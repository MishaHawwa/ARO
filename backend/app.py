from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit
import random
import time
from datetime import datetime
import math
from geopy.distance import geodesic
import numpy as np
from sklearn.ensemble import RandomForestRegressor

app = Flask(__name__)
CORS(app)
socketio = SocketIO(app, cors_allowed_origins="*")

# Bhatkal Hospital Database - Real hospitals with accurate locations and facilities
hospitals = [
    {
        "id": 1,
        "name": "Bhatkal Government Hospital",
        "location": {"lat": 13.9667, "lng": 74.5667},  # Main government hospital
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 45,
        "specialists": ["general_physician", "trauma", "obstetrician", "pediatrician"]
    },
    {
        "id": 2,
        "name": "Peace Hospital Bhatkal",
        "location": {"lat": 13.9645, "lng": 74.5645},  # Private hospital near market
        "cardiac_icu": True,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 25,
        "specialists": ["cardiologist", "trauma", "burn", "obstetrician", "general_physician"]
    },
    {
        "id": 3,
        "name": "Al-Shifa Hospital",
        "location": {"lat": 13.9678, "lng": 74.5689},  # Near bus stand
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 20,
        "specialists": ["general_physician", "trauma", "obstetrician"]
    },
    {
        "id": 4,
        "name": "Bhatkal Taluk Hospital",
        "location": {"lat": 13.9712, "lng": 74.5634},  # Taluk hospital
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 35,
        "specialists": ["general_physician", "trauma", "burn", "obstetrician", "pediatrician"]
    },
    {
        "id": 5,
        "name": "Navayuga Hospital",
        "location": {"lat": 13.9634, "lng": 74.5612},  # Private clinic
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": False,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 12,
        "specialists": ["general_physician", "obstetrician"]
    },
    {
        "id": 6,
        "name": "Murdeshwar Hospital",
        "location": {"lat": 14.0942, "lng": 74.4847},  # Nearby Murdeshwar (15km)
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 40,
        "specialists": ["cardiologist", "neurologist", "trauma", "burn", "obstetrician"]
    },
    {
        "id": 7,
        "name": "Kundapur Government Hospital",
        "location": {"lat": 13.6167, "lng": 74.6833},  # Kundapur (40km south)
        "cardiac_icu": True,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 50,
        "specialists": ["cardiologist", "trauma", "burn", "obstetrician", "general_physician"]
    }
]

# Bhatkal Ambulance Database - Strategic locations for minimal response time
ambulances = [
    {"id": "KA-19-EM-001", "location": {"lat": 13.9667, "lng": 74.5667}, "available": True},  # Government Hospital
    {"id": "KA-19-EM-002", "location": {"lat": 13.9645, "lng": 74.5645}, "available": True},  # Peace Hospital
    {"id": "KA-19-EM-003", "location": {"lat": 13.9678, "lng": 74.5689}, "available": True},  # Al-Shifa Hospital
    {"id": "KA-19-EM-004", "location": {"lat": 13.9712, "lng": 74.5634}, "available": True},  # Taluk Hospital
    {"id": "KA-19-EM-005", "location": {"lat": 13.9650, "lng": 74.5650}, "available": True},  # Central Bhatkal
    {"id": "KA-19-EM-006", "location": {"lat": 13.9680, "lng": 74.5620}, "available": True},  # Market area
    {"id": "KA-19-EM-007", "location": {"lat": 13.9640, "lng": 74.5680}, "available": True},  # Residential area
    {"id": "KA-19-EM-008", "location": {"lat": 14.0942, "lng": 74.4847}, "available": True}   # Murdeshwar backup
]

