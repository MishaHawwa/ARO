try:
    import gevent.monkey
    gevent.monkey.patch_all()
except ImportError:
    pass
from flask import Flask, request, jsonify
from flask_cors import CORS
from flask_socketio import SocketIO, emit, join_room, leave_room
import random
import time
from datetime import datetime, timezone
import secrets
import math
import os
import uuid
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

@app.errorhandler(Exception)
def handle_exception(e):
    import traceback
    return jsonify({"error": "Internal Server Error", "traceback": traceback.format_exc()}), 500


_ambulance_rate_limits = {}

def get_utc_iso():
    return datetime.now(timezone.utc).isoformat()

def validate_coordinates(lat, lng):
    """Validate latitude and longitude ranges."""
    try:
        lat_f = float(lat)
        lng_f = float(lng)
    except (TypeError, ValueError):
        return False, None, None
    if not (-90.0 <= lat_f <= 90.0 and -180.0 <= lng_f <= 180.0):
        return False, None, None
    return True, lat_f, lng_f

def get_allowed_origins():
    origins = [
        "http://localhost:3000",
        "http://localhost:5173",
        "http://127.0.0.1:3000",
        "http://127.0.0.1:5173",
        "https://aro-backend-tvkq.onrender.com",
        "http://localhost",
        "capacitor://localhost"
    ]
    env_cors = os.environ.get("CORS_ORIGINS")
    if env_cors:
        for orig in env_cors.split(","):
            cleaned = orig.strip()
            if cleaned and cleaned not in origins:
                origins.append(cleaned)
    frontend_url = os.environ.get("FRONTEND_URL") or os.environ.get("REACT_APP_API_URL")
    if frontend_url and frontend_url.strip() not in origins:
        origins.append(frontend_url.strip())
    amb_url = os.environ.get("AMBULANCE_APP_URL") or os.environ.get("VITE_API_BASE_URL")
    if amb_url and amb_url.strip() not in origins:
        origins.append(amb_url.strip())
    if os.environ.get("ALLOW_ALL_ORIGINS", "").lower() in ("true", "1") or os.environ.get("FLASK_ENV") == "development":
        return "*"
    return origins

ALLOWED_ORIGINS = get_allowed_origins()
CORS(app, resources={r"/*": {"origins": ALLOWED_ORIGINS}})
socketio = SocketIO(app, cors_allowed_origins=ALLOWED_ORIGINS)
import requests

BACKENLY_PROJECT_ID = "01db9ccd-417e-457e-8073-e7bccdca3e63"
BACKENLY_API_KEY = os.environ.get('BACKENLY_API_KEY', "svc_live_79a83ca9aadb0868e4dcd6f9b381cf1b5d3e07724b9a690a4e6b106daded0a9c")
BACKENLY_BASE_URL = f"https://backenly.com/api/v1/{BACKENLY_PROJECT_ID}/db"
HEADERS = {"x-api-key": BACKENLY_API_KEY}

DEFAULT_HOSPITALS = [
    {
        "id": "kmc-mangalore",
        "name": "KMC Hospital Mangalore (Ambedkar Circle)",
        "location": {"lat": 12.8718, "lng": 74.8425},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 45,
        "specialists": ["cardiologist", "neurologist", "trauma", "pediatrician", "general_physician", "burn", "obstetrician"]
    },
    {
        "id": "fathermuller-mangalore",
        "name": "Father Muller Medical College Hospital (Kankanady)",
        "location": {"lat": 12.8631, "lng": 74.8622},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 60,
        "specialists": ["cardiologist", "neurologist", "trauma", "obstetrician", "general_physician"]
    },
    {
        "id": "aj-mangalore",
        "name": "A.J. Hospital & Research Centre (Kuntikan)",
        "location": {"lat": 12.9056, "lng": 74.8542},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 35,
        "specialists": ["cardiologist", "neurologist", "trauma", "general_physician"]
    },
    {
        "id": "wenlock-mangalore",
        "name": "Wenlock District Hospital (Hampankatta)",
        "location": {"lat": 12.8672, "lng": 74.8436},
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 80,
        "specialists": ["trauma", "pediatrician", "burn", "general_physician", "obstetrician"]
    },
    {
        "id": "3a95708c-35e6-4d34-adc6-18583d160268",
        "name": "Lifecare Hospital Bhatkal",
        "location": {"lat": 13.9645, "lng": 74.5645},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 25,
        "specialists": ["cardiologist", "neurologist", "trauma", "general_physician"]
    },
    {
        "id": "st-ignatius-honnavar",
        "name": "St. Ignatius Hospital Honnavar",
        "location": {"lat": 14.2769, "lng": 74.4531},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 65,
        "specialists": ["cardiologist", "neurologist", "trauma", "general_physician", "obstetrician"]
    },
    {
        "id": "honnavar-taluk-govt",
        "name": "Honnavar Taluk Government Hospital",
        "location": {"lat": 14.2806, "lng": 74.4452},
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 50,
        "specialists": ["trauma", "general_physician", "obstetrician"]
    },
    {
        "id": "lifeline-honnavar",
        "name": "Lifeline Hospital & Trauma Care Honnavar",
        "location": {"lat": 14.2795, "lng": 74.4480},
        "cardiac_icu": True,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": False,
        "beds_available": 30,
        "specialists": ["cardiologist", "trauma", "general_physician"]
    },
    {
        "id": "durgamba-honnavar",
        "name": "Shree Durgamba Hospital Honnavar",
        "location": {"lat": 14.2818, "lng": 74.4439},
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": False,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 20,
        "specialists": ["general_physician", "obstetrician"]
    }
]

