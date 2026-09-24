from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room
import random
import time
from datetime import datetime
import math
import os
from geopy.distance import geodesic
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
import joblib
from traffic import get_traffic_factor

# Load the trained ETA model (built by train_eta_model.py) if it exists.
# Falls back to the hand-written formula below when it doesn't, so the app
# still runs even if someone hasn't trained a model yet.
ETA_MODEL_PATH = os.path.join(os.path.dirname(__file__), "models", "eta_model.pkl")
try:
    eta_model = joblib.load(ETA_MODEL_PATH)
    print(f"[ETA] Loaded trained model from {ETA_MODEL_PATH}")
except FileNotFoundError:
    eta_model = None
    print("[ETA] No trained model found - using rule-based fallback. "
          "Run `python train_eta_model.py` to train one.")

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
    {"id": "KA-19-EM-001", "location": {"lat": 13.9667, "lng": 74.5667}, "available": True, "phone": "+910000000001"},  # Government Hospital
    {"id": "KA-19-EM-002", "location": {"lat": 13.9645, "lng": 74.5645}, "available": True, "phone": "+910000000002"},  # Peace Hospital
    {"id": "KA-19-EM-003", "location": {"lat": 13.9678, "lng": 74.5689}, "available": True, "phone": "+910000000003"},  # Al-Shifa Hospital
    {"id": "KA-19-EM-004", "location": {"lat": 13.9712, "lng": 74.5634}, "available": True, "phone": "+910000000004"},  # Taluk Hospital
    {"id": "KA-19-EM-005", "location": {"lat": 13.9650, "lng": 74.5650}, "available": True, "phone": "+910000000005"},  # Central Bhatkal
    {"id": "KA-19-EM-006", "location": {"lat": 13.9680, "lng": 74.5620}, "available": True, "phone": "+910000000006"},  # Market area
    {"id": "KA-19-EM-007", "location": {"lat": 13.9640, "lng": 74.5680}, "available": True, "phone": "+910000000007"},  # Residential area
    {"id": "KA-19-EM-008", "location": {"lat": 14.0942, "lng": 74.4847}, "available": True, "phone": "+910000000008"}   # Murdeshwar backup
]

# NOTE on real hospital/ambulance data:
# The records above are still placeholders for the Bhatkal demo. See
# backend/fetch_real_hospitals.py to pull real hospital names/locations
# from OpenStreetMap for any city, and swap ambulance "phone" numbers for
# your real fleet's numbers before wiring up the Twilio call fallback.

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
    """Predict realistic ETA for emergency ambulance in Bhatkal.

    Uses the trained RandomForestRegressor (backend/models/eta_model.pkl)
    when available; otherwise falls back to the original hand-tuned formula.
    """
    if eta_model is not None:
        features = pd.DataFrame(
            [[distance_km, traffic_factor, time_of_day]],
            columns=["distance_km", "traffic_factor", "time_of_day"],
        )
        total_time = eta_model.predict(features)[0]
    else:
        # --- fallback formula (used only if no trained model is present) ---
        base_speed_kmh = 50
        base_time = (distance_km / base_speed_kmh) * 60
        traffic_delay = base_time * traffic_factor * 0.15
        time_delay = base_time * time_of_day * 0.1
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

