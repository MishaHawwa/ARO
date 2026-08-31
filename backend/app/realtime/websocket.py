from fastapi import APIRouter, WebSocket, WebSocketDisconnect
import asyncio

router = APIRouter()

class ConnectionManager:
    def __init__(self):
        self.active_connections: list[WebSocket] = []

    async def connect(self, websocket: WebSocket):
        await websocket.accept()
        self.active_connections.append(websocket)
        await websocket.send_json({'event': 'connected', 'data': 'Connected to server'})

    def disconnect(self, websocket: WebSocket):
        if websocket in self.active_connections:
            self.active_connections.remove(websocket)

    async def send_personal_message(self, message: dict, websocket: WebSocket):
        await websocket.send_json(message)

    async def broadcast(self, message: dict):
        for connection in self.active_connections:
            await connection.send_json(message)

manager = ConnectionManager()

@router.websocket("/ws")
async def websocket_endpoint(websocket: WebSocket):
    await manager.connect(websocket)
    try:
        while True:
            data = await websocket.receive_json()
            if data.get('event') == 'start_tracking':
                payload = data.get('data', {})
                emergency_id = payload.get('emergency_id')
                ambulance_location = payload.get('ambulance_location')
                patient_location = payload.get('patient_location')
                hospital_location = payload.get('hospital_location')
                
                # Start background tracking task for this client
                asyncio.create_task(
                    simulate_movement(
                        websocket, 
                        emergency_id, 
                        ambulance_location, 
                        patient_location, 
                        hospital_location
                    )
                )
    except WebSocketDisconnect:
        manager.disconnect(websocket)

async def simulate_movement(websocket: WebSocket, emergency_id, ambulance_location, patient_location, hospital_location):
    current_location = ambulance_location.copy()
    
    # First move to patient
    steps = 20
    for i in range(steps):
        progress = (i + 1) / steps
        current_location['lat'] = ambulance_location['lat'] + (patient_location['lat'] - ambulance_location['lat']) * progress
        current_location['lng'] = ambulance_location['lng'] + (patient_location['lng'] - ambulance_location['lng']) * progress
        
        await manager.send_personal_message({
            'event': 'ambulance_update',
            'data': {
                'emergency_id': emergency_id,
                'location': current_location.copy(),
                'status': 'En Route to Patient',
                'progress': progress * 50  # 0-50%
            }
        }, websocket)
        await asyncio.sleep(0.5)
    
    # Then move to hospital
    for i in range(steps):
        progress = (i + 1) / steps
        current_location['lat'] = patient_location['lat'] + (hospital_location['lat'] - patient_location['lat']) * progress
        current_location['lng'] = patient_location['lng'] + (hospital_location['lng'] - patient_location['lng']) * progress
        
        await manager.send_personal_message({
            'event': 'ambulance_update',
            'data': {
                'emergency_id': emergency_id,
                'location': current_location.copy(),
                'status': 'En Route to Hospital',
                'progress': 50 + progress * 50  # 50-100%
            }
        }, websocket)
        await asyncio.sleep(0.5)
    
    await manager.send_personal_message({
        'event': 'ambulance_arrived',
        'data': {
            'emergency_id': emergency_id,
            'message': 'Ambulance arrived at hospital'
        }
    }, websocket)