DEFAULT_AMBULANCES = [
    {
        "id": "b2d0b054-8d8a-42d6-b4fc-aecfb77f36d0",
        "name": "Unit KA-B2D0 (Mangalore Central)",
        "location": {"lat": 12.8725, "lng": 74.8440},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "a1c0d054-8d8a-42d6-b4fc-aecfb77f0002",
        "name": "Unit KA-A1C0 (Mangalore Kadri)",
        "location": {"lat": 12.8820, "lng": 74.8560},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "a1c0d054-8d8a-42d6-b4fc-aecfb77f0003",
        "name": "Unit KA-A1C1 (Mangalore Kankanady)",
        "location": {"lat": 12.8640, "lng": 74.8640},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "a1c0d054-8d8a-42d6-b4fc-aecfb77f0004",
        "name": "Unit KA-A1C2 (Mangalore Deralakatte)",
        "location": {"lat": 12.8120, "lng": 74.8980},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "h1c0d054-8d8a-42d6-b4fc-aecfb77f0005",
        "name": "Unit KA-H1C0 (Honnavar Port)",
        "location": {"lat": 14.2770, "lng": 74.4530},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "h1c0d054-8d8a-42d6-b4fc-aecfb77f0006",
        "name": "Unit KA-H1C1 (Honnavar Taluk Center)",
        "location": {"lat": 14.2810, "lng": 74.4450},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "b1c0d054-8d8a-42d6-b4fc-aecfb77f0007",
        "name": "Unit KA-B1C0 (Bhatkal Main Road)",
        "location": {"lat": 13.9780, "lng": 74.5520},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    },
    {
        "id": "b1c0d054-8d8a-42d6-b4fc-aecfb77f0008",
        "name": "Unit KA-B1C1 (Bhatkal Coastal)",
        "location": {"lat": 13.9660, "lng": 74.5670},
        "available": True,
        "phone": "+919110853440",
        "driver_status": "idle",
        "current_emergency_id": None
    }
]

_hospitals_cache = {"data": None, "time": 0}
def fetch_hospitals(force_refresh=False):
    global _hospitals_cache
    now = time.time()
    if not force_refresh and _hospitals_cache["data"] and (now - _hospitals_cache["time"] < 60):
        return _hospitals_cache["data"]

    import urllib.request
    import json
    import ssl
    
    req = urllib.request.Request(f"{BACKENLY_BASE_URL}/hospitals", method="GET")
    req.add_header('x-api-key', BACKENLY_API_KEY)
    
    data = []
    try:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, context=ctx, timeout=3.0) as res:
            if res.status == 200:
                body = res.read().decode('utf-8')
                data = json.loads(body)
    except Exception as e:
        print("Failed to fetch hospitals:", e)
    
    if isinstance(data, dict):
        data = data.get("data", data)
    
    formatted_hospitals = []
    if isinstance(data, list):
        for h in data:
            specs = ["general_physician"]
            if h.get("cardiac_icu"): specs.append("cardiologist")
            if h.get("neuro_icu"): specs.append("neurologist")
            if h.get("burn_unit"): specs.append("burn")
            if h.get("maternity_ward"): specs.append("obstetrician")
            if h.get("trauma_center"): 
                specs.append("trauma")
                specs.append("pediatrician")
                
            formatted_hospitals.append({
                "id": h.get("id"),
                "name": h.get("name"),
                "location": {"lat": h.get("location_lat"), "lng": h.get("location_lng")},
                "cardiac_icu": h.get("cardiac_icu", False),
                "neuro_icu": h.get("neuro_icu", False),
                "trauma_center": h.get("trauma_center", False),
                "burn_unit": h.get("burn_unit", False),
                "maternity_ward": h.get("maternity_ward", False),
                "beds_available": h.get("beds_available", 0),
                "specialists": specs
            })
    result = formatted_hospitals if formatted_hospitals else DEFAULT_HOSPITALS
    _hospitals_cache["data"] = result
    _hospitals_cache["time"] = now
    return result

_ambulances_cache = {"data": None, "time": 0}
ACTIVE_EMERGENCIES = {}

def fetch_ambulances(force_refresh=False):
    global _ambulances_cache
    now = time.time()
    if not force_refresh and _ambulances_cache["data"] and (now - _ambulances_cache["time"] < 10):
        return _ambulances_cache["data"]

    import urllib.request
    import json
    import ssl
    
    req = urllib.request.Request(f"{BACKENLY_BASE_URL}/ambulances", method="GET")
    req.add_header('x-api-key', BACKENLY_API_KEY)
    
    data = []
    try:
        ctx = ssl._create_unverified_context()
        with urllib.request.urlopen(req, context=ctx, timeout=2.5) as res:
            if res.status == 200:
                body = res.read().decode('utf-8')
                data = json.loads(body)
    except Exception as e:
        print("Error fetching ambulances:", e)
    
    if isinstance(data, dict):
        data = data.get("data", data)
    
    formatted_ambulances = []
    if isinstance(data, list):
        for a in data:
            lat = a.get("location_lat")
            lng = a.get("location_lng")
            if lat is None or lng is None:
                lat, lng = 12.8725, 74.8440
            formatted_ambulances.append({
                "id": a.get("id"),
                "name": a.get("name") or f"Unit {str(a.get('id', ''))[:8]}",
                "location": {"lat": lat, "lng": lng},
                "available": a.get("available", True),
                "phone": a.get("phone", "+919110853440"),
                "driver_status": a.get("driver_status", "idle"),
                "current_emergency_id": a.get("current_emergency_id", None)
            })

    # Always ensure the full default fleet across Mangalore, Honnavar, and Bhatkal is included
    all_ambs = list(formatted_ambulances) if formatted_ambulances else []
    existing_ids = {a['id'] for a in all_ambs}
    for def_amb in DEFAULT_AMBULANCES:
        if def_amb['id'] not in existing_ids:
            all_ambs.append(def_amb.copy())

    _ambulances_cache["data"] = all_ambs
    _ambulances_cache["time"] = now
    return all_ambs

def update_ambulance_status(amb_id, updates):
    # 1. Update in-memory state immediately for instant responsiveness
    for a in DEFAULT_AMBULANCES:
        if a['id'] == amb_id:
            a.update(updates)
            if 'location_lat' in updates and 'location_lng' in updates:
                a['location'] = {'lat': updates['location_lat'], 'lng': updates['location_lng']}
    if _ambulances_cache.get("data"):
        for a in _ambulances_cache["data"]:
            if a['id'] == amb_id:
                a.update(updates)
                if 'location_lat' in updates and 'location_lng' in updates:
                    a['location'] = {'lat': updates['location_lat'], 'lng': updates['location_lng']}

    # 2. Asynchronously persist to Backenly without blocking execution
    def sync_backenly():
        try:
            import urllib.request
            import json
            import ssl
            req = urllib.request.Request(f"{BACKENLY_BASE_URL}/ambulances?id=eq.{amb_id}", method="PATCH")
            req.add_header('x-api-key', BACKENLY_API_KEY)
            req.add_header('Content-Type', 'application/json')
            data = json.dumps(updates).encode('utf-8')
            ctx = ssl._create_unverified_context()
            urllib.request.urlopen(req, data=data, context=ctx, timeout=2.0)
        except Exception as e:
            pass

    try:
        socketio.start_background_task(sync_backenly)
    except Exception:
        pass

