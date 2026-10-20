import React, { useState, useEffect, useRef } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';

const API_BASE_URL = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com');

// Leaflet icon setup
delete L.Icon.Default.prototype._getIconUrl;
try {
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
    iconUrl: require('leaflet/dist/images/marker-icon.png'),
    shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
  });
} catch (e) {
  L.Icon.Default.mergeOptions({
    iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
    iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
    shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
  });
}

const FLEET_UNITS = [
  { id: 'b2d0b054-8d8a-42d6-b4fc-aecfb77f36d0', alias: 'Unit KA-B2D0', label: 'Mangalore Central' },
  { id: 'a1c0d054-8d8a-42d6-b4fc-aecfb77f0002', alias: 'Unit KA-A1C0', label: 'Mangalore Kadri' },
  { id: 'a1c0d054-8d8a-42d6-b4fc-aecfb77f0003', alias: 'Unit KA-A1C1', label: 'Mangalore Kankanady' },
  { id: 'a1c0d054-8d8a-42d6-b4fc-aecfb77f0004', alias: 'Unit KA-A1C2', label: 'Mangalore Deralakatte' },
  { id: 'h1c0d054-8d8a-42d6-b4fc-aecfb77f0005', alias: 'Unit KA-H1C0', label: 'Honnavar Port' },
  { id: 'h1c0d054-8d8a-42d6-b4fc-aecfb77f0006', alias: 'Unit KA-H1C1', label: 'Honnavar Taluk Center' },
  { id: 'b1c0d054-8d8a-42d6-b4fc-aecfb77f0007', alias: 'Unit KA-B1C0', label: 'Bhatkal Main Road' },
  { id: 'b1c0d054-8d8a-42d6-b4fc-aecfb77f0008', alias: 'Unit KA-B1C1', label: 'Bhatkal Coastal' }
];

function generateRoadWaypoints(start, end) {
  if (!start || !end) return [];
  const lat1 = start.lat !== undefined ? start.lat : start[0];
  const lng1 = start.lng !== undefined ? start.lng : start[1];
  const lat2 = end.lat !== undefined ? end.lat : end[0];
  const lng2 = end.lng !== undefined ? end.lng : end[1];

  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  if (Math.abs(dLat) < 0.0001 && Math.abs(dLng) < 0.0001) {
    return [[lat1, lng1], [lat2, lng2]];
  }

  const pts = [
    [lat1, lng1],
    [lat1 + dLat * 0.45, lng1 + dLng * 0.08],
    [lat1 + dLat * 0.52, lng1 + dLng * 0.82],
    [lat2, lng2]
  ];

  const smooth = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i];
    const pB = pts[i + 1];
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      smooth.push([pA[0] + (pB[0] - pA[0]) * f, pA[1] + (pB[1] - pA[1]) * f]);
    }
  }
  smooth.push([lat2, lng2]);
  return smooth;
}

function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.panTo(center, { animate: true });
    }
  }, [center, map]);
  return null;
}

