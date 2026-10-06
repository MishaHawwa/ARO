import React, { useState, useEffect } from 'react';
import { io } from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import 'leaflet-routing-machine';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://aro-backend-tvkq.onrender.com';

function Routing({ start, end }) {
  const map = useMap();
  useEffect(() => {
    if (!start || !end) return;
    const routingControl = L.Routing.control({
      waypoints: [
        L.latLng(start.lat, start.lng),
        L.latLng(end.lat, end.lng)
      ],
      routeWhileDragging: false,
      addWaypoints: false,
      fitSelectedRoutes: true,
      show: false
    }).addTo(map);

    return () => map.removeControl(routingControl);
  }, [map, start, end]);
  return null;
}

const formatAmbulanceAlias = (uuid) => {
  if (!uuid) return '';
  const part1 = uuid.substring(0, 4).toUpperCase();
  const part2 = uuid.substring(4, 6).toUpperCase();
  return `KA-${part1}-${part2}`;
};

export default function App() {
  const [ambulanceId, setAmbulanceId] = useState('b2d0b054-8d8a-42d6-b4fc-aecfb77f36d0');
  const [ambulanceList, setAmbulanceList] = useState([]);
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [socket, setSocket] = useState(null);
  
  const [assignment, setAssignment] = useState(null);
  const [status, setStatus] = useState('idle');
  const [myLocation, setMyLocation] = useState({ lat: 13.9667, lng: 74.5667 });

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/ambulances`)
      .then(res => res.json())
      .then(data => {
        setAmbulanceList(data);
      })
      .catch(err => console.error("Error fetching ambulances", err));
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      const newSocket = io(API_BASE_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to backend');
        newSocket.emit('join_ambulance', { ambulance_id: ambulanceId });
      });

      newSocket.on('new_assignment', (data) => {
        console.log('New assignment received:', data);
        setAssignment(data);
        setStatus('assigned');
      });
      
      return () => newSocket.close();
    }
  }, [isLoggedIn, ambulanceId]);

  const respondToAssignment = async (accepted) => {
    try {
      const res = await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accepted, 
          emergency_id: assignment.emergency_id,
          patient_location: assignment.patient_location,
          emergency_type: assignment.emergency_type,
          severity: assignment.severity,
          hospital: assignment.hospital,
          eta: assignment.eta
        })
      });
      const data = await res.json();
      
      if (accepted) {
        setStatus('en_route_to_patient');
      } else {
        setAssignment(null);
        setStatus('idle');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatus = async (newStatus) => {
    try {
      await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus })
      });
      setStatus(newStatus);
      if (newStatus === 'arrived_at_hospital') {
        setTimeout(() => {
          setAssignment(null);
          setStatus('idle');
        }, 3000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const renderStatusBadge = () => {
    switch (status) {
      case 'idle': return <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '6px 14px', borderRadius: 20, fontSize: 14, fontWeight: 'bold' }}>Available</span>;
      case 'assigned': return <span style={{ background: '#fff3e0', color: '#ef6c00', padding: '6px 14px', borderRadius: 20, fontSize: 14, fontWeight: 'bold' }}>New Job</span>;
      default: return <span style={{ background: '#e3f2fd', color: '#1565c0', padding: '6px 14px', borderRadius: 20, fontSize: 14, fontWeight: 'bold' }}>Busy</span>;
    }
  };

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', color: '#d32f2f' }}>Emergency System</h1>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 400, color: '#666', marginBottom: '40px' }}>Driver Portal</h2>
        
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
          <div style={{ padding: '15px', fontSize: 18, marginBottom: 30, background: '#f9f9f9', color: '#333', border: '1px solid #ddd', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>
            KA-B2D0-B0
          </div>
          <button onClick={() => setIsLoggedIn(true)} style={{ width: '100%', padding: '15px', fontSize: 18, background: '#d32f2f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(211, 47, 47, 0.3)' }}>
            Start Shift
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", height: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f7', color: '#333' }}>
      <div style={{ padding: '15px 20px', background: 'white', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#666' }}>Vehicle: <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>{formatAmbulanceAlias(ambulanceId)}</span></h2>
        <div>{renderStatusBadge()}</div>
      </div>

      {status === 'idle' && (
        <div style={{ padding: 40, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '20px' }}>📡</div>
          <h3 style={{ fontSize: '1.5rem', margin: '0 0 10px 0', color: '#333' }}>Waiting for dispatch...</h3>
          <p style={{ color: '#666', maxWidth: '300px', lineHeight: '1.5' }}>You are currently marked as available and will be notified of nearby emergencies.</p>
        </div>
      )}

      {status === 'assigned' && assignment && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', padding: 20 }}>
          <div style={{ background: '#ffebee', padding: 25, borderRadius: 16, marginBottom: 20, boxShadow: '0 10px 20px rgba(211, 47, 47, 0.1)', border: '1px solid #ffcdd2' }}>
            <h1 style={{ color: '#d32f2f', margin: '0 0 5px 0', fontSize: '2rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
              ⚠️ EMERGENCY DISPATCH
            </h1>
            <p style={{ color: '#c62828', margin: '0 0 20px 0', fontSize: '1.1rem' }}>Requested 0 minutes ago</p>
            
            <div style={{ background: 'white', padding: '20px', borderRadius: '12px', marginBottom: '20px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)' }}>
              <p style={{ margin: '0 0 12px 0', fontSize: '1.2rem', color: '#333' }}><strong>Condition:</strong> <span style={{ color: '#d32f2f' }}>{assignment.emergency_type} ({assignment.severity})</span></p>
              <p style={{ margin: '0', fontSize: '1.2rem', color: '#333' }}><strong>Destination:</strong> {assignment.hospital.name}</p>
            </div>

            <div style={{ display: 'flex', gap: 15 }}>
              <button 
                onClick={() => respondToAssignment(true)}
                style={{ flex: 1, padding: 20, fontSize: 20, background: '#d32f2f', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(211, 47, 47, 0.3)' }}
              >
                ACCEPT
              </button>
              <button 
                onClick={() => respondToAssignment(false)}
                style={{ flex: 1, padding: 20, fontSize: 20, background: 'white', color: '#d32f2f', border: '1px solid #d32f2f', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold' }}
              >
                DECLINE
              </button>
            </div>
          </div>
          
          <div style={{ flex: 1, minHeight: 250, borderRadius: 16, overflow: 'hidden', border: '1px solid #ddd', boxShadow: '0 4px 12px rgba(0,0,0,0.05)' }}>
            <MapContainer center={[assignment.patient_location.lat, assignment.patient_location.lng]} zoom={14} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Marker position={[assignment.patient_location.lat, assignment.patient_location.lng]}>
                <Popup>Patient Location</Popup>
              </Marker>
            </MapContainer>
          </div>
        </div>
      )}

      {(status === 'en_route_to_patient' || status === 'en_route_to_hospital') && assignment && (
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: 25, background: 'white', borderBottom: '1px solid #eee', boxShadow: '0 2px 10px rgba(0,0,0,0.05)' }}>
            {status === 'en_route_to_patient' ? (
              <>
                <p style={{ margin: '0 0 15px 0', color: '#666', fontSize: '1.1rem' }}>Current Objective: <strong style={{ color: '#1565c0' }}>Pick up patient</strong></p>
                <button 
                  onClick={() => updateStatus('en_route_to_hospital')}
                  style={{ width: '100%', padding: '20px', fontSize: 18, background: '#1565c0', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(21, 101, 192, 0.3)' }}
                >
                  Confirm Patient Picked Up
                </button>
              </>
            ) : (
              <>
                <p style={{ margin: '0 0 15px 0', color: '#666', fontSize: '1.1rem' }}>Current Objective: <strong style={{ color: '#2e7d32' }}>Drive to {assignment.hospital.name}</strong></p>
                <button 
                  onClick={() => updateStatus('arrived_at_hospital')}
                  style={{ width: '100%', padding: '20px', fontSize: 18, background: '#2e7d32', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(46, 125, 50, 0.3)' }}
                >
                  Confirm Arrived at Hospital
                </button>
              </>
            )}
          </div>
          <div style={{ flex: 1 }}>
             <MapContainer center={[myLocation.lat, myLocation.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
              <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
              <Routing 
                start={status === 'en_route_to_patient' ? myLocation : assignment.patient_location} 
                end={status === 'en_route_to_patient' ? assignment.patient_location : assignment.hospital.location} 
              />
            </MapContainer>
          </div>
        </div>
      )}
      
      {status === 'arrived_at_hospital' && (
        <div style={{ padding: 40, flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center' }}>
          <div style={{ fontSize: '4rem', marginBottom: '20px', color: '#4caf50' }}>✅</div>
          <h2 style={{ margin: '0 0 10px 0', color: '#333' }}>Job Completed</h2>
          <p style={{ color: '#666' }}>Great work. Resetting your status to available...</p>
        </div>
      )}
    </div>
  );
}