# Emergency type requirements mapping - Adapted for Bhatkal's medical facilities
emergency_requirements = {
    "Heart Attack": {
        "severity": "Critical",
        "required_facility": "cardiac_icu",
        "required_specialist": "cardiologist",
        "priority_score": 10,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Stroke": {
        "severity": "Critical",
        "required_facility": "neuro_icu",
        "required_specialist": "neurologist",
        "priority_score": 10,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Accident": {
        "severity": "High",
        "required_facility": "trauma_center",
        "required_specialist": "trauma",
        "priority_score": 8,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Burns": {
        "severity": "High",
        "required_facility": "burn_unit",
        "required_specialist": "burn",
        "priority_score": 8,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Pregnancy Emergency": {
        "severity": "High",
        "required_facility": "maternity_ward",
        "required_specialist": "obstetrician",
        "priority_score": 9,
        "fallback_facility": "maternity_ward",
        "fallback_specialist": "general_physician"
    },
    "Difficulty Breathing": {
        "severity": "Critical",
        "required_facility": "trauma_center",
        "required_specialist": "general_physician",
        "priority_score": 9,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Seizure": {
        "severity": "High",
        "required_facility": "neuro_icu",
        "required_specialist": "neurologist",
        "priority_score": 8,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Poisoning": {
        "severity": "Critical",
        "required_facility": "trauma_center",
        "required_specialist": "general_physician",
        "priority_score": 9,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Fracture": {
        "severity": "Medium",
        "required_facility": "trauma_center",
        "required_specialist": "trauma",
        "priority_score": 6,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Child Emergency": {
        "severity": "High",
        "required_facility": "trauma_center",
        "required_specialist": "pediatrician",
        "priority_score": 9,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Drowning": {
        "severity": "Critical",
        "required_facility": "trauma_center",
        "required_specialist": "general_physician",
        "priority_score": 10,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    },
    "Electric Shock": {
        "severity": "High",
        "required_facility": "trauma_center",
        "required_specialist": "general_physician",
        "priority_score": 8,
        "fallback_facility": "trauma_center",
        "fallback_specialist": "general_physician"
    }
}

