import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import './TrackingScreen.css';
import 'leaflet/dist/leaflet.css';
import HospitalScoreboard from './HospitalScoreboard';
import EmergencyChatbot from './EmergencyChatbot';

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

function TrackingScreen({ data, onBack }) {
  const [ambulanceLocation, setAmbulanceLocation] = useState(data.ambulance.location);
  const [ambulanceStatus, setAmbulanceStatus] = useState('En Route');
  const [showSuggestions, setShowSuggestions] = useState(true);

  useEffect(() => {
    const socket = io(process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`);

    socket.on('connect', () => {
      console.log('Connected to tracking server');
      socket.emit('start_tracking', {
        emergency_id: data.emergency_id,
        ambulance_location: data.ambulance.location,
        patient_location: data.patient_location,
        hospital_location: data.hospital.location
      });
    });

    socket.on('ambulance_update', (update) => {
      setAmbulanceLocation(update.location);
      setAmbulanceStatus(update.status);
    });

    socket.on('ambulance_arrived', () => {
      setAmbulanceStatus('Arrived at Hospital');
    });

    return () => {
      socket.disconnect();
    };
  }, [data]);

  const routeCoordinates = [
    [ambulanceLocation.lat, ambulanceLocation.lng],
    [data.patient_location.lat, data.patient_location.lng],
    [data.hospital.location.lat, data.hospital.location.lng]
  ];

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
            <div className="info-label">ETA</div>
            <div className="info-value eta">{data.eta} mins</div>
          </div>
        </div>

        {/* Middle Section - Map */}
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
            
            <Marker position={[data.patient_location.lat, data.patient_location.lng]} icon={patientIcon}>
              <Popup>Patient Location</Popup>
            </Marker>
            
            <Marker position={[ambulanceLocation.lat, ambulanceLocation.lng]} icon={ambulanceIcon}>
              <Popup>Ambulance - {ambulanceStatus}</Popup>
            </Marker>
            
            <Marker position={[data.hospital.location.lat, data.hospital.location.lng]} icon={hospitalIcon}>
              <Popup>{data.hospital.name}</Popup>
            </Marker>
            
            <Polyline positions={routeCoordinates} color="#3a86ff" weight={4} opacity={0.7} />
          </MapContainer>
        </div>

        {/* Bottom Section - Details */}
        <div className="details-section">
          <div className="detail-card">
            <div className="detail-icon">🚑</div>
            <div className="detail-content">
              <div className="detail-label">Ambulance Number</div>
              <div className="detail-value">{data.ambulance.id}</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">📍</div>
            <div className="detail-content">
              <div className="detail-label">Driver Status</div>
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
              <div className="detail-label">Distance</div>
              <div className="detail-value">{data.distance} km</div>
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