def score_hospital_breakdown(hospital, emergency_type, patient_location):
    """
    Full scoring breakdown for one hospital against one emergency.
    Internally we compute a *penalty* (lower = better: less distance, better
    facility match, more beds) because that's simplest to reason about.
    We also derive a 0-100 "match_score" (higher = better) purely for
    display in the Hospital Scoring System UI, so it reads the way people
    expect a "score" to read. Both are derived from the same numbers, so
    they always agree on which hospital wins.

    Returns a dict; eligible=False means this hospital cannot handle the
    emergency at all (missing facility AND specialist, no fallback either).
    """
    requirements = emergency_requirements.get(emergency_type, {})

    required_facility = requirements.get('required_facility')
    has_required_facility = hospital.get(required_facility, False)

    required_specialist = requirements.get('required_specialist')
    has_required_specialist = required_specialist in hospital.get('specialists', [])

    fallback_facility = requirements.get('fallback_facility')
    fallback_specialist = requirements.get('fallback_specialist')

    has_fallback_facility = hospital.get(fallback_facility, False) if fallback_facility else False
    has_fallback_specialist = fallback_specialist in hospital.get('specialists', []) if fallback_specialist else False

    distance = calculate_distance(patient_location, hospital['location'])

    if has_required_facility and has_required_specialist:
        facility_score = 0
        match_label = 'Exact match'
    elif has_fallback_facility and has_fallback_specialist:
        facility_score = 5
        match_label = 'Fallback facility'
    elif has_fallback_facility or has_fallback_specialist:
        facility_score = 10
        match_label = 'Partial capability'
    else:
        return {
            'hospital_id': hospital['id'],
            'hospital_name': hospital['name'],
            'eligible': False,
            'reason': 'No matching or fallback facility/specialist',
            'distance_km': round(distance, 2),
            'match_score': 0,
        }

    distance_score = distance * 8
    bed_score = max(0, 3 - hospital['beds_available']) * 0.3

    if distance < 1:
        distance_score *= 0.5
    elif distance < 3:
        distance_score *= 0.8

    total_penalty = facility_score + distance_score + bed_score

    # Convert penalty -> a friendly 0-100 "higher is better" match score.
    # 0 penalty -> 100. Penalty grows roughly linearly with distance*8, so a
    # penalty of 40 (~5km with no bonus) maps close to 0.
    match_score = max(0, round(100 - (total_penalty * 2.2)))

    return {
        'hospital_id': hospital['id'],
        'hospital_name': hospital['name'],
        'eligible': True,
        'match_label': match_label,
        'distance_km': round(distance, 2),
        'beds_available': hospital['beds_available'],
        'penalty': round(total_penalty, 2),   # lower = better (internal)
        'match_score': match_score,           # higher = better (display)
    }


def score_hospital(hospital, emergency_type, patient_location):
    """Backwards-compatible wrapper: returns the internal penalty score, or
    -1 if the hospital is not eligible. Existing selection logic uses this."""
    breakdown = score_hospital_breakdown(hospital, emergency_type, patient_location)
    if not breakdown['eligible']:
        return -1
    return breakdown['penalty']

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

    # Full scoring breakdown for every hospital (eligible or not), for the
    # Hospital Scoring System panel on the tracking screen. Sorted so the
    # highest match_score (the one that gets assigned) is first.
    hospital_scores = [
        score_hospital_breakdown(h, emergency_type, patient_location)
        for h in hospitals
    ]
    hospital_scores.sort(key=lambda s: s['match_score'], reverse=True)
    for s in hospital_scores:
        s['assigned'] = (s['hospital_id'] == best_hospital['id'])
    
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
    emergency_id = f"EMG-{int(time.time())}"
    nearest_ambulance['current_emergency_id'] = emergency_id
    nearest_ambulance['driver_status'] = 'notified'
    
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
    
    # Real-time traffic factor (see traffic.py). Uses live Google Distance
    # Matrix data if GOOGLE_MAPS_API_KEY is set; otherwise falls back to a
    # neutral placeholder so the app still runs with zero setup.
    traffic_factor = get_traffic_factor(nearest_ambulance['location'], best_hospital['location'])
    
    eta_to_patient = predict_eta(distance_to_patient, traffic_factor, time_factor)
    eta_to_hospital = predict_eta(distance_to_hospital, traffic_factor, time_factor)
    total_eta = eta_to_patient + eta_to_hospital
    
    # Get emergency details
    emergency_details = emergency_requirements.get(emergency_type, {})
    
    # Get AI suggestions
    suggestions = ai_suggestions.get(emergency_type, {})
    
    response = {
        'emergency_id': emergency_id,
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
        'hospital_scores': hospital_scores,
        'rejected_hospitals': [
            {
                'name': h['hospital']['name'],
                'reason': 'Missing required facility or specialist'
            }
            for h in suitable_hospitals[1:3]
        ] if len(suitable_hospitals) > 1 else []
    }

    # Notify the ambulance driver app in real time. The driver's app joins
    # a room called "ambulance_<id>" (see the 'join_ambulance' handler
    # below) as soon as it opens, so this reaches it instantly if it's
    # online. See notify_ambulance() for the call/SMS fallback.
    notify_ambulance(nearest_ambulance, response)

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


# ============================================================
# AMBULANCE-SIDE NOTIFICATION
# ============================================================
# Two layers, so a driver never misses a job:
#   1. Real-time push over Socket.IO to the ambulance driver app/screen
#      (instant, free, works as long as the driver's app is open).
#   2. An automated phone call via Twilio if nobody accepts within
#      RESPONSE_TIMEOUT_SECONDS (works even if the app crashed, phone is
#      locked, or the driver is on a different screen).
# Set TWILIO_ACCOUNT_SID / TWILIO_AUTH_TOKEN / TWILIO_FROM_NUMBER as
# environment variables to enable step 2; it's skipped (logged only) if
# they're not set, so the app still works without a Twilio account.

