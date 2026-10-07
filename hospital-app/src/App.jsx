import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://aro-backend-tvkq.onrender.com';
const HOSPITAL_ID = '3a95708c-35e6-4d34-adc6-18583d160268';

// Fix Leaflet icons
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

const ambulanceIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iI2QzMmYyZiIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPvCfmoE8L3RleHQ+PC9zdmc+',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [socket, setSocket] = useState(null);
  const [emergencies, setEmergencies] = useState({});

  useEffect(() => {
    if (isLoggedIn) {
      const newSocket = io(API_BASE_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to backend');
        newSocket.emit('join_hospital', { hospital_id: HOSPITAL_ID });
      });

      newSocket.on('hospital_new_emergency', (data) => {
        console.log('New emergency assigned to hospital:', data);
        setEmergencies(prev => ({
          ...prev,
          [data.emergency_id]: {
            ...data,
            ambulance_status: 'Dispatched',
            ambulance_location: null
          }
        }));
        // Start tracking this specific emergency to receive ambulance_update events
        newSocket.emit('start_tracking', { emergency_id: data.emergency_id });
      });

      newSocket.on('ambulance_update', (update) => {
        console.log('Ambulance update:', update);
        setEmergencies(prev => {
          if (!prev[update.emergency_id]) return prev;
          return {
            ...prev,
            [update.emergency_id]: {
              ...prev[update.emergency_id],
              ambulance_status: update.status,
              ambulance_location: update.location
            }
          };
        });
      });
      
      return () => newSocket.close();
    }
  }, [isLoggedIn]);

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '30px', color: '#d32f2f' }}>Emergency System</h1>
        <h2 style={{ fontSize: '1.5rem', fontWeight: 400, color: '#666', marginBottom: '40px' }}>Hospital Portal</h2>
        
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 30px rgba(0,0,0,0.1)' }}>
          <label style={{ display: 'block', marginBottom: '10px', color: '#555', fontWeight: 'bold' }}>Facility ID:</label>
          <div style={{ padding: '15px', fontSize: 18, marginBottom: 30, background: '#f9f9f9', color: '#333', border: '1px solid #ddd', borderRadius: '8px', textAlign: 'center', fontWeight: 'bold' }}>
            Peace Hospital Bhatkal
          </div>
          <button onClick={() => setIsLoggedIn(true)} style={{ width: '100%', padding: '15px', fontSize: 18, background: '#d32f2f', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 12px rgba(211, 47, 47, 0.3)' }}>
            Open Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f7', color: '#333' }}>
      <div style={{ padding: '15px 20px', background: 'white', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.05)', position: 'sticky', top: 0, zIndex: 1000 }}>
        <h2 style={{ margin: 0, fontSize: '1.2rem', color: '#666' }}>Facility: <span style={{ color: '#d32f2f', fontWeight: 'bold' }}>Peace Hospital</span></h2>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '6px 14px', borderRadius: 20, fontSize: 14, fontWeight: 'bold' }}>Accepting Patients</span>
          <button onClick={() => setIsLoggedIn(false)} style={{ padding: '6px 14px', background: '#f5f5f7', color: '#555', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 14 }}>Log Out</button>
        </div>
      </div>

      <div style={{ padding: '30px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(250px, 1fr))', gap: '20px', marginBottom: '30px' }}>
          <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#666', fontSize: '1rem' }}>Beds Available</h3>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1565c0' }}>25</div>
          </div>
          <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#666', fontSize: '1rem' }}>Doctors On Call</h3>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#2e7d32' }}>8</div>
            <div style={{ fontSize: '0.85rem', color: '#888', marginTop: '5px' }}>Cardiology, Trauma, Neurology</div>
          </div>
          <div style={{ background: 'white', padding: '20px', borderRadius: '12px', boxShadow: '0 4px 6px rgba(0,0,0,0.05)' }}>
            <h3 style={{ margin: '0 0 10px 0', color: '#666', fontSize: '1rem' }}>Active ER Cases</h3>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#d32f2f' }}>{Object.keys(emergencies).length}</div>
          </div>
        </div>

        <h2 style={{ fontSize: '1.5rem', marginBottom: '20px' }}>Incoming Emergencies</h2>
        
        {Object.keys(emergencies).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', background: 'white', borderRadius: '12px', color: '#888' }}>
            <div style={{ fontSize: '3rem', marginBottom: '10px' }}>🏥</div>
            <p>No active emergencies incoming.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(400px, 1fr))', gap: '20px' }}>
            {Object.values(emergencies).map(emg => (
              <div key={emg.emergency_id} style={{ background: 'white', borderRadius: '12px', overflow: 'hidden', boxShadow: '0 4px 12px rgba(0,0,0,0.1)', border: '1px solid #fee' }}>
                <div style={{ background: '#d32f2f', color: 'white', padding: '12px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 'bold' }}>{emg.emergency_type}</div>
                  <div style={{ fontSize: '0.85rem', opacity: 0.9 }}>ETA: {emg.eta} min</div>
                </div>
                
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '15px' }}>
                    <div>
                      <div style={{ fontSize: '0.8rem', color: '#666', textTransform: 'uppercase' }}>Ambulance ID</div>
                      <div style={{ fontWeight: 'bold' }}>{emg.ambulance_id.substring(0,8).toUpperCase()}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.8rem', color: '#666', textTransform: 'uppercase' }}>Status</div>
                      <div style={{ fontWeight: 'bold', color: '#ef6c00' }}>{emg.ambulance_status}</div>
                    </div>
                  </div>

                  <div style={{ height: '200px', borderRadius: '8px', overflow: 'hidden', background: '#eee' }}>
                    {(emg.ambulance_location || emg.patient_location) && (
                      <MapContainer 
                        center={emg.ambulance_location ? [emg.ambulance_location.lat, emg.ambulance_location.lng] : [emg.patient_location.lat, emg.patient_location.lng]} 
                        zoom={13} 
                        style={{ height: '100%', width: '100%' }}
                        zoomControl={false}
                      >
                        <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                        {emg.ambulance_location && (
                          <Marker position={[emg.ambulance_location.lat, emg.ambulance_location.lng]} icon={ambulanceIcon} />
                        )}
                        {emg.patient_location && (
                          <Marker position={[emg.patient_location.lat, emg.patient_location.lng]} />
                        )}
                        {emg.hospital && (
                          <Marker position={[emg.hospital.location.lat, emg.hospital.location.lng]} />
                        )}
                      </MapContainer>
                    )}
                  </div>
                </div>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}