# Initialize database caches
hospitals = fetch_hospitals()
ambulances = fetch_ambulances()

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
    data = request.json or {}
    emergency_type = data.get('type', 'General Medical')
    patient_location = data.get('location')
    if not patient_location or not isinstance(patient_location, dict) or 'lat' not in patient_location or 'lng' not in patient_location:
        patient_location = {'lat': 12.8725, 'lng': 74.8440}
    
    # Find best hospital
    hospitals = fetch_hospitals()
    
    # Dynamic Real-Time Hospital Recommendation
    # Score all hospitals based on real distance to patient, emergency requirements, and bed availability
    hospital_scores = [
        score_hospital_breakdown(h, emergency_type, patient_location)
        for h in hospitals
    ]
    
    # Highest match_score among eligible facilities wins
    eligible_scores = [s for s in hospital_scores if s.get('eligible')]
    if eligible_scores:
        eligible_scores.sort(key=lambda s: s['match_score'], reverse=True)
        best_hospital_id = eligible_scores[0]['hospital_id']
        best_hospital = next(h for h in hospitals if h['id'] == best_hospital_id)
    else:
        # Fallback to closest hospital by geographic distance
        hospitals_by_dist = sorted(hospitals, key=lambda h: calculate_distance(patient_location, h['location']))
        best_hospital = hospitals_by_dist[0]

    hospital_scores.sort(key=lambda s: s['match_score'], reverse=True)
    for s in hospital_scores:
        s['assigned'] = (s['hospital_id'] == best_hospital['id'])
    
    # Find nearest available ambulance to patient
    ambulances = fetch_ambulances()
    for a in ambulances:
        if not a.get('location') or not isinstance(a['location'], dict):
            a['location'] = {'lat': 12.8725, 'lng': 74.8440}

    available_ambulances = [a for a in ambulances if a.get('available', True)]
    if not available_ambulances:
        # Guarantee an ambulance is ALWAYS available: auto-free/reuse fleet so user is never rejected
        print("[Ambulance Dispatch] All units busy, auto-reallocating fleet unit")
        for a in ambulances:
            a['available'] = True
            a['driver_status'] = 'idle'
            a['current_emergency_id'] = None
        available_ambulances = ambulances
    
    for a in available_ambulances:
        a['dist_to_patient'] = calculate_distance(patient_location, a['location'])
    available_ambulances.sort(key=lambda a: a['dist_to_patient'])
    nearest_ambulance = available_ambulances[0]
    
    # Mark ambulance as allocated
    emergency_id = str(uuid.uuid4())
    tracking_token = secrets.token_urlsafe(24)
    nearest_ambulance['available'] = False
    nearest_ambulance['current_emergency_id'] = emergency_id
    nearest_ambulance['driver_status'] = 'notified'
    
    update_ambulance_status(nearest_ambulance['id'], {
        'available': False,
        'current_emergency_id': emergency_id,
        'driver_status': 'notified'
    })
    
    # Calculate ETA with realistic factors for Bhatkal/Mangalore
    distance_to_patient = calculate_distance(nearest_ambulance['location'], patient_location)
    if distance_to_patient < 1.0:
        # Distance too close for testing (same device/location) - station ~2.1km away
        nearest_ambulance['location'] = {
            'lat': patient_location['lat'] - 0.015,
            'lng': patient_location['lng'] - 0.012
        }
        distance_to_patient = calculate_distance(nearest_ambulance['location'], patient_location)

    distance_to_hospital = calculate_distance(patient_location, best_hospital['location'])
    
    # Current time factor for traffic
    current_hour = datetime.now().hour
    if 7 <= current_hour <= 9 or 17 <= current_hour <= 19:  # School/work hours
        time_factor = 0.4  # Moderate traffic
    elif 10 <= current_hour <= 16:  # Normal day hours
        time_factor = 0.2  # Light traffic
    else:  # Night/early morning
        time_factor = 0.1  # Very light traffic
    
    # Real-time traffic factor
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
        'tracking_token': tracking_token,
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
            'name': nearest_ambulance.get('name', 'Ambulance Unit'),
            'location': nearest_ambulance['location']
        },
        'patient_location': patient_location,
        'eta': eta_to_patient,
        'total_eta': total_eta,
        'distance': round(distance_to_patient, 2),
        'distance_to_hospital': round(distance_to_hospital, 2),
        'ai_suggestions': suggestions,
        'hospital_scores': hospital_scores,
        'rejected_hospitals': []
    }

    # Record active emergency in memory
    ACTIVE_EMERGENCIES[emergency_id] = {
        'emergency_id': emergency_id,
        'tracking_token': tracking_token,
        'ambulance_id': nearest_ambulance['id'],
        'patient_location': patient_location,
        'hospital': response['hospital'],
        'hospital_location': best_hospital['location'],
        'hospital_name': best_hospital['name'],
        'ambulance_location': nearest_ambulance['location'].copy(),
        'emergency_type': emergency_type,
        'severity': emergency_details.get('severity', 'High'),
        'status': 'Ambulance Dispatched',
        'phase': 'to_patient',
        'driver_status': 'notified',
        'eta': eta_to_patient,
        'distance_km': round(distance_to_patient, 2),
        'tracking': {
            'status': 'waiting',
            'latest_location': {
                'lat': nearest_ambulance['location']['lat'],
                'lng': nearest_ambulance['location']['lng'],
                'accuracy': None,
                'heading': None,
                'speed': None
            },
            'device_timestamp': None,
            'server_timestamp': time.time(),
            'last_update_iso': get_utc_iso()
        }
    }

    # Notify the ambulance driver app in real time
    notify_ambulance(nearest_ambulance, response)

    return jsonify(response)

@app.route('/api/hospitals', methods=['GET'])
def get_hospitals():
    return jsonify(fetch_hospitals())

@app.route('/api/ambulances', methods=['GET'])
def get_ambulances():
    return jsonify(fetch_ambulances())

