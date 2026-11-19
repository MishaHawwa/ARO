import React, { useState, useEffect, useCallback } from 'react';
import Dashboard from './components/Dashboard';
import LoadingScreen from './components/LoadingScreen';
import TrackingScreen from './components/TrackingScreen';
import AmbulanceApp from './components/AmbulanceApp';
import EmergencyChatbot from './components/EmergencyChatbot';
import './App.css';

function CitizenApp() {
  const [screen, setScreen] = useState('dashboard'); // dashboard, loading, tracking
  const [emergencyData, setEmergencyData] = useState(null);
  const [selectedEmergency, setSelectedEmergency] = useState(null);
  const [userLocation, setUserLocation] = useState(null);
  const [gpsError, setGpsError] = useState(null);
  const [isAcquiringGps, setIsAcquiringGps] = useState(false);

  const requestGpsLocation = useCallback((onSuccess, onError) => {
    if (!navigator.geolocation) {
      const msg = 'Geolocation is not supported by your browser or device.';
      setGpsError(msg);
      if (onError) onError(msg);
      return;
    }

    setGpsError(null);
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(loc);
        setGpsError(null);
        if (onSuccess) onSuccess(loc);
      },
      (error) => {
        let msg = 'Waiting for real device GPS lock — please allow Location access.';
        if (error.code === 1) {
          msg = 'Location permission denied. Please allow location access in your browser settings to detect your emergency location.';
        } else if (error.code === 2) {
          msg = 'GPS signal unavailable. Please ensure GPS/Location is enabled on your device.';
        } else if (error.code === 3) {
          msg = 'GPS request timed out. Retrying high-accuracy signal...';
        }
        setGpsError(msg);
        if (onError) onError(msg);
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );
  }, []);

  useEffect(() => {
    requestGpsLocation();

    if (!navigator.geolocation) return;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(loc);
        setGpsError(null);
      },
      (error) => {
        if (error.code === 1) {
          setGpsError('Location permission denied. Live GPS tracking unavailable.');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [requestGpsLocation]);

  const handleEmergencySelect = (emergencyType) => {
    setSelectedEmergency(emergencyType);

    const sendEmergencyDispatch = (coords) => {
      setScreen('loading');
      const API_BASE_URL = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com');
      const startTime = Date.now();

      fetch(`${API_BASE_URL}/api/emergency`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: emergencyType,
          location: coords
        }),
      })
        .then(response => {
          if (!response.ok) {
            return response.json().then(errData => { throw new Error(errData.error || 'Emergency dispatch failed'); });
          }
          return response.json();
        })
        .then(data => {
          const elapsed = Date.now() - startTime;
          const remainingDelay = Math.max(0, 600 - elapsed);
          setTimeout(() => {
            setEmergencyData(data);
            setScreen('tracking');
          }, remainingDelay);
        })
        .catch(error => {
          console.error('Error:', error);
          alert(error.message || 'Error connecting to server. Please ensure backend is running.');
          setScreen('dashboard');
        });
    };

    if (userLocation) {
      sendEmergencyDispatch(userLocation);
    } else {
      setIsAcquiringGps(true);
      requestGpsLocation(
        (freshLoc) => {
          setIsAcquiringGps(false);
          sendEmergencyDispatch(freshLoc);
        },
        (errorMsg) => {
          setIsAcquiringGps(false);
          alert(`Cannot dispatch emergency without GPS coordinates:\n\n${errorMsg}\n\nPlease enable Location permissions and try again.`);
        }
      );
    }
  };

  const handleBackToDashboard = () => {
    setScreen('dashboard');
    setEmergencyData(null);
    setSelectedEmergency(null);
  };

  return (
    <div className="App">
      {isAcquiringGps && (
        <div style={{
          position: 'fixed',
          top: 0,
          left: 0,
          right: 0,
          bottom: 0,
          background: 'rgba(0,0,0,0.7)',
          zIndex: 9999,
          display: 'flex',
          flexDirection: 'column',
          alignItems: 'center',
          justifyContent: 'center',
          color: 'white',
          padding: 24,
          textAlign: 'center'
        }}>
          <div style={{ fontSize: '3rem', marginBottom: 16 }}>📡</div>
          <h2 style={{ margin: '0 0 10px 0' }}>Acquiring Live GPS Signal...</h2>
          <p style={{ maxWidth: 420, color: '#e0e0e0', lineHeight: 1.5 }}>
            Obtaining high-accuracy coordinates from your device hardware to dispatch the nearest emergency unit directly to your location.
          </p>
        </div>
      )}

      {gpsError && screen === 'dashboard' && (
        <div style={{
          background: '#fee2e2',
          border: '1px solid #ef4444',
          color: '#991b1b',
          padding: '12px 20px',
          display: 'flex',
          justifyContent: 'space-between',
          alignItems: 'center',
          fontWeight: 'bold',
          fontSize: '0.9rem'
        }}>
          <div>⚠️ {gpsError}</div>
          <button
            onClick={() => requestGpsLocation()}
            style={{
              background: '#b91c1c',
              color: 'white',
              border: 'none',
              padding: '6px 14px',
              borderRadius: '6px',
              cursor: 'pointer',
              fontWeight: 'bold',
              fontSize: '0.85rem'
            }}
          >
            Retry GPS
          </button>
        </div>
      )}

      {screen === 'dashboard' && (
        <>
          <Dashboard onEmergencySelect={handleEmergencySelect} />
          <EmergencyChatbot emergencyType="Medical Triage & First-Aid" severity="Normal" />
        </>
      )}

      {screen === 'loading' && (
        <LoadingScreen emergencyType={selectedEmergency} />
      )}

      {screen === 'tracking' && emergencyData && (
        <TrackingScreen 
          data={emergencyData} 
          onBack={handleBackToDashboard}
        />
      )}
    </div>
  );
}

export default function Root() {
  const isAmbulancePortal = window.location.pathname.includes('/ambulance') || window.location.search.includes('role=ambulance');
  if (isAmbulancePortal) {
    return <AmbulanceApp />;
  }
  return <CitizenApp />;
}
