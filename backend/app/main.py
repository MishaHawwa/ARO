from fastapi import FastAPI, HTTPException
from fastapi.middleware.cors import CORSMiddleware
from pydantic import BaseModel
import time
import math
from geopy.distance import geodesic
from .models.mock_db import hospitals, ambulances, emergency_requirements, ai_suggestions
from .realtime.websocket import router as websocket_router

app = FastAPI(title="MediLink Elite API", version="1.0.0")

app.include_router(websocket_router)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

class Location(BaseModel):
    lat: float
    lng: float

class EmergencyRequest(BaseModel):
    type: str
    location: Location

def calculate_distance(loc1, loc2):
    return geodesic((loc1['lat'], loc1['lng']), (loc2['lat'], loc2['lng'])).km

def predict_eta(distance_km, traffic_factor=0.5, time_of_day=0.5):
    base_time = distance_km * 2
    traffic_adjustment = base_time * traffic_factor * 0.5
    time_adjustment = base_time * time_of_day * 0.3
    total_time = base_time + traffic_adjustment + time_adjustment
    return max(3, int(total_time))

def score_hospital(hospital, emergency_type, patient_location):
    requirements = emergency_requirements.get(emergency_type, {})
    required_facility = requirements.get('required_facility')
    if not hospital.get(required_facility, False):
        return -1
    required_specialist = requirements.get('required_specialist')
    if required_specialist not in hospital.get('specialists', []):
        return -1
    distance = calculate_distance(patient_location, hospital['location'])
    distance_score = distance * 2
    bed_score = max(0, 10 - hospital['beds_available'])
    return distance_score + bed_score

@app.post("/api/emergency")
async def handle_emergency(req: EmergencyRequest):
    patient_loc = {"lat": req.location.lat, "lng": req.location.lng}
    suitable_hospitals = []
    
    for hospital in hospitals:
        score = score_hospital(hospital, req.type, patient_loc)
        if score >= 0:
            distance = calculate_distance(patient_loc, hospital['location'])
            suitable_hospitals.append({
                'hospital': hospital,
                'score': score,
                'distance': distance
            })
            
    if not suitable_hospitals:
        raise HTTPException(status_code=404, detail="No suitable hospital found")
        
    suitable_hospitals.sort(key=lambda x: x['score'])
    best_hospital = suitable_hospitals[0]['hospital']
    
    available_ambulances = [a for a in ambulances if a['available']]
    if not available_ambulances:
        raise HTTPException(status_code=404, detail="No ambulance available")
        
    nearest_ambulance = min(
        available_ambulances,
        key=lambda a: calculate_distance(patient_loc, a['location'])
    )
    
    nearest_ambulance['available'] = False
    
    dist_to_patient = calculate_distance(nearest_ambulance['location'], patient_loc)
    dist_to_hospital = calculate_distance(patient_loc, best_hospital['location'])
    
    total_eta = predict_eta(dist_to_patient) + predict_eta(dist_to_hospital)
    emergency_details = emergency_requirements.get(req.type, {})
    suggestions = ai_suggestions.get(req.type, {})
    
    return {
        'emergency_id': f"EMG-{int(time.time())}",
        'emergency_type': req.type,
        'severity': emergency_details.get('severity', 'High'),
        'hospital': {
            'id': best_hospital['id'],
            'name': best_hospital['name'],
            'location': best_hospital['location'],
            'beds_available': best_hospital['beds_available']
        },
        'ambulance': {
            'id': nearest_ambulance['id'],
            'location': nearest_ambulance['location']
        },
        'patient_location': patient_loc,
        'eta': total_eta,
        'distance': round(dist_to_hospital, 2),
        'ai_suggestions': suggestions,
        'rejected_hospitals': [
            {
                'name': h['hospital']['name'],
                'reason': 'Missing required facility or specialist'
            }
            for h in suitable_hospitals[1:3]
        ] if len(suitable_hospitals) > 1 else []
    }

@app.get("/api/hospitals")
async def get_hospitals():
    return hospitals

@app.get("/api/ambulances")
async def get_ambulances():
    return ambulances