# AI suggestions for each emergency type
ai_suggestions = {
    "Heart Attack": {
        "immediate_actions": [
            "Call emergency services immediately (already done)",
            "Have the patient sit down and rest in a comfortable position",
            "If available, give aspirin (300mg) to chew slowly",
            "Loosen any tight clothing around neck and chest",
            "Stay calm and reassure the patient",
            "If patient becomes unconscious, prepare for CPR"
        ],
        "warning_signs": [
            "Chest pain or discomfort",
            "Pain in arms, neck, jaw, or back",
            "Shortness of breath",
            "Cold sweat, nausea"
        ],
        "do_not": [
            "Do not leave the patient alone",
            "Do not give food or water",
            "Do not wait to see if symptoms go away"
        ]
    },
    "Stroke": {
        "immediate_actions": [
            "Note the time when symptoms first appeared",
            "Keep the patient calm and lying down with head slightly elevated",
            "Do not give any food, drinks, or medication",
            "Loosen tight clothing",
            "Check if patient can smile, raise both arms, speak clearly (FAST test)",
            "Monitor breathing and consciousness"
        ],
        "warning_signs": [
            "Face drooping on one side",
            "Arm weakness or numbness",
            "Speech difficulty or slurred speech",
            "Sudden confusion or trouble seeing"
        ],
        "do_not": [
            "Do not give aspirin (unlike heart attack)",
            "Do not give food or water",
            "Do not let patient sleep"
        ]
    },
    "Accident": {
        "immediate_actions": [
            "Ensure scene safety before approaching",
            "Do not move the patient unless in immediate danger",
            "Control any visible bleeding with direct pressure",
            "Keep the patient still, especially if spinal injury suspected",
            "Cover the patient to prevent shock",
            "Monitor breathing and consciousness"
        ],
        "warning_signs": [
            "Severe bleeding",
            "Unconsciousness",
            "Difficulty breathing",
            "Suspected broken bones or spinal injury"
        ],
        "do_not": [
            "Do not move patient if spinal injury suspected",
            "Do not remove embedded objects",
            "Do not give food or water"
        ]
    },
    "Burns": {
        "immediate_actions": [
            "Remove patient from heat source safely",
            "Cool the burn with cool (not ice-cold) running water for 10-20 minutes",
            "Remove jewelry and tight clothing before swelling starts",
            "Cover burn with clean, dry cloth or sterile dressing",
            "Do not apply ice, butter, or ointments",
            "Keep patient warm to prevent shock"
        ],
        "warning_signs": [
            "Burns larger than 3 inches",
            "Burns on face, hands, feet, or genitals",
            "Third-degree burns (white or charred skin)",
            "Chemical or electrical burns"
        ],
        "do_not": [
            "Do not apply ice directly",
            "Do not break blisters",
            "Do not apply butter, oil, or ointments"
        ]
    },
    "Pregnancy Emergency": {
        "immediate_actions": [
            "Keep the mother calm and comfortable",
            "Position her on her left side if possible",
            "Do not give food or water",
            "Monitor contractions (frequency and duration)",
            "Check for bleeding or fluid leakage",
            "Prepare for possibility of delivery en route"
        ],
        "warning_signs": [
            "Severe abdominal pain",
            "Heavy bleeding",
            "Water breaking",
            "Contractions less than 5 minutes apart",
            "Decreased fetal movement"
        ],
        "do_not": [
            "Do not panic - stay calm",
            "Do not give medications without medical advice",
            "Do not attempt to delay delivery if imminent"
        ]
    },
    "Difficulty Breathing": {
        "immediate_actions": [
            "Help patient sit upright in comfortable position",
            "Loosen tight clothing around neck and chest",
            "Encourage slow, deep breathing",
            "If patient has inhaler, help them use it",
            "Stay calm and reassure the patient",
            "Monitor breathing rate and consciousness"
        ],
        "warning_signs": [
            "Blue lips or fingernails",
            "Severe shortness of breath",
            "Cannot speak in full sentences",
            "Wheezing or gasping sounds",
            "Chest pain with breathing"
        ],
        "do_not": [
            "Do not leave patient alone",
            "Do not give food or water",
            "Do not let patient lie flat if conscious"
        ]
    },
    "Seizure": {
        "immediate_actions": [
            "Stay calm and time the seizure",
            "Clear area of dangerous objects",
            "Place something soft under patient's head",
            "Turn patient on their side after seizure stops",
            "Do not restrain or hold down the patient",
            "Stay with patient until fully conscious"
        ],
        "warning_signs": [
            "Seizure lasts more than 5 minutes",
            "Multiple seizures without recovery",
            "Difficulty breathing after seizure",
            "Injury during seizure",
            "First-time seizure"
        ],
        "do_not": [
            "Do not put anything in patient's mouth",
            "Do not restrain the patient",
            "Do not give water or food immediately after"
        ]
    },
    "Poisoning": {
        "immediate_actions": [
            "Identify the poison if possible (keep container)",
            "If conscious, rinse mouth with water",
            "Remove contaminated clothing if skin contact",
            "Do not induce vomiting unless instructed",
            "Monitor breathing and consciousness",
            "Collect vomit sample if it occurs naturally"
        ],
        "warning_signs": [
            "Nausea and vomiting",
            "Difficulty breathing",
            "Confusion or drowsiness",
            "Burns around mouth (chemical poisoning)",
            "Unusual breath odor"
        ],
        "do_not": [
            "Do not induce vomiting",
            "Do not give milk or water unless instructed",
            "Do not give activated charcoal without medical advice"
        ]
    },
    "Fracture": {
        "immediate_actions": [
            "Do not move the injured area",
            "Apply ice wrapped in cloth to reduce swelling",
            "Support the injured limb with splint if trained",
            "Control any bleeding with direct pressure",
            "Keep patient still and comfortable",
            "Monitor for signs of shock"
        ],
        "warning_signs": [
            "Visible deformity",
            "Severe pain and swelling",
            "Inability to move the area",
            "Numbness or tingling",
            "Bone protruding through skin"
        ],
        "do_not": [
            "Do not move the broken bone",
            "Do not give food or water",
            "Do not apply ice directly to skin"
        ]
    },
    "Child Emergency": {
        "immediate_actions": [
            "Stay calm to keep the child calm",
            "Assess breathing and consciousness",
            "Control any bleeding with gentle pressure",
            "Keep child warm and comfortable",
            "Speak in soothing, reassuring voice",
            "Allow parent/guardian to stay close if possible"
        ],
        "warning_signs": [
            "Difficulty breathing",
            "Unconsciousness",
            "Severe bleeding",
            "High fever with lethargy",
            "Signs of dehydration"
        ],
        "do_not": [
            "Do not leave child alone",
            "Do not give medications without medical advice",
            "Do not force food or water if unconscious"
        ]
    },
    "Drowning": {
        "immediate_actions": [
            "Remove person from water safely",
            "Check for breathing and pulse",
            "Begin CPR if no breathing/pulse",
            "Clear airway of water/debris if visible",
            "Keep person warm to prevent hypothermia",
            "Monitor for secondary drowning symptoms"
        ],
        "warning_signs": [
            "No breathing or gasping",
            "Blue lips or skin",
            "Unconsciousness",
            "Vomiting water",
            "Extreme fatigue after rescue"
        ],
        "do_not": [
            "Do not assume person is fine after rescue",
            "Do not leave person alone",
            "Do not give up CPR too quickly"
        ]
    },
    "Electric Shock": {
        "immediate_actions": [
            "Turn off power source if safely possible",
            "Do not touch person if still in contact with electricity",
            "Use non-conductive object to separate if needed",
            "Check for breathing and pulse",
            "Begin CPR if necessary",
            "Cover electrical burns with sterile dressing"
        ],
        "warning_signs": [
            "Burns at entry and exit points",
            "Irregular heartbeat",
            "Muscle pain and contractions",
            "Difficulty breathing",
            "Confusion or memory loss"
        ],
        "do_not": [
            "Do not touch person while electricity is on",
            "Do not use water near electrical source",
            "Do not move person unless absolutely necessary"
        ]
    }
}

