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

const createAmbulanceIcon = (heading = 0) => L.divIcon({
  className: 'rotatable-hospital-ambulance-marker',
  html: `
    <div style="
      width: 36px;
      height: 36px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: rotate(${heading || 0}deg);
      transition: transform 0.4s ease;
    ">
      <div style="
        background: #d32f2f;
        color: white;
        border: 2px solid white;
        border-radius: 50%;
        width: 32px;
        height: 32px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 8px rgba(0,0,0,0.3);
        font-size: 16px;
      ">
        🚑
      </div>
    </div>
  `,
  iconSize: [36, 36],
  iconAnchor: [18, 18]
});

export default function App() {
  const [isUnlocked, setIsUnlocked] = useState(() => sessionStorage.getItem('hospital_passcode_verified') === 'true');
  const [passcode, setPasscode] = useState('');
  const [passcodeError, setPasscodeError] = useState('');
  const [isVerifying, setIsVerifying] = useState(false);

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [hospitalsList, setHospitalsList] = useState([]);
  const [selectedHospital, setSelectedHospital] = useState(null);
  const [searchQuery, setSearchQuery] = useState('');
  const [socket, setSocket] = useState(null);
  const [emergencies, setEmergencies] = useState({});
  const [nowEpoch, setNowEpoch] = useState(Date.now());

  const handleVerifyPasscode = async (e) => {
    if (e) e.preventDefault();
    const cleanCode = passcode.trim();
    if (!cleanCode) {
      setPasscodeError('Please enter the security PIN.');
      return;
    }
    setIsVerifying(true);
    setPasscodeError('');

    try {
      const res = await fetch(`${API_BASE_URL}/api/hospital/verify-passcode`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ passcode: cleanCode })
      });
      const data = await res.json();
      if (res.ok && data.valid) {
        sessionStorage.setItem('hospital_passcode_verified', 'true');
        setIsUnlocked(true);
        setPasscodeError('');
      } else {
        setPasscodeError(data.error || 'Invalid passcode. Default is 1234.');
      }
    } catch (err) {
      // Local fallback verification in case of offline / preflight error
      if (cleanCode === '1234') {
        sessionStorage.setItem('hospital_passcode_verified', 'true');
        setIsUnlocked(true);
        setPasscodeError('');
      } else {
        setPasscodeError('Invalid passcode. Default is 1234.');
      }
    } finally {
      setIsVerifying(false);
    }
  };

  const handleLockDashboard = () => {
    sessionStorage.removeItem('hospital_passcode_verified');
    setIsUnlocked(false);
    setIsLoggedIn(false);
    setPasscode('');
    setPasscodeError('');
  };

  useEffect(() => {
    const timer = setInterval(() => setNowEpoch(Date.now()), 1000);
    return () => clearInterval(timer);
  }, []);

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

  // Socket connection is STRICTLY gated: NEVER connect when locked!
  useEffect(() => {
    if (isUnlocked && isLoggedIn && selectedHospital) {
      const newSocket = io(API_BASE_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Connected to backend as hospital:', selectedHospital.name);
        newSocket.emit('join_hospital', { hospital_id: selectedHospital.id });
      });

      newSocket.on('hospital_new_emergency', (data) => {
        console.log('New emergency assigned to hospital:', data);
        const tripId = data.trip_id || `trip_${data.emergency_id}`;
        setEmergencies(prev => ({
          ...prev,
          [data.emergency_id]: {
            ...data,
            trip_id: tripId,
            ambulance_status: data.status || 'Dispatched',
            ambulance_location: data.ambulance_location || null,
            patient_location: data.patient_location || null,
            eta: data.eta || 5,
            distance: data.distance || 2.0,
            heading: 0,
            speed: null,
            last_updated: Date.now()
          }
        }));
        newSocket.emit('join_trip', { tripId });
        newSocket.emit('start_tracking', { emergency_id: data.emergency_id });
      });

      const handleUpdate = (update) => {
        const emgId = update.emergency_id || update.emergencyId || (update.tripId ? update.tripId.replace('trip_', '') : null);
        if (!emgId) return;

        setEmergencies(prev => {
          const existing = prev[emgId];
          if (!existing) return prev;

          if (update.role === 'citizen') {
            const patLat = update.lat !== undefined ? update.lat : update.latitude;
            const patLng = update.lng !== undefined ? update.lng : update.longitude;
            return {
              ...prev,
              [emgId]: {
                ...existing,
                patient_location: (patLat !== undefined && patLng !== undefined) ? { lat: patLat, lng: patLng } : existing.patient_location,
                last_updated: Date.now()
              }
            };
          }

          const lat = update.lat !== undefined ? update.lat : (update.latitude !== undefined ? update.latitude : update.location?.lat);
          const lng = update.lng !== undefined ? update.lng : (update.longitude !== undefined ? update.longitude : update.location?.lng);
          const loc = (lat !== undefined && lng !== undefined) ? { lat, lng } : existing.ambulance_location;

          return {
            ...prev,
            [emgId]: {
              ...existing,
              ambulance_location: loc,
              ambulance_status: update.status || existing.ambulance_status,
              eta: update.eta !== undefined ? update.eta : existing.eta,
              distance: update.distance_km || update.distanceKm || existing.distance,
              heading: update.heading !== undefined ? update.heading : existing.heading,
              speed: update.speed !== undefined ? update.speed : existing.speed,
              last_updated: Date.now()
            }
          };
        });
      };

      newSocket.on('location_broadcast', handleUpdate);
      newSocket.on('ambulance:location:updated', handleUpdate);
      newSocket.on('ambulance_update', handleUpdate);
      
      return () => newSocket.close();
    }
  }, [isUnlocked, isLoggedIn, selectedHospital]);

  const filteredHospitals = hospitalsList.filter(h => 
    h.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  if (!isUnlocked) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 25 }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '10px' }}>🏥</div>
          <h1 style={{ fontSize: '2.4rem', margin: '0 0 8px 0', color: '#d32f2f' }}>Hospital Emergency Portal</h1>
          <p style={{ color: '#666', fontSize: '1.05rem', margin: 0 }}>Authorized Facility Access & Emergency Radar</p>
        </div>
        
        <div style={{ background: 'white', padding: '38px', borderRadius: '16px', width: '100%', maxWidth: '420px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', boxSizing: 'border-box' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ fontSize: '2.2rem' }}>🔒</span>
            <h3 style={{ margin: '8px 0 4px 0', color: '#222', fontSize: '1.25rem' }}>Passcode Gate</h3>
            <p style={{ margin: 0, color: '#777', fontSize: '0.88rem' }}>Enter the 4-digit facility access PIN to unlock the live dashboard</p>
          </div>

          <form onSubmit={handleVerifyPasscode}>
            <div style={{ marginBottom: 20 }}>
              <label style={{ display: 'block', marginBottom: 8, color: '#444', fontWeight: 'bold', fontSize: '0.9rem' }}>
                Universal PIN Code:
              </label>
              <input 
                type="password"
                maxLength={4}
                autoFocus
                placeholder="••••"
                value={passcode}
                onChange={(e) => {
                  setPasscode(e.target.value);
                  setPasscodeError('');
                }}
                style={{ 
                  width: '100%', 
                  padding: '14px', 
                  borderRadius: '10px', 
                  border: passcodeError ? '2px solid #ef4444' : '1px solid #d1d5db', 
                  fontSize: '24px', 
                  textAlign: 'center',
                  letterSpacing: '10px',
                  boxSizing: 'border-box', 
                  outline: 'none',
                  background: '#f9fafb'
                }}
              />
              <div style={{ fontSize: '0.78rem', color: '#6b7280', marginTop: 6, textAlign: 'center' }}>
                🔑 Default staff passcode: <strong>1234</strong>
              </div>
            </div>

            {passcodeError && (
              <div style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', padding: '10px 14px', borderRadius: '8px', marginBottom: 18, fontSize: '0.86rem', textAlign: 'center', fontWeight: 'bold' }}>
                ⚠️ {passcodeError}
              </div>
            )}

            <button 
              type="submit"
              disabled={isVerifying || passcode.length === 0}
              style={{ 
                width: '100%', 
                padding: '15px', 
                fontSize: 17, 
                background: '#d32f2f', 
                color: 'white', 
                border: 'none', 
                borderRadius: '10px', 
                cursor: (isVerifying || passcode.length === 0) ? 'not-allowed' : 'pointer', 
                fontWeight: 'bold', 
                boxShadow: '0 4px 14px rgba(211, 47, 47, 0.3)',
                opacity: (isVerifying || passcode.length === 0) ? 0.6 : 1,
                transition: 'all 0.2s'
              }}
            >
              {isVerifying ? 'Verifying PIN...' : '🔓 Unlock Dashboard'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', color: '#d32f2f' }}>Emergency App</h1>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#666', marginBottom: '30px' }}>Hospital Portal</h2>
        
        <div style={{ background: 'white', padding: '35px', borderRadius: '16px', width: '100%', maxWidth: '440px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', boxSizing: 'border-box' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <span style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 'bold' }}>✓ Authenticated (PIN 1234)</span>
            <button 
              onClick={handleLockDashboard}
              style={{ padding: '4px 10px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.78rem' }}
            >
              🔒 Lock
            </button>
          </div>

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
          <button onClick={handleLockDashboard} style={{ padding: '7px 16px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>🔒 Lock Portal</button>
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
                  <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                    <span style={{ fontSize: '0.8rem', background: '#2e7d32', color: 'white', padding: '3px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                      ● {emg.last_updated ? `${Math.floor((nowEpoch - emg.last_updated)/1000)}s ago` : 'Live'}
                    </span>
                    <span style={{ fontSize: '0.9rem', background: 'rgba(255,255,255,0.25)', padding: '4px 10px', borderRadius: '12px', fontWeight: 'bold' }}>
                      ETA: {emg.eta}m
                    </span>
                  </div>
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
                        <Marker position={[emg.ambulance_location.lat, emg.ambulance_location.lng]} icon={createAmbulanceIcon(emg.heading)}>
                          <Popup>
                            <strong>Ambulance Unit</strong><br />
                            Status: {emg.ambulance_status}<br />
                            Speed: {emg.speed ? `${emg.speed} km/h` : 'En route'}
                          </Popup>
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
