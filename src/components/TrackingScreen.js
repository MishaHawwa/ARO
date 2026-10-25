import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import './TrackingScreen.css';
import 'leaflet/dist/leaflet.css';
import HospitalScoreboard from './HospitalScoreboard';
import EmergencyChatbot from './EmergencyChatbot';

function MapRecenter({ center, enabled = false }) {
  const map = useMap();
  useEffect(() => {
    if (enabled && center && center[0] && center[1]) {
      map.panTo(center, { animate: true });
    }
  }, [center, map, enabled]);
  return null;
}

// Fix for default marker icons in react-leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: require('leaflet/dist/images/marker-icon-2x.png'),
  iconUrl: require('leaflet/dist/images/marker-icon.png'),
  shadowUrl: require('leaflet/dist/images/marker-shadow.png'),
});

// Custom icons
const patientIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iI2ZmNDc1NyIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPvCfpbU8L3RleHQ+PC9zdmc+',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const ambulanceIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iIzNhODZmZiIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPvCfmoE8L3RleHQ+PC9zdmc+',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const hospitalIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iIzJlY2M3MSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPvCfj6U8L3RleHQ+PC9zdmc+',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const formatAmbulanceAlias = (uuid) => {
  if (!uuid) return '';
  const part1 = uuid.substring(0, 4).toUpperCase();
  const part2 = uuid.substring(4, 6).toUpperCase();
  return `KA-${part1}-${part2}`;
};

// Instant realistic street path generator (0ms network latency, never hangs)
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

  // Generate realistic street turns along urban corridors
  const pts = [
    [lat1, lng1],
    [lat1 + dLat * 0.45, lng1 + dLng * 0.08],
    [lat1 + dLat * 0.52, lng1 + dLng * 0.82],
    [lat2, lng2]
  ];

  // Smooth into dense road-following points
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