# Realistic ETA prediction for Bhatkal emergency vehicles
def predict_eta(distance_km, traffic_factor=0.3, time_of_day=0.3):
    """Predict realistic ETA for emergency ambulance in Bhatkal"""
    # Bhatkal is a smaller coastal town with different road conditions
    # Emergency ambulance speed: 40-60 km/h (average 50 km/h) due to narrow roads
    base_speed_kmh = 50  # km/h for emergency vehicle in small town
    base_time = (distance_km / base_speed_kmh) * 60  # Convert to minutes
    
    # Traffic factor adjustment (less traffic in small town)
    # 0.0 = no traffic, 0.3 = normal, 0.7 = festival/market day traffic
    traffic_delay = base_time * traffic_factor * 0.15  # Max 15% delay
    
    # Time of day factor (less impact in small town)
    # 0.0 = night, 0.3 = normal day, 0.7 = peak hours (market time, school time)
    time_delay = base_time * time_of_day * 0.1  # Max 10% delay
    
    total_time = base_time + traffic_delay + time_delay
    
    # Realistic bounds for Bhatkal: minimum 1 minute, maximum 15 minutes for local distances
    # For longer distances (to Murdeshwar/Kundapur), can be up to 45 minutes
    if distance_km > 20:  # Long distance (to other towns)
        return max(15, min(45, int(total_time)))
    else:  # Local Bhatkal area
        return max(1, min(15, int(total_time)))

def calculate_distance(loc1, loc2):
    """Calculate distance between two coordinates in km"""
    return geodesic((loc1['lat'], loc1['lng']), (loc2['lat'], loc2['lng'])).km

def score_hospital(hospital, emergency_type, patient_location):
    """Score hospital based on multiple factors - with fallback options for Bhatkal"""
    requirements = emergency_requirements.get(emergency_type, {})
    
    # Check if hospital has required facility
    required_facility = requirements.get('required_facility')
    has_required_facility = hospital.get(required_facility, False)
    
    # Check if hospital has required specialist
    required_specialist = requirements.get('required_specialist')
    has_required_specialist = required_specialist in hospital.get('specialists', [])
    
    # For Bhatkal, use fallback options if primary not available
    fallback_facility = requirements.get('fallback_facility')
    fallback_specialist = requirements.get('fallback_specialist')
    
    has_fallback_facility = hospital.get(fallback_facility, False) if fallback_facility else False
    has_fallback_specialist = fallback_specialist in hospital.get('specialists', []) if fallback_specialist else False
    
    # Scoring logic with fallback
    if has_required_facility and has_required_specialist:
        facility_score = 0  # Perfect match
    elif has_fallback_facility and has_fallback_specialist:
        facility_score = 5  # Acceptable fallback
    elif has_fallback_facility or has_fallback_specialist:
        facility_score = 10  # Partial capability
    else:
        return -1  # Hospital cannot handle this emergency
    
    # Calculate distance (primary factor for emergencies)
    distance = calculate_distance(patient_location, hospital['location'])
    distance_score = distance * 8  # Heavy weight on distance for emergencies
    
    # Bed availability (secondary factor)
    bed_score = max(0, 3 - hospital['beds_available']) * 0.3
    
    # Bhatkal proximity bonus (prioritize local hospitals)
    if distance < 1:  # Within 1km (very local)
        distance_score *= 0.5  # 50% bonus
    elif distance < 3:  # Within 3km (local Bhatkal)
        distance_score *= 0.8  # 20% bonus
    
    total_score = facility_score + distance_score + bed_score
    return total_score

