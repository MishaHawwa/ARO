import React, { useState, useEffect } from 'react';
import { MapContainer, TileLayer, Marker, Popup, Polyline, useMap } from 'react-leaflet';
import L from 'leaflet';
import io from 'socket.io-client';
import './TrackingScreen.css';
import 'leaflet/dist/leaflet.css';
import HospitalScoreboard from './HospitalScoreboard';
import EmergencyChatbot from './EmergencyChatbot';

// Mathematical Bearing calculation for smooth vehicle compass rotation
function calculateBearing(lat1, lon1, lat2, lon2) {
  const toRad = (d) => (d * Math.PI) / 180;
  const toDeg = (r) => (r * 180) / Math.PI;
  const phi1 = toRad(lat1);
  const phi2 = toRad(lat2);
  const deltaLambda = toRad(lon2 - lon1);
  const y = Math.sin(deltaLambda) * Math.cos(phi2);
  const x = Math.cos(phi1) * Math.sin(phi2) - Math.sin(phi1) * Math.cos(deltaLambda);
  return (toDeg(Math.atan2(y, x)) + 360) % 360;
}

// Google Maps-Style Live Camera Follower & User Drag Detector
function CameraFollower({ center, enabled = true, onUserDrag }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const handleDragStart = () => {
      if (onUserDrag) onUserDrag();
    };
    map.on('dragstart', handleDragStart);
    return () => {
      map.off('dragstart', handleDragStart);
    };
  }, [map, onUserDrag]);

  useEffect(() => {
    if (!map || !center || !enabled) return;
    if (typeof center[0] === 'number' && typeof center[1] === 'number' && !isNaN(center[0])) {
      map.panTo(center, {
        animate: true,
        duration: 0.8,
        easeLinearity: 0.25
      });
    }
  }, [map, center?.[0], center?.[1], enabled]);

  return null;
}

function MapBoundsFitter({ patientLoc, ambulanceLoc, hospitalLoc, enabled = true }) {
  const map = useMap();
  const hasFittedOnceRef = React.useRef(false);

  useEffect(() => {
    if (!enabled || hasFittedOnceRef.current) return;
    const pts = [];
    if (patientLoc?.lat && patientLoc?.lng) pts.push([patientLoc.lat, patientLoc.lng]);
    if (ambulanceLoc?.lat && ambulanceLoc?.lng) pts.push([ambulanceLoc.lat, ambulanceLoc.lng]);
    if (hospitalLoc?.lat && hospitalLoc?.lng) pts.push([hospitalLoc.lat, hospitalLoc.lng]);

    if (pts.length >= 2) {
      try {
        map.fitBounds(pts, { padding: [60, 60], maxZoom: 15 });
        hasFittedOnceRef.current = true;
      } catch (e) {}
    } else if (pts.length === 1) {
      map.setView(pts[0], 14);
      hasFittedOnceRef.current = true;
    }
  }, [map, patientLoc?.lat, patientLoc?.lng, ambulanceLoc?.lat, ambulanceLoc?.lng, hospitalLoc?.lat, hospitalLoc?.lng, enabled]);
  return null;
}

const GOOGLE_MAPS_KEY = process.env.REACT_APP_GOOGLE_MAPS_API_KEY || '';