_osrm_cache = {}
def fetch_osrm_route(start_loc, end_loc):
    """Fetches real road geometry from OSRM with in-memory caching and fast 1.2s timeout."""
    if calculate_distance(start_loc, end_loc) < 0.1:
        return None, None, None
    cache_key = f"{round(start_loc['lat'], 4)},{round(start_loc['lng'], 4)}->{round(end_loc['lat'], 4)},{round(end_loc['lng'], 4)}"
    if cache_key in _osrm_cache:
        return _osrm_cache[cache_key]
    try:
        url = f"https://router.project-osrm.org/route/v1/driving/{start_loc['lng']},{start_loc['lat']};{end_loc['lng']},{end_loc['lat']}?overview=full&geometries=geojson"
        req = urllib.request.Request(url, headers={'User-Agent': 'EmergencyApp/1.0'})
        with urllib.request.urlopen(req, timeout=1.2) as resp:
            data = json.loads(resp.read().decode('utf-8'))
            if data.get('routes') and len(data['routes']) > 0:
                coords = data['routes'][0]['geometry']['coordinates']
                dist_m = data['routes'][0].get('distance', 0)
                dur_s = data['routes'][0].get('duration', 0)
                result = ([{'lat': c[1], 'lng': c[0]} for c in coords], dist_m, dur_s)
                _osrm_cache[cache_key] = result
                return result
    except Exception as e:
        print(f"[OSRM Route Fast Fallback]: {e}")
    return None, None, None

# ============================================================
# REAL-TIME GPS TRACKING & SOCKET.IO ENGINE
# ============================================================

@socketio.on('connect')
def handle_connect():
    print('[Socket] Client connected')
    emit('connected', {'data': 'Connected to server', 'timestamp': get_utc_iso()})

@socketio.on('disconnect')
def handle_disconnect():
    print('[Socket] Client disconnected')

def process_ambulance_status_change(ambulance_id, emergency_id, status):
    """Processes driver mission state transitions and streams real-time updates."""
    ambulances = fetch_ambulances()
    ambulance = next((a for a in ambulances if a['id'] == ambulance_id), None)
    if not ambulance:
        return {'error': 'Unknown ambulance'}

    ambulance['driver_status'] = status
    active = ACTIVE_EMERGENCIES.get(emergency_id)
    if not active:
        for e_id, e_info in ACTIVE_EMERGENCIES.items():
            if e_info.get('ambulance_id') == ambulance_id:
                active = e_info
                emergency_id = e_id
                break

    if status in ['en_route_to_hospital', 'picked_up']:
        phase = 'to_hospital'
        display_status = f"Transporting to {active.get('hospital_name', 'Hospital')}" if active else 'Transporting to Hospital'
        if active:
            active['phase'] = 'to_hospital'
            active['status'] = display_status
    elif status in ['arrived', 'arrived_at_hospital']:
        phase = 'arrived'
        display_status = 'Arrived at Hospital'
        if active:
            active['phase'] = 'arrived'
            active['status'] = display_status
            if 'tracking' in active:
                active['tracking']['status'] = 'stopped'
    elif status in ['accepted', 'en_route_to_patient']:
        phase = 'to_patient'
        display_status = 'En Route to Patient'
        if active:
            active['phase'] = 'to_patient'
            active['status'] = display_status
    else:
        phase = 'to_patient'
        display_status = 'Ambulance Dispatched'

    # Determine remaining dist/eta
    target = active.get('hospital_location') if (active and phase == 'to_hospital') else (active.get('patient_location') if active else None)
    amb_loc = ambulance.get('location')
    remaining_dist = None
    remaining_eta = None
    if target and amb_loc and 'lat' in target and 'lng' in target and 'lat' in amb_loc and 'lng' in amb_loc:
        remaining_dist = round(calculate_distance(amb_loc, target), 2)
        remaining_eta = max(1, round(remaining_dist * 2.0))

    payload = {
        'emergencyId': emergency_id,
        'emergency_id': emergency_id,
        'ambulanceId': ambulance_id,
        'ambulance_id': ambulance_id,
        'location': ambulance.get('location'),
        'latitude': ambulance.get('location', {}).get('lat'),
        'longitude': ambulance.get('location', {}).get('lng'),
        'status': display_status,
        'phase': phase,
        'eta': 0 if phase == 'arrived' else (remaining_eta or (active.get('eta') if active else 5)),
        'distanceKm': 0.0 if phase == 'arrived' else (remaining_dist or (active.get('distance_km') if active else 2.0)),
        'distance_km': 0.0 if phase == 'arrived' else (remaining_dist or (active.get('distance_km') if active else 2.0)),
        'isRealtime': True,
        'is_realtime': True,
        'timestamp': get_utc_iso()
    }

    if emergency_id:
        socketio.emit('ambulance:location:updated', payload, room=f"emergency:{emergency_id}")
        socketio.emit('ambulance:location:updated', payload, room=f"emergency_{emergency_id}")
        socketio.emit('ambulance_update', payload, room=f"emergency:{emergency_id}")
        socketio.emit('ambulance_update', payload, room=f"emergency_{emergency_id}")
    socketio.emit('ambulance:location:updated', payload, room=f"ambulance:{ambulance_id}")
    socketio.emit('ambulance:location:updated', payload, room=f"ambulance_{ambulance_id}")

    if phase == 'arrived':
        arrived_payload = {
            'emergencyId': emergency_id,
            'emergency_id': emergency_id,
            'message': 'Ambulance arrived safely at hospital',
            'timestamp': get_utc_iso()
        }
        if emergency_id:
            socketio.emit('ambulance_arrived', arrived_payload, room=f"emergency:{emergency_id}")
            socketio.emit('ambulance_arrived', arrived_payload, room=f"emergency_{emergency_id}")
            socketio.emit('tracking:stopped', {
                'emergencyId': emergency_id,
                'emergency_id': emergency_id,
                'ambulanceId': ambulance_id,
                'reason': 'arrived_at_hospital',
                'timestamp': get_utc_iso()
            }, room=f"emergency:{emergency_id}")
            socketio.emit('tracking:stopped', {
                'emergencyId': emergency_id,
                'emergency_id': emergency_id,
                'ambulanceId': ambulance_id,
                'reason': 'arrived_at_hospital',
                'timestamp': get_utc_iso()
            }, room=f"emergency_{emergency_id}")

        ambulance['available'] = True
        ambulance['current_emergency_id'] = None
        ambulance['driver_status'] = 'idle'
        update_ambulance_status(ambulance_id, {
            'available': True,
            'current_emergency_id': None,
            'driver_status': 'idle'
        })

    return {'ok': True, 'status': status}