@app.route('/api/emergency', methods=['POST'])
def handle_emergency():
    data = request.json
    emergency_type = data.get('type')
    patient_location = data.get('location')
    
    # Find best hospital
    suitable_hospitals = []
    for hospital in hospitals:
        score = score_hospital(hospital, emergency_type, patient_location)
        if score >= 0:  # Hospital is suitable
            distance = calculate_distance(patient_location, hospital['location'])
            suitable_hospitals.append({
                'hospital': hospital,
                'score': score,
                'distance': distance
            })
    
    if not suitable_hospitals:
        return jsonify({'error': 'No suitable hospital found'}), 404
    
    # Sort by score (lower is better)
    suitable_hospitals.sort(key=lambda x: x['score'])
    best_hospital = suitable_hospitals[0]['hospital']
    
    # Find nearest available ambulance
    available_ambulances = [a for a in ambulances if a['available']]
    if not available_ambulances:
        return jsonify({'error': 'No ambulance available'}), 404
    
    nearest_ambulance = min(
        available_ambulances,
        key=lambda a: calculate_distance(patient_location, a['location'])
    )
    
    # Mark ambulance as unavailable
    nearest_ambulance['available'] = False
    
    # Calculate ETA with realistic factors for Bhatkal
    distance_to_patient = calculate_distance(nearest_ambulance['location'], patient_location)
    distance_to_hospital = calculate_distance(patient_location, best_hospital['location'])
    
    # Current time factor for Bhatkal (smaller town, less traffic variation)
    current_hour = datetime.now().hour
    if 7 <= current_hour <= 9 or 17 <= current_hour <= 19:  # School/work hours
        time_factor = 0.4  # Moderate traffic
    elif 10 <= current_hour <= 16:  # Normal day hours
        time_factor = 0.2  # Light traffic
    else:  # Night/early morning
        time_factor = 0.1  # Very light traffic
    
    # Traffic factor based on location (Bhatkal has minimal traffic)
    traffic_factor = min(0.3, distance_to_hospital * 0.05)  # Max 30% traffic impact
    
    eta_to_patient = predict_eta(distance_to_patient, traffic_factor, time_factor)
    eta_to_hospital = predict_eta(distance_to_hospital, traffic_factor, time_factor)
    total_eta = eta_to_patient + eta_to_hospital
    
    # Get emergency details
    emergency_details = emergency_requirements.get(emergency_type, {})
    
    # Get AI suggestions
    suggestions = ai_suggestions.get(emergency_type, {})
    
    response = {
        'emergency_id': f"EMG-{int(time.time())}",
        'emergency_type': emergency_type,
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
        'patient_location': patient_location,
        'eta': total_eta,
        'distance': round(distance_to_hospital, 2),
        'ai_suggestions': suggestions,
        'rejected_hospitals': [
            {
                'name': h['hospital']['name'],
                'reason': 'Missing required facility or specialist'
            }
            for h in suitable_hospitals[1:3]
        ] if len(suitable_hospitals) > 1 else []
    }
    
    return jsonify(response)

@app.route('/api/hospitals', methods=['GET'])
def get_hospitals():
    return jsonify(hospitals)

@app.route('/api/ambulances', methods=['GET'])
def get_ambulances():
    return jsonify(ambulances)

# WebSocket for live tracking
@socketio.on('connect')
def handle_connect():
    print('Client connected')
    emit('connected', {'data': 'Connected to server'})

@socketio.on('start_tracking')
def handle_tracking(data):
    emergency_id = data.get('emergency_id')
    ambulance_location = data.get('ambulance_location')
    patient_location = data.get('patient_location')
    hospital_location = data.get('hospital_location')
    
    # Simulate ambulance movement
    def simulate_movement():
        current_location = ambulance_location.copy()
        
        # First move to patient
        steps = 20
        for i in range(steps):
            progress = (i + 1) / steps
            current_location['lat'] = ambulance_location['lat'] + (patient_location['lat'] - ambulance_location['lat']) * progress
            current_location['lng'] = ambulance_location['lng'] + (patient_location['lng'] - ambulance_location['lng']) * progress
            
            socketio.emit('ambulance_update', {
                'emergency_id': emergency_id,
                'location': current_location.copy(),
                'status': 'En Route to Patient',
                'progress': progress * 50  # 0-50%
            })
            socketio.sleep(0.5)
        
        # Then move to hospital
        for i in range(steps):
            progress = (i + 1) / steps
            current_location['lat'] = patient_location['lat'] + (hospital_location['lat'] - patient_location['lat']) * progress
            current_location['lng'] = patient_location['lng'] + (hospital_location['lng'] - patient_location['lng']) * progress
            
            socketio.emit('ambulance_update', {
                'emergency_id': emergency_id,
                'location': current_location.copy(),
                'status': 'En Route to Hospital',
                'progress': 50 + progress * 50  # 50-100%
            })
            socketio.sleep(0.5)
        
        socketio.emit('ambulance_arrived', {
            'emergency_id': emergency_id,
            'message': 'Ambulance arrived at hospital'
        })
    
    socketio.start_background_task(simulate_movement)

if __name__ == '__main__':
    socketio.run(app, debug=True, port=5000, allow_unsafe_werkzeug=True)
