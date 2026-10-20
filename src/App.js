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
    return { lat: 12.8725, lng: 74.8440 };
  });

  useEffect(() => {
    if (!navigator.geolocation) return;

    // 1. Instant fast location (<50ms) using network/cached position
    navigator.geolocation.getCurrentPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(loc);
        try { localStorage.setItem('cached_user_location', JSON.stringify(loc)); } catch (e) {}
      },
      (error) => {
        console.warn('Fast location check:', error);
      },
      { enableHighAccuracy: false, timeout: 2000, maximumAge: 300000 }
    );

    // 2. High-accuracy watch in background without blocking UI
    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const loc = {
          lat: position.coords.latitude,
          lng: position.coords.longitude
        };
        setUserLocation(loc);
        try { localStorage.setItem('cached_user_location', JSON.stringify(loc)); } catch (e) {}
      },
      (error) => console.warn('Background GPS watch:', error),
      { enableHighAccuracy: true, timeout: 5000, maximumAge: 10000 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, []);

  const handleEmergencySelect = (emergencyType) => {
    setSelectedEmergency(emergencyType);
    setScreen('loading');

    const API_BASE_URL = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com');
    const activeLocation = userLocation || { lat: 12.8725, lng: 74.8440 };
    const startTime = Date.now();

    // Fire API request immediately without any artificial delay
    fetch(`${API_BASE_URL}/api/emergency`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({
        type: emergencyType,
        location: activeLocation
      }),
    })
      .then(response => response.json())
      .then(data => {
        if (data.error) {
          alert(data.error);
          setScreen('dashboard');
          return;
        }
        // Smooth 600ms visual transition for loading animation
        const elapsed = Date.now() - startTime;
        const remainingDelay = Math.max(0, 600 - elapsed);
        setTimeout(() => {
          setEmergencyData(data);
          setScreen('tracking');
        }, remainingDelay);
      })
      .catch(error => {
        console.error('Error:', error);
        alert('Error connecting to server. Please ensure backend is running.');
        setScreen('dashboard');
      });
  };

  const handleBackToDashboard = () => {
    setScreen('dashboard');
    setEmergencyData(null);
    setSelectedEmergency(null);
  };

  return (
    <div className="App">
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
