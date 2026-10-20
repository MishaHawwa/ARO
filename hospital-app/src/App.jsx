import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://aro-backend-tvkq.onrender.com';

// Fix Leaflet marker icons
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
  const [hospitalsList, setHospitalsList] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [socket, setSocket] = useState(null);
  const [emergencies, setEmergencies] = useState({});

  useEffect(() => {
    fetch(`${API_BASE_URL}/api/hospitals`)
      .then(res => res.json())
      .then(data => {
        if (Array.isArray(data) && data.length > 0) {
          setHospitalsList(data);
          setSelectedHospital(data[0]);
        }
      })
      .catch(err => console.error("Error fetching hospitals:", err));
  }, []);

  useEffect(() => {
    if (isLoggedIn && selectedHospital) {
      const newSocket = io(API_BASE_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to backend as hospital:', selectedHospital.name);
        newSocket.emit('join_hospital', { hospital_id: selectedHospital.id });
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
        newSocket.emit('start_tracking', { emergency_id: data.emergency_id });
      });

      newSocket.on('ambulance_update', (update) => {
        setEmergencies(prev => {
          if (!prev[update.emergency_id]) return prev;
          return {
            ...prev,
            [update.emergency_id]: {
              ...prev[update.emergency_id],
              ambulance_status: update.status,
              ambulance_location: update.location || prev[update.emergency_id].ambulance_location
            }
          };
        });
      });
      
      return () => newSocket.close();
    }
  }, [isLoggedIn, selectedHospital]);

  const filteredHospitals = hospitalsList.filter(h => 
    h.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', color: '#d32f2f' }}>Emergency App</h1>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#666', marginBottom: '30px' }}>Hospital Portal</h2>
        
        <div style={{ background: 'white', padding: '35px', borderRadius: '16px', width: '100%', maxWidth: '440px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', boxSizing: 'border-box' }}>
          <label style={{ display: 'block', marginBottom: '8px', color: '#444', fontWeight: 'bold', fontSize: '0.95rem' }}>
            Select Your Hospital:
          </label>
          
          <input 
            type="text"
            placeholder="🔍 Search hospital..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '12px 14px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '15px', marginBottom: '12px', boxSizing: 'border-box', outline: 'none' }}
          />

          <div style={{ maxHeight: '220px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '8px', marginBottom: '25px', background: '#fafafa' }}>
            {filteredHospitals.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px' }}>No hospitals found</div>
            ) : (
              filteredHospitals.map(h => {
                const isSelected = selectedHospital?.id === h.id;
                return (
                  <div 
                    key={h.id}
                    onClick={() => setSelectedHospital(h)}
                    style={{
                      padding: '12px 14px',
                      cursor: 'pointer',
                      borderBottom: '1px solid #eee',
                      background: isSelected ? '#e8f0fe' : 'white',
                      transition: 'background 0.2s',
                      display: 'flex',
                      justifyContent: 'space-between',
                      alignItems: 'center'
                    }}
                  >
                    <div>
                      <div style={{ fontWeight: isSelected ? 'bold' : '600', color: isSelected ? '#1a73e8' : '#333', fontSize: '14px' }}>
                        {h.name}
                      </div>
                      <div style={{ fontSize: '12px', color: '#777', marginTop: '2px' }}>
                        Available Beds: {h.beds_available ?? 'N/A'} • {h.specialists?.slice(0, 2).join(', ') || 'General ER'}
                      </div>
                    </div>
                    {isSelected && <span style={{ color: '#1a73e8', fontWeight: 'bold', fontSize: '16px' }}>✓</span>}
                  </div>
                );
              })
            )}
          </div>

          <button 
            disabled={!selectedHospital}
            onClick={() => setIsLoggedIn(true)} 
            style={{ width: '100%', padding: '15px', fontSize: 17, background: selectedHospital ? '#d32f2f' : '#ccc', color: 'white', border: 'none', borderRadius: '10px', cursor: selectedHospital ? 'pointer' : 'not-allowed', fontWeight: 'bold', boxShadow: selectedHospital ? '0 4px 14px rgba(211, 47, 47, 0.3)' : 'none' }}
          >
            Open Dashboard
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f7', color: '#333' }}>
      <div style={{ padding: '16px 24px', background: 'white', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 1000 }}>
        <div>
          <span style={{ fontSize: '0.85rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Facility</span>
          <h2 style={{ margin: '2px 0 0 0', fontSize: '1.3rem', color: '#d32f2f', fontWeight: 'bold' }}>{selectedHospital.name}</h2>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '15px' }}>
          <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>🟢 Accepting Patients</span>
          <button onClick={() => setIsLoggedIn(false)} style={{ padding: '7px 16px', background: '#f5f5f7', color: '#555', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>Switch Hospital</button>
        </div>
      </div>

      <div style={{ padding: '28px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box' }}>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(260px, 1fr))', gap: '20px', marginBottom: '28px' }}>
          <div style={{ background: 'white', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#777', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Beds Available</h3>
            <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#1565c0' }}>{selectedHospital.beds_available ?? 25}</div>
          </div>
          <div style={{ background: 'white', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#777', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Specialties & ICU</h3>
            <div style={{ fontSize: '1.2rem', fontWeight: '600', color: '#2e7d32', marginTop: '6px' }}>
              {[selectedHospital.cardiac_icu && 'Cardiac ICU', selectedHospital.neuro_icu && 'Neuro ICU', selectedHospital.trauma_center && 'Trauma Center'].filter(Boolean).join(', ') || 'General ICU, Emergency'}
            </div>
            <div style={{ fontSize: '0.82rem', color: '#888', marginTop: '6px' }}>{selectedHospital.specialists?.join(', ') || 'On-call specialists active'}</div>
          </div>
          <div style={{ background: 'white', padding: '22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.05)', border: '1px solid #eee' }}>
            <h3 style={{ margin: '0 0 8px 0', color: '#777', fontSize: '0.9rem', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Active Inbound Cases</h3>
            <div style={{ fontSize: '2.2rem', fontWeight: 'bold', color: '#d32f2f' }}>{Object.keys(emergencies).length}</div>
          </div>
        </div>

        <h2 style={{ fontSize: '1.4rem', marginBottom: '18px', color: '#333' }}>Inbound Emergencies (Live Radar)</h2>
        
        {Object.keys(emergencies).length === 0 ? (
          <div style={{ textAlign: 'center', padding: '60px', background: 'white', borderRadius: '14px', border: '1px solid #eee', color: '#888' }}>
            <div style={{ fontSize: '3rem', marginBottom: '12px' }}>🏥</div>
            <h3 style={{ margin: '0 0 6px 0', color: '#444' }}>No Active Inbound Emergencies</h3>
            <p style={{ margin: 0, fontSize: '0.95rem' }}>When an ambulance is dispatched with a patient heading here, live tracking will appear automatically.</p>
          </div>
        ) : (
          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '22px' }}>
            {Object.values(emergencies).map(emg => (
              <div key={emg.emergency_id} style={{ background: 'white', borderRadius: '14px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.08)', border: '1px solid #ffcdd2' }}>
                <div style={{ background: '#d32f2f', color: 'white', padding: '14px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                  <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>🚨 {emg.emergency_type}</div>
                  <div style={{ fontSize: '0.9rem', background: 'rgba(255,255,255,0.2)', padding: '4px 10px', borderRadius: '12px' }}>ETA: {emg.eta} mins</div>
                </div>
                
                <div style={{ padding: '20px' }}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: '16px', background: '#fafafa', padding: '12px 16px', borderRadius: '10px' }}>
                    <div>
                      <div style={{ fontSize: '0.75rem', color: '#777', textTransform: 'uppercase', fontWeight: 'bold' }}>Vehicle</div>
                      <div style={{ fontWeight: 'bold', color: '#d32f2f', marginTop: '2px' }}>{emg.ambulance_id ? `KA-${emg.ambulance_id.substring(0,4).toUpperCase()}-${emg.ambulance_id.substring(4,6).toUpperCase()}` : 'Assigned Unit'}</div>
                    </div>
                    <div style={{ textAlign: 'right' }}>
                      <div style={{ fontSize: '0.75rem', color: '#777', textTransform: 'uppercase', fontWeight: 'bold' }}>Status</div>
                      <div style={{ fontWeight: 'bold', color: '#ef6c00', marginTop: '2px' }}>{emg.ambulance_status}</div>
                    </div>
                  </div>

                  <div style={{ height: '220px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #eee' }}>
                    <MapContainer 
                      center={emg.ambulance_location ? [emg.ambulance_location.lat, emg.ambulance_location.lng] : [emg.patient_location.lat, emg.patient_location.lng]} 
                      zoom={13} 
                      style={{ height: '100%', width: '100%' }}
                      zoomControl={false}
                    >
                      <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                      {emg.ambulance_location && (
                        <Marker position={[emg.ambulance_location.lat, emg.ambulance_location.lng]} icon={ambulanceIcon}>
                          <Popup>Ambulance - {emg.ambulance_status}</Popup>
                        </Marker>
                      )}
                      {emg.patient_location && (
                        <Marker position={[emg.patient_location.lat, emg.patient_location.lng]}>
                          <Popup>Patient Location</Popup>
                        </Marker>
                      )}
                    </MapContainer>
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
