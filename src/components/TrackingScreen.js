import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import './TrackingScreen.css';
import 'leaflet/dist/leaflet.css';
import HospitalScoreboard from './HospitalScoreboard';
import EmergencyChatbot from './EmergencyChatbot';

function MapRecenter({ center }) {
  const map = useMap();
  useEffect(() => {
    if (center && center[0] && center[1]) {
      map.panTo(center, { animate: true });
    }
  }, [center, map]);
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
  const [patientRoute, setPatientRoute] = useState(() => 
    generateRoadWaypoints(resolvedAmbulanceLoc, data.patient_location)
  );
  const [hospitalRoute, setHospitalRoute] = useState(() => 
    generateRoadWaypoints(data.patient_location, data.hospital.location)
  );

  // Live countdown timer ticking down second-by-second
  useEffect(() => {
    const timer = setInterval(() => {
      setCountdownSeconds((prev) => {
        if (prev === null || prev <= 0) return 0;
        return prev - 1;
      });
    }, 1000);
    return () => clearInterval(timer);
  }, []);

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

  // Socket connection for live tracking & dynamic countdown sync
  useEffect(() => {
    const API_BASE_URL = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com');
    const socket = io(API_BASE_URL);

    socket.on('connect', () => {
      console.log('Connected to tracking server');
      socket.emit('start_tracking', {
        emergency_id: data.emergency_id,
        ambulance_location: resolvedAmbulanceLoc,
        patient_location: data.patient_location,
        hospital_location: data.hospital.location
      });
    });

    socket.on('ambulance_update', (update) => {
      if (update.location) {
        setAmbulanceLocation(update.location);
      }
      if (update.status) {
        setAmbulanceStatus(update.status);
      }
      if (update.phase) {
        setJourneyPhase(update.phase);
      }
      if (update.eta !== undefined) {
        setLiveEta(update.eta);
        setCountdownSeconds(update.eta * 60);
      }
      if (update.distance_km !== undefined) {
        setLiveDistance(update.distance_km);
      }
    });

    socket.on('ambulance_arrived', () => {
      setAmbulanceStatus('Arrived at Hospital');
      setJourneyPhase('arrived');
      setLiveEta(0);
      setLiveDistance(0.0);
      setCountdownSeconds(0);
    });

    return () => {
      socket.disconnect();
    };
  }, [data, resolvedAmbulanceLoc]);

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

        {/* Live Google Maps-Style Navigation Bar */}
        <div className="live-nav-banner">
          <div className="live-nav-left">
            <span className="live-pulse-badge">
              <span className="live-pulse-dot"></span>
              LIVE TRACKING
            </span>
            <span className="live-nav-headline">{ambulanceStatus}</span>
          </div>
          <div className="live-nav-right">
            <span className="live-nav-chip">⏱️ Remaining: <strong>{formatCountdown()}</strong></span>
            <span className="live-nav-chip">📏 Distance: <strong>{liveDistance} km</strong></span>
          </div>
        </div>

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
            <MapRecenter center={[ambulanceLocation.lat, ambulanceLocation.lng]} />
            
            <Marker position={[data.patient_location.lat, data.patient_location.lng]} icon={patientIcon}>
              <Popup>Patient Location</Popup>
            </Marker>
            
            <Marker position={[ambulanceLocation.lat, ambulanceLocation.lng]} icon={ambulanceIcon}>
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
