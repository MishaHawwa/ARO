import { useState, useEffect, useRef, useCallback } from 'react';

// Haversine formula to compute distance in meters
export function calculateDistanceMeters(lat1, lon1, lat2, lon2) {
  if (lat1 === lat2 && lon1 === lon2) return 0;
  const R = 6371e3; // Earth radius in meters
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaPhi = ((lat2 - lat1) * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const a =
    Math.sin(deltaPhi / 2) * Math.sin(deltaPhi / 2) +
    Math.cos(phi1) * Math.cos(phi2) *
    Math.sin(deltaLambda / 2) * Math.sin(deltaLambda / 2);
  const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
  return R * c;
}

// Compute compass bearing (0-360 deg) between two points
export function calculateBearing(lat1, lon1, lat2, lon2) {
  const phi1 = (lat1 * Math.PI) / 180;
  const phi2 = (lat2 * Math.PI) / 180;
  const deltaLambda = ((lon2 - lon1) * Math.PI) / 180;

  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x =
    Math.cos(phi1) * Math.sin(phi2) -
    Math.sin(phi1) * Math.cos(phi2) * Math.cos(deltaLambda);
  const theta = Math.atan2(y, x);
  return (Math.round((theta * 180) / Math.PI) + 360) % 360;
}

export function useLocationTracking({
  socket,
  ambulanceId,
  emergencyId,
  trackingToken,
  status = 'idle',
  enabled = false,
  transmissionInterval = 2000, // Emit every 2s or on >=1m movement
  minDistanceMeters = 1.0,     // Ultra-responsive: 1 meter threshold
  onLocationUpdate = null,
  onError = null
}) {
  const [isTracking, setIsTracking] = useState(false);
  const [trackingStatus, setTrackingStatus] = useState('idle'); // idle, starting, live, stale, stopped, permission_denied, unavailable
  const [currentLocation, setCurrentLocation] = useState(null);
  const [lastTransmitted, setLastTransmitted] = useState(null);
  const [packetCount, setPacketCount] = useState(0);
  const [errorMessage, setErrorMessage] = useState(null);
  const [telemetry, setTelemetry] = useState({
    accuracy: null,
    heading: 0,
    speed: 0,
    timestamp: null
  });

  // Stale closure guards: persist live props in refs so watchPosition always sees current state
  const socketRef = useRef(socket);
  const ambulanceIdRef = useRef(ambulanceId);
  const emergencyIdRef = useRef(emergencyId);
  const trackingTokenRef = useRef(trackingToken);
  const statusRef = useRef(status);
  const onLocationUpdateRef = useRef(onLocationUpdate);
  const onErrorRef = useRef(onError);

  // Sync refs on every render
  useEffect(() => {
    socketRef.current = socket;
    ambulanceIdRef.current = ambulanceId;
    emergencyIdRef.current = emergencyId;
    trackingTokenRef.current = trackingToken;
    statusRef.current = status;
    onLocationUpdateRef.current = onLocationUpdate;
    onErrorRef.current = onError;
  });

  const watchIdRef = useRef(null);
  const lastSendTimeRef = useRef(0);
  const lastEmittedCoordsRef = useRef(null);
  const lastKnownHeadingRef = useRef(0);
  const isTrackingRef = useRef(false);
  const staleTimerRef = useRef(null);
  const wakeLockRef = useRef(null);

  // Screen WakeLock to prevent mobile browser sleep during tracking
  const requestWakeLock = useCallback(async () => {
    if ('wakeLock' in navigator && !wakeLockRef.current) {
      try {
        wakeLockRef.current = await navigator.wakeLock.request('screen');
        wakeLockRef.current.addEventListener('release', () => {
          wakeLockRef.current = null;
        });
      } catch (err) {
        // WakeLock can fail if battery saver is on or user denied
      }
    }
  }, []);

  const releaseWakeLock = useCallback(() => {
    if (wakeLockRef.current) {
      try {
        wakeLockRef.current.release();
      } catch (e) {}
      wakeLockRef.current = null;
    }
  }, []);

  // Handle visibility change to re-acquire wakeLock if user switches tabs and returns
  useEffect(() => {
    const handleVisibilityChange = () => {
      if (document.visibilityState === 'visible' && isTrackingRef.current) {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibilityChange);
    return () => {
      document.removeEventListener('visibilitychange', handleVisibilityChange);
    };
  }, [requestWakeLock]);

  // Clean watchPosition stop
  const stopWatch = useCallback(() => {
    if (watchIdRef.current !== null) {
      try {
        navigator.geolocation.clearWatch(watchIdRef.current);
      } catch (e) {}
      watchIdRef.current = null;
    }
    if (staleTimerRef.current) {
      clearInterval(staleTimerRef.current);
      staleTimerRef.current = null;
    }
    releaseWakeLock();
    isTrackingRef.current = false;
  }, [releaseWakeLock]);

  // Stop tracking explicitly
  const stopTracking = useCallback((reason = 'manual_stop') => {
    stopWatch();
    setIsTracking(false);
    setTrackingStatus('stopped');

    const s = socketRef.current;
    const eId = emergencyIdRef.current;
    const aId = ambulanceIdRef.current;
    const tToken = trackingTokenRef.current;

    if (s && s.connected && eId) {
      s.emit('tracking:stop', {
        ambulanceId: aId,
        ambulance_id: aId,
        emergencyId: eId,
        emergency_id: eId,
        trackingToken: tToken,
        reason,
        timestamp: new Date().toISOString()
      });
    }
  }, [stopWatch]);

  // Start continuous watchPosition (strictly one active watcher, zero repeated tear-downs)
  const startTracking = useCallback(() => {
    if (!navigator.geolocation) {
      const msg = 'Geolocation is not supported by your browser or device.';
      setErrorMessage(msg);
      setTrackingStatus('unavailable');
      if (onErrorRef.current) onErrorRef.current(msg);
      return;
    }

    // If already watching, don't restart; just ensure state is live
    if (watchIdRef.current !== null) {
      setIsTracking(true);
      isTrackingRef.current = true;
      requestWakeLock();
      return;
    }

    setErrorMessage(null);
    setTrackingStatus('starting');
    setIsTracking(true);
    isTrackingRef.current = true;
    requestWakeLock();

    // If socket & emergency are ready, join trip room
    const s = socketRef.current;
    const eId = emergencyIdRef.current;
    const aId = ambulanceIdRef.current;
    const tToken = trackingTokenRef.current;
    if (s && s.connected && eId) {
      const tripId = `trip_${eId.replace('trip_', '')}`;
      s.emit('join_trip', { tripId });
      s.emit('tracking:start', {
        tripId,
        trip_id: tripId,
        ambulanceId: aId,
        ambulance_id: aId,
        emergencyId: eId,
        emergency_id: eId,
        trackingToken: tToken,
        timestamp: new Date().toISOString()
      });
    }

    const geoOptions = {
      enableHighAccuracy: true,
      maximumAge: 0,
      timeout: 10000
    };

    const handleSuccess = (position) => {
      const { latitude, longitude, accuracy, heading, speed } = position.coords;
      const posTimestamp = position.timestamp || Date.now();

      if (
        typeof latitude !== 'number' || isNaN(latitude) || latitude < -90 || latitude > 90 ||
        typeof longitude !== 'number' || isNaN(longitude) || longitude < -180 || longitude > 180
      ) {
        return;
      }

      const locObj = { lat: latitude, lng: longitude };
      setCurrentLocation(locObj);
      setTrackingStatus('live');
      setErrorMessage(null);

      // Compute heading / bearing: use hardware heading if valid, else calculate from movement
      let effectiveHeading = lastKnownHeadingRef.current;
      if (heading !== null && !isNaN(heading) && heading >= 0) {
        effectiveHeading = Math.round(heading);
        lastKnownHeadingRef.current = effectiveHeading;
      } else if (lastEmittedCoordsRef.current) {
        const movedMeters = calculateDistanceMeters(
          lastEmittedCoordsRef.current.lat,
          lastEmittedCoordsRef.current.lng,
          latitude,
          longitude
        );
        if (movedMeters >= 1.0) {
          effectiveHeading = calculateBearing(
            lastEmittedCoordsRef.current.lat,
            lastEmittedCoordsRef.current.lng,
            latitude,
            longitude
          );
          lastKnownHeadingRef.current = effectiveHeading;
        }
      }

      const parsedAccuracy = accuracy !== null && !isNaN(accuracy) ? Math.round(accuracy * 10) / 10 : null;
      const parsedSpeedKmh = speed !== null && !isNaN(speed) && speed >= 0 ? Math.round(speed * 3.6 * 10) / 10 : 0;
      const isoTs = new Date(posTimestamp).toISOString();

      setTelemetry({
        accuracy: parsedAccuracy,
        heading: effectiveHeading,
        speed: parsedSpeedKmh,
        timestamp: isoTs
      });

      if (onLocationUpdateRef.current) {
        onLocationUpdateRef.current({
          location: locObj,
          accuracy: parsedAccuracy,
          heading: effectiveHeading,
          speed: parsedSpeedKmh,
          timestamp: isoTs
        });
      }

      // Transmission logic: emit whenever distance moved >= 1 meter OR time elapsed >= 2000ms
      const now = Date.now();
      const elapsed = now - lastSendTimeRef.current;
      const prev = lastEmittedCoordsRef.current;

      let distMoved = 999;
      if (prev) {
        distMoved = calculateDistanceMeters(prev.lat, prev.lng, latitude, longitude);
      }

      const shouldEmit = !prev || distMoved >= minDistanceMeters || elapsed >= transmissionInterval;

      if (shouldEmit) {
        lastSendTimeRef.current = now;
        lastEmittedCoordsRef.current = locObj;
        setLastTransmitted({ ...locObj, timestamp: isoTs });
        setPacketCount(c => c + 1);

        const curSocket = socketRef.current;
        const curAmbId = ambulanceIdRef.current;
        const curEmgId = emergencyIdRef.current;
        const curToken = trackingTokenRef.current;
        const curStatus = statusRef.current;
        const curTripId = curEmgId ? `trip_${curEmgId.replace('trip_', '')}` : undefined;

        if (curSocket && curSocket.connected) {
          const payload = {
            tripId: curTripId,
            trip_id: curTripId,
            role: 'driver',
            lat: latitude,
            lng: longitude,
            latitude,
            longitude,
            ambulanceId: curAmbId,
            ambulance_id: curAmbId,
            emergencyId: curEmgId,
            emergency_id: curEmgId,
            trackingToken: curToken,
            location: locObj,
            accuracy: parsedAccuracy,
            heading: effectiveHeading,
            speed: parsedSpeedKmh,
            timestamp: isoTs,
            status: curStatus
          };

          curSocket.emit('update_location', payload);
          curSocket.emit('ambulance:location:update', payload);

          // Fallback REST ping to guarantee in-memory fleet freshness
          const API_BASE_URL = typeof window !== 'undefined' && (
            window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com'
          );
          if (curAmbId) {
            fetch(`${API_BASE_URL}/api/ambulance/${curAmbId}/location`, {
              method: 'POST',
              headers: { 'Content-Type': 'application/json' },
              body: JSON.stringify({
                ambulance_id: curAmbId,
                lat: latitude,
                lng: longitude,
                speed: parsedSpeedKmh,
                heading: effectiveHeading,
                accuracy: parsedAccuracy
              })
            }).catch(() => {});
          }
        }
      }
    };

    const handleError = (error) => {
      let friendlyMsg = 'An error occurred while reading GPS position.';
      let newStatus = 'unavailable';

      switch (error.code) {
        case 1:
          friendlyMsg = 'GPS permission denied. Please allow location access in your browser settings.';
          newStatus = 'permission_denied';
          break;
        case 2:
          friendlyMsg = 'GPS signal unavailable. Ensure location is enabled on device.';
          newStatus = 'unavailable';
          break;
        case 3:
          friendlyMsg = 'GPS signal request timed out. Retrying...';
          newStatus = 'timeout';
          break;
        default:
          friendlyMsg = error.message || friendlyMsg;
          break;
      }

      setErrorMessage(friendlyMsg);
      setTrackingStatus(newStatus);
      if (onErrorRef.current) onErrorRef.current(friendlyMsg);
    };

    try {
      watchIdRef.current = navigator.geolocation.watchPosition(
        handleSuccess,
        handleError,
        geoOptions
      );
    } catch (e) {
      setErrorMessage(e.message);
      setTrackingStatus('unavailable');
    }

    // Stale check interval: mark stale if no reading received for 12 seconds
    staleTimerRef.current = setInterval(() => {
      const now = Date.now();
      if (lastSendTimeRef.current > 0 && now - lastSendTimeRef.current > 12000) {
        setTrackingStatus('stale');
      }
    }, 3000);
  }, [requestWakeLock, transmissionInterval, minDistanceMeters]);

  // Handle enabled prop toggling
  useEffect(() => {
    if (enabled) {
      startTracking();
    } else {
      stopTracking('disabled');
    }
  }, [enabled, startTracking, stopTracking]);

  // When emergencyId transitions from null -> active ID, inform backend immediately
  useEffect(() => {
    if (emergencyId && socket && socket.connected && isTrackingRef.current) {
      const tripId = `trip_${emergencyId.replace('trip_', '')}`;
      socket.emit('join_trip', { tripId });
      socket.emit('tracking:start', {
        tripId,
        trip_id: tripId,
        ambulanceId,
        ambulance_id: ambulanceId,
        emergencyId,
        emergency_id: emergencyId,
        trackingToken,
        timestamp: new Date().toISOString()
      });
    }
  }, [emergencyId, socket, ambulanceId, trackingToken]);

  // Clean up on component unmount
  useEffect(() => {
    return () => {
      stopWatch();
    };
  }, [stopWatch]);

  return {
    isTracking,
    trackingStatus,
    currentLocation,
    lastTransmitted,
    packetCount,
    telemetry,
    errorMessage,
    startTracking,
    stopTracking
  };
}

export default useLocationTracking;
