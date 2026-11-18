import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import LoadingScreen from './components/LoadingScreen';
import TrackingScreen from './components/TrackingScreen';
import AmbulanceApp from './components/AmbulanceApp';
import './App.css';

function CitizenApp() {
  const [screen, setScreen] = useState('dashboard'); // dashboard, loading, tracking
  const [emergencyData, setEmergencyData] = useState(null);
  const [selectedEmergency, setSelectedEmergency] = useState(null);
  const [userLocation, setUserLocation] = useState(() => {
    try {
      const cached = localStorage.getItem('cached_user_location');
      if (cached) return JSON.parse(cached);
    } catch (e) {}
    return null;
  });
  const [gpsError, setGpsError] = useState(null);

  useEffect(() => {
    if (!navigator.geolocation) {
      setGpsError('Geolocation is not supported by your browser or device.');
      return;
    }

    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(loc);
        setGpsError(null);
        try { localStorage.setItem('cached_user_location', JSON.stringify(loc)); } catch (e) {}
      },
      (error) => {
        let msg = 'Unable to fetch current GPS location.';
        if (error.code === 1) msg = 'Location permission denied. Please allow location access in your browser settings to detect your emergency location.';
        else if (error.code === 3) msg = 'GPS signal request timed out. Retrying in background...';
        setGpsError(msg);
      },
      { enableHighAccuracy: true, timeout: 8000, maximumAge: 0 }
    );

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(loc);
        setGpsError(null);
        try { localStorage.setItem('cached_user_location', JSON.stringify(loc)); } catch (e) {}
      },
      (error) => {
        if (error.code === 1) setGpsError('Location permission denied. Live GPS unavailable.');
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

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
      if (!navigator.geolocation) {
        alert('Geolocation is not supported by your device. Cannot dispatch emergency.');
        return;
      }
      navigator.geolocation.getCurrentPosition(
        (pos) => {
          const freshLoc = { lat: pos.coords.latitude, lng: pos.coords.longitude };
          setUserLocation(freshLoc);
          sendEmergencyDispatch(freshLoc);
        },
        () => {
          alert('GPS location permission is strictly required to locate and dispatch an ambulance to you. Please enable location permissions in your browser.');
        },
        { enableHighAccuracy: true, timeout: 7000, maximumAge: 0 }
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
      {gpsError && screen === 'dashboard' && (
        <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', padding: '12px 20px', textAlign: 'center', fontWeight: 'bold', fontSize: '0.9rem' }}>
          ⚠️ {gpsError}
        </div>
      )}
      {screen === 'dashboard' && (
        <Dashboard onEmergencySelect={handleEmergencySelect} />
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

// Simple path-based split (no react-router needed): the ambulance crew
// opens http://<host>:3000/ambulance?id=KA-19-EM-001 on their device,
// citizens get the normal dashboard/tracking flow at "/".
function App() {
  if (window.location.pathname.startsWith('/ambulance')) {
    return <AmbulanceApp />;
  }
  return <CitizenApp />;
}

export default App;