export default function AmbulanceApp() {
  const params = new URLSearchParams(window.location.search);
  const initialAmbId = params.get('id') || 'b2d0b054-8d8a-42d6-b4fc-aecfb77f36d0';

  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [ambulanceId, setAmbulanceId] = useState(initialAmbId);
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

  // GPS Tracking
  useEffect(() => {
    if (!navigator.geolocation) return;

    navigator.geolocation.getCurrentPosition(
      (pos) => {
        setMyLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      },
      (err) => console.warn("GPS Initial fix warning:", err),
      { enableHighAccuracy: false, timeout: 2000, maximumAge: 60000 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (pos) => {
        setMyLocation({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude
        });
      },
      (err) => console.warn("Watch GPS error:", err),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 5000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  // WebSocket Connection
  useEffect(() => {
    if (isLoggedIn) {
      const newSocket = io(API_BASE_URL);
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('Ambulance connected to backend:', ambulanceId);
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
        if (navigator.vibrate) navigator.vibrate([300, 100, 300]);
      });

      newSocket.on('ambulance_update', (update) => {
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

  // Instant real-time GPS streaming over Socket.IO
  useEffect(() => {
    if (!socket || !isLoggedIn || !myLocation) return;
    socket.emit('driver_location_update', {
      ambulance_id: ambulanceId,
      emergency_id: assignment?.emergency_id,
      location: myLocation,
      status: status
    });
  }, [socket, isLoggedIn, myLocation, ambulanceId, assignment?.emergency_id, status]);

  // Backup HTTP location sync (throttled)
  const lastSyncRef = useRef(0);
  useEffect(() => {
    if (!isLoggedIn || !myLocation || !ambulanceId) return;
    const now = Date.now();
    if (now - lastSyncRef.current < 10000 && status !== 'assigned') return;
    lastSyncRef.current = now;

    fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/location`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        location: myLocation,
        emergency_id: assignment?.emergency_id,
        status
      })
    }).catch(err => console.log('Location sync error:', err));
  }, [isLoggedIn, myLocation, ambulanceId, status, assignment]);

  const respondToAssignment = async (accepted) => {
    try {
      if (socket && assignment) {
        socket.emit('driver_status_update', {
          ambulance_id: ambulanceId,
          emergency_id: assignment.emergency_id,
          status: accepted ? 'en_route_to_patient' : 'idle'
        });
      }

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
      if (socket && assignment) {
        socket.emit('driver_status_update', {
          ambulance_id: ambulanceId,
          emergency_id: assignment.emergency_id,
          status: newStatus
        });
      }

      await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, emergency_id: assignment?.emergency_id })
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

  // Step movement on desktop/simulator for live testing
  const stepTowardsTarget = () => {
    if (!assignment) return;
    const target = status === 'en_route_to_patient' ? assignment.patient_location : assignment.hospital?.location;
    if (!target) return;
    
    const latDiff = target.lat - myLocation.lat;
    const lngDiff = target.lng - myLocation.lng;
    const distTotal = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
    if (distTotal < 0.0006) {
      if (status === 'en_route_to_patient') updateStatus('en_route_to_hospital');
      else updateStatus('arrived_at_hospital');
      return;
    }
    const stepRatio = Math.min(0.2, 0.0025 / distTotal);
    const newLoc = {
      lat: Number((myLocation.lat + latDiff * stepRatio).toFixed(6)),
      lng: Number((myLocation.lng + lngDiff * stepRatio).toFixed(6))
    };
    setMyLocation(newLoc);
    if (socket) {
      socket.emit('driver_location_update', {
        ambulance_id: ambulanceId,
        emergency_id: assignment.emergency_id,
        location: newLoc,
        status: status
      });
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

  const currentUnit = FLEET_UNITS.find(u => u.id === ambulanceId);
  const unitDisplayName = currentUnit ? `${currentUnit.alias} (${currentUnit.label})` : `Unit ${ambulanceId.substring(0, 6)}`;

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', color: '#d32f2f' }}>Emergency App</h1>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#666', marginBottom: '35px' }}>Driver Portal</h2>
        
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', width: '100%', maxWidth: '440px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', textAlign: 'center', boxSizing: 'border-box' }}>
          <label style={{ display: 'block', marginBottom: '10px', color: '#666', fontWeight: 'bold', fontSize: '0.95rem' }}>Select Assigned Vehicle Unit:</label>
          <select 
            value={ambulanceId} 
            onChange={(e) => setAmbulanceId(e.target.value)}
            style={{ width: '100%', padding: '14px', fontSize: 16, marginBottom: 28, background: '#f9f9f9', color: '#d32f2f', border: '1px solid #e0e0e0', borderRadius: '10px', fontWeight: 'bold' }}
          >
            {FLEET_UNITS.map(u => (
              <option key={u.id} value={u.id}>{u.alias} — {u.label}</option>
            ))}
          </select>
          <button onClick={() => setIsLoggedIn(true)} style={{ width: '100%', padding: '16px', fontSize: 18, background: '#d32f2f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(211, 47, 47, 0.3)' }}>
            Start Shift
          </button>
        </div>
      </div>
    );
  }

  // Active route points
  const activeDestination = status === 'en_route_to_patient' ? assignment?.patient_location : assignment?.hospital?.location;
  const currentRouteWaypoints = activeDestination ? generateRoadWaypoints(myLocation, activeDestination) : [];

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f5f5f7', color: '#333' }}>
      {/* Top Navbar */}
      <div style={{ padding: '16px 28px', background: 'white', borderBottom: '1px solid #eee', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 1000 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.5rem' }}>🚑</span>
          <div>
            <span style={{ fontSize: '0.75rem', color: '#888', textTransform: 'uppercase', letterSpacing: '0.5px' }}>Vehicle Unit</span>
            <div style={{ fontSize: '1.25rem', color: '#d32f2f', fontWeight: 'bold' }}>{unitDisplayName}</div>
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

      {/* Main Content */}
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

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                <button 
                  onClick={stepTowardsTarget}
                  title="Simulate driving 250m closer towards destination"
                  style={{ padding: '14px 20px', fontSize: 15, background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold' }}
                >
                  🚗 Test Move 250m
                </button>
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

            {/* Live Navigation Metrics Card */}
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
                <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Navigation Stream</div>
                <div style={{ fontSize: '1.05rem', fontWeight: 'bold', color: '#92400e', marginTop: '6px' }}>
                  🚦 Google Maps Blue Route
                </div>
              </div>
            </div>

            {/* Map Card */}
            <div style={{ height: '540px', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e0e0e0', boxShadow: '0 4px 20px rgba(0,0,0,0.07)' }}>
              <MapContainer center={[myLocation.lat, myLocation.lng]} zoom={13} style={{ height: '100%', width: '100%' }}>
                <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                <MapRecenter center={[myLocation.lat, myLocation.lng]} />
                <Marker position={[myLocation.lat, myLocation.lng]}>
                  <Popup>Ambulance (Your Current Position)</Popup>
                </Marker>
                {assignment?.patient_location && (
                  <Marker position={[assignment.patient_location.lat, assignment.patient_location.lng]}>
                    <Popup>Patient Location</Popup>
                  </Marker>
                )}
                {assignment?.hospital?.location && (
                  <Marker position={[assignment.hospital.location.lat, assignment.hospital.location.lng]}>
                    <Popup>{assignment.hospital.name}</Popup>
                  </Marker>
                )}
                {currentRouteWaypoints.length > 0 && (
                  <>
                    <Polyline 
                      positions={currentRouteWaypoints} 
                      pathOptions={{ color: '#1a73e8', weight: 8, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }} 
                    />
                    <Polyline 
                      positions={currentRouteWaypoints} 
                      pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} 
                    />
                  </>
                )}
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