RESPONSE_TIMEOUT_SECONDS = 25

try:
    from twilio.rest import Client as TwilioClient
    TWILIO_SID = os.environ.get('TWILIO_ACCOUNT_SID')
    TWILIO_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN')
    TWILIO_FROM = os.environ.get('TWILIO_FROM_NUMBER')
    twilio_client = TwilioClient(TWILIO_SID, TWILIO_TOKEN) if (TWILIO_SID and TWILIO_TOKEN) else None
except Exception as e:
    twilio_client = None


def call_ambulance_fallback(ambulance, response):
    """Places an automated call to the driver reading out the job, used only
    if the Socket.IO push wasn't acknowledged in time. Requires a Twilio
    account (see the env vars above) and a real phone number on the
    ambulance record."""
    if twilio_client is None:
        print(f"[Ambulance Fallback] Twilio not configured - would have called "
              f"{ambulance.get('phone')} for {response['emergency_id']}")
        return
    twiml = (f"<Response><Say>New emergency assignment. "
              f"{response['emergency_type']}, severity {response['severity']}. "
              f"Please open your driver app to accept.</Say></Response>")
    try:
        twilio_client.calls.create(
            twiml=twiml,
            to=ambulance['phone'],
            from_=TWILIO_FROM,
        )
        print(f"[Ambulance Fallback] Called {ambulance['phone']}")
    except Exception as e:
        print(f"[Ambulance Fallback] Twilio call failed: {e}")


def notify_ambulance(ambulance, response):
    """Push the new job to the driver app in real time, and arm the call
    fallback in case nobody acknowledges it."""
    job_payload = {
        'emergency_id': response['emergency_id'],
        'emergency_type': response['emergency_type'],
        'severity': response['severity'],
        'patient_location': response['patient_location'],
        'hospital': response['hospital'],
        'eta': response['eta'],
    }
    socketio.emit('new_assignment', job_payload, room=f"ambulance_{ambulance['id']}")
    print(f"[Ambulance] Notified {ambulance['id']} of {response['emergency_id']}")

    def arm_fallback():
        socketio.sleep(RESPONSE_TIMEOUT_SECONDS)
        # Re-fetch current state - the driver may have accepted by now.
        current = next((a for a in ambulances if a['id'] == ambulance['id']), None)
        if current and current.get('driver_status') == 'notified':
            call_ambulance_fallback(current, response)

    socketio.start_background_task(arm_fallback)


@socketio.on('join_ambulance')
def handle_join_ambulance(data):
    """The ambulance driver app calls this right after connecting so it can
    receive 'new_assignment' events addressed to it specifically."""
    ambulance_id = data.get('ambulance_id')
    if ambulance_id:
        join_room(f"ambulance_{ambulance_id}")
        emit('joined', {'ambulance_id': ambulance_id})


@app.route('/api/ambulance/<ambulance_id>/respond', methods=['POST'])
def ambulance_respond(ambulance_id):
    """Driver taps Accept/Decline in the driver app."""
    data = request.json or {}
    accepted = data.get('accepted', True)
    ambulance = next((a for a in ambulances if a['id'] == ambulance_id), None)
    if not ambulance:
        return jsonify({'error': 'Unknown ambulance'}), 404

    if accepted:
        ambulance['driver_status'] = 'accepted'
        socketio.emit('driver_responded', {
            'ambulance_id': ambulance_id,
            'emergency_id': ambulance.get('current_emergency_id'),
            'status': 'accepted',
        })
    else:
        # Free the ambulance back up; in production you'd re-run hospital/
        # ambulance assignment here to find the next-best option.
        ambulance['available'] = True
        ambulance['driver_status'] = 'declined'
        ambulance['current_emergency_id'] = None

    return jsonify({'ok': True, 'status': ambulance['driver_status']})


@app.route('/api/ambulance/<ambulance_id>/status', methods=['POST'])
def ambulance_status(ambulance_id):
    """Driver updates their status: en_route_to_patient, picked_up,
    en_route_to_hospital, arrived. Pushed live to the citizen's tracking
    screen over the 'ambulance_update'/'ambulance_arrived' events it
    already listens for."""
    data = request.json or {}
    status = data.get('status')
    ambulance = next((a for a in ambulances if a['id'] == ambulance_id), None)
    if not ambulance:
        return jsonify({'error': 'Unknown ambulance'}), 404

    ambulance['driver_status'] = status
    socketio.emit('ambulance_update', {
        'emergency_id': ambulance.get('current_emergency_id'),
        'location': ambulance['location'],
        'status': status,
    })
    if status == 'arrived':
        socketio.emit('ambulance_arrived', {
            'emergency_id': ambulance.get('current_emergency_id'),
        })
        ambulance['available'] = True
        ambulance['current_emergency_id'] = None

    return jsonify({'ok': True})


