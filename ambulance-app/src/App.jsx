import React, { useState, useEffect } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://aro-backend-tvkq.onrender.com';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

function Routing({ start, end, onRouteInfo }) {
  const map = useMap();

  useEffect(() => {
    if (!map || !start || !end) return;

    const routingControl = L.Routing.control({
      waypoints: [
        L.latLng(start.lat, start.lng),
        L.latLng(end.lat, end.lng)
      ],
      routeWhileDragging: false,
      showAlternatives: false,
      fitSelectedRoutes: true,
      lineOptions: {
        styles: [
          { color: '#1a73e8', weight: 8, opacity: 0.35 },
          { color: '#2563eb', weight: 5, opacity: 0.95 }
        ]
      }
    }).addTo(map);

    routingControl.on('routesfound', (e) => {
      if (e.routes && e.routes[0] && e.routes[0].summary) {
        const s = e.routes[0].summary;
        if (onRouteInfo) {
          onRouteInfo({
            distanceKm: Number((s.totalDistance / 1000).toFixed(1)),
            etaMins: Math.max(1, Math.round(s.totalTime / 60))
          });
        }
      }
    });

    return () => map.removeControl(routingControl);
  }, [map, start, end, onRouteInfo]);

  return null;
}

const formatAmbulanceAlias = (uuid) => {
  if (!uuid) return '';
  const part1 = uuid.substring(0, 4).toUpperCase();
  const part2 = uuid.substring(4, 6).toUpperCase();
  return `KA-${part1}-${part2}`;
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [ambulanceId] = useState('b2d0b054-8d8a-42d6-b4fc-aecfb77f36d0');
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('idle'); // idle, assigned, en_route_to_patient, en_route_to_hospital, arrived_at_hospital
  const [assignment, setAssignment] = useState(null);
  const [myLocation, setMyLocation] = useState({ lat: 12.8725, lng: 74.8440 });
  const [routeInfo, setRouteInfo] = useState({ distanceKm: null, etaMins: null });
  const [countdownSeconds, setCountdownSeconds] = useState(null);

  // Dynamic 1-second countdown timer
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev === null || prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setMyLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error("GPS error:", error);
          setMyLocation({ lat: 12.8725, lng: 74.8440 });
        },
        { enableHighAccuracy: true }
      );
    }
  }, []);

  useEffect(() => {
    if (isLoggedIn) {
      const newSocket = io(API_BASE_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Ambulance connected to backend');
        newSocket.emit('join_ambulance', { ambulance_id: ambulanceId });
      });

      newSocket.on('new_assignment', (data) => {
        console.log('New assignment received:', data);
        setAssignment(data);
        setStatus('assigned');
        if (data.eta) {
          setRouteInfo(prev => ({ ...prev, etaMins: data.eta }));
          setCountdownSeconds(data.eta * 60);
        }
        if (data.distance) {
          setRouteInfo(prev => ({ ...prev, distanceKm: data.distance }));
        }
      });

      newSocket.on('ambulance_update', (update) => {
        if (update.location) {
          setMyLocation(update.location);
        }
        if (update.eta !== undefined) {
          setRouteInfo(prev => ({ ...prev, etaMins: update.eta }));
          setCountdownSeconds(update.eta * 60);
        }
        if (update.distance_km !== undefined) {
          setRouteInfo(prev => ({ ...prev, distanceKm: update.distance_km }));
        }
      });
      
      return () => newSocket.close();
    }
  }, [isLoggedIn, ambulanceId]);

  // Sync real location to backend
  useEffect(() => {
    if (isLoggedIn && myLocation && ambulanceId) {
      fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/location`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          location: myLocation,
          emergency_id: assignment?.emergency_id,
          status
        })
      }).catch(err => console.log('Location sync error:', err));
    }
  }, [isLoggedIn, myLocation, ambulanceId, status, assignment]);

  const respondToAssignment = async (accepted) => {
    try {
      await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/respond`, {
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
        }, 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  const formatDriverCountdown = () => {
    if (countdownSeconds && countdownSeconds > 0) {
      const m = Math.floor(countdownSeconds / 60);
      const s = countdownSeconds % 60;
      return m > 0 ? `${m}m ${s < 10 ? '0' : ''}${s}s` : `${s}s`;
    }
    return routeInfo.etaMins ? `${routeInfo.etaMins} mins` : `${assignment?.eta || 5} mins`;
  };

  const renderStatusBadge = () => {
    switch (status) {
      case 'idle': return <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>🟢 Available</span>;
      case 'assigned': return <span style={{ background: '#fff3e0', color: '#ef6c00', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>⚡ New Job</span>;
      default: return <span style={{ background: '#e3f2fd', color: '#1565c0', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>🚨 En Route</span>;
    }
  };

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', color: '#d32f2f' }}>Emergency App</h1>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#666', marginBottom: '35px' }}>Driver Portal</h2>
        
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', width: '100%', maxWidth: '400px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', textAlign: 'center', boxSizing: 'border-box' }}>
          <label style={{ display: 'block', marginBottom: '10px', color: '#666', fontWeight: 'bold', fontSize: '0.95rem' }}>Assigned Vehicle:</label>
          <div style={{ padding: '16px', fontSize: 20, marginBottom: 28, background: '#f9f9f9', color: '#d32f2f', border: '1px solid #e0e0e0', borderRadius: '10px', fontWeight: 'bold', letterSpacing: '1px' }}>
            {formatAmbulanceAlias(ambulanceId)}
          </div>
          <button onClick={() => setIsLoggedIn(true)} style={{ width: '100%', padding: '16px', fontSize: 18, background: '#d32f2f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(211, 47, 47, 0.3)' }}>
            Start Shift
          </button>
        </div>
      </div>
    );
  }

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f7', color: '#333' }}>
      {/* Top Navbar */}
      <div style={{ padding: '16px 28px', background: 'white', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.5rem' }}>🚑</span>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vehicle Unit</span>
            <div style={{ fontSize: '1.25rem', color: '#d32f2f', fontWeight: 'bold' }}>{formatAmbulanceAlias(ambulanceId)}</div>
          </div>
        </div>
        <div style={{ display: 'flex', alignItems: 'center', gap: '16px' }}>
          {renderStatusBadge()}
          <button 
            onClick={() => setIsLoggedIn(false)} 
            style={{ padding: '7px 16px', background: '#f5f5f7', color: '#555', border: '1px solid #ccc', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}
          >
            End Shift
          </button>
        </div>
      </div>

      {/* Main Content with container spacing matching Emergency App */}
      <div style={{ padding: '24px', maxWidth: '1200px', margin: '0 auto', width: '100%', boxSizing: 'border-box', flex: 1, display: 'flex', flexDirection: 'column' }}>

        {status === 'idle' && (
          <div style={{ padding: '80px 40px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'white', borderRadius: '16px', border: '1px solid #eee', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            <div style={{ fontSize: '4.5rem', marginBottom: '24px' }}>📡</div>
            <h3 style={{ fontSize: '1.6rem', margin: '0 0 10px 0', color: '#222' }}>Waiting for dispatch...</h3>
            <p style={{ color: '#666', maxWidth: '380px', lineHeight: '1.6', fontSize: '1rem', margin: 0 }}>You are online and marked as available. When an emergency is requested nearby, your screen will alert you immediately.</p>
          </div>
        )}

        {status === 'assigned' && assignment && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: '#ffebee', padding: 28, borderRadius: 16, boxShadow: '0 10px 25px rgba(211, 47, 47, 0.1)', border: '1px solid #ffcdd2' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h1 style={{ color: '#d32f2f', margin: 0, fontSize: '1.8rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  ⚠️ NEW EMERGENCY DISPATCH
                </h1>
                <span style={{ background: '#d32f2f', color: 'white', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>Immediate Action</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '22px' }}>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', fontWeight: 'bold' }}>Condition</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#d32f2f', marginTop: '4px' }}>{assignment.emergency_type}</div>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', fontWeight: 'bold' }}>Severity</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#ef6c00', marginTop: '4px' }}>{assignment.severity}</div>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', fontWeight: 'bold' }}>Assigned Hospital</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#1565c0', marginTop: '4px' }}>{assignment.hospital?.name}</div>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#888', textTransform: 'uppercase', fontWeight: 'bold' }}>Estimated ETA</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#2e7d32', marginTop: '4px' }}>{assignment.eta} mins</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <button 
                  onClick={() => respondToAssignment(true)}
                  style={{ flex: 1, padding: 18, fontSize: 19, background: '#d32f2f', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(211, 47, 47, 0.35)', transition: 'transform 0.1s' }}
                >
                  ✓ ACCEPT DISPATCH
                </button>
                <button 
                  onClick={() => respondToAssignment(false)}
                  style={{ flex: 1, padding: 18, fontSize: 19, background: 'white', color: '#d32f2f', border: '2px solid #d32f2f', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold' }}
                >
                  ✕ DECLINE
                </button>
              </div>
            </div>
            
            <div style={{ height: 380, borderRadius: 16, overflow: 'hidden', border: '1px solid #e0e0e0', boxShadow: '0 4px 16px rgba(0,0,0,0.06)' }}>
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
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            {/* Mission status & action card */}
            <div style={{ padding: '22px 28px', background: 'white', borderRadius: '16px', border: '1px solid #eee', boxShadow: '0 4px 16px rgba(0,0,0,0.05)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '0.85rem', color: '#888', textTransform: 'uppercase', fontWeight: 'bold' }}>Current Mission Objective</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: status === 'en_route_to_patient' ? '#1565c0' : '#2e7d32', marginTop: '2px' }}>
                  {status === 'en_route_to_patient' ? '📍 Driving to Pick Up Patient' : `🏥 Transporting Patient to ${assignment.hospital.name}`}
                </div>
                <div style={{ fontSize: '0.9rem', color: '#666', marginTop: '4px' }}>
                  Patient Condition: <strong>{assignment.emergency_type} ({assignment.severity})</strong>
                </div>
              </div>

              <div>
                {status === 'en_route_to_patient' ? (
                  <button 
                    onClick={() => updateStatus('en_route_to_hospital')}
                    style={{ padding: '16px 28px', fontSize: 17, background: '#1565c0', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(21, 101, 192, 0.3)' }}
                  >
                    ✓ Confirm Patient Picked Up
                  </button>
                ) : (
                  <button 
                    onClick={() => updateStatus('arrived_at_hospital')}
                    style={{ padding: '16px 28px', fontSize: 17, background: '#2e7d32', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(46, 125, 50, 0.3)' }}
                  >
                    ✓ Confirm Arrived at Hospital
                  </button>
                )}
              </div>
            </div>

            {/* Live Google Maps Navigation Metrics Card */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px' }}>
              <div style={{ background: 'white', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Live Road ETA</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#1e40af', marginTop: '4px' }}>
                  ⏱️ {formatDriverCountdown()}
                </div>
              </div>
              <div style={{ background: 'white', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0', borderLeft: '4px solid #059669', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Remaining Distance</div>
                <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#065f46', marginTop: '4px' }}>
                  📏 {routeInfo.distanceKm !== null ? `${routeInfo.distanceKm} km` : `${assignment?.distance || 'Calculating...'} km`}
                </div>
              </div>
              <div style={{ background: 'white', padding: '16px 20px', borderRadius: '14px', border: '1px solid #e2e8f0', borderLeft: '4px solid #d97706', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Navigation System</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#92400e', marginTop: '6px' }}>
                  🚦 Google Maps Blue Route
                </div>
              </div>
            </div>

            {/* Map Card */}
            <div style={{ height: '540px', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e0e0e0', boxShadow: '0 4px 20px rgba(0,0,0,0.07)' }}>
              <MapContainer center={[myLocation.lat, myLocation.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <Routing 
                  start={status === 'en_route_to_patient' ? myLocation : assignment.patient_location} 
                  end={status === 'en_route_to_patient' ? assignment.patient_location : assignment.hospital.location} 
                  onRouteInfo={setRouteInfo}
                />
              </MapContainer>
            </div>
          </div>
        )}
        
        {status === 'arrived_at_hospital' && (
          <div style={{ padding: '70px 40px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'white', borderRadius: '16px', border: '1px solid #eee', boxShadow: '0 4px 14px rgba(0,0,0,0.05)' }}>
            <div style={{ fontSize: '4.5rem', marginBottom: '20px', color: '#4caf50' }}>✅</div>
            <h2 style={{ margin: '0 0 10px 0', color: '#222', fontSize: '1.8rem' }}>Mission Completed!</h2>
            <p style={{ color: '#666', fontSize: '1.05rem', margin: 0 }}>Patient successfully transferred to {assignment?.hospital?.name || 'the emergency department'}. Resetting unit to available...</p>
          </div>
        )}
      </div>
    </div>
  );
}
