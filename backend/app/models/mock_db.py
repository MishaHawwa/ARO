hospitals = [
    {
        "id": 1,
        "name": "CityCare Hospital",
        "location": {"lat": 12.9716, "lng": 77.5946},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 15,
        "specialists": ["cardiologist", "neurologist", "trauma", "burn", "obstetrician"]
    },
    {
        "id": 2,
        "name": "MediPlus Hospital",
        "location": {"lat": 12.9352, "lng": 77.6245},
        "cardiac_icu": True,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 8,
        "specialists": ["cardiologist", "trauma", "obstetrician"]
    },
    {
        "id": 3,
        "name": "LifeLine Medical Center",
        "location": {"lat": 12.9141, "lng": 77.6411},
        "cardiac_icu": False,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": False,
        "beds_available": 12,
        "specialists": ["neurologist", "trauma", "burn"]
    },
    {
        "id": 4,
        "name": "Apollo Emergency Care",
        "location": {"lat": 13.0358, "lng": 77.5970},
        "cardiac_icu": True,
        "neuro_icu": True,
        "trauma_center": True,
        "burn_unit": True,
        "maternity_ward": True,
        "beds_available": 20,
        "specialists": ["cardiologist", "neurologist", "trauma", "burn", "obstetrician"]
    },
    {
        "id": 5,
        "name": "QuickCare Hospital",
        "location": {"lat": 12.8956, "lng": 77.6362},
        "cardiac_icu": False,
        "neuro_icu": False,
        "trauma_center": True,
        "burn_unit": False,
        "maternity_ward": True,
        "beds_available": 5,
        "specialists": ["trauma", "obstetrician"]
    }
]

ambulances = [
    {"id": "KA-01-EM-101", "location": {"lat": 12.9716, "lng": 77.5946}, "available": True},
    {"id": "KA-01-EM-102", "location": {"lat": 12.9352, "lng": 77.6245}, "available": True},
    {"id": "KA-01-EM-103", "location": {"lat": 12.9141, "lng": 77.6411}, "available": True},
    {"id": "KA-01-EM-104", "location": {"lat": 13.0358, "lng": 77.5970}, "available": True},
    {"id": "KA-01-EM-105", "location": {"lat": 12.8956, "lng": 77.6362}, "available": True}
]

emergency_requirements = {
    "Heart Attack": {
        "severity": "Critical",
        "required_facility": "cardiac_icu",
        "required_specialist": "cardiologist",
        "priority_score": 10
    },
    "Stroke": {
        "severity": "Critical",
        "required_facility": "neuro_icu",
        "required_specialist": "neurologist",
        "priority_score": 10
    },
    "Accident": {
        "severity": "High",
        "required_facility": "trauma_center",
        "required_specialist": "trauma",
        "priority_score": 8
    },
    "Burns": {
        "severity": "High",
        "required_facility": "burn_unit",
        "required_specialist": "burn",
        "priority_score": 8
    },
    "Pregnancy Emergency": {
        "severity": "High",
        "required_facility": "maternity_ward",
        "required_specialist": "obstetrician",
        "priority_score": 9
    }
}

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
    }
}
