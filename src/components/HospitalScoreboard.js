import React from 'react';
import './HospitalScoreboard.css';

// Shows every hospital the backend evaluated for this emergency, ranked by
// match_score (0-100, higher = better). The one that was actually assigned
// (highest score, matching /api/emergency's choice) is highlighted.
function HospitalScoreboard({ scores }) {
  if (!scores || scores.length === 0) return null;

  return (
    <div className="scoreboard-section">
      <h3>🏥 Hospital Scoring System</h3>
      <p className="scoreboard-subtitle">
        Every nearby hospital, scored on facility match, distance, and bed
        availability. Highest score wins the assignment.
      </p>

      <div className="scoreboard-list">
        {scores.map((h) => (
          <div
            key={h.hospital_id}
            className={
              'scoreboard-row' +
              (h.assigned ? ' assigned' : '') +
              (!h.eligible ? ' ineligible' : '')
            }
          >
            <div className="scoreboard-rank">
              {h.assigned ? '🏆' : h.eligible ? '' : '✕'}
            </div>

            <div className="scoreboard-main">
              <div className="scoreboard-name-row">
                <span className="scoreboard-name">{h.hospital_name}</span>
                {h.assigned && <span className="assigned-badge">ASSIGNED</span>}
              </div>

              {h.eligible ? (
                <div className="scoreboard-meta">
                  <span>{h.match_label}</span>
                  <span>•</span>
                  <span>{h.distance_km} km away</span>
                  <span>•</span>
                  <span>{h.beds_available} beds free</span>
                </div>
              ) : (
                <div className="scoreboard-meta ineligible-reason">{h.reason}</div>
              )}

              <div className="scoreboard-bar-track">
                <div
                  className="scoreboard-bar-fill"
                  style={{ width: `${h.match_score}%` }}
                />
              </div>
            </div>

            <div className="scoreboard-score">{h.match_score}</div>
          </div>
        ))}
      </div>
    </div>
  );
}

export default HospitalScoreboard;
