import React, { useState, useEffect } from 'react';
import Dashboard from './components/Dashboard';
import LoadingScreen from './components/LoadingScreen';
import TrackingScreen from './components/TrackingScreen';
import './App.css';

function App() {
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

    // Simulate API call to find best hospital
    setTimeout(() => {
      fetch('http://localhost:5000/api/emergency', {
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

export default App;
