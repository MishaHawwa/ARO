import { useState, useEffect, useRef, useCallback } from 'react';

// Distance calculation using Haversine formula (meters)
function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371e3; // Earth radius in meters
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLon = (lon2 - lon1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
            Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
            Math.sin(dLon / 2) * Math.sin(dLon / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

export function useLocationTracking({
  socket,
  ambulanceId,
  emergencyId,
  trackingToken,
  status = 'en_route_to_patient',
  enabled = false,
  transmissionInterval = 2500, // Send every ~2.5s when fresh readings are available
  minDistanceMeters = 3.0,     // 3m filter against stationary jitter
  enableHighAccuracy = true,
  onLocationUpdate = null,
  onError = null
}) {
  const [isTracking, setIsTracking] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState('idle'); // idle, starting, live, stale, stopped, permission_denied, unavailable, timeout
  const [currentLocation, setCurrentLocation] = useState(null);
  const [lastTransmitted, setLastTransmitted] = useState(null);
  const [errorMessage, setErrorMessage] = useState(null);
  const [telemetry, setTelemetry] = useState({
    accuracy: null,
    heading: null,
    speed: null,
    timestamp: null
  });

  const watchIdRef = useRef(null);
  const lastSendTimeRef = useRef(0);
  const lastTransmittedLocRef = useRef(null);
  const isTrackingRef = useRef(false);
  const staleTimerRef = useRef(null);

  isTrackingRef.current = isTracking;

  // Clear GPS watch cleanly
  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch (e) {
        console.warn('Error clearing watch:', e);
      }
      watchIdRef.current = null;
    }
    if (staleTimerRef.current) {
      clearInterval(staleTimerRef.current);
      staleTimerRef.current = null;
    }
  }, []);

  // Stop tracking explicitly
  const stopTracking = useCallback((reason = 'operator_stopped') => {
    stopWatch();
    setIsTracking(false);
    setTrackingStatus('stopped');
    if (socket && socket.connected && emergencyId) {
      socket.emit('tracking:stop', {
        ambulanceId,
        ambulance_id: ambulanceId,
        emergencyId,
        emergency_id: emergencyId,
        trackingToken,
        reason,
        timestamp: new Date().toISOString()
      });
    }
  }, [socket, ambulanceId, emergencyId, trackingToken, stopWatch]);

  // Start tracking explicitly
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      const msg = 'Geolocation is not supported by your browser/device.';
      setErrorMessage(msg);
      setTrackingStatus('unavailable');
      if (onError) onError(msg);
      return;
    }

    if (!emergencyId) {
      console.warn('Cannot start location tracking without an active emergencyId assignment.');
      return;
    }

    stopWatch(); // Clear any existing watcher to avoid duplicates
    setErrorMessage(null);
    setTrackingStatus('starting');
    setIsTracking(true);

    // Notify backend
    if (socket && socket.connected) {
      socket.emit('tracking:start', {
        ambulanceId,
        ambulance_id: ambulanceId,
        emergencyId,
        emergency_id: emergencyId,
        trackingToken,
        timestamp: new Date().toISOString()
      });
    }

    const geoOptions = {
      enableHighAccuracy,
      maximumAge: 0,
      timeout: 10000
    };

    const handleSuccess = (position) => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;
      const posTimestamp = position.timestamp || Date.now();

      // Validate coordinate ranges
      if (
        typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90 ||
        typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180
      ) {
        console.warn('Received invalid GPS coordinates from browser:', latitude, longitude);
        return;
      }

      const locObj = { lat: latitude, lng: longitude };
      setCurrentLocation(locObj);
      setTrackingStatus('live');
      setErrorMessage(null);

      const parsedAccuracy = accuracy !== null && !isNaN(accuracy) ? Math.round(accuracy * 10) / 10 : null;
      const parsedHeading = heading !== null && !isNaN(heading) ? Math.round(heading) : null;
      const parsedSpeedKmh = speed !== null && !isNaN(speed) ? Math.round(speed * 3.6 * 10) / 10 : null;
      const isoTs = new Date(posTimestamp).toISOString();

      setTelemetry({
        accuracy: parsedAccuracy,
        heading: parsedHeading,
        speed: parsedSpeedKmh,
        timestamp: isoTs
      });

      if (onLocationUpdate) {
        onLocationUpdate({
          location: locObj,
          accuracy: parsedAccuracy,
          heading: parsedHeading,
          speed: parsedSpeedKmh,
          timestamp: isoTs
        });
      }

      // Check transmission throttling & minimum distance filtering
      const now = Date.now();
      const elapsedSinceLastSend = now - lastSendTimeRef.current;
      const prevLoc = lastTransmittedLocRef.current;

      let distanceMoved = 999;
      if (prevLoc) {
        distanceMoved = calculateDistanceMeters(prevLoc.lat, prevLoc.lng, latitude, longitude);
      }

      // Transmit if:
      // 1. First transmission OR
      // 2. (Elapsed >= transmissionInterval AND distanceMoved >= minDistanceMeters) OR
      // 3. Heartbeat (elapsed >= 5000ms regardless of distance to keep connection fresh)
      const shouldTransmit = !prevLoc || 
        (elapsedSinceLastSend >= transmissionInterval && distanceMoved >= minDistanceMeters) ||
        (elapsedSinceLastSend >= 5000);

      if (shouldTransmit && socket && socket.connected && emergencyId) {
        lastSendTimeRef.current = now;
        lastTransmittedLocRef.current = locObj;
        setLastTransmitted({ ...locObj, timestamp: isoTs });

        const payload = {
          ambulanceId,
          ambulance_id: ambulanceId,
          emergencyId,
          emergency_id: emergencyId,
          trackingToken,
          latitude,
          longitude,
          location: locObj,
          accuracy: parsedAccuracy,
          heading: parsedHeading,
          speed: parsedSpeedKmh,
          timestamp: isoTs,
          status
        };

        socket.emit('ambulance:location:update', payload);
      }
    };

    const handleError = (error) => {
      let friendlyMsg = 'An error occurred while obtaining GPS location.';
      let newStatus = 'unavailable';

      switch (error.code) {
        case 1: // PERMISSION_DENIED
          friendlyMsg = 'GPS permission denied. Please grant location access in your browser.';
          newStatus = 'permission_denied';
          break;
        case 2: // POSITION_UNAVAILABLE
          friendlyMsg = 'GPS position unavailable. Looking for satellites...';
          newStatus = 'unavailable';
          break;
        case 3: // TIMEOUT
          friendlyMsg = 'GPS signal request timed out. Retrying...';
          newStatus = 'timeout';
          break;
        default:
          friendlyMsg = error.message || friendlyMsg;
          break;
      }

      setErrorMessage(friendlyMsg);
      setTrackingStatus(newStatus);
      if (onError) onError(friendlyMsg);
    };

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess,
        handleError,
        geoOptions
      );
    } catch (e) {
      console.error('Failed to start watchPosition:', e);
      setErrorMessage(e.message);
      setTrackingStatus('unavailable');
    }

    // Stale check interval: if no reading arrives for 15s
    staleTimerRef.current = setInterval(() => {
      const now = Date.now();
      if (lastSendTimeRef.current > 0 && (now - lastSendTimeRef.current > 15000)) {
        setTrackingStatus('stale');
      }
    }, 3000);

  }, [
    socket,
    ambulanceId,
    emergencyId,
    trackingToken,
    status,
    enableHighAccuracy,
    transmissionInterval,
    minDistanceMeters,
    onLocationUpdate,
    onError,
    stopWatch
  ]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopWatch();
    };
  }, [stopWatch]);

  // Handle socket reconnect
  useEffect(() => {
    if (!socket) return;
    const handleReconnect = () => {
      if (isTrackingRef.current && emergencyId) {
        socket.emit('tracking:start', {
          ambulanceId,
          ambulance_id: ambulanceId,
          emergencyId,
          emergency_id: emergencyId,
          trackingToken,
          timestamp: new Date().toISOString()
        });
      }
    };
    socket.on('reconnect', handleReconnect);
    return () => {
      socket.off('reconnect', handleReconnect);
    };
  }, [socket, ambulanceId, emergencyId, trackingToken]);

  return {
    isTracking,
    trackingStatus,
    currentLocation,
    lastTransmitted,
    telemetry,
    errorMessage,
    startTracking,
    stopTracking
  };
}

export default useLocationTracking;