// Optional Google Maps component when API key is provided
function GoogleMapsCitizenTracking({
  ambulanceLoc,
  patientLoc,
  hospitalLoc,
  heading = 0,
  isFollowing,
  onUserDrag,
  journeyPhase,
  ambulanceStatus,
  hospitalName
}) {
  const containerRef = React.useRef(null);
  const mapRef = React.useRef(null);
  const ambMarkerRef = React.useRef(null);
  const patMarkerRef = React.useRef(null);
  const hospMarkerRef = React.useRef(null);
  const directionsRendererRef = React.useRef(null);

  React.useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;
    const initMap = () => {
      if (!window.google || !containerRef.current) return;
      const initialCenter = ambulanceLoc || patientLoc;
      const gMap = new window.google.maps.Map(containerRef.current, {
        center: { lat: initialCenter.lat, lng: initialCenter.lng },
        zoom: 14,
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: false
      });

      new window.google.maps.TrafficLayer().setMap(gMap);

      gMap.addListener('dragstart', () => {
        if (onUserDrag) onUserDrag();
      });

      mapRef.current = gMap;

      ambMarkerRef.current = new window.google.maps.Marker({
        position: { lat: ambulanceLoc.lat, lng: ambulanceLoc.lng },
        map: gMap,
        title: `Ambulance - ${ambulanceStatus}`,
        icon: {
          path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#2563eb',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          rotation: heading || 0
        }
      });

      if (patientLoc) {
        patMarkerRef.current = new window.google.maps.Marker({
          position: { lat: patientLoc.lat, lng: patientLoc.lng },
          map: gMap,
          title: 'Patient Location'
        });
      }

      if (hospitalLoc) {
        hospMarkerRef.current = new window.google.maps.Marker({
          position: { lat: hospitalLoc.lat, lng: hospitalLoc.lng },
          map: gMap,
          title: hospitalName || 'Hospital'
        });
      }

      const directionsService = new window.google.maps.DirectionsService();
      const directionsRenderer = new window.google.maps.DirectionsRenderer({
        map: gMap,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: '#2563eb',
          strokeWeight: 5,
          strokeOpacity: 0.85
        }
      });
      directionsRendererRef.current = directionsRenderer;

      const dest = journeyPhase === 'to_hospital' ? hospitalLoc : patientLoc;
      if (dest) {
        directionsService.route(
          {
            origin: { lat: ambulanceLoc.lat, lng: ambulanceLoc.lng },
            destination: { lat: dest.lat, lng: dest.lng },
            travelMode: window.google.maps.TravelMode.DRIVING
          },
          (result, status) => {
            if (status === 'OK' && directionsRendererRef.current) {
              directionsRendererRef.current.setDirections(result);
            }
          }
        );
      }
    };

    if (window.google && window.google.maps) {
      initMap();
    } else {
      const scriptId = 'google-maps-citizen-sdk';
      if (!document.getElementById(scriptId)) {
        const script = document.createElement('script');
        script.id = scriptId;
        script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places`;
        script.async = true;
        script.defer = true;
        script.onload = initMap;
        document.head.appendChild(script);
      }
    }
  }, []);

  React.useEffect(() => {
    if (!mapRef.current || !ambulanceLoc) return;
    if (ambMarkerRef.current) {
      ambMarkerRef.current.setPosition({ lat: ambulanceLoc.lat, lng: ambulanceLoc.lng });
      ambMarkerRef.current.setIcon({
        path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 6,
        fillColor: '#2563eb',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        rotation: heading || 0
      });
    }
    if (isFollowing) {
      mapRef.current.panTo({ lat: ambulanceLoc.lat, lng: ambulanceLoc.lng });
    }
  }, [ambulanceLoc, heading, isFollowing]);

  return <div ref={containerRef} style={{ width: '100%', height: '100%', borderRadius: '15px' }} />;
}

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

const createAmbulanceIcon = (heading = 0) => L.divIcon({
  className: 'rotatable-ambulance-marker',
  html: `
    <div style="
      width: 40px;
      height: 40px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: rotate(${heading || 0}deg);
      transition: transform 0.4s ease;
    ">
      <div style="
        background: #2563eb;
        color: white;
        border: 2px solid white;
        border-radius: 50%;
        width: 36px;
        height: 36px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 10px rgba(0,0,0,0.3);
        font-size: 19px;
      ">
        🚑
      </div>
    </div>
  `,
  iconSize: [40, 40],
  iconAnchor: [20, 20]
});

const hospitalIcon = new L.Icon({
  iconUrl: 'data:image/svg+xml;base64,PHN2ZyB4bWxucz0iaHR0cDovL3d3dy53My5vcmcvMjAwMC9zdmciIHdpZHRoPSIzMiIgaGVpZ2h0PSIzMiIgdmlld0JveD0iMCAwIDMyIDMyIj48Y2lyY2xlIGN4PSIxNiIgY3k9IjE2IiByPSIxMiIgZmlsbD0iIzJlY2M3MSIvPjx0ZXh0IHg9IjE2IiB5PSIyMSIgZm9udC1zaXplPSIxNiIgdGV4dC1hbmNob3I9Im1pZGRsZSIgZmlsbD0id2hpdGUiPvCfj6U8L3RleHQ+PC9zdmc+',
  iconSize: [32, 32],
  iconAnchor: [16, 32],
});

const formatAmbulanceAlias = (uuid) => {
  if (!uuid) return '';
  const part1 = uuid.substring(0, 4).toUpperCase();
  const part2 = uuid.substring(4, 6).toUpperCase();
  return `KA-${part1}-${part2}`;
};

// Instant realistic street path generator (0ms network latency, never hangs)
function generateRoadWaypoints(start, end) {
  if (!start || !end) return [];
  const lat1 = start.lat !== undefined ? start.lat : start[0];
  const lng1 = start.lng !== undefined ? start.lng : start[1];
  const lat2 = end.lat !== undefined ? end.lat : end[0];
  const lng2 = end.lng !== undefined ? end.lng : end[1];

  const dLat = lat2 - lat1;
  const dLng = lng2 - lng1;
  if (Math.abs(dLat) < 0.0001 && Math.abs(dLng) < 0.0001) {
    return [[lat1, lng1], [lat2, lng2]];
  }

  // Generate realistic street turns along urban corridors
  const pts = [
    [lat1, lng1],
    [lat1 + dLat * 0.45, lng1 + dLng * 0.08],
    [lat1 + dLat * 0.52, lng1 + dLng * 0.82],
    [lat2, lng2]
  ];

  // Smooth into dense road-following points
  const smooth = [];
  for (let i = 0; i < pts.length - 1; i++) {
    const pA = pts[i];
    const pB = pts[i + 1];
    const steps = 6;
    for (let s = 0; s < steps; s++) {
      const f = s / steps;
      smooth.push([pA[0] + (pB[0] - pA[0]) * f, pA[1] + (pB[1] - pA[1]) * f]);
    }
  }
  smooth.push([lat2, lng2]);
  return smooth;
}

function TrackingScreen({ data, onBack }) {
  const initialAmbulanceLoc = data.ambulance?.location || data.patient_location;

  const [ambulanceLocation, setAmbulanceLocation] = useState(initialAmbulanceLoc);
  const [patientLocation, setPatientLocation] = useState(data.patient_location);
  const [patientGpsError, setPatientGpsError] = useState(null);
  const [ambulanceStatus, setAmbulanceStatus] = useState('En Route to Patient');

  // Linear Interpolation (lerp) animation refs for silky-smooth vehicle gliding
  const animFrameRef = React.useRef(null);
  const currentMarkerPosRef = React.useRef([initialAmbulanceLoc.lat, initialAmbulanceLoc.lng]);
  const socketRef = React.useRef(null);

  const animateMarkerLerp = (targetLat, targetLng, durationMs = 1800) => {
    if (!ambulanceMarkerRef.current) return;
    if (animFrameRef.current) {
      cancelAnimationFrame(animFrameRef.current);
    }

    const startLat = currentMarkerPosRef.current ? currentMarkerPosRef.current[0] : targetLat;
    const startLng = currentMarkerPosRef.current ? currentMarkerPosRef.current[1] : targetLng;
    const startTime = performance.now();

    const step = (now) => {
      const elapsed = now - startTime;
      const progress = Math.min(elapsed / durationMs, 1.0);
      const ease = progress < 0.5 ? 2 * progress * progress : 1 - Math.pow(-2 * progress + 2, 2) / 2;

      const curLat = startLat + (targetLat - startLat) * ease;
      const curLng = startLng + (targetLng - startLng) * ease;
      currentMarkerPosRef.current = [curLat, curLng];

      if (ambulanceMarkerRef.current) {
        ambulanceMarkerRef.current.setLatLng([curLat, curLng]);
      }

      if (progress < 1.0) {
        animFrameRef.current = requestAnimationFrame(step);
      }
    };

    animFrameRef.current = requestAnimationFrame(step);
  };
  const [journeyPhase, setJourneyPhase] = useState('to_patient');
  const [liveEta, setLiveEta] = useState(data.eta || 5);
  const [liveDistance, setLiveDistance] = useState(data.distance || 2.1);
  const [showSuggestions, setShowSuggestions] = useState(true);
  
  // Real-Time GPS & Stale State Management
  const [trackingState, setTrackingState] = useState('waiting'); // waiting, live, stale, stopped, reconnecting
  const [telemetry, setTelemetry] = useState({ accuracy: null, speed: null, heading: null, timestamp: null });
  const [secondsSinceLastUpdate, setSecondsSinceLastUpdate] = useState(0);
  const [activeAmbulance, setActiveAmbulance] = useState(data.ambulance || {});
  const [assignedHospitalData, setAssignedHospitalData] = useState(data.hospital || {});
  const [erPreparedInfo, setErPreparedInfo] = useState({
    prepared: Boolean(data.er_acknowledged),
    bay: data.er_bay || null,
    notes: data.er_notes || null
  });
  const [isAdmitted, setIsAdmitted] = useState(false);
  const [reroutedNotice, setReroutedNotice] = useState(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [packetCount, setPacketCount] = useState(0);
  const ambulanceMarkerRef = React.useRef(null);
  const lastUpdateEpochRef = React.useRef(Date.now());
  const prevAmbPosRef = React.useRef(initialAmbulanceLoc);
  const currentHeadingRef = React.useRef(0);

  // Screen Wake Lock while trip tracking is active
  useEffect(() => {
    let wakeLock = null;
    const requestWakeLock = async () => {
      try {
        if ('wakeLock' in navigator) {
          wakeLock = await navigator.wakeLock.request('screen');
        }
      } catch (err) {}
    };
    requestWakeLock();

    const handleVisibility = () => {
      if (document.visibilityState === 'visible') {
        requestWakeLock();
      }
    };
    document.addEventListener('visibilitychange', handleVisibility);

    return () => {
      document.removeEventListener('visibilitychange', handleVisibility);
      if (wakeLock) {
        wakeLock.release().catch(() => {});
      }
    };
  }, []);

  const [patientRoute, setPatientRoute] = useState(() => 
    generateRoadWaypoints(initialAmbulanceLoc, data.patient_location)
  );
  const [hospitalRoute, setHospitalRoute] = useState(() => 
    generateRoadWaypoints(data.patient_location, data.hospital.location)
  );

  // Live Patient Device GPS Tracking (streams real location to backend, ambulance, and hospital)
  useEffect(() => {
    if (!navigator.geolocation) {
      setPatientGpsError('Geolocation is not supported by your browser or device.');
      return;
    }

    const tripId = data.trip_id || `trip_${data.emergency_id}`;
    let lastSendEpoch = 0;

    const watchId = navigator.geolocation.watchPosition(
      (position) => {
        const pLat = position.coords.latitude;
        const pLng = position.coords.longitude;
        setPatientLocation({ lat: pLat, lng: pLng });
        setPatientGpsError(null);

        const now = Date.now();
        // Emit citizen update every 5-10 seconds
        if (now - lastSendEpoch >= 5000) {
          lastSendEpoch = now;
          if (socketRef.current && socketRef.current.connected) {
            socketRef.current.emit('update_location', {
              tripId,
              trip_id: tripId,
              role: 'citizen',
              emergencyId: data.emergency_id,
              emergency_id: data.emergency_id,
              lat: pLat,
              lng: pLng,
              latitude: pLat,
              longitude: pLng,
              accuracy: position.coords.accuracy,
              timestamp: new Date().toISOString()
            });
          }
        }
      },
      (error) => {
        if (error.code === 1) {
          setPatientGpsError('Location permission denied. Patient marker using initial GPS pin.');
        } else if (error.code === 3) {
          setPatientGpsError('Patient GPS signal weak. Searching...');
        }
      },
      { enableHighAccuracy: true, timeout: 15000, maximumAge: 0 }
    );

    return () => navigator.geolocation.clearWatch(watchId);
  }, [data.emergency_id, data.trip_id]);

  // Signal freshness & stale reading monitor ticking second-by-second (NO blind countdown!)
  useEffect(() => {
    const timer = setInterval(() => {
      const elapsed = Math.floor((Date.now() - lastUpdateEpochRef.current) / 1000);
      setSecondsSinceLastUpdate(elapsed);
      if (elapsed > 15 && trackingState === 'live') {
        setTrackingState('stale');
      }
    }, 1000);
    return () => clearInterval(timer);
  }, [trackingState]);

  // Background road route enhancer (optional, max 800ms abort so it never blocks)
  useEffect(() => {
    if (!data?.ambulance?.location || !data?.patient_location || !data?.hospital?.location) return;

    const amb = initialAmbulanceLoc;
    const pat = data.patient_location;
    const hosp = data.hospital.location;
    let isMounted = true;

    const enhanceWithOSRM = async () => {
      try {
        const controller = new AbortController();
        const timeoutId = setTimeout(() => controller.abort(), 800);

        const [res1, res2] = await Promise.all([
          fetch(
            `https://router.project-osrm.org/route/v1/driving/${amb.lng},${amb.lat};${pat.lng},${pat.lat}?overview=full&geometries=geojson`,
            { signal: controller.signal }
          ).catch(() => null),
          fetch(
            `https://router.project-osrm.org/route/v1/driving/${pat.lng},${pat.lat};${hosp.lng},${hosp.lat}?overview=full&geometries=geojson`,
            { signal: controller.signal }
          ).catch(() => null)
        ]);

        clearTimeout(timeoutId);
        if (!isMounted) return;

        if (res1 && res1.ok) {
          const json1 = await res1.json();
          if (json1?.routes?.[0]?.geometry?.coordinates?.length > 1) {
            setPatientRoute(json1.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
            if (json1.routes[0].duration) {
              const mins = Math.max(1, Math.round(json1.routes[0].duration / 60));
              setLiveEta(mins);
            }
            if (json1.routes[0].distance) {
              setLiveDistance(Number((json1.routes[0].distance / 1000).toFixed(1)));
            }
          }
        }

        if (res2 && res2.ok) {
          const json2 = await res2.json();
          if (json2?.routes?.[0]?.geometry?.coordinates?.length > 1) {
            setHospitalRoute(json2.routes[0].geometry.coordinates.map(c => [c[1], c[0]]));
          }
        }
      } catch (err) {}
    };

    enhanceWithOSRM();
    return () => { isMounted = false; };
  }, [data, initialAmbulanceLoc]);

  // Socket.IO real-time tracking subscription & event listener lifecycle
  useEffect(() => {
    const API_BASE_URL = process.env.REACT_APP_API_URL || (window.location.hostname === 'localhost' ? 'http://localhost:5000' : 'https://aro-backend-tvkq.onrender.com');
    const socket = io(API_BASE_URL, {
      reconnection: true,
      reconnectionAttempts: 10,
      reconnectionDelay: 1000
    });

    socketRef.current = socket;
    const tripId = data.trip_id || `trip_${data.emergency_id}`;

    const subscribeToTracking = () => {
      console.log('Subscribing to unified trip room:', tripId);
      socket.emit('join_trip', { tripId, trip_id: tripId, emergencyId: data.emergency_id });
      socket.emit('tracking:subscribe', {
        tripId,
        emergencyId: data.emergency_id,
        emergency_id: data.emergency_id,
        trackingToken: data.tracking_token,
        tracking_token: data.tracking_token
      });
      socket.emit('start_tracking', {
        emergency_id: data.emergency_id,
        ambulance_location: initialAmbulanceLoc,
        patient_location: data.patient_location,
        hospital_location: data.hospital.location
      });
    };

    socket.on('connect', () => {
      console.log('Citizen tracking connected to server');
      subscribeToTracking();
    });

    socket.on('reconnect', () => {
      console.log('Citizen tracking reconnected to server');
      setTrackingState('live');
      subscribeToTracking();
    });

    socket.on('disconnect', () => {
      console.warn('Citizen tracking disconnected from server');
      setTrackingState('reconnecting');
    });

    // Initial snapshot handler
    socket.on('tracking:initial_state', (snapshot) => {
      if (snapshot.emergencyId && snapshot.emergencyId !== data.emergency_id && snapshot.emergency_id !== data.emergency_id) return;
      if (snapshot.location) {
        setAmbulanceLocation(snapshot.location);
        if (ambulanceMarkerRef.current && snapshot.location.lat && snapshot.location.lng) {
          ambulanceMarkerRef.current.setLatLng([snapshot.location.lat, snapshot.location.lng]);
        }
      }
      if (snapshot.status) setAmbulanceStatus(snapshot.status);
      if (snapshot.phase) setJourneyPhase(snapshot.phase);
      if (snapshot.eta !== undefined) {
        setLiveEta(snapshot.eta);
      }
      if (snapshot.distanceKm !== undefined) setLiveDistance(snapshot.distanceKm);
      else if (snapshot.distance_km !== undefined) setLiveDistance(snapshot.distance_km);

      setTelemetry({
        accuracy: snapshot.accuracy || null,
        speed: snapshot.speed || null,
        heading: snapshot.heading || null,
        timestamp: snapshot.timestamp || null
      });

      if (snapshot.trackingStatus) {
        setTrackingState(snapshot.trackingStatus);
      }
      lastUpdateEpochRef.current = Date.now();
      setSecondsSinceLastUpdate(0);
    });

    // Live position handler
    const handleLocationUpdate = (update) => {
      // Verify update belongs to this emergency
      const updateEmergencyId = update.emergencyId || update.emergency_id;
      if (updateEmergencyId && updateEmergencyId !== data.emergency_id) return;

      // Check if ambulance was rerouted
      const updateAmbId = update.ambulanceId || update.ambulance_id;
      if (update.rerouted || (updateAmbId && activeAmbulance.id && updateAmbId !== activeAmbulance.id)) {
        setActiveAmbulance(prev => ({
          ...prev,
          id: updateAmbId,
          name: update.ambulanceName || update.ambulance_name || `Unit ${String(updateAmbId).substring(0, 8)}`
        }));
        setReroutedNotice(`Emergency reassigned to ${update.ambulanceName || update.ambulance_name || 'next available ambulance'}.`);
        setTimeout(() => setReroutedNotice(null), 8000);
      }

      // Validate coordinates and animate smoothly using linear interpolation (lerp)
      const lat = update.lat !== undefined ? update.lat : (update.latitude !== undefined ? update.latitude : (update.location?.lat));
      const lng = update.lng !== undefined ? update.lng : (update.longitude !== undefined ? update.longitude : (update.location?.lng));
      if (typeof lat === 'number' && typeof lng === 'number' && !isNaN(lat) && !isNaN(lng)) {
        const newCoords = { lat, lng };
        setAmbulanceLocation(newCoords);
        animateMarkerLerp(lat, lng, 1800);

        // Smooth mathematical compass bearing fallback
        let newHeading = update.heading;
        if ((newHeading === null || newHeading === undefined || newHeading === 0) && prevAmbPosRef.current) {
          const dLat = Math.abs(lat - prevAmbPosRef.current.lat);
          const dLng = Math.abs(lng - prevAmbPosRef.current.lng);
          if (dLat > 0.00001 || dLng > 0.00001) {
            newHeading = calculateBearing(prevAmbPosRef.current.lat, prevAmbPosRef.current.lng, lat, lng);
          } else {
            newHeading = currentHeadingRef.current;
          }
        }
        if (typeof newHeading === 'number') {
          currentHeadingRef.current = Math.round(newHeading);
        }
        prevAmbPosRef.current = { lat, lng };
      }

      setPacketCount(c => c + 1);

      if (update.status) setAmbulanceStatus(update.status);
      if (update.phase) setJourneyPhase(update.phase);
      if (update.eta !== undefined) {
        setLiveEta(update.eta);
      }
      if (update.distanceKm !== undefined) setLiveDistance(update.distanceKm);
      else if (update.distance_km !== undefined) setLiveDistance(update.distance_km);

      setTelemetry({
        accuracy: update.accuracy !== undefined ? update.accuracy : null,
        speed: update.speed !== undefined ? update.speed : null,
        heading: currentHeadingRef.current,
        timestamp: update.timestamp || new Date().toISOString()
      });

      lastUpdateEpochRef.current = Date.now();
      setSecondsSinceLastUpdate(0);
      setTrackingState('live');
    };

    socket.on('ambulance:location:updated', handleLocationUpdate);
    socket.on('ambulance_update', handleLocationUpdate);
    socket.on('location_broadcast', (update) => {
      if (update.role === 'citizen') {
        const patLat = update.lat !== undefined ? update.lat : update.latitude;
        const patLng = update.lng !== undefined ? update.lng : update.longitude;
        if (typeof patLat === 'number' && typeof patLng === 'number') {
          setPatientLocation({ lat: patLat, lng: patLng });
        }
      } else {
        handleLocationUpdate(update);
      }
    });

    socket.on('tracking:started', () => {
      setTrackingState('live');
      lastUpdateEpochRef.current = Date.now();
      setSecondsSinceLastUpdate(0);
    });

    socket.on('tracking:stopped', (payload) => {
      setTrackingState('stopped');
      if (payload?.reason === 'ambulance_declined') {
        setReroutedNotice('Assigned ambulance declined. Rerouting to next nearest unit...');
      }
    });

    socket.on('ambulance_arrived', () => {
      setAmbulanceStatus('Arrived at Hospital');
      setJourneyPhase('arrived');
      setTrackingState('stopped');
      setLiveEta(0);
      setLiveDistance(0.0);
    });

    socket.on('er_acknowledged', (payload) => {
      if (!payload.emergency_id || payload.emergency_id === data.emergency_id) {
        setErPreparedInfo({
          prepared: true,
          bay: payload.er_bay || 'Bay 1',
          notes: payload.notes || 'Intake team prepared.'
        });
      }
    });

    socket.on('patient_admitted', (payload) => {
      if (!payload.emergency_id || payload.emergency_id === data.emergency_id) {
        setIsAdmitted(true);
        setAmbulanceStatus('Admitted to Hospital');
        setJourneyPhase('admitted');
        setTrackingState('stopped');
        setLiveEta(0);
        setLiveDistance(0.0);
      }
      if (payload.hospital && (payload.hospital.id === data.hospital?.id || payload.hospital_id === data.hospital?.id)) {
        setAssignedHospitalData(prev => ({ ...prev, ...payload.hospital }));
      }
    });

    socket.on('hospital_resources_updated', (payload) => {
      if (payload.hospital && (payload.hospital_id === data.hospital?.id || payload.hospital.id === data.hospital?.id)) {
        setAssignedHospitalData(prev => ({ ...prev, ...payload.hospital }));
      }
    });

    return () => {
      if (animFrameRef.current) cancelAnimationFrame(animFrameRef.current);
      socket.off('connect');
      socket.off('reconnect');
      socket.off('disconnect');
      socket.off('tracking:initial_state');
      socket.off('ambulance:location:updated');
      socket.off('ambulance_update');
      socket.off('tracking:started');
      socket.off('tracking:stopped');
      socket.off('ambulance_arrived');
      socket.off('er_acknowledged');
      socket.off('patient_admitted');
      socket.off('hospital_resources_updated');
      socket.disconnect();
    };
  }, [data, initialAmbulanceLoc, activeAmbulance.id]);

  // Live dynamic route line updating as the ambulance travels in real-time
  useEffect(() => {
    if (!ambulanceLocation) return;
    if (journeyPhase === 'to_hospital') {
      if (data?.hospital?.location) {
        setHospitalRoute(generateRoadWaypoints(ambulanceLocation, data.hospital.location));
      }
    } else {
      if (data?.patient_location) {
        setPatientRoute(generateRoadWaypoints(ambulanceLocation, data.patient_location));
      }
    }
  }, [ambulanceLocation, journeyPhase, data?.patient_location, data?.hospital?.location]);

  const formatCountdown = () => {
    if (ambulanceStatus.includes('Arrived at Hospital')) return 'Arrived';
    if (ambulanceStatus.includes('At Patient')) return 'At Patient';
    if (liveEta !== null && liveEta !== undefined) {
      if (liveEta <= 1 && liveDistance > 1.0) {
        return `${Math.max(2, Math.round((liveDistance / 35.0) * 60))} mins`;
      }
      if (liveEta <= 1) return '< 1 min';
      if (liveEta > 60) {
        const hrs = Math.floor(liveEta / 60);
        const mins = liveEta % 60;
        return mins > 0 ? `~${hrs} hr ${mins} min` : `~${hrs} hr`;
      }
      return `${liveEta} mins`;
    }
    return `${data.eta || 5} mins`;
  };

  const formatDistance = () => {
    if (liveDistance !== null && liveDistance !== undefined) {
      return liveDistance >= 1
        ? `${Number(liveDistance).toFixed(1)} km`
        : `${Math.round(liveDistance * 1000)} m`;
    }
    return `${data.distance || 'Calculating...'} km`;
  };

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
            <div className="info-label">{journeyPhase === 'to_hospital' ? 'ETA to Hospital' : 'ETA to Patient'}</div>
            <div className="info-value eta">{formatCountdown()}</div>
          </div>
        </div>

        {/* Rerouted Alert Banner */}
        {reroutedNotice && (
          <div style={{ background: '#fffbeb', border: '1px solid #fde68a', color: '#92400e', padding: '12px 20px', borderRadius: '12px', marginBottom: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>⚠️</span>
            <span>{reroutedNotice}</span>
          </div>
        )}

        {/* Patient GPS Warning Banner */}
        {patientGpsError && (
          <div style={{ background: '#fee2e2', border: '1px solid #f87171', color: '#991b1b', padding: '12px 20px', borderRadius: '12px', marginBottom: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '10px' }}>
            <span>⚠️</span>
            <span>{patientGpsError}</span>
          </div>
        )}

        {/* Patient Admitted Banner */}
        {isAdmitted && (
          <div style={{ background: '#dcfce7', border: '1px solid #86efac', color: '#166534', padding: '16px 22px', borderRadius: '12px', marginBottom: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', justifyContent: 'space-between', flexWrap: 'wrap', gap: '10px' }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
              <span style={{ fontSize: '1.8rem' }}>🏥</span>
              <div>
                <div style={{ fontSize: '1.1rem' }}>Patient Successfully Admitted!</div>
                <div style={{ fontSize: '0.85rem', color: '#14532d', fontWeight: 500 }}>The emergency trip has concluded at {assignedHospitalData.name || data.hospital.name}.</div>
              </div>
            </div>
            <button onClick={onBack} style={{ padding: '8px 16px', background: '#16a34a', color: 'white', border: 'none', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.85rem' }}>
              Return to Dashboard
            </button>
          </div>
        )}

        {/* ER Prepared Notification Banner */}
        {erPreparedInfo.prepared && !isAdmitted && (
          <div style={{ background: '#ecfdf5', border: '1px solid #a7f3d0', color: '#065f46', padding: '12px 20px', borderRadius: '12px', marginBottom: '14px', fontWeight: 'bold', display: 'flex', alignItems: 'center', gap: '12px' }}>
            <span style={{ fontSize: '1.4rem' }}>✅</span>
            <div>
              <div>ER Intake Bay Prepared: <strong>{erPreparedInfo.bay || 'Trauma Bay 1'}</strong></div>
              {erPreparedInfo.notes && <div style={{ fontSize: '0.82rem', color: '#047857', fontWeight: 500 }}>{erPreparedInfo.notes}</div>}
            </div>
          </div>
        )}

        {/* Live Navigation & Telemetry Bar */}
        <div className="live-nav-banner">
          <div className="live-nav-left">
            <span className="live-pulse-badge" style={{
              background: trackingState === 'live' ? '#dcfce7' : (trackingState === 'stale' ? '#fef9c3' : (trackingState === 'reconnecting' ? '#e0f2fe' : '#f1f5f9')),
              color: trackingState === 'live' ? '#166534' : (trackingState === 'stale' ? '#854d0e' : (trackingState === 'reconnecting' ? '#075985' : '#475569'))
            }}>
              <span className="live-pulse-dot" style={{
                background: trackingState === 'live' ? '#22c55e' : (trackingState === 'stale' ? '#eab308' : (trackingState === 'reconnecting' ? '#0284c7' : '#94a3b8'))
              }}></span>
              {trackingState === 'live' && 'LIVE GPS TRACKING'}
              {trackingState === 'waiting' && 'CONNECTING TO AMBULANCE GPS'}
              {trackingState === 'stale' && 'SIGNAL STALE'}
              {trackingState === 'reconnecting' && 'RECONNECTING...'}
              {trackingState === 'stopped' && 'TRACKING STOPPED'}
            </span>
            <span className="live-nav-headline">{ambulanceStatus}</span>
          </div>
          <div className="live-nav-right">
            {/* Live GPS Telemetry Pill */}
            <div style={{
              display: 'inline-flex',
              alignItems: 'center',
              gap: '8px',
              background: '#0f172a',
              color: '#38bdf8',
              padding: '5px 12px',
              borderRadius: '20px',
              fontSize: '0.8rem',
              fontFamily: 'monospace',
              fontWeight: 'bold',
              border: '1px solid #1e293b'
            }}>
              <span style={{
                width: '8px',
                height: '8px',
                borderRadius: '50%',
                background: '#22c55e',
                boxShadow: '0 0 8px #22c55e',
                display: 'inline-block'
              }}></span>
              <span>{ambulanceLocation?.lat ? `${ambulanceLocation.lat.toFixed(4)}, ${ambulanceLocation.lng.toFixed(4)}` : 'GPS Acquired'}</span>
              {telemetry.accuracy && <span style={{ color: '#94a3b8' }}>±{Math.round(telemetry.accuracy)}m</span>}
              {telemetry.speed !== null && <span style={{ color: '#e2e8f0' }}>{telemetry.speed} km/h</span>}
              <span style={{ color: '#64748b' }}>#{packetCount}</span>
            </div>

            <span className="live-nav-chip">⏱️ Remaining: <strong>{formatCountdown()}</strong></span>
            <span className="live-nav-chip">📏 Distance: <strong>{formatDistance()}</strong></span>
            {telemetry.accuracy !== null && (
              <span className="live-nav-chip" title="GPS Horizontal Accuracy">🎯 ±{telemetry.accuracy}m</span>
            )}
            {telemetry.speed !== null && (
              <span className="live-nav-chip" title="Live Velocity">⚡ {telemetry.speed} km/h</span>
            )}
            <span className="live-nav-chip" title="Signal Freshness">
              📡 {secondsSinceLastUpdate === 0 ? 'Live' : `${secondsSinceLastUpdate}s ago`}
            </span>
            <button 
              onClick={() => setIsFollowing(prev => !prev)}
              style={{
                background: isFollowing ? '#2563eb' : '#f8fafc',
                color: isFollowing ? 'white' : '#334155',
                border: '1px solid #cbd5e1',
                padding: '6px 14px',
                borderRadius: '8px',
                cursor: 'pointer',
                fontWeight: 'bold',
                fontSize: '0.85rem'
              }}
            >
              {isFollowing ? '✓ Following Unit' : '🎯 Follow Unit'}
            </button>
          </div>
        </div>

        {/* Stale Warning Notification */}
        {trackingState === 'stale' && (
          <div style={{ background: '#fef3c7', border: '1px solid #fde047', color: '#854d0e', padding: '10px 18px', borderRadius: '10px', margin: '-10px 0 16px 0', fontSize: '0.9rem', display: 'flex', alignItems: 'center', gap: '8px' }}>
            <span>⚠️</span>
            <span>Ambulance location signal is stale. Last confirmed reading was received {secondsSinceLastUpdate} seconds ago.</span>
          </div>
        )}

        {/* Middle Section - Map with Highlighted Road Directions & Camera Follow */}
        <div className="map-section" style={{ position: 'relative' }}>
          {GOOGLE_MAPS_KEY ? (
            <GoogleMapsCitizenTracking
              ambulanceLoc={ambulanceLocation}
              patientLoc={patientLocation}
              hospitalLoc={data?.hospital?.location}
              heading={telemetry.heading}
              isFollowing={isFollowing}
              onUserDrag={() => setIsFollowing(false)}
              journeyPhase={journeyPhase}
              ambulanceStatus={ambulanceStatus}
              hospitalName={data?.hospital?.name}
            />
          ) : (
            <MapContainer 
              center={center} 
              zoom={14} 
              style={{ height: '100%', width: '100%', borderRadius: '15px' }}
            >
              <TileLayer
                url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                attribution='&copy; <a href="https://www.openstreetmap.org/copyright">OpenStreetMap</a> contributors'
              />
              <CameraFollower 
                center={[ambulanceLocation.lat, ambulanceLocation.lng]} 
                enabled={isFollowing} 
                onUserDrag={() => setIsFollowing(false)} 
              />
              <MapBoundsFitter 
                patientLoc={patientLocation} 
                ambulanceLoc={ambulanceLocation} 
                hospitalLoc={data?.hospital?.location} 
                enabled={!isFollowing} 
              />
              
              <Marker position={[patientLocation.lat, patientLocation.lng]} icon={patientIcon}>
                <Popup>Patient Location</Popup>
              </Marker>
              
              <Marker position={[ambulanceLocation.lat, ambulanceLocation.lng]} icon={createAmbulanceIcon(telemetry.heading)} ref={ambulanceMarkerRef}>
                <Popup>Ambulance - {ambulanceStatus}</Popup>
              </Marker>
              
              <Marker position={[data.hospital.location.lat, data.hospital.location.lng]} icon={hospitalIcon}>
                <Popup>{data.hospital.name}</Popup>
              </Marker>
              
              {/* Google Maps Highlighted Road Directions */}
              {/* Leg 1: Ambulance to Patient (Google Maps blue road route) */}
              {patientRoute.length > 0 ? (
                <>
                  <Polyline 
                    positions={patientRoute} 
                    pathOptions={{ color: '#1a73e8', weight: 8, opacity: 0.35, lineCap: 'round', lineJoin: 'round' }} 
                  />
                  <Polyline 
                    positions={patientRoute} 
                    pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.95, lineCap: 'round', lineJoin: 'round' }} 
                  />
                </>
              ) : (
                <Polyline 
                  positions={[[ambulanceLocation.lat, ambulanceLocation.lng], [data.patient_location.lat, data.patient_location.lng]]} 
                  pathOptions={{ color: '#2563eb', weight: 5, opacity: 0.8 }} 
                />
              )}

              {/* Leg 2: Patient to Hospital (Google Maps emerald road route) */}
              {hospitalRoute.length > 0 ? (
                <>
                  <Polyline 
                    positions={hospitalRoute} 
                    pathOptions={{ 
                      color: journeyPhase === 'to_hospital' ? '#1a73e8' : '#059669', 
                      weight: journeyPhase === 'to_hospital' ? 8 : 7, 
                      opacity: 0.3, 
                      lineCap: 'round', 
                      lineJoin: 'round' 
                    }} 
                  />
                  <Polyline 
                    positions={hospitalRoute} 
                    pathOptions={{ 
                      color: journeyPhase === 'to_hospital' ? '#2563eb' : '#10b981', 
                      weight: journeyPhase === 'to_hospital' ? 5 : 4, 
                      dashArray: journeyPhase === 'to_hospital' ? null : '6, 8', 
                      opacity: 0.95, 
                      lineCap: 'round', 
                      lineJoin: 'round' 
                    }} 
                  />
                </>
              ) : (
                <Polyline 
                  positions={[[data.patient_location.lat, data.patient_location.lng], [data.hospital.location.lat, data.hospital.location.lng]]} 
                  pathOptions={{ color: '#10b981', weight: 4, dashArray: '6, 8', opacity: 0.8 }} 
                />
              )}
            </MapContainer>
          )}

          {/* Floating Recenter Button (Google Maps-Style) */}
          {!isFollowing && (
            <button
              onClick={() => setIsFollowing(true)}
              className="recenter-camera-btn"
              style={{
                position: 'absolute',
                bottom: 24,
                right: 24,
                zIndex: 1000,
                background: '#2563eb',
                color: 'white',
                border: 'none',
                borderRadius: '24px',
                padding: '10px 18px',
                fontWeight: 'bold',
                fontSize: '0.9rem',
                cursor: 'pointer',
                boxShadow: '0 4px 14px rgba(37,99,235,0.4)',
                display: 'flex',
                alignItems: 'center',
                gap: '6px'
              }}
            >
              <span>📍</span> Recenter Camera
            </button>
          )}
        </div>

        {/* Bottom Section - Details */}
        <div className="details-section">
          <div className="detail-card">
            <div className="detail-icon">🚑</div>
            <div className="detail-content">
              <div className="detail-label">Ambulance Number</div>
              <div className="detail-value">{formatAmbulanceAlias(data.ambulance.id)}</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">📍</div>
            <div className="detail-content">
              <div className="detail-label">Journey Status</div>
              <div className="detail-value">{ambulanceStatus}</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">{erPreparedInfo.prepared ? '✅' : '⏳'}</div>
            <div className="detail-content">
              <div className="detail-label">Hospital Prepared</div>
              <div className="detail-value">{erPreparedInfo.prepared ? `Prepared (${erPreparedInfo.bay || 'Bay 1'})` : 'Standing By'}</div>
            </div>
          </div>
          <div className="detail-card">
            <div className="detail-icon">📏</div>
            <div className="detail-content">
              <div className="detail-label">{journeyPhase === 'to_hospital' ? 'Distance to Hospital' : 'Distance Remaining'}</div>
              <div className="detail-value">{liveDistance} km</div>
            </div>
          </div>
        </div>

        {/* Destination Hospital Live Telemetry & Specialist Roster */}
        <div style={{ background: 'white', borderRadius: '16px', padding: '20px 24px', border: '1px solid #e2e8f0', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', marginBottom: '24px' }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '14px', flexWrap: 'wrap', gap: '8px' }}>
            <div>
              <div style={{ fontSize: '0.78rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Destination Hospital Telemetry</div>
              <h3 style={{ margin: '2px 0 0 0', fontSize: '1.25rem', color: '#1e293b' }}>{assignedHospitalData.name || data.hospital.name}</h3>
            </div>
            <span style={{ background: '#dcfce7', color: '#166534', padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>
              ● Live Bed & Specialist Sync
            </span>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(130px, 1fr))', gap: '12px', marginBottom: '16px' }}>
            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Total Beds</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#1e40af', marginTop: '2px' }}>
                {assignedHospitalData.beds_available ?? ((assignedHospitalData.icu_beds || 0) + (assignedHospitalData.general_beds || 0))}
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>ICU Beds</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#065f46', marginTop: '2px' }}>
                {assignedHospitalData.icu_beds ?? '—'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>General Beds</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#1e293b', marginTop: '2px' }}>
                {assignedHospitalData.general_beds ?? '—'}
              </div>
            </div>
            <div style={{ background: '#f8fafc', padding: '10px 14px', borderRadius: '10px', border: '1px solid #e2e8f0' }}>
              <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Ventilators</div>
              <div style={{ fontSize: '1.4rem', fontWeight: 'bold', color: '#d97706', marginTop: '2px' }}>
                {assignedHospitalData.ventilators ?? '—'}
              </div>
            </div>
          </div>

          <div>
            <div style={{ fontSize: '0.8rem', color: '#64748b', fontWeight: 'bold', marginBottom: '8px', textTransform: 'uppercase' }}>
              On-Duty Medical Specialists:
            </div>
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '8px' }}>
              {(assignedHospitalData.specialists || []).map((s, idx) => {
                const name = typeof s === 'object' ? s.name : `Dr. ${String(s).toUpperCase()}`;
                const spec = typeof s === 'object' ? s.specialty : s;
                const status = typeof s === 'object' ? s.status : 'Available';
                if (status === 'Off-Duty') return null;
                return (
                  <span 
                    key={s.id || idx}
                    style={{ 
                      background: status === 'Available' ? '#eff6ff' : '#fef9c3', 
                      color: status === 'Available' ? '#1e40af' : '#854d0e',
                      border: `1px solid ${status === 'Available' ? '#bfdbfe' : '#fde68a'}`,
                      borderRadius: '8px', 
                      padding: '5px 10px', 
                      fontSize: '0.82rem', 
                      fontWeight: 600,
                      display: 'inline-flex',
                      alignItems: 'center',
                      gap: '4px'
                    }}
                  >
                    👨‍⚕️ {name} <span style={{ opacity: 0.75, fontSize: '0.75rem' }}>({spec})</span>
                  </span>
                );
              })}
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
