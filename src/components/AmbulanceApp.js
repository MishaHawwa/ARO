import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import './AmbulanceApp.css';

// Driver-facing screen. Open this at /ambulance?id=KA-19-EM-001 on the
// ambulance crew's phone/tablet. It joins a Socket.IO room for that
// ambulance ID and gets pushed a job the instant the backend assigns one
// (see notify_ambulance() in app.py). If nobody accepts within ~25s, the
// backend also places an automated phone call as a fallback (Twilio).
function AmbulanceApp() {
  const params = new URLSearchParams(window.location.search);
  const [ambulanceId, setAmbulanceId] = useState(params.get('id') || '');
  const [connected, setConnected] = useState(false);
  const [job, setJob] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, notified, accepted, en_route, arrived
  const socketRef = useRef(null);

  useEffect(() => {
    if (!ambulanceId) return;

    const API_BASE_URL = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`;
    const socket = io(API_BASE_URL);
    socketRef.current = socket;

    socket.on('connect', () => {
      setConnected(true);
      socket.emit('join_ambulance', { ambulance_id: ambulanceId });
    });
    socket.on('disconnect', () => setConnected(false));

    socket.on('new_assignment', (payload) => {
      setJob(payload);
      setStatus('notified');
      // Vibrate + a loud tone would go here on a real device build (Capacitor
      // has a Haptics plugin - see the mobile-app guidance).
      if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
    });

    return () => socket.disconnect();
  }, [ambulanceId]);

  const respond = async (accepted) => {
    const API_BASE_URL = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`;
    await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/respond`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ accepted }),
    });
    setStatus(accepted ? 'accepted' : 'idle');
    if (!accepted) setJob(null);
  };

  const updateStatus = async (newStatus) => {
    const API_BASE_URL = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`;
    await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status: newStatus }),
    });
    setStatus(newStatus);
    if (newStatus === 'arrived') {
      setTimeout(() => {
        setJob(null);
        setStatus('idle');
      }, 2000);
    }
  };

  if (!ambulanceId) {
    return (
      <div className="ambulance-app">
        <h2>🚑 Ambulance Driver App</h2>
        <p>Enter your ambulance ID to start receiving assignments.</p>
        <input
          placeholder="e.g. KA-19-EM-001"
          onKeyDown={(e) => {
            if (e.key === 'Enter') setAmbulanceId(e.target.value.trim());
          }}
        />
      </div>
    );
  }

  return (
    <div className="ambulance-app">
      <div className="ambulance-header">
        <h2>🚑 {ambulanceId}</h2>
        <span className={`conn-dot ${connected ? 'on' : 'off'}`} />
        <span className="conn-label">{connected ? 'Online' : 'Reconnecting...'}</span>
      </div>

      {!job && (
        <div className="ambulance-idle">
          <p>Standing by. You'll be notified here the moment a job is assigned.</p>
        </div>
      )}

      {job && status === 'notified' && (
        <div className="ambulance-job-card new">
          <h3>New Assignment</h3>
          <p><strong>{job.emergency_type}</strong> — severity {job.severity}</p>
          <p>Hospital: {job.hospital?.name}</p>
          <p>ETA target: {job.eta} min</p>
          <div className="ambulance-actions">
            <button className="accept" onClick={() => respond(true)}>Accept</button>
            <button className="decline" onClick={() => respond(false)}>Decline</button>
          </div>
        </div>
      )}

      {job && status !== 'notified' && (
        <div className="ambulance-job-card">
          <h3>{job.emergency_type} — {job.severity}</h3>
          <p>Hospital: {job.hospital?.name}</p>
          <p>
            Patient location: {job.patient_location?.lat.toFixed(4)}, {job.patient_location?.lng.toFixed(4)}
            {' '}
            <a
              href={`https://www.google.com/maps/dir/?api=1&destination=${job.patient_location?.lat},${job.patient_location?.lng}`}
              target="_blank" rel="noreferrer"
            >Navigate →</a>
          </p>

          <div className="status-steps">
            <button disabled={status !== 'accepted'} onClick={() => updateStatus('en_route_to_patient')}>
              En route to patient
            </button>
            <button disabled={status !== 'en_route_to_patient'} onClick={() => updateStatus('picked_up')}>
              Picked up patient
            </button>
            <button disabled={status !== 'picked_up'} onClick={() => updateStatus('en_route_to_hospital')}>
              En route to hospital
            </button>
            <button disabled={status !== 'en_route_to_hospital'} onClick={() => updateStatus('arrived')}>
              Arrived
            </button>
          </div>
          <p className="current-status">Current status: {status}</p>
        </div>
      )}
    </div>
  );
}

export default AmbulanceApp;
