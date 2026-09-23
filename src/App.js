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
  const [userLocation, setUserLocation] = useState(null);

  useEffect(() => {
    // Get user's location automatically
    if (navigator.geolocation) {
      navigator.geolocation.getCurrentPosition(
        (position) => {
          setUserLocation({
            lat: position.coords.latitude,
            lng: position.coords.longitude
          });
        },
        (error) => {
          console.error('Error getting location:', error);
          // Default to Bhatkal coordinates if location access denied
          setUserLocation({
            lat: 13.9667,
            lng: 74.5667
          });
        }
      );
    } else {
      // Default to Bhatkal location
      setUserLocation({
        lat: 13.9667,
        lng: 74.5667
      });
    }
  }, []);

  const handleEmergencySelect = (emergencyType) => {
    setSelectedEmergency(emergencyType);
    setScreen('loading');

    const API_BASE_URL = process.env.REACT_APP_API_URL || `http://${window.location.hostname}:5000`;

    // API call to find best hospital
    setTimeout(() => {
      fetch(`${API_BASE_URL}/api/emergency`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          type: emergencyType,
          location: userLocation
        }),
      })
        .then(response => response.json())
        .then(data => {
          setEmergencyData(data);
          setScreen('tracking');
        })
        .catch(error => {
          console.error('Error:', error);
          alert('Error connecting to server. Please ensure backend is running.');
          setScreen('dashboard');
        });
    }, 3000); // 3 second loading animation
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
