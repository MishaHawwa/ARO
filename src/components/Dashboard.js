import React from 'react';
import './Dashboard.css';

const emergencies = [
  {
    type: 'Heart Attack',
    icon: '❤️',
    color: '#ff4757',
    description: 'Cardiac emergency'
  },
  {
    type: 'Accident',
    icon: '🚗',
    color: '#ffa502',
    description: 'Traffic accident or injury'
  },
  {
    type: 'Stroke',
    icon: '🧠',
    color: '#ff6348',
    description: 'Neurological emergency'
  },
  {
    type: 'Burns',
    icon: '🔥',
    color: '#ff7f50',
    description: 'Burn injuries'
  },
  {
    type: 'Pregnancy Emergency',
    icon: '🤰',
    color: '#ff6b9d',
    description: 'Maternity emergency'
  },
  {
    type: 'Difficulty Breathing',
    icon: '🫁',
    color: '#3742fa',
    description: 'Respiratory distress'
  },
  {
    type: 'Seizure',
    icon: '⚡',
    color: '#8c7ae6',
    description: 'Neurological seizure'
  },
  {
    type: 'Poisoning',
    icon: '☠️',
    color: '#2f3542',
    description: 'Toxic substance ingestion'
  },
  {
    type: 'Fracture',
    icon: '🦴',
    color: '#a4b0be',
    description: 'Bone fracture or break'
  },
  {
    type: 'Child Emergency',
    icon: '👶',
    color: '#ff9ff3',
    description: 'Pediatric emergency'
  },
  {
    type: 'Drowning',
    icon: '🌊',
    color: '#0abde3',
    description: 'Water-related emergency'
  },
  {
    type: 'Electric Shock',
    icon: '⚡',
    color: '#feca57',
    description: 'Electrical injury'
  }
];

function Dashboard({ onEmergencySelect }) {
  return (
    <div className="dashboard">
      <div className="dashboard-header">
        <div className="header-top">
          <div>
            <h1>Emergency Response System</h1>
            <p className="subtitle">
              Real-time ambulance dispatch and hospital optimization
            </p>
          </div>

          <div className="status-badge">
            <span className="status-dot"></span>
            System Active
          </div>
        </div>
      </div>

      <div className="emergency-grid">
        {emergencies.map((emergency) => (
          <div
            key={emergency.type}
            className="emergency-card"
            style={{ borderColor: emergency.color }}
          >
            <div className="emergency-icon" style={{ color: emergency.color }}>
              {emergency.icon}
            </div>

            <div className="card-content">
              <h3>{emergency.type}</h3>
              <p>{emergency.description}</p>
            </div>

            <button
              className="emergency-button"
              style={{ backgroundColor: emergency.color }}
              onClick={() => onEmergencySelect(emergency.type)}
            >
              Request Emergency
            </button>
          </div>
        ))}
      </div>

      <div className="dashboard-footer">
        <div className="footer-item">
          <span>📍</span>
          <p>Location: Bhatkal, Karnataka</p>
        </div>

        <div className="footer-item">
          <span>🏥</span>
          <p>Connected to 7 hospitals</p>
        </div>

        <div className="footer-item">
          <span>🚑</span>
          <p>8 ambulances available</p>
        </div>
      </div>
    </div>
  );
}

export default Dashboard;