def process_location_update(data):
    """
    Core validation and ingestion pipeline for live ambulance GPS coordinates.
    1. Authenticates & verifies active ambulance assignment
    2. Validates latitude [-90, 90] and longitude [-180, 180]
    3. Drops out-of-order and excessively stale (>90s) updates
    4. Filters impossible jumps (>250 km/h)
    5. Applies sensible rate limits
    6. Persists latest accepted position
    7. Emits to authorized emergency room only
    """
    if not isinstance(data, dict):
        return False, {'code': 'INVALID_PAYLOAD', 'message': 'Payload must be a dictionary'}

    amb_id = data.get('ambulanceId') or data.get('ambulance_id')
    emergency_id = data.get('emergencyId') or data.get('emergency_id')
    tracking_token = data.get('trackingToken') or data.get('tracking_token')

    # Extract coordinates
    lat = data.get('latitude')
    lng = data.get('longitude')
    if lat is None or lng is None:
        loc = data.get('location')
        if isinstance(loc, dict):
            lat = loc.get('lat') if loc.get('lat') is not None else loc.get('latitude')
            lng = loc.get('lng') if loc.get('lng') is not None else loc.get('longitude')

    valid_coords, lat, lng = validate_coordinates(lat, lng)
    if not valid_coords:
        return False, {'code': 'INVALID_COORDINATES', 'message': f'Coordinates ({lat}, {lng}) outside valid range [-90..90, -180..180]'}

    # Find emergency
    active = ACTIVE_EMERGENCIES.get(emergency_id)
    if not active and amb_id:
        for e_id, e_info in ACTIVE_EMERGENCIES.items():
            if e_info.get('ambulance_id') == amb_id:
                active = e_info
                emergency_id = e_id
                break

    if not active:
        return False, {'code': 'EMERGENCY_NOT_FOUND', 'message': f'No active emergency found for ID: {emergency_id}'}

    # 1. Assignment check: must be assigned ambulance
    if active.get('ambulance_id') != amb_id:
        return False, {'code': 'UNAUTHORIZED_AMBULANCE', 'message': f'Ambulance {amb_id} is not assigned to emergency {emergency_id}'}

    # 2. Token check if present
    if active.get('tracking_token') and tracking_token and active['tracking_token'] != tracking_token:
        return False, {'code': 'UNAUTHORIZED', 'message': 'Invalid tracking authorization token'}

    now_time = time.time()

    # 3. Rate limiting: max 1 update per 0.7s per ambulance
    last_rate_time = _ambulance_rate_limits.get(amb_id, 0.0)
    if (now_time - last_rate_time) < 0.7:
        return False, {'code': 'RATE_LIMITED', 'throttled': True, 'message': 'Update rate limit exceeded (max 1 per 0.7s)'}

    # 4. Device timestamp & out-of-order check
    tracking = active.setdefault('tracking', {
        'status': 'live',
        'latest_location': {},
        'device_timestamp': None,
        'server_timestamp': None,
        'last_update_iso': None
    })

    raw_ts = data.get('timestamp') or data.get('device_timestamp')
    parsed_device_ts = None
    if raw_ts:
        try:
            if isinstance(raw_ts, (int, float)):
                parsed_device_ts = float(raw_ts) / 1000.0 if raw_ts > 1e11 else float(raw_ts)
            elif isinstance(raw_ts, str):
                dt = datetime.fromisoformat(raw_ts.replace('Z', '+00:00'))
                parsed_device_ts = dt.timestamp()
        except Exception:
            pass

    if parsed_device_ts:
        if (now_time - parsed_device_ts) > 90.0:
            return False, {'code': 'STALE_READING', 'message': 'Location reading is older than 90 seconds'}
        prev_device_ts = tracking.get('device_timestamp')
        if prev_device_ts and (parsed_device_ts < prev_device_ts - 0.5):
            return False, {'code': 'OUT_OF_ORDER', 'message': 'Out of order GPS reading dropped'}

    # 5. Plausibility / jump check (only between consecutive device GPS updates)
    prev_loc = tracking.get('latest_location')
    prev_device_ts = tracking.get('device_timestamp')
    if prev_device_ts and prev_loc and 'lat' in prev_loc and 'lng' in prev_loc:
        dist_jump_km = calculate_distance({'lat': lat, 'lng': lng}, {'lat': prev_loc['lat'], 'lng': prev_loc['lng']})
        time_delta_s = max(0.2, (parsed_device_ts - prev_device_ts) if parsed_device_ts else (now_time - (tracking.get('server_timestamp') or now_time)))
        implied_speed_kmh = (dist_jump_km / (time_delta_s / 3600.0))
        if implied_speed_kmh > 250.0 and dist_jump_km > 1.0:
            return False, {'code': 'IMPOSSIBLE_JUMP', 'message': f'Implied speed {round(implied_speed_kmh)} km/h exceeds 250 km/h threshold'}

    # Reading accepted - record rate limit timestamp
    _ambulance_rate_limits[amb_id] = now_time

    # Extract accuracy, heading, speed
    accuracy = data.get('accuracy')
    heading = data.get('heading')
    speed = data.get('speed')
    try:
        accuracy = round(float(accuracy), 1) if accuracy is not None else None
    except (ValueError, TypeError):
        accuracy = None
    try:
        heading = round(float(heading), 1) if heading is not None else None
    except (ValueError, TypeError):
        heading = None
    try:
        speed = round(float(speed), 1) if speed is not None else None
    except (ValueError, TypeError):
        speed = None

    # Update in-memory state
    current_loc_dict = {
        'lat': lat,
        'lng': lng,
        'accuracy': accuracy,
        'heading': heading,
        'speed': speed
    }
    for a in fetch_ambulances():
        if a['id'] == amb_id:
            a['location'] = {'lat': lat, 'lng': lng}

    tracking['status'] = 'live'
    tracking['latest_location'] = current_loc_dict
    tracking['device_timestamp'] = parsed_device_ts or now_time
    tracking['server_timestamp'] = now_time
    iso_timestamp = get_utc_iso()
    tracking['last_update_iso'] = iso_timestamp

    active['ambulance_location'] = {'lat': lat, 'lng': lng}

    # Determine Phase, target, ETA & remaining distance
    phase = active.get('phase', 'to_patient')
    driver_status = data.get('status')
    if driver_status in ['en_route_to_hospital', 'picked_up']:
        phase = 'to_hospital'
        active['phase'] = 'to_hospital'

    target = None
    display_status = 'En Route to Patient'
    if phase == 'to_hospital':
        target = active.get('hospital_location')
        display_status = f"Transporting to {active.get('hospital_name', 'Hospital')}"
    else:
        target = active.get('patient_location')
        display_status = 'En Route to Patient'

    remaining_dist = None
    remaining_eta = None
    if target and 'lat' in target and 'lng' in target:
        remaining_dist = round(calculate_distance({'lat': lat, 'lng': lng}, target), 2)
        remaining_eta = max(1, round(remaining_dist * 2.0))
        active['distance_km'] = remaining_dist
        active['eta'] = remaining_eta

    payload = {
        'ambulanceId': amb_id,
        'ambulance_id': amb_id,
        'emergencyId': emergency_id,
        'emergency_id': emergency_id,
        'latitude': lat,
        'longitude': lng,
        'location': {'lat': lat, 'lng': lng},
        'accuracy': accuracy,
        'heading': heading,
        'speed': speed,
        'timestamp': iso_timestamp,
        'status': display_status,
        'phase': phase,
        'eta': remaining_eta if remaining_eta is not None else active.get('eta', 5),
        'distanceKm': remaining_dist if remaining_dist is not None else active.get('distance_km', 2.0),
        'distance_km': remaining_dist if remaining_dist is not None else active.get('distance_km', 2.0),
        'isRealtime': True,
        'is_realtime': True
    }

    # Emit ONLY to the authorized emergency tracking rooms (no global broadcast!)
    socketio.emit('ambulance:location:updated', payload, room=f"emergency:{emergency_id}")
    socketio.emit('ambulance:location:updated', payload, room=f"emergency_{emergency_id}")
    socketio.emit('ambulance_update', payload, room=f"emergency:{emergency_id}")
    socketio.emit('ambulance_update', payload, room=f"emergency_{emergency_id}")

    # Also emit to ambulance driver room
    socketio.emit('ambulance:location:updated', payload, room=f"ambulance:{amb_id}")
    socketio.emit('ambulance:location:updated', payload, room=f"ambulance_{amb_id}")

    # Async persist location to database / Backenly
    update_ambulance_status(amb_id, {'location_lat': lat, 'location_lng': lng})

    return True, payload