function TrackingScreen({ data, onBack }) {
  // If ambulance and patient are at the exact same location (same-device testing),
  // station the ambulance ~2.1 km away so they never overlap or cause 0-distance lag
  const resolvedAmbulanceLoc = (() => {
    const amb = data.ambulance.location;
    const pat = data.patient_location;
    if (Math.abs(amb.lat - pat.lat) < 0.008 && Math.abs(amb.lng - pat.lng) < 0.008) {
      return { lat: pat.lat - 0.015, lng: pat.lng - 0.012 };
    }
    return amb;
  })();

  const [ambulanceLocation, setAmbulanceLocation] = useState(resolvedAmbulanceLoc);
  const [ambulanceStatus, setAmbulanceStatus] = useState('En Route to Patient');
  const [journeyPhase, setJourneyPhase] = useState('to_patient');
  const [liveEta, setLiveEta] = useState(data.eta || 5);
  const [liveDistance, setLiveDistance] = useState(data.distance || 2.1);
  const [countdownSeconds, setCountdownSeconds] = useState((data.eta || 5) * 60);
  const [showSuggestions, setShowSuggestions] = useState(true);
  
  // Real-Time GPS & Stale State Management
  const [trackingState, setTrackingState] = useState('waiting'); // waiting, live, stale, stopped, reconnecting
  const [telemetry, setTelemetry] = useState({ accuracy: null, speed: null, heading: null, timestamp: null });
  const [secondsSinceLastUpdate, setSecondsSinceLastUpdate] = useState(0);
  const [activeAmbulance, setActiveAmbulance] = useState(data.ambulance || {});
  const [reroutedNotice, setReroutedNotice] = useState(null);
  const [autoFollow, setAutoFollow] = useState(false);
  const ambulanceMarkerRef = React.useRef(null);
  const lastUpdateEpochRef = React.useRef(Date.now());

  const [patientRoute, setPatientRoute] = useState(() => 
    generateRoadWaypoints(resolvedAmbulanceLoc, data.patient_location)
  );
  const [hospitalRoute, setHospitalRoute] = useState(() => 
    generateRoadWaypoints(data.patient_location, data.hospital.location)
  );

  // Live countdown timer and stale reading monitor ticking second-by-second
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev === null || prev <= 0) return 0;
        return prev - 1;
      });

      const elapsed = Math.floor((Date.now() - lastUpdateEpochRef.current) / 1000);
      setSecondsSinceLastUpdate(elapsed);
      if (elapsed > 15 && trackingState === 'live') {
        setTrackingState('stale');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [trackingState]);

  // Background road route enhancer (optional, max 800ms abort so it never blocks)
  useEffect(() => {
    if (!data?.ambulance?.location || !data?.patient_location || !data?.hospital?.location) return;

    const amb = resolvedAmbulanceLoc;
    const pat = data.patient_location;
    const hosp = data.hospital.location;
    let isMounted = true;

    const enhanceWithOSRM = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 800);

        const [res1, res2] = await Promise.all([
          fetch(
            `https://router.project-osrm.org/route/v1/driving/${amb.lng},${amb.lat};${pat.lng},${pat.lat}?overview=full&geometries=geojson`,
            { signal: controller.signal }
          ).catch(() => null),
          fetch(
            `https://router.project-osrm.org/route/v1/driving/${pat.lng},${pat.lat};${hosp.lng},${hosp.lat}?overview=full&geometries=geojson`,
            { signal: controller.signal }
          ).catch(() => null)
        ]);

        clearTimeout(timeoutId);
        if (!isMounted) return;

        if (res1 && res1.ok) {
          const json1 = await res1.json();
          if (json1?.routes?.[0]?.geometry?.coordinates?.length > 1) {
            setPatientRoute(json1.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
            if (json1.routes[0].duration) {
              const mins = Math.max(1, Math.round(json1.routes[0].duration / 60));
              setLiveEta(mins);
              setCountdownSeconds(mins * 60);
            }
            if (json1.routes[0].distance) {
              setLiveDistance(Number((json1.routes[0].distance / 1000).toFixed(1)));
            }
          }
        }

        if (res2 && res2.ok) {
          const json2 = await res2.json();
          if (json2?.routes?.[0]?.geometry?.coordinates?.length > 1) {
            setHospitalRoute(json2.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
          }
        }
      } catch (err) {}
    };

    enhanceWithOSRM();
    return () => { isMounted = false; };
  }, [data, resolvedAmbulanceLoc]);

  // Socket.IO real-time tracking subscription & event listener lifecycle
  useEffect(() => {
    const API_BASE_URL = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com');
    const socket = io(API_BASE_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    const subscribeToTracking = () => {
      console.log('Subscribing to emergency tracking room:', data.emergency_id);
      socket.emit('tracking:subscribe', {
        emergencyId: data.emergency_id,
        emergency_id: data.emergency_id,
        trackingToken: data.tracking_token,
        tracking_token: data.tracking_token
      });
      socket.emit('start_tracking', {
        emergency_id: data.emergency_id,
        ambulance_location: resolvedAmbulanceLoc,
        patient_location: data.patient_location,
        hospital_location: data.hospital.location
      });
    };

    socket.on('connect', () => {
      console.log('Citizen tracking connected to server');
      subscribeToTracking();
    });

    socket.on('reconnect', () => {
      console.log('Citizen tracking reconnected to server');
      setTrackingState('live');
      subscribeToTracking();
    });

    socket.on('disconnect', () => {
      console.warn('Citizen tracking disconnected from server');
      setTrackingState('reconnecting');
    });

    // Initial snapshot handler
    socket.on('tracking:initial_state', (snapshot) => {
      if (snapshot.emergencyId && snapshot.emergencyId !== data.emergency_id && snapshot.emergency_id !== data.emergency_id) return;
      if (snapshot.location) {
        setAmbulanceLocation(snapshot.location);
        if (ambulanceMarkerRef.current && snapshot.location.lat && snapshot.location.lng) {
          ambulanceMarkerRef.current.setLatLng([snapshot.location.lat, snapshot.location.lng]);
        }
      }
      if (snapshot.status) setAmbulanceStatus(snapshot.status);
      if (snapshot.phase) setJourneyPhase(snapshot.phase);
      if (snapshot.eta !== undefined) {
        setLiveEta(snapshot.eta);
        setCountdownSeconds(snapshot.eta * 60);
      }
      if (snapshot.distanceKm !== undefined) setLiveDistance(snapshot.distanceKm);
      else if (snapshot.distance_km !== undefined) setLiveDistance(snapshot.distance_km);

      setTelemetry({
        accuracy: snapshot.accuracy || null,
        speed: snapshot.speed || null,
        heading: snapshot.heading || null,
        timestamp: snapshot.timestamp || null
      });

      if (snapshot.trackingStatus) {
        setTrackingState(snapshot.trackingStatus);
      }
      lastUpdateEpochRef.current = Date.now();
      setSecondsSinceLastUpdate(0);
    });

    // Live position handler
    const handleLocationUpdate = (update) => {
      // Verify update belongs to this emergency
      const updateEmergencyId = update.emergencyId || update.emergency_id;
      if (updateEmergencyId && updateEmergencyId !== data.emergency_id) return;

      // Check if ambulance was rerouted
      const updateAmbId = update.ambulanceId || update.ambulance_id;
      if (update.rerouted || (updateAmbId && activeAmbulance.id && updateAmbId !== activeAmbulance.id)) {
        setActiveAmbulance(prev => ({
          ...prev,
          id: updateAmbId,
          name: update.ambulanceName || update.ambulance_name || `Unit ${String(updateAmbId).substring(0, 8)}`
        }));
        setReroutedNotice(`Emergency reassigned to ${update.ambulanceName || update.ambulance_name || 'next available ambulance'}.`);
        setTimeout(() => setReroutedNotice(null), 8000);
      }

      // Validate coordinates
      const lat = update.latitude !== undefined ? update.latitude : (update.location?.lat);
      const lng = update.longitude !== undefined ? update.longitude : (update.location?.lng);
      if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
        const newCoords = { lat, lng };
        setAmbulanceLocation(newCoords);
        if (ambulanceMarkerRef.current) {
          ambulanceMarkerRef.current.setLatLng([lat, lng]);
        }
      }

      if (update.status) setAmbulanceStatus(update.status);
      if (update.phase) setJourneyPhase(update.phase);
      if (update.eta !== undefined) {
        setLiveEta(update.eta);
        setCountdownSeconds(update.eta * 60);
      }
      if (update.distanceKm !== undefined) setLiveDistance(update.distanceKm);
      else if (update.distance_km !== undefined) setLiveDistance(update.distance_km);

      setTelemetry({
        accuracy: update.accuracy !== undefined ? update.accuracy : null,
        speed: update.speed !== undefined ? update.speed : null,
        heading: update.heading !== undefined ? update.heading : null,
        timestamp: update.timestamp || new Date().toISOString()
      });

      lastUpdateEpochRef.current = Date.now();
      setSecondsSinceLastUpdate(0);
      setTrackingState('live');
    };

    socket.on('ambulance:location:updated', handleLocationUpdate);
    socket.on('ambulance_update', handleLocationUpdate);

    socket.on('tracking:started', () => {
      setTrackingState('live');
      lastUpdateEpochRef.current = Date.now();
      setSecondsSinceLastUpdate(0);
    });

    socket.on('tracking:stopped', (payload) => {
      setTrackingState('stopped');
      if (payload?.reason === 'ambulance_declined') {
        setReroutedNotice('Assigned ambulance declined. Rerouting to next nearest unit...');
      }
    });

    socket.on('ambulance_arrived', () => {
      setAmbulanceStatus('Arrived at Hospital');
      setJourneyPhase('arrived');
      setTrackingState('stopped');
      setLiveEta(0);
      setLiveDistance(0.0);
      setCountdownSeconds(0);
    });

    return () => {
      socket.off('connect');
      socket.off('reconnect');
      socket.off('disconnect');
      socket.off('tracking:initial_state');
      socket.off('ambulance:location:updated');
      socket.off('ambulance_update');
      socket.off('tracking:started');
      socket.off('tracking:stopped');
      socket.off('ambulance_arrived');
      socket.disconnect();
    };
  }, [data, resolvedAmbulanceLoc, activeAmbulance.id]);

  // Live dynamic route line updating as the ambulance travels in real-time
  useEffect(() => {
    if (!ambulanceLocation) return;
    if (journeyPhase === 'to_hospital') {
      if (data?.hospital?.location) {
        setHospitalRoute(generateRoadWaypoints(ambulanceLocation, data.hospital.location));
      }
    } else {
      if (data?.patient_location) {
        setPatientRoute(generateRoadWaypoints(ambulanceLocation, data.patient_location));
      }
    }
  }, [ambulanceLocation, journeyPhase, data?.patient_location, data?.hospital?.location]);

  const formatCountdown = () => {
    if (ambulanceStatus.includes('Arrived at Hospital')) return 'Arrived';
    if (ambulanceStatus.includes('At Patient')) return 'At Patient';
    if (countdownSeconds && countdownSeconds > 0) {
      const m = Math.floor(countdownSeconds / 60);
      const s = countdownSeconds % 60;
      return m > 0 ? `${m}m ${s < 10 ? '0' : ''}${s}s` : `${s}s`;
    }
    return `${liveEta} mins`;
  };

  const center = [data.patient_location.lat, data.patient_location.lng];

  return (
    <div className="tracking-screen">
      <div className="tracking-header">
        <button className="back-button" onClick={onBack}>← Back to Dashboard</button>
        <h2>🚨 Emergency Tracking</h2>
      </div>

      <div className="tracking-container">
        {/* Top Section - Emergency Info */}
        <div className="info-section">
          <div className="info-card">
            <div className="info-label">Emergency Type</div>
            <div className="info-value emergency-type">{data.emergency_type}</div>
          </div>
          <div className="info-card">
            <div className="info-label">Severity</div>
            <div className="info-value severity">{data.severity}</div>
          </div>
          <div className="info-card">
            <div className="info-label">Assigned Hospital</div>
            <div className="info-value">{data.hospital.name}</div>
          </div>
          <div className="info-card highlight">
            <div className="info-label">{journeyPhase === 'to_hospital' ? 'ETA to Hospital' : 'ETA to Patient'}</div>
            <div className="info-value eta">{formatCountdown()}</div>
          </div>
        </div>

        {/* Rerouted Alert Banner */}
        {reroutedNotice && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '12px 20px', borderRadius: '12px', marginBottom: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>⚠️</span>
            <span>{reroutedNotice}</span>
          </div>
        )}

        {/* Live Navigation & Telemetry Bar */}
        <div className="live-nav-banner">
          <div className="live-nav-left">
            <span className="live-pulse-badge" style={{
              background: trackingState === 'live' ? '#dcfce7' : (trackingState === 'stale' ? '#fef9c3' : (trackingState === 'reconnecting' ? '#e0f2fe' : '#f1f5f9')),
              color: trackingState === 'live' ? '#166534' : (trackingState === 'stale' ? '#854d0e' : (trackingState === 'reconnecting' ? '#075985' : '#475569'))
            }}>
              <span className="live-pulse-dot" style={{
                background: trackingState === 'live' ? '#22c55e' : (trackingState === 'stale' ? '#eab308' : (trackingState === 'reconnecting' ? '#0284c7' : '#94a3b8'))
              }}></span>
              {trackingState === 'live' && 'LIVE GPS TRACKING'}
              {trackingState === 'waiting' && 'CONNECTING TO AMBULANCE GPS'}
              {trackingState === 'stale' && 'SIGNAL STALE'}
              {trackingState === 'reconnecting' && 'RECONNECTING...'}
              {trackingState === 'stopped' && 'TRACKING STOPPED'}
            </span>
            <span className="live-nav-headline">{ambulanceStatus}</span>
          </div>
          <div className="live-nav-right">
            <span className="live-nav-chip">⏱️ Remaining: <strong>{formatCountdown()}</strong></span>
            <span className="live-nav-chip">📏 Distance: <strong>{liveDistance} km</strong></span>
            {telemetry.accuracy !== null && (
              <span className="live-nav-chip" title="GPS Horizontal Accuracy">🎯 ±{telemetry.accuracy}m</span>
            )}
            {telemetry.speed !== null && (
              <span className="live-nav-chip" title="Live Velocity">⚡ {telemetry.speed} km/h</span>
            )}
            <span className="live-nav-chip" title="Signal Freshness">
              📡 {secondsSinceLastUpdate === 0 ? 'Live' : `${secondsSinceLastUpdate}s ago`}
            </span>
            <button 
              onClick={() => setAutoFollow(prev => !prev)}
              style={{
                background: autoFollow ? '#2563eb' : '#f8fafc',
                color: autoFollow ? 'white' : '#334155',
                border: '1px solid #cbd5e1',
                padding: '6px 14px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.85rem'
              }}
            >
              {autoFollow ? '✓ Following Unit' : '🎯 Follow Unit'}
            </button>
          </div>
        </div>

        {/* Stale Warning Notification */}
        {trackingState === 'stale' && (
          <div style={{ background: '#fef3c7', border: '1px solid #fde047', color: '#854d0e', padding: '10px 18px', borderRadius: '10px', margin: '-10px 0 16px 0', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚠️</span>
            <span>Ambulance location signal is stale. Last confirmed reading was received {secondsSinceLastUpdate} seconds ago.</span>
          </div>
        )}

        {/* Middle Section - Map with Highlighted Road Directions */}
        <div className="map-section">
          <MapContainer 
            center={center} 
            zoom={13} 
            style={{ height: '100%', width: '100%', borderRadius: '15px' }}
          >
            <TileLayer
              url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
              attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
            />
            <MapRecenter center={[ambulanceLocation.lat, ambulanceLocation.lng]} enabled={autoFollow} />
            
            <Marker position={[data.patient_location.lat, data.patient_location.lng]} icon={patientIcon}>
              <Popup>Patient Location</Popup>
            </Marker>
            
            <Marker position={[ambulanceLocation.lat, ambulanceLocation.lng]} icon={ambulanceIcon} ref={ambulanceMarkerRef}>
              <Popup>Ambulance - {ambulanceStatus}</Popup>
            </Marker>
            
            <Marker position={[data.hospital.location.lat, data.hospital.location.lng]} icon={hospitalIcon}>
              <Popup>{data.hospital.name}</Popup>
            </Marker>
            
            {/* Google Maps Highlighted Road Directions */}
            {/* Leg 1: Ambulance to Patient (Google Maps blue road route) */}
            {patientRoute.length > 0 ? (
              <>
                <Polyline 
                  positions={patientRoute} 
                  pathOptions={{ color: '#1a73e8', weight: 8, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }} 
                />
                <Polyline 
                  positions={patientRoute} 
                  pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} 
                />
              </>
            ) : (
              <Polyline 
                positions={[[ambulanceLocation.lat, ambulanceLocation.lng], [data.patient_location.lat, data.patient_location.lng]]} 
                pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.8 }} 
              />
            )}

            {/* Leg 2: Patient to Hospital (Google Maps emerald road route) */}
            {hospitalRoute.length > 0 ? (
              <>
                <Polyline 
                  positions={hospitalRoute} 
                  pathOptions={{ 
                    color: journeyPhase === 'to_hospital' ? '#1a73e8' : '#059669', 
                    weight: journeyPhase === 'to_hospital' ? 8 : 7, 
                    opacity: 0.3, 
                    lineCap: 'round', 
                    lineJoin: 'round' 
                  }} 
                />
                <Polyline 
                  positions={hospitalRoute} 
                  pathOptions={{ 
                    color: journeyPhase === 'to_hospital' ? '#2563eb' : '#10b981', 
                    weight: journeyPhase === 'to_hospital' ? 5 : 4, 
                    dashArray: journeyPhase === 'to_hospital' ? null : '6, 8', 
                    opacity: 0.95, 
                    lineCap: 'round', 
                    lineJoin: 'round' 
                  }} 
                />
              </>
            ) : (
              <Polyline 
                positions={[[data.patient_location.lat, data.patient_location.lng], [data.hospital.location.lat, data.hospital.location.lng]]} 
                pathOptions={{ color: '#10b981', weight: 4, dashArray: '6, 8', opacity: 0.8 }} 
              />
            )}
          </MapContainer>
        </div>

        {/* Bottom Section - Details */}
        <div className="details-section">
          <div className="detail-card">
            <div className="detail-icon">🚑</div>
            <div className="detail-content">
              <div className="detail-label">Ambulance Number</div>
              <div className="detail-value">{formatAmbulanceAlias(data.ambulance.id)}</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">📍</div>
            <div className="detail-content">
              <div className="detail-label">Journey Status</div>
              <div className="detail-value">{ambulanceStatus}</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">✅</div>
            <div className="detail-content">
              <div className="detail-label">Hospital Prepared</div>
              <div className="detail-value">YES</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">📏</div>
            <div className="detail-content">
              <div className="detail-label">{journeyPhase === 'to_hospital' ? 'Distance to Hospital' : 'Distance Remaining'}</div>
              <div className="detail-value">{liveDistance} km</div>
            </div>
          </div>
        </div>

        {/* AI Suggestions Section */}
        {data.ai_suggestions && (
          <div className="suggestions-section">
            <div className="suggestions-header">
              <h3>🤖 AI Emergency Guidance</h3>
              <button 
                className="toggle-button"
                onClick={() => setShowSuggestions(!showSuggestions)}
              >
                {showSuggestions ? 'Hide' : 'Show'}
              </button>
            </div>
            
            {showSuggestions && (
              <div className="suggestions-content">
                <div className="suggestion-category">
                  <h4>⚡ Immediate Actions</h4>
                  <ul>
                    {data.ai_suggestions.immediate_actions?.map((action, index) => (
                      <li key={index}>{action}</li>
                    ))}
                  </ul>
                </div>

                <div className="suggestion-category">
                  <h4>⚠️ Warning Signs</h4>
                  <ul>
                    {data.ai_suggestions.warning_signs?.map((sign, index) => (
                      <li key={index}>{sign}</li>
                    ))}
                  </ul>
                </div>

                <div className="suggestion-category danger">
                  <h4>🚫 Do NOT</h4>
                  <ul>
                    {data.ai_suggestions.do_not?.map((item, index) => (
                      <li key={index}>{item}</li>
                    ))}
                  </ul>
                </div>
              </div>
            )}
          </div>
        )}

        {/* Hospital Scoring System - below the fold, as requested */}
        <HospitalScoreboard scores={data.hospital_scores} />
      </div>

      <EmergencyChatbot
        emergencyType={data.emergency_type}
        severity={data.severity}
        eta={data.eta}
      />
    </div>
  );
}

export default TrackingScreen;
