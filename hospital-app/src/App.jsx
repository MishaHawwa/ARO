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

const SPECIALTY_OPTIONS = [
  'Emergency Physician',
  'Cardiologist',
  'Neurologist',
  'Trauma Surgeon',
  'Pediatrician',
  'Obstetrician',
  'Burn Specialist',
  'General Physician'
];

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

  // Resource management local state
  const [icuBeds, setIcuBeds] = useState(10);
  const [generalBeds, setGeneralBeds] = useState(30);
  const [ventilators, setVentilators] = useState(5);
  const [facilityStatus, setFacilityStatus] = useState('Accepting Patients');
  const [specialists, setSpecialists] = useState([]);
  const [isSavingResources, setIsSavingResources] = useState(false);
  const [resourceSaveMessage, setResourceSaveMessage] = useState('');

  // Add specialist state
  const [newDocName, setNewDocName] = useState('');
  const [newDocSpecialty, setNewDocSpecialty] = useState(SPECIALTY_OPTIONS[0]);
  const [newDocStatus, setNewDocStatus] = useState('Available');

  // Bay acknowledge modal / inline state
  const [preparingEmergencyId, setPreparingEmergencyId] = useState(null);
  const [selectedBay, setSelectedBay] = useState('Bay 1 (Trauma)');
  const [bayNotes, setBayNotes] = useState('');

  // Admit modal state
  const [admittingEmergencyId, setAdmittingEmergencyId] = useState(null);
  const [admitBedType, setAdmitBedType] = useState('general');

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

  // Sync local resource state when selected hospital changes
  useEffect(() => {
    if (selectedHospital) {
      setIcuBeds(selectedHospital.icu_beds ?? 8);
      setGeneralBeds(selectedHospital.general_beds ?? (selectedHospital.beds_available ? Math.max(0, selectedHospital.beds_available - 8) : 25));
      setVentilators(selectedHospital.ventilators ?? 4);
      setFacilityStatus(selectedHospital.status || 'Accepting Patients');
      
      const specs = (selectedHospital.specialists || []).map((s, idx) => {
        if (typeof s === 'string') {
          return { id: `spec-${selectedHospital.id}-${idx}`, name: `Dr. ${s.toUpperCase()}`, specialty: s, status: 'Available' };
        }
        return s;
      });
      setSpecialists(specs);
    }
  }, [selectedHospital]);

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

  // Gated Socket Connection
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
            er_acknowledged: false,
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

      newSocket.on('er_acknowledged', (data) => {
        if (data.emergency_id) {
          setEmergencies(prev => {
            const existing = prev[data.emergency_id];
            if (!existing) return prev;
            return {
              ...prev,
              [data.emergency_id]: {
                ...existing,
                er_acknowledged: true,
                er_bay: data.er_bay || 'Bay 1',
                er_notes: data.notes
              }
            };
          });
        }
      });

      newSocket.on('patient_admitted', (data) => {
        if (data.emergency_id) {
          setEmergencies(prev => {
            const next = { ...prev };
            delete next[data.emergency_id];
            return next;
          });
        }
        if (data.hospital && (data.hospital_id === selectedHospital.id || data.hospital.id === selectedHospital.id)) {
          setSelectedHospital(prev => ({ ...prev, ...data.hospital }));
        }
      });

      newSocket.on('hospital_resources_updated', (data) => {
        if (data.hospital && (data.hospital_id === selectedHospital.id || data.hospital.id === selectedHospital.id)) {
          setSelectedHospital(prev => ({ ...prev, ...data.hospital }));
        }
        if (Array.isArray(data.hospitals)) {
          setHospitalsList(data.hospitals);
        }
      });

      return () => newSocket.close();
    }
  }, [isUnlocked, isLoggedIn, selectedHospital]);

  // Save Bed & Resource changes to backend
  const handleSaveResources = async () => {
    if (!selectedHospital) return;
    setIsSavingResources(true);
    setResourceSaveMessage('');

    const payload = {
      icu_beds: Number(icuBeds),
      general_beds: Number(generalBeds),
      ventilators: Number(ventilators),
      beds_available: Number(icuBeds) + Number(generalBeds),
      status: facilityStatus,
      specialists
    };

    try {
      const res = await fetch(`${API_BASE_URL}/api/hospitals/${selectedHospital.id}/resources`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });
      const data = await res.json();
      if (res.ok && data.ok) {
        setSelectedHospital(data.hospital);
        setResourceSaveMessage('✓ Resources saved & synchronized to dispatch network!');
        setTimeout(() => setResourceSaveMessage(''), 4000);
      } else {
        setResourceSaveMessage('⚠️ Failed to save resources.');
      }
    } catch (err) {
      console.error('Error saving resources:', err);
      // Local optimistic update
      setSelectedHospital(prev => ({ ...prev, ...payload }));
      setResourceSaveMessage('✓ Synchronized locally');
      setTimeout(() => setResourceSaveMessage(''), 4000);
    } finally {
      setIsSavingResources(false);
    }
  };

  // Specialist management
  const handleAddSpecialist = () => {
    if (!newDocName.trim()) return;
    const newSpec = {
      id: `spec-${selectedHospital.id}-${Date.now()}`,
      name: newDocName.trim(),
      specialty: newDocSpecialty,
      status: newDocStatus
    };
    const updated = [...specialists, newSpec];
    setSpecialists(updated);
    setNewDocName('');
  };

  const handleToggleSpecialistStatus = (id) => {
    const cycle = { 'Available': 'Busy', 'Busy': 'Off-Duty', 'Off-Duty': 'Available' };
    setSpecialists(prev => prev.map(s => s.id === id ? { ...s, status: cycle[s.status] || 'Available' } : s));
  };

  const handleRemoveSpecialist = (id) => {
    setSpecialists(prev => prev.filter(s => s.id !== id));
  };

  // Emergency preparation: Acknowledge & Prepare ER Bay
  const handleAcknowledgeBay = async (emergencyId) => {
    const payload = {
      emergency_id: emergencyId,
      hospital_id: selectedHospital.id,
      er_bay: selectedBay,
      notes: bayNotes || `ER Bay ${selectedBay} prepared for inbound emergency.`
    };

    try {
      if (socket) {
        socket.emit('er_prepare_bay', payload);
      }
      await fetch(`${API_BASE_URL}/api/hospital/acknowledge-emergency`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      setEmergencies(prev => {
        if (!prev[emergencyId]) return prev;
        return {
          ...prev,
          [emergencyId]: {
            ...prev[emergencyId],
            er_acknowledged: true,
            er_bay: selectedBay,
            er_notes: payload.notes
          }
        };
      });
      setPreparingEmergencyId(null);
      setBayNotes('');
    } catch (err) {
      console.error('Error acknowledging emergency:', err);
    }
  };

  // Emergency completion: Mark Patient Admitted
  const handleAdmitPatient = async (emergencyId) => {
    const payload = {
      emergency_id: emergencyId,
      hospital_id: selectedHospital.id,
      bed_type: admitBedType
    };

    try {
      if (socket) {
        socket.emit('admit_patient', payload);
      }
      await fetch(`${API_BASE_URL}/api/hospital/admit-patient`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(payload)
      });

      // Decrement bed locally
      if (admitBedType === 'icu') {
        setIcuBeds(b => Math.max(0, b - 1));
      } else {
        setGeneralBeds(b => Math.max(0, b - 1));
      }

      setEmergencies(prev => {
        const next = { ...prev };
        delete next[emergencyId];
        return next;
      });
      setAdmittingEmergencyId(null);
    } catch (err) {
      console.error('Error admitting patient:', err);
    }
  };

  const filteredHospitals = hospitalsList.filter(h => 
    h.name.toLowerCase().includes(searchQuery.toLowerCase())
  );

  // Screen 1: Passcode Gate
  if (!isUnlocked) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <div style={{ textAlign: 'center', marginBottom: 25 }}>
          <div style={{ fontSize: '3.5rem', marginBottom: '10px' }}>🏥</div>
          <h1 style={{ fontSize: '2.4rem', margin: '0 0 8px 0', color: '#d32f2f' }}>Hospital Emergency Portal</h1>
          <p style={{ color: '#666', fontSize: '1.05rem', margin: 0 }}>Authorized ER Command Center & Fleet Radar</p>
        </div>
        
        <div style={{ background: 'white', padding: '38px', borderRadius: '16px', width: '100%', maxWidth: '420px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', boxSizing: 'border-box' }}>
          <div style={{ textAlign: 'center', marginBottom: 24 }}>
            <span style={{ fontSize: '2.2rem' }}>🔒</span>
            <h3 style={{ margin: '8px 0 4px 0', color: '#222', fontSize: '1.25rem' }}>Passcode Gate</h3>
            <p style={{ margin: 0, color: '#777', fontSize: '0.88rem' }}>Enter the 4-digit facility access PIN to unlock the live command center</p>
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
              {isVerifying ? 'Verifying PIN...' : '🔓 Unlock Command Center'}
            </button>
          </form>
        </div>
      </div>
    );
  }

  // Screen 2: Facility Selection
  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '6px', color: '#d32f2f' }}>Emergency App</h1>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#666', marginBottom: '25px' }}>Hospital Command Center</h2>
        
        <div style={{ background: 'white', padding: '35px', borderRadius: '16px', width: '100%', maxWidth: '480px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', boxSizing: 'border-box' }}>
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
            Select Active Hospital Facility:
          </label>
          
          <input 
            type="text"
            placeholder="🔍 Search hospital by name..."
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            style={{ width: '100%', padding: '12px 14px', borderRadius: '8px', border: '1px solid #ccc', fontSize: '15px', marginBottom: '12px', boxSizing: 'border-box', outline: 'none' }}
          />

          <div style={{ maxHeight: '250px', overflowY: 'auto', border: '1px solid #e0e0e0', borderRadius: '8px', marginBottom: '25px', background: '#fafafa' }}>
            {filteredHospitals.length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: '#888', fontSize: '14px' }}>No hospitals found</div>
            ) : (
              filteredHospitals.map(h => {
                const isSelected = selectedHospital?.id === h.id;
                const totalBeds = h.beds_available ?? ((h.icu_beds || 0) + (h.general_beds || 0));
                const specialistsCount = Array.isArray(h.specialists) ? h.specialists.length : 0;
                return (
                  <div 
                    key={h.id}
                    onClick={() => setSelectedHospital(h)}
                    style={{
                      padding: '14px 16px',
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
                      <div style={{ fontWeight: isSelected ? 'bold' : '600', color: isSelected ? '#1a73e8' : '#333', fontSize: '14.5px' }}>
                        {h.name}
                      </div>
                      <div style={{ fontSize: '12.5px', color: '#666', marginTop: '3px' }}>
                        Beds: <strong>{totalBeds}</strong> (ICU: {h.icu_beds ?? '—'}, Gen: {h.general_beds ?? '—'}) • {specialistsCount} Specialists
                      </div>
                    </div>
                    {isSelected && <span style={{ color: '#1a73e8', fontWeight: 'bold', fontSize: '18px' }}>✓</span>}
                  </div>
                );
              })
            )}
          </div>

          <button 
            disabled={!selectedHospital}
            onClick={() => setIsLoggedIn(true)} 
            style={{ 
              width: '100%', 
              padding: '15px', 
              fontSize: 17, 
              background: selectedHospital ? '#d32f2f' : '#ccc', 
              color: 'white', 
              border: 'none', 
              borderRadius: '10px', 
              cursor: selectedHospital ? 'pointer' : 'not-allowed', 
              fontWeight: 'bold', 
              boxShadow: selectedHospital ? '0 4px 14px rgba(211, 47, 47, 0.3)' : 'none' 
            }}
          >
            Launch Command Center
          </button>
        </div>
      </div>
    );
  }

  // Screen 3: Full ER Command Center Dashboard
  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc', color: '#1e293b' }}>
      
      {/* Top Navigation Bar */}
      <div style={{ padding: '16px 28px', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.03)', position: 'sticky', top: 0, zIndex: 1000, flexWrap: 'wrap', gap: '12px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          <span style={{ fontSize: '1.8rem' }}>🏥</span>
          <div>
            <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.6px', fontWeight: 'bold' }}>Facility ER Command</div>
            <h2 style={{ margin: '1px 0 0 0', fontSize: '1.35rem', color: '#d32f2f', fontWeight: 'bold' }}>{selectedHospital.name}</h2>
          </div>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
          <select 
            value={facilityStatus}
            onChange={(e) => setFacilityStatus(e.target.value)}
            style={{ 
              padding: '6px 14px', 
              borderRadius: '20px', 
              fontSize: '13px', 
              fontWeight: 'bold', 
              border: '1px solid #cbd5e1', 
              cursor: 'pointer',
              background: facilityStatus === 'Accepting Patients' ? '#dcfce7' : (facilityStatus === 'ER High Load' ? '#fef9c3' : '#fee2e2'),
              color: facilityStatus === 'Accepting Patients' ? '#166534' : (facilityStatus === 'ER High Load' ? '#854d0e' : '#991b1b')
            }}
          >
            <option value="Accepting Patients">🟢 Accepting Patients</option>
            <option value="ER High Load">🟡 ER High Load</option>
            <option value="Diversion / At Capacity">🔴 Diversion / At Capacity</option>
          </select>

          <button onClick={() => setIsLoggedIn(false)} style={{ padding: '7px 16px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>Switch Hospital</button>
          <button onClick={handleLockDashboard} style={{ padding: '7px 16px', background: '#fee2e2', color: '#991b1b', border: '1px solid #fecaca', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}>🔒 Lock Portal</button>
        </div>
      </div>

      <div style={{ padding: '24px', maxWidth: '1280px', margin: '0 auto', width: '100%', boxSizing: 'border-box', display: 'flex', flexDirection: 'column', gap: '24px' }}>

        {/* Global Live Stat Counters */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(210px, 1fr))', gap: '16px' }}>
          <div style={{ background: 'white', padding: '18px 22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb' }}>
            <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Available Beds</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#1e40af', marginTop: '4px' }}>
              {icuBeds + generalBeds}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>ICU: {icuBeds} • General: {generalBeds}</div>
          </div>

          <div style={{ background: 'white', padding: '18px 22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', borderLeft: '4px solid #059669' }}>
            <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Ventilators Ready</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#065f46', marginTop: '4px' }}>
              {ventilators}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Critical respiratory support</div>
          </div>

          <div style={{ background: 'white', padding: '18px 22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', borderLeft: '4px solid #d97706' }}>
            <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Specialists On Duty</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#92400e', marginTop: '4px' }}>
              {specialists.filter(s => s.status !== 'Off-Duty').length} <span style={{ fontSize: '1rem', color: '#64748b' }}>/ {specialists.length}</span>
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>{specialists.filter(s => s.status === 'Available').length} Available right now</div>
          </div>

          <div style={{ background: 'white', padding: '18px 22px', borderRadius: '14px', boxShadow: '0 2px 8px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', borderLeft: '4px solid #dc2626' }}>
            <div style={{ color: '#64748b', fontSize: '0.8rem', textTransform: 'uppercase', fontWeight: 'bold' }}>Active Inbound Ambulances</div>
            <div style={{ fontSize: '2rem', fontWeight: 'bold', color: '#b91c1c', marginTop: '4px' }}>
              {Object.keys(emergencies).length}
            </div>
            <div style={{ fontSize: '0.78rem', color: '#94a3b8', marginTop: '2px' }}>Live tracking active</div>
          </div>
        </div>

        {/* Resource Management & Specialist Roster Grid */}
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(420px, 1fr))', gap: '24px' }}>
          
          {/* Card A: Bed & Ventilator Capacity Controls */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '18px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#1e293b' }}>🛏️ Bed & Ventilator Management</h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Adjust and broadcast live capacity across the dispatch network</p>
              </div>
              <button 
                onClick={handleSaveResources}
                disabled={isSavingResources}
                style={{ padding: '8px 18px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13.5px' }}
              >
                {isSavingResources ? 'Syncing...' : '💾 Save & Broadcast'}
              </button>
            </div>

            {resourceSaveMessage && (
              <div style={{ padding: '8px 14px', borderRadius: '8px', background: '#dcfce7', color: '#166534', fontWeight: 'bold', fontSize: '0.85rem', marginBottom: '16px' }}>
                {resourceSaveMessage}
              </div>
            )}

            <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
              {/* ICU Beds control */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Available ICU Beds</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Equipped with continuous vitals monitoring</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button 
                    onClick={() => setIcuBeds(b => Math.max(0, b - 1))}
                    style={{ width: 34, height: 34, borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}
                  >-</button>
                  <input 
                    type="number"
                    min="0"
                    value={icuBeds}
                    onChange={(e) => setIcuBeds(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ width: 50, textAlign: 'center', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 'bold', fontSize: '16px' }}
                  />
                  <button 
                    onClick={() => setIcuBeds(b => b + 1)}
                    style={{ width: 34, height: 34, borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}
                  >+</button>
                </div>
              </div>

              {/* General Beds control */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>General Emergency Beds</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Observation and step-down ER capacity</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button 
                    onClick={() => setGeneralBeds(b => Math.max(0, b - 1))}
                    style={{ width: 34, height: 34, borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}
                  >-</button>
                  <input 
                    type="number"
                    min="0"
                    value={generalBeds}
                    onChange={(e) => setGeneralBeds(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ width: 50, textAlign: 'center', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 'bold', fontSize: '16px' }}
                  />
                  <button 
                    onClick={() => setGeneralBeds(b => b + 1)}
                    style={{ width: 34, height: 34, borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}
                  >+</button>
                </div>
              </div>

              {/* Ventilators control */}
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '12px 16px', background: '#f8fafc', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                <div>
                  <div style={{ fontWeight: 'bold', fontSize: '0.95rem' }}>Available Ventilators</div>
                  <div style={{ fontSize: '0.8rem', color: '#64748b' }}>Invasive and non-invasive ventilators ready</div>
                </div>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <button 
                    onClick={() => setVentilators(v => Math.max(0, v - 1))}
                    style={{ width: 34, height: 34, borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}
                  >-</button>
                  <input 
                    type="number"
                    min="0"
                    value={ventilators}
                    onChange={(e) => setVentilators(Math.max(0, parseInt(e.target.value) || 0))}
                    style={{ width: 50, textAlign: 'center', padding: '6px', borderRadius: '6px', border: '1px solid #cbd5e1', fontWeight: 'bold', fontSize: '16px' }}
                  />
                  <button 
                    onClick={() => setVentilators(v => v + 1)}
                    style={{ width: 34, height: 34, borderRadius: '8px', border: '1px solid #cbd5e1', background: 'white', cursor: 'pointer', fontWeight: 'bold', fontSize: '18px' }}
                  >+</button>
                </div>
              </div>
            </div>
          </div>

          {/* Card B: On-Duty Specialists Roster */}
          <div style={{ background: 'white', borderRadius: '16px', padding: '24px', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', border: '1px solid #e2e8f0', display: 'flex', flexDirection: 'column' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px' }}>
              <div>
                <h3 style={{ margin: 0, fontSize: '1.2rem', color: '#1e293b' }}>👨‍⚕️ On-Duty Specialists Roster</h3>
                <p style={{ margin: '3px 0 0 0', fontSize: '0.85rem', color: '#64748b' }}>Named medical specialists available for trauma & critical intake</p>
              </div>
              <button 
                onClick={handleSaveResources}
                disabled={isSavingResources}
                style={{ padding: '6px 14px', background: '#f1f5f9', color: '#334155', border: '1px solid #cbd5e1', borderRadius: '8px', fontWeight: 'bold', cursor: 'pointer', fontSize: '12px' }}
              >
                Sync Roster
              </button>
            </div>

            {/* Specialist List */}
            <div style={{ maxHeight: '180px', overflowY: 'auto', border: '1px solid #e2e8f0', borderRadius: '10px', marginBottom: '16px', background: '#f8fafc' }}>
              {specialists.length === 0 ? (
                <div style={{ padding: '20px', textAlign: 'center', color: '#94a3b8', fontSize: '0.9rem' }}>No specialists listed. Add one below.</div>
              ) : (
                specialists.map(s => (
                  <div key={s.id} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '10px 14px', borderBottom: '1px solid #e2e8f0', background: 'white' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '0.92rem', color: '#1e293b' }}>{s.name}</div>
                      <div style={{ fontSize: '0.8rem', color: '#64748b' }}>{s.specialty}</div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <button 
                        onClick={() => handleToggleSpecialistStatus(s.id)}
                        title="Click to cycle status: Available -> Busy -> Off-Duty"
                        style={{
                          padding: '4px 10px',
                          borderRadius: '12px',
                          border: 'none',
                          cursor: 'pointer',
                          fontWeight: 'bold',
                          fontSize: '0.76rem',
                          background: s.status === 'Available' ? '#dcfce7' : (s.status === 'Busy' ? '#fef9c3' : '#f1f5f9'),
                          color: s.status === 'Available' ? '#166534' : (s.status === 'Busy' ? '#854d0e' : '#64748b')
                        }}
                      >
                        ● {s.status}
                      </button>
                      <button 
                        onClick={() => handleRemoveSpecialist(s.id)}
                        style={{ background: 'none', border: 'none', color: '#ef4444', cursor: 'pointer', fontSize: '15px' }}
                        title="Remove specialist"
                      >
                        ✕
                      </button>
                    </div>
                  </div>
                ))
              )}
            </div>

            {/* Add Specialist Form */}
            <div style={{ background: '#f1f5f9', padding: '12px 14px', borderRadius: '10px', display: 'flex', flexWrap: 'wrap', gap: '8px', alignItems: 'center' }}>
              <input 
                type="text"
                placeholder="Doctor Name (e.g. Dr. Rajesh Naik)"
                value={newDocName}
                onChange={(e) => setNewDocName(e.target.value)}
                style={{ flex: '1 1 180px', padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', outline: 'none' }}
              />
              <select 
                value={newDocSpecialty}
                onChange={(e) => setNewDocSpecialty(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: 'white' }}
              >
                {SPECIALTY_OPTIONS.map(opt => (
                  <option key={opt} value={opt}>{opt}</option>
                ))}
              </select>
              <select 
                value={newDocStatus}
                onChange={(e) => setNewDocStatus(e.target.value)}
                style={{ padding: '8px 10px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', background: 'white' }}
              >
                <option value="Available">Available</option>
                <option value="Busy">Busy</option>
                <option value="Off-Duty">Off-Duty</option>
              </select>
              <button 
                onClick={handleAddSpecialist}
                disabled={!newDocName.trim()}
                style={{ padding: '8px 14px', background: newDocName.trim() ? '#16a34a' : '#cbd5e1', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: newDocName.trim() ? 'pointer' : 'not-allowed', fontSize: '13px' }}
              >
                + Add Doctor
              </button>
            </div>
          </div>
        </div>

        {/* Inbound Emergencies (Live Radar Section) */}
        <div>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
            <div>
              <h2 style={{ fontSize: '1.4rem', margin: 0, color: '#1e293b' }}>Inbound Emergencies (Live Radar)</h2>
              <p style={{ margin: '3px 0 0 0', fontSize: '0.88rem', color: '#64748b' }}>Active dispatches en route to {selectedHospital.name}</p>
            </div>
            <span style={{ fontSize: '0.85rem', color: '#16a34a', fontWeight: 'bold' }}>● WebSocket Live Feed</span>
          </div>

          {Object.keys(emergencies).length === 0 ? (
            <div style={{ textAlign: 'center', padding: '60px', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', color: '#64748b' }}>
              <div style={{ fontSize: '3.5rem', marginBottom: '12px' }}>🏥</div>
              <h3 style={{ margin: '0 0 6px 0', color: '#1e293b', fontSize: '1.25rem' }}>No Active Inbound Emergencies</h3>
              <p style={{ margin: 0, fontSize: '0.95rem', maxWidth: '420px', marginInline: 'auto' }}>
                When an emergency dispatch selects {selectedHospital.name}, real-time GPS telemetry, ER bay prep controls, and intake tools will appear automatically.
              </p>
            </div>
          ) : (
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(440px, 1fr))', gap: '22px' }}>
              {Object.values(emergencies).map(emg => (
                <div key={emg.emergency_id} style={{ background: 'white', borderRadius: '16px', overflow: 'hidden', boxShadow: '0 4px 16px rgba(0,0,0,0.06)', border: '1px solid #fed7aa' }}>
                  
                  {/* Card Header */}
                  <div style={{ background: '#d32f2f', color: 'white', padding: '16px 20px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                    <div>
                      <div style={{ fontWeight: 'bold', fontSize: '1.1rem' }}>🚨 {emg.emergency_type}</div>
                      <div style={{ fontSize: '0.8rem', opacity: 0.9, marginTop: '2px' }}>Severity: <strong>{emg.severity || 'Urgent'}</strong></div>
                    </div>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                      <span style={{ fontSize: '0.8rem', background: '#16a34a', color: 'white', padding: '3px 8px', borderRadius: '10px', fontWeight: 'bold' }}>
                        ● {emg.last_updated ? `${Math.floor((nowEpoch - emg.last_updated)/1000)}s ago` : 'Live'}
                      </span>
                      <span style={{ fontSize: '0.95rem', background: 'rgba(255,255,255,0.25)', padding: '5px 12px', borderRadius: '12px', fontWeight: 'bold' }}>
                        ETA: {emg.eta}m ({emg.distance ? `${emg.distance} km` : 'En route'})
                      </span>
                    </div>
                  </div>

                  <div style={{ padding: '20px' }}>
                    
                    {/* Vehicle & Prep Status Info */}
                    <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', background: '#f8fafc', padding: '12px 16px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
                      <div>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Vehicle Unit</div>
                        <div style={{ fontWeight: 'bold', color: '#d32f2f', marginTop: '2px', fontSize: '0.95rem' }}>
                          {emg.ambulance_id ? `KA-${emg.ambulance_id.substring(0,4).toUpperCase()}-${emg.ambulance_id.substring(4,6).toUpperCase()}` : 'Assigned Fleet Unit'}
                        </div>
                      </div>
                      <div style={{ textAlign: 'right' }}>
                        <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Ambulance Status</div>
                        <div style={{ fontWeight: 'bold', color: '#d97706', marginTop: '2px', fontSize: '0.95rem' }}>
                          {emg.ambulance_status}
                        </div>
                      </div>
                    </div>

                    {/* ER Bay Status Banner */}
                    {emg.er_acknowledged ? (
                      <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <div>
                          <strong>✅ ER Prepared:</strong> {emg.er_bay || 'Trauma Bay 1'}
                          {emg.er_notes && <span style={{ fontSize: '0.8rem', display: 'block', color: '#14532d' }}>Notes: {emg.er_notes}</span>}
                        </div>
                        <span style={{ fontSize: '0.8rem', fontWeight: 'bold', background: '#22c55e', color: 'white', padding: '3px 8px', borderRadius: '6px' }}>Ready</span>
                      </div>
                    ) : (
                      <div style={{ background: '#fef3c7', border: '1px solid #fde68a', color: '#92400e', padding: '10px 14px', borderRadius: '8px', marginBottom: '16px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
                        <span style={{ fontSize: '0.88rem' }}>⚠️ ER Bay has not been pre-assigned yet</span>
                        <button 
                          onClick={() => setPreparingEmergencyId(emg.emergency_id)}
                          style={{ padding: '6px 12px', background: '#d97706', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '0.82rem' }}
                        >
                          Prepare Bay
                        </button>
                      </div>
                    )}

                    {/* Prepare Bay Inline Dialog */}
                    {preparingEmergencyId === emg.emergency_id && (
                      <div style={{ background: '#f1f5f9', padding: '14px', borderRadius: '10px', marginBottom: '16px', border: '1px solid #cbd5e1' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '8px', color: '#1e293b' }}>Assign Intake Bay:</div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px', flexWrap: 'wrap' }}>
                          {['Bay 1 (Trauma)', 'Bay 2 (Cardiac)', 'ICU Bay 3 (Resus)', 'ER Observation 4'].map(bay => (
                            <button 
                              key={bay} 
                              onClick={() => setSelectedBay(bay)}
                              style={{ 
                                padding: '6px 12px', 
                                borderRadius: '6px', 
                                border: '1px solid #cbd5e1', 
                                fontSize: '0.82rem', 
                                fontWeight: 'bold', 
                                cursor: 'pointer',
                                background: selectedBay === bay ? '#2563eb' : 'white',
                                color: selectedBay === bay ? 'white' : '#334155'
                              }}
                            >
                              {bay}
                            </button>
                          ))}
                        </div>
                        <input 
                          type="text"
                          placeholder="Optional notes for crew & intake team..."
                          value={bayNotes}
                          onChange={(e) => setBayNotes(e.target.value)}
                          style={{ width: '100%', padding: '8px', borderRadius: '6px', border: '1px solid #cbd5e1', fontSize: '13px', boxSizing: 'border-box', marginBottom: '10px' }}
                        />
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => handleAcknowledgeBay(emg.emergency_id)}
                            style={{ flex: 1, padding: '9px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
                          >
                            ✓ Confirm Bay & Notify Driver
                          </button>
                          <button 
                            onClick={() => setPreparingEmergencyId(null)}
                            style={{ padding: '9px 14px', background: 'white', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Patient Admission Inline Dialog */}
                    {admittingEmergencyId === emg.emergency_id && (
                      <div style={{ background: '#eff6ff', padding: '14px', borderRadius: '10px', marginBottom: '16px', border: '1px solid #bfdbfe' }}>
                        <div style={{ fontWeight: 'bold', fontSize: '0.9rem', marginBottom: '8px', color: '#1e40af' }}>Admit Patient to Facility:</div>
                        <div style={{ display: 'flex', gap: '8px', marginBottom: '10px' }}>
                          <button 
                            onClick={() => setAdmitBedType('general')}
                            style={{ 
                              flex: 1, 
                              padding: '8px', 
                              borderRadius: '6px', 
                              border: '1px solid #bfdbfe', 
                              fontSize: '0.82rem', 
                              fontWeight: 'bold', 
                              cursor: 'pointer',
                              background: admitBedType === 'general' ? '#2563eb' : 'white',
                              color: admitBedType === 'general' ? 'white' : '#1e40af'
                            }}
                          >
                            General Bed (-1)
                          </button>
                          <button 
                            onClick={() => setAdmitBedType('icu')}
                            style={{ 
                              flex: 1, 
                              padding: '8px', 
                              borderRadius: '6px', 
                              border: '1px solid #bfdbfe', 
                              fontSize: '0.82rem', 
                              fontWeight: 'bold', 
                              cursor: 'pointer',
                              background: admitBedType === 'icu' ? '#2563eb' : 'white',
                              color: admitBedType === 'icu' ? 'white' : '#1e40af'
                            }}
                          >
                            ICU Bed (-1)
                          </button>
                        </div>
                        <div style={{ display: 'flex', gap: '8px' }}>
                          <button 
                            onClick={() => handleAdmitPatient(emg.emergency_id)}
                            style={{ flex: 1, padding: '9px', background: '#2563eb', color: 'white', border: 'none', borderRadius: '6px', fontWeight: 'bold', cursor: 'pointer', fontSize: '13px' }}
                          >
                            ✓ Confirm Admission & Free Ambulance
                          </button>
                          <button 
                            onClick={() => setAdmittingEmergencyId(null)}
                            style={{ padding: '9px 14px', background: 'white', color: '#64748b', border: '1px solid #cbd5e1', borderRadius: '6px', cursor: 'pointer', fontSize: '13px' }}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    )}

                    {/* Live Leaflet Map */}
                    <div style={{ height: '220px', borderRadius: '10px', overflow: 'hidden', border: '1px solid #e2e8f0', marginBottom: '14px' }}>
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

                    {/* Action Buttons Row */}
                    <div style={{ display: 'flex', gap: '10px' }}>
                      {!emg.er_acknowledged && (
                        <button 
                          onClick={() => setPreparingEmergencyId(emg.emergency_id)}
                          style={{ flex: 1, padding: '12px', background: '#d97706', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 2px 6px rgba(217, 119, 6, 0.25)' }}
                        >
                          🚨 Prepare ER Bay
                        </button>
                      )}
                      <button 
                        onClick={() => setAdmittingEmergencyId(emg.emergency_id)}
                        style={{ flex: 1, padding: '12px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '14px', boxShadow: '0 2px 6px rgba(22, 163, 74, 0.25)' }}
                      >
                        🏥 Admit Patient / Complete Trip
                      </button>
                    </div>

                  </div>
                </div>
              ))}
            </div>
          )}
        </div>

      </div>
    </div>
  );
}