@socketio.on('tracking:subscribe')
def handle_tracking_subscribe(data):
    """Client subscribes to an authorized emergency tracking room and receives the latest snapshot."""
    if not isinstance(data, dict):
        emit('tracking:error', {'code': 'INVALID_PAYLOAD', 'message': 'Payload must be a dictionary'})
        return
    emergency_id = data.get('emergencyId') or data.get('emergency_id')
    tracking_token = data.get('trackingToken') or data.get('tracking_token')

    if not emergency_id:
        emit('tracking:error', {'code': 'MISSING_EMERGENCY_ID', 'message': 'emergency_id is required'})
        return

    active = ACTIVE_EMERGENCIES.get(emergency_id)
    if not active:
        emit('tracking:error', {'code': 'EMERGENCY_NOT_FOUND', 'message': f'Emergency {emergency_id} not active'})
        return

    if active.get('tracking_token') and tracking_token:
        if active['tracking_token'] != tracking_token:
            emit('tracking:error', {'code': 'UNAUTHORIZED', 'message': 'Invalid tracking authorization token'})
            return

    join_room(f"emergency:{emergency_id}")
    join_room(f"emergency_{emergency_id}")
    print(f"[Socket] Client joined tracking room for emergency:{emergency_id}")

    amb_id = active.get('ambulance_id')
    amb = next((a for a in fetch_ambulances() if a['id'] == amb_id), None)
    tracking_info = active.get('tracking', {})
    latest_loc = tracking_info.get('latest_location') or (amb and amb.get('location')) or active.get('ambulance_location') or {'lat': 12.8725, 'lng': 74.8440}
    tracking_status = tracking_info.get('status', 'waiting')

    snapshot = {
        'emergencyId': emergency_id,
        'emergency_id': emergency_id,
        'ambulanceId': amb_id,
        'ambulance_id': amb_id,
        'location': latest_loc,
        'latitude': latest_loc.get('lat') if isinstance(latest_loc, dict) else None,
        'longitude': latest_loc.get('lng') if isinstance(latest_loc, dict) else None,
        'accuracy': latest_loc.get('accuracy') if isinstance(latest_loc, dict) else None,
        'heading': latest_loc.get('heading') if isinstance(latest_loc, dict) else None,
        'speed': latest_loc.get('speed') if isinstance(latest_loc, dict) else None,
        'status': active.get('status', 'Ambulance Dispatched'),
        'phase': active.get('phase', 'to_patient'),
        'eta': active.get('eta', 5),
        'distanceKm': active.get('distance_km', 2.0),
        'distance_km': active.get('distance_km', 2.0),
        'trackingStatus': tracking_status,
        'tracking_status': tracking_status,
        'timestamp': tracking_info.get('last_update_iso') or get_utc_iso(),
        'isRealtime': True,
        'is_realtime': True
    }
    emit('tracking:initial_state', snapshot)
    emit('ambulance_update', snapshot)


@socketio.on('start_tracking')
def handle_start_tracking(data):
    """Backwards-compatible alias for tracking:subscribe."""
    handle_tracking_subscribe(data)


@socketio.on('tracking:start')
def handle_tracking_start(data):
    """Ambulance operator signals start of active GPS streaming."""
    if not isinstance(data, dict):
        emit('tracking:error', {'code': 'INVALID_PAYLOAD', 'message': 'Payload must be a dictionary'})
        return
    emergency_id = data.get('emergencyId') or data.get('emergency_id')
    amb_id = data.get('ambulanceId') or data.get('ambulance_id')
    tracking_token = data.get('trackingToken') or data.get('tracking_token')

    if not emergency_id or not amb_id:
        emit('tracking:error', {'code': 'MISSING_FIELDS', 'message': 'emergency_id and ambulance_id required'})
        return

    active = ACTIVE_EMERGENCIES.get(emergency_id)
    if not active:
        emit('tracking:error', {'code': 'EMERGENCY_NOT_FOUND', 'message': 'Emergency not active'})
        return

    if active.get('ambulance_id') != amb_id:
        emit('tracking:error', {'code': 'UNAUTHORIZED_AMBULANCE', 'message': 'Ambulance not assigned to this emergency'})
        return

    if active.get('tracking_token') and tracking_token and active['tracking_token'] != tracking_token:
        emit('tracking:error', {'code': 'UNAUTHORIZED', 'message': 'Invalid tracking token'})
        return

    tracking = active.setdefault('tracking', {})
    tracking['status'] = 'live'

    payload = {
        'emergencyId': emergency_id,
        'emergency_id': emergency_id,
        'ambulanceId': amb_id,
        'ambulance_id': amb_id,
        'status': 'live',
        'startedAt': get_utc_iso()
    }
    emit('tracking:started', payload)
    socketio.emit('tracking:started', payload, room=f"emergency:{emergency_id}")
    socketio.emit('tracking:started', payload, room=f"emergency_{emergency_id}")
    print(f"[Tracking] GPS sharing started for emergency {emergency_id} by ambulance {amb_id}")


