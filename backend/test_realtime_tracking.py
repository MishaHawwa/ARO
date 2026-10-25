import unittest
import time
import json
from datetime import datetime, timezone

from app import (
    app,
    socketio,
    ACTIVE_EMERGENCIES,
    process_location_update,
    validate_coordinates,
    fetch_ambulances
)

class TestRealTimeTracking(unittest.TestCase):
    @classmethod
    def setUpClass(cls):
        from engineio import packet as eio_packet
        from socketio import packet as sio_packet
        from flask_socketio.test_client import SocketIOTestClient
        
        orig_send_eio = socketio.server._send_eio_packet
        def patched_send_eio(eio_sid, epkt):
            c = SocketIOTestClient.clients.get(eio_sid)
            if c and epkt.packet_type == eio_packet.MESSAGE:
                try:
                    spkt = sio_packet.Packet(encoded_packet=epkt.data)
                    if spkt.packet_type == sio_packet.EVENT:
                        c.queue.append({'name': spkt.data[0], 'args': spkt.data[1:], 'namespace': spkt.namespace or '/'})
                except Exception:
                    pass
            orig_send_eio(eio_sid, epkt)
        socketio.server._send_eio_packet = patched_send_eio

    def setUp(self):
        app.config['TESTING'] = True
        self.client = app.test_client()
        self.socket_client = socketio.test_client(app)
        ACTIVE_EMERGENCIES.clear()

    def tearDown(self):
        if self.socket_client.is_connected():
            self.socket_client.disconnect()
        ACTIVE_EMERGENCIES.clear()

    def _create_test_emergency(self):
        """Helper to create an active emergency via the existing API endpoint."""
        res = self.client.post('/api/emergency', json={
            'type': 'Heart Attack',
            'location': {'lat': 12.8725, 'lng': 74.8440}
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertIn('emergency_id', data)
        self.assertIn('tracking_token', data)
        self.assertIn('ambulance', data)
        return data

    # ---------------------------------------------------------
    # TEST SUITE A & B: Coordinate Validation & Backend Security
    # ---------------------------------------------------------
    def test_coordinate_validation_ranges(self):
        """Test latitude and longitude boundary validations."""
        valid, lat, lng = validate_coordinates(12.9716, 77.5946)
        self.assertTrue(valid)
        self.assertEqual(lat, 12.9716)

        # Out of bounds
        valid, _, _ = validate_coordinates(95.0, 77.0)
        self.assertFalse(valid)
        valid, _, _ = validate_coordinates(12.0, -185.0)
        self.assertFalse(valid)
        valid, _, _ = validate_coordinates("invalid", 77.0)
        self.assertFalse(valid)

    def test_unauthorized_ambulance_rejection(self):
        """A different ambulance cannot update an emergency assigned to another ambulance."""
        emg = self._create_test_emergency()
        emg_id = emg['emergency_id']
        assigned_amb_id = emg['ambulance']['id']
        impostor_amb_id = "00000000-0000-0000-0000-000000000000"

        success, res = process_location_update({
            'ambulance_id': impostor_amb_id,
            'emergency_id': emg_id,
            'latitude': 12.8730,
            'longitude': 74.8450
        })
        self.assertFalse(success)
        self.assertEqual(res['code'], 'UNAUTHORIZED_AMBULANCE')

    def test_invalid_tracking_token_rejection(self):
        """An update with a mismatched tracking authorization token is rejected."""
        emg = self._create_test_emergency()
        emg_id = emg['emergency_id']
        amb_id = emg['ambulance']['id']

        success, res = process_location_update({
            'ambulance_id': amb_id,
            'emergency_id': emg_id,
            'tracking_token': 'fake-invalid-token-12345',
            'latitude': 12.8730,
            'longitude': 74.8450
        })
        self.assertFalse(success)
        self.assertEqual(res['code'], 'UNAUTHORIZED')

    def test_out_of_order_and_stale_rejection(self):
        """Older coordinates cannot overwrite newer accepted positions, and excessively stale updates are rejected."""
        emg = self._create_test_emergency()
        emg_id = emg['emergency_id']
        amb_id = emg['ambulance']['id']

        # 1. Stale update (>90 seconds old)
        stale_time = time.time() - 120.0
        success, res = process_location_update({
            'ambulance_id': amb_id,
            'emergency_id': emg_id,
            'latitude': 12.8730,
            'longitude': 74.8450,
            'timestamp': stale_time
        })
        self.assertFalse(success)
        self.assertEqual(res['code'], 'STALE_READING')

        # 2. Accepted fresh update
        now = time.time()
        success, res = process_location_update({
            'ambulance_id': amb_id,
            'emergency_id': emg_id,
            'latitude': 12.8730,
            'longitude': 74.8450,
            'timestamp': now
        })
        self.assertTrue(success)

        # 3. Out-of-order update with an earlier timestamp
        time.sleep(0.8) # Wait to avoid rate-limiter
        success, res = process_location_update({
            'ambulance_id': amb_id,
            'emergency_id': emg_id,
            'latitude': 12.8740,
            'longitude': 74.8460,
            'timestamp': now - 5.0 # Earlier than accepted reading
        })
        self.assertFalse(success)
        self.assertEqual(res['code'], 'OUT_OF_ORDER')

    def test_impossible_teleportation_jump_rejection(self):
        """Reject physically impossible GPS jumps exceeding 250 km/h."""
        emg = self._create_test_emergency()
        emg_id = emg['emergency_id']
        amb_id = emg['ambulance']['id']

        now = time.time()
        success, _ = process_location_update({
            'ambulance_id': amb_id,
            'emergency_id': emg_id,
            'latitude': 12.8730,
            'longitude': 74.8450,
            'timestamp': now
        })
        self.assertTrue(success)

        # Sudden jump of 100 km within 1 second (~360,000 km/h)
        time.sleep(0.8)
        success, res = process_location_update({
            'ambulance_id': amb_id,
            'emergency_id': emg_id,
            'latitude': 13.8730, # ~110 km north
            'longitude': 74.8450,
            'timestamp': now + 1.0
        })
        self.assertFalse(success)
        self.assertEqual(res['code'], 'IMPOSSIBLE_JUMP')

    # ---------------------------------------------------------
    # TEST SUITE C: Real-Time Delivery & Room Isolation
    # ---------------------------------------------------------
    def test_room_isolation_and_snapshot_recovery(self):
        """Updates arrive only in the authorized emergency room; initial snapshot delivered upon subscribe."""
        emg1 = self._create_test_emergency()
        emg2 = self._create_test_emergency()

        client1 = socketio.test_client(app)
        client2 = socketio.test_client(app)

        # Client 1 subscribes to emergency 1
        client1.emit('tracking:subscribe', {
            'emergencyId': emg1['emergency_id'],
            'trackingToken': emg1['tracking_token']
        })
        received1 = client1.get_received()
        
        # Verify initial snapshot received
        initial_events = [e for e in received1 if e['name'] in ('tracking:initial_state', 'ambulance_update')]
        self.assertTrue(len(initial_events) >= 1)
        snapshot = initial_events[0]['args'][0]
        self.assertEqual(snapshot['emergencyId'], emg1['emergency_id'])

        # Client 2 subscribes to emergency 2
        client2.emit('tracking:subscribe', {
            'emergencyId': emg2['emergency_id'],
            'trackingToken': emg2['tracking_token']
        })
        _ = client2.get_received() # Clear initial events

        # Ambulance 1 publishes location update
        time.sleep(0.8)
        client_amb = socketio.test_client(app)
        client_amb.emit('ambulance:location:update', {
            'ambulanceId': emg1['ambulance']['id'],
            'emergencyId': emg1['emergency_id'],
            'trackingToken': emg1['tracking_token'],
            'latitude': 12.8750,
            'longitude': 74.8470,
            'accuracy': 6.5,
            'speed': 38.0,
            'heading': 45,
            'timestamp': datetime.now(timezone.utc).isoformat()
        })

        # Client 1 MUST receive the update
        events1 = client1.get_received()
        loc_updates1 = [e for e in events1 if e['name'] in ('ambulance:location:updated', 'ambulance_update')]
        self.assertTrue(len(loc_updates1) >= 1)
        update_payload = loc_updates1[0]['args'][0]
        self.assertEqual(update_payload['emergencyId'], emg1['emergency_id'])
        self.assertEqual(update_payload['latitude'], 12.8750)

        # Client 2 MUST NOT receive update for emergency 1 (Room Isolation verified!)
        events2 = client2.get_received()
        loc_updates2 = [e for e in events2 if e['name'] in ('ambulance:location:updated', 'ambulance_update')]
        self.assertEqual(len(loc_updates2), 0)

        client1.disconnect()
        client2.disconnect()
        client_amb.disconnect()

    # ---------------------------------------------------------
    # TEST SUITE E: Emergency Lifecycle & Rejection Rerouting
    # ---------------------------------------------------------
    def test_rejection_and_rerouting_lifecycle(self):
        """Declining an ambulance stops its tracking and cleanly reallocates to next ambulance."""
        emg = self._create_test_emergency()
        emg_id = emg['emergency_id']
        first_amb_id = emg['ambulance']['id']

        client_citizen = socketio.test_client(app)
        client_citizen.emit('tracking:subscribe', {
            'emergencyId': emg_id,
            'trackingToken': emg['tracking_token']
        })
        _ = client_citizen.get_received()

        # First ambulance declines
        res = self.client.post(f'/api/ambulance/{first_amb_id}/respond', json={
            'accepted': False,
            'emergency_id': emg_id,
            'patient_location': emg['patient_location'],
            'hospital': emg['hospital']
        })
        self.assertEqual(res.status_code, 200)
        data = res.get_json()
        self.assertEqual(data['status'], 'declined')
        next_amb_id = data['next_ambulance']
        self.assertNotEqual(next_amb_id, first_amb_id)

        # Citizen client receives tracking:stopped for old unit and reroute update
        events = client_citizen.get_received()
        stopped_events = [e for e in events if e['name'] == 'tracking:stopped']
        self.assertTrue(len(stopped_events) >= 1)
        self.assertEqual(stopped_events[0]['args'][0]['reason'], 'ambulance_declined')

        # Active emergency in backend updated to next ambulance
        self.assertEqual(ACTIVE_EMERGENCIES[emg_id]['ambulance_id'], next_amb_id)

        # New ambulance can now publish updates
        time.sleep(0.8)
        success, payload = process_location_update({
            'ambulance_id': next_amb_id,
            'emergency_id': emg_id,
            'latitude': 12.8790,
            'longitude': 74.8490
        })
        self.assertTrue(success)
        self.assertEqual(payload['ambulanceId'], next_amb_id)

        client_citizen.disconnect()

if __name__ == '__main__':
    unittest.main()