# ============================================================# ============================================================
# EMERGENCY CHATBOT (voice-in-text-out via the browser, text in/out here)
# ============================================================
def generate_offline_chat_response(user_message, emergency_type):
    msg_lower = user_message.lower()
    
    # Lookup suggestions for the active emergency type
    suggestions = ai_suggestions.get(emergency_type, {})
    imm = suggestions.get('immediate_actions', [])
    warn = suggestions.get('warning_signs', [])
    donot = suggestions.get('do_not', [])
    
    if any(w in msg_lower for w in ['water', 'drink', 'food', 'eat']):
        if donot:
            for d in donot:
                if 'food' in d.lower() or 'water' in d.lower() or 'drink' in d.lower():
                    return f"For {emergency_type}: {d}. Keep the patient calm until the ambulance arrives."
        return f"Do not give food or drinks during a {emergency_type} as it can cause choking or complicate treatment."

    if any(w in msg_lower for w in ['do not', "don't", 'avoid', 'never', 'wrong']):
        if donot:
            items = "; ".join(donot[:2])
            return f"Key things to avoid for {emergency_type}: {items}."

    if any(w in msg_lower for w in ['sign', 'symptom', 'warning', 'look for', 'identify']):
        if warn:
            items = "; ".join(warn[:3])
            return f"Key warning signs for {emergency_type} include: {items}."

    if any(w in msg_lower for w in ['cpr', 'breathe', 'breathing', 'gasp']):
        return f"If the patient stops breathing or becomes unresponsive, tilt head back to open airway and begin CPR immediately."

    # Default fallback using immediate actions for active emergency
    if imm:
        actions = "; ".join(imm[:2])
        return f"For {emergency_type}: {actions}. The ambulance is en route."
    
    return f"Please stay calm. Keep the patient in a comfortable position, monitor breathing, and wait for the emergency team."

try:
    import google.generativeai as genai
    gemini_key = os.environ.get('GEMINI_API_KEY')
    if gemini_key:
        genai.configure(api_key=gemini_key)
        gemini_model = genai.GenerativeModel('gemini-1.5-flash')
    else:
        gemini_model = None
except Exception as e:
    gemini_model = None


@app.route('/api/chat', methods=['POST'])
def emergency_chat():
    data = request.json or {}
    user_message = data.get('message', '').strip()
    emergency_type = data.get('emergency_type', 'the emergency')
    severity = data.get('severity', 'Unknown')
    eta = data.get('eta')
    history = data.get('history', [])  # [{role: 'user'|'assistant', content: str}, ...]

    if not user_message:
        return jsonify({'error': 'message is required'}), 400

    if gemini_model is None:
        # Use intelligent offline first-aid guidance engine when API key is not set
        reply_text = generate_offline_chat_response(user_message, emergency_type)
        return jsonify({'reply': reply_text})

    system_prompt = (
        f"You are an emergency first-aid voice assistant embedded in an "
        f"ambulance-dispatch app. The active emergency is: {emergency_type} "
        f"(severity: {severity}), ambulance ETA: {eta} minutes. "
        f"The user is a bystander or patient, likely stressed, possibly "
        f"speaking via voice-to-text, and will probably have this answer "
        f"read aloud via text-to-speech. Rules: keep every answer under "
        f"60 words, use short plain sentences, no markdown, no headers, "
        f"give the single most important action first. If the situation "
        f"sounds life-threatening or worsening, tell them to call local "
        f"emergency services immediately in addition to anything else. "
        f"Never claim to be a doctor or give a diagnosis - give first-aid "
        f"guidance only."
    )

    prompt = f"System Context:\n{system_prompt}\n\nConversation History:\n"
    for msg in history[-6:]:
        role = "Assistant" if msg['role'] == 'assistant' else "User"
        prompt += f"{role}: {msg['content']}\n"
    prompt += f"User: {user_message}\nAssistant:"

    try:
        response = gemini_model.generate_content(prompt)
        reply_text = response.text.replace('*', '').strip() # Remove any markdown stars
    except Exception as e:
        print(f"[Chat] Gemini API error: {e}")
        reply_text = generate_offline_chat_response(user_message, emergency_type)

    return jsonify({'reply': reply_text})


if __name__ == '__main__':
    socketio.run(app, host='0.0.0.0', debug=True, port=5000, allow_unsafe_werkzeug=True)