@socketio.on('ambulance:location:update')
def handle_ambulance_location_update(data):
    """Main real-time GPS coordinate ingestion handler from the Ambulance App."""
    success, res = process_location_update(data)
    if not success:
        emit('tracking:error', res)
    else:
        emit('ambulance:location:ack', {'ok': True, 'timestamp': res.get('timestamp')})


@socketio.on('driver_location_update')
def handle_driver_location_update(data):
    """Backwards-compatible alias for ambulance:location:update."""
    success, res = process_location_update(data)
    if not success:
        emit('tracking:error', res)


@socketio.on('tracking:stop')
def handle_tracking_stop(data):
    """Ambulance operator signals stop of active GPS sharing."""
    if not isinstance(data, dict):
        return
    emergency_id = data.get('emergencyId') or data.get('emergency_id')
    amb_id = data.get('ambulanceId') or data.get('ambulance_id')
    reason = data.get('reason', 'stopped_by_driver')

    active = ACTIVE_EMERGENCIES.get(emergency_id)
    if active:
        if active.get('ambulance_id') == amb_id or not amb_id:
            tracking = active.setdefault('tracking', {})
            tracking['status'] = 'stopped'
            payload = {
                'emergencyId': emergency_id,
                'emergency_id': emergency_id,
                'ambulanceId': amb_id or active.get('ambulance_id'),
                'ambulance_id': amb_id or active.get('ambulance_id'),
                'status': 'stopped',
                'reason': reason,
                'timestamp': get_utc_iso()
            }
            emit('tracking:stopped', payload)
            socketio.emit('tracking:stopped', payload, room=f"emergency:{emergency_id}")
            socketio.emit('tracking:stopped', payload, room=f"emergency_{emergency_id}")
            print(f"[Tracking] GPS sharing stopped for emergency {emergency_id}")


@socketio.on('driver_status_update')
def handle_driver_status_update(data):
    amb_id = data.get('ambulance_id') or data.get('ambulanceId')
    emergency_id = data.get('emergency_id') or data.get('emergencyId')
    status = data.get('status')
    if amb_id and status:
        process_ambulance_status_change(amb_id, emergency_id, status)


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

import urllib.request
import urllib.parse
import base64

TWILIO_SID = os.environ.get('TWILIO_ACCOUNT_SID')
TWILIO_TOKEN = os.environ.get('TWILIO_AUTH_TOKEN')
TWILIO_FROM = os.environ.get('TWILIO_FROM_NUMBER') or os.environ.get('TWILIO_PHONE_NUMBER') or os.environ.get('TWILIO_NUMBER')

print(f"[TWILIO CONFIG] SID={bool(TWILIO_SID)} TOKEN={bool(TWILIO_TOKEN)} FROM={TWILIO_FROM}")


def call_ambulance_fallback(ambulance, response):
    """Places an automated call to the driver reading out the job."""
    target_number = "+919110853440"
    if not TWILIO_SID or not TWILIO_TOKEN:
        print(f"[Ambulance Call Mock] Twilio not configured - would have called {target_number}")
        return
    if not TWILIO_FROM:
        print(f"[Ambulance Call] ERROR: Twilio From Number is missing!")
        return
        
    twiml = "<Response><Say>There is a medical emergency. There is a medical emergency. There is a medical emergency.</Say></Response>"
    url = f"https://api.twilio.com/2010-04-01/Accounts/{TWILIO_SID}/Calls.json"
    data = urllib.parse.urlencode({
        'To': target_number,
        'From': TWILIO_FROM,
        'Twiml': twiml
    }).encode('utf-8')
    
    auth_string = f"{TWILIO_SID}:{TWILIO_TOKEN}"
    auth_base64 = base64.b64encode(auth_string.encode('ascii')).decode('ascii')
    
    req = urllib.request.Request(url, data=data, method='POST')
    req.add_header("Authorization", f"Basic {auth_base64}")
    req.add_header("Content-Type", "application/x-www-form-urlencoded")
    
    try:
        import ssl
        ctx = ssl._create_unverified_context()
        res = urllib.request.urlopen(req, context=ctx)
        print(f"[Ambulance Call] Success: {res.read().decode('utf-8')}")
    except Exception as e:
        print(f"[Ambulance Call] Twilio call failed: {e}")

def notify_ambulance(ambulance, response):
    """Push the new job to the driver app in real time, and immediately call."""
    job_payload = {
        'emergency_id': response['emergency_id'],
        'emergencyId': response['emergency_id'],
        'tracking_token': response.get('tracking_token'),
        'trackingToken': response.get('tracking_token'),
        'emergency_type': response['emergency_type'],
        'severity': response['severity'],
        'patient_location': response['patient_location'],
        'hospital': response['hospital'],
        'eta': response['eta'],
        'distance': response.get('distance', 2.0),
        'ambulance_id': ambulance['id'],
        'ambulanceId': ambulance['id']
    }
    socketio.emit('new_assignment', job_payload, room=f"ambulance:{ambulance['id']}")
    socketio.emit('new_assignment', job_payload, room=f"ambulance_{ambulance['id']}")
    socketio.emit('new_assignment', job_payload)
    print(f"[Ambulance] Notified {ambulance['id']} of {response['emergency_id']}")

    def make_call():
        call_ambulance_fallback(ambulance, response)

    socketio.start_background_task(make_call)

@socketio.on('join_ambulance')
def handle_join_ambulance(data):
    ambulance_id = data.get('ambulance_id') or data.get('ambulanceId')
    if ambulance_id:
        join_room(f"ambulance:{ambulance_id}")
        join_room(f"ambulance_{ambulance_id}")
        emit('joined', {'ambulance_id': ambulance_id})

@socketio.on('join_hospital')
def handle_join_hospital(data):
    hospital_id = data.get('hospital_id') or data.get('hospitalId')
    if hospital_id:
        join_room(f"hospital:{hospital_id}")
        join_room(f"hospital_{hospital_id}")
        emit('joined', {'hospital_id': hospital_id})

@app.route('/api/ambulance/<ambulance_id>/respond', methods=['POST'])
def ambulance_respond(ambulance_id):
    data = request.json or {}
    accepted = data.get('accepted', True)
    emergency_id = data.get('emergency_id') or data.get('emergencyId')
    
    ambulances = fetch_ambulances()
    ambulance = next((a for a in ambulances if a['id'] == ambulance_id), None)
    if not ambulance:
        return jsonify({'error': 'Unknown ambulance'}), 404

    if accepted:
        update_ambulance_status(ambulance_id, {'driver_status': 'accepted'})
        socketio.emit('driver_responded', {
            'ambulance_id': ambulance_id,
            'emergency_id': emergency_id,
            'status': 'accepted',
        })
        process_ambulance_status_change(ambulance_id, emergency_id, 'accepted')
        return jsonify({'ok': True, 'status': 'accepted'})
    else:
        # Rejected! Free up this ambulance
        update_ambulance_status(ambulance_id, {
            'available': True,
            'driver_status': 'declined',
            'current_emergency_id': None
        })
        
        # Stop tracking for the declined ambulance
        if emergency_id:
            decline_stop_payload = {
                'emergencyId': emergency_id,
                'emergency_id': emergency_id,
                'ambulanceId': ambulance_id,
                'ambulance_id': ambulance_id,
                'reason': 'ambulance_declined',
                'timestamp': get_utc_iso()
            }
            socketio.emit('tracking:stopped', decline_stop_payload, room=f"emergency:{emergency_id}")
            socketio.emit('tracking:stopped', decline_stop_payload, room=f"emergency_{emergency_id}")

        # Find next nearest ambulance excluding the declined one
        ambulances = fetch_ambulances()
        available_ambulances = [a for a in ambulances if a.get('available', True) and a['id'] != ambulance_id]
        if not available_ambulances:
            for a in ambulances:
                a['available'] = True
            available_ambulances = [a for a in ambulances if a['id'] != ambulance_id] or ambulances
            
        patient_location = data.get('patient_location', {'lat': 12.8725, 'lng': 74.8440})
        
        nearest_ambulance = min(
            available_ambulances,
            key=lambda a: calculate_distance(patient_location, a['location'])
        )
        
        # Mark new ambulance as unavailable
        update_ambulance_status(nearest_ambulance['id'], {
            'available': False,
            'current_emergency_id': emergency_id,
            'driver_status': 'notified'
        })
        
        # Preserve tracking token for the new ambulance assignment
        active = ACTIVE_EMERGENCIES.get(emergency_id)
        current_token = active.get('tracking_token') if active else secrets.token_urlsafe(24)

        if active:
            active['ambulance_id'] = nearest_ambulance['id']
            active['ambulance_location'] = nearest_ambulance['location'].copy()
            active['driver_status'] = 'notified'
            active['status'] = 'Rerouted to Next Ambulance'
            active['tracking'] = {
                'status': 'waiting',
                'latest_location': nearest_ambulance['location'].copy(),
                'device_timestamp': None,
                'server_timestamp': time.time(),
                'last_update_iso': get_utc_iso()
            }
            
            reroute_payload = {
                'emergencyId': emergency_id,
                'emergency_id': emergency_id,
                'ambulanceId': nearest_ambulance['id'],
                'ambulance_id': nearest_ambulance['id'],
                'ambulanceName': nearest_ambulance.get('name', 'Ambulance Unit'),
                'ambulance_name': nearest_ambulance.get('name', 'Ambulance Unit'),
                'location': nearest_ambulance['location'],
                'latitude': nearest_ambulance['location']['lat'],
                'longitude': nearest_ambulance['location']['lng'],
                'status': 'Rerouted to Next Ambulance',
                'phase': 'to_patient',
                'eta': data.get('eta', 10),
                'distanceKm': data.get('distance', 2.0),
                'distance_km': data.get('distance', 2.0),
                'trackingStatus': 'waiting',
                'tracking_status': 'waiting',
                'rerouted': True,
                'timestamp': get_utc_iso()
            }
            socketio.emit('ambulance:location:updated', reroute_payload, room=f"emergency:{emergency_id}")
            socketio.emit('ambulance:location:updated', reroute_payload, room=f"emergency_{emergency_id}")
            socketio.emit('ambulance_update', reroute_payload, room=f"emergency:{emergency_id}")
            socketio.emit('ambulance_update', reroute_payload, room=f"emergency_{emergency_id}")

        response_data = {
            'emergency_id': emergency_id,
            'emergencyId': emergency_id,
            'emergency_type': data.get('emergency_type', 'Emergency'),
            'severity': data.get('severity', 'High'),
            'patient_location': patient_location,
            'hospital': data.get('hospital', {}),
            'eta': data.get('eta', 10),
            'distance': data.get('distance', 2.0),
            'tracking_token': current_token,
            'trackingToken': current_token
        }
        
        notify_ambulance(nearest_ambulance, response_data)
        
        return jsonify({'ok': True, 'status': 'declined', 'next_ambulance': nearest_ambulance['id']})

@app.route('/api/ambulance/<ambulance_id>/status', methods=['POST'])
def ambulance_status(ambulance_id):
    """Driver updates their status: en_route_to_patient, picked_up,
    en_route_to_hospital, arrived. Pushed live to the citizen's tracking
    screen over the 'ambulance_update'/'ambulance_arrived' events."""
    data = request.json or {}
    status = data.get('status')
    emergency_id = data.get('emergency_id') or data.get('emergencyId')
    result = process_ambulance_status_change(ambulance_id, emergency_id, status)
    if 'error' in result:
        return jsonify(result), 404
    return jsonify({'ok': True})

@app.route('/api/ambulance/<ambulance_id>/location', methods=['POST'])
def update_ambulance_gps(ambulance_id):
    data = request.json or {}
    data['ambulance_id'] = ambulance_id
    success, res = process_location_update(data)
    if success:
        return jsonify({'ok': True, 'data': res})
    return jsonify({'error': res.get('message', 'Invalid location'), 'code': res.get('code')}), 400


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
