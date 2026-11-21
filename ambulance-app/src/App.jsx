import React, { useState, useEffect, useRef, useCallback } from 'react';
import io from 'socket.io-client';
import { MapContainer, TileLayer, Marker, Popup, useMap } from 'react-leaflet';
import L from 'leaflet';
import 'leaflet/dist/leaflet.css';
import 'leaflet-routing-machine';
import 'leaflet-routing-machine/dist/leaflet-routing-machine.css';
import useLocationTracking from './hooks/useLocationTracking';

const API_BASE_URL = import.meta.env.VITE_API_BASE_URL || 'https://aro-backend-tvkq.onrender.com';
const GOOGLE_MAPS_KEY = import.meta.env.VITE_GOOGLE_MAPS_API_KEY || '';

delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconRetinaUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon-2x.png',
  iconUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-icon.png',
  shadowUrl: 'https://cdnjs.cloudflare.com/ajax/libs/leaflet/1.7.1/images/marker-shadow.png',
});

// Rotatable Google Maps-style navigation arrow/ambulance icon
const createAmbulanceIcon = (heading = 0) => L.divIcon({
  className: 'rotatable-driver-ambulance-marker',
  html: `
    <div style="
      width: 44px;
      height: 44px;
      display: flex;
      align-items: center;
      justify-content: center;
      transform: rotate(${heading || 0}deg);
      transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1);
    ">
      <div style="
        background: #d32f2f;
        color: white;
        border: 2px solid white;
        border-radius: 50%;
        width: 38px;
        height: 38px;
        display: flex;
        align-items: center;
        justify-content: center;
        box-shadow: 0 4px 12px rgba(0,0,0,0.35);
        font-size: 20px;
      ">
        🚑
      </div>
    </div>
  `,
  iconSize: [44, 44],
  iconAnchor: [22, 22]
});

// Google Maps-Style Live Camera Follower & User Drag Detector
function CameraFollower({ location, isFollowing, onUserPan }) {
  const map = useMap();

  useEffect(() => {
    if (!map) return;
    const handleDragStart = () => {
      if (onUserPan) onUserPan();
    };
    map.on('dragstart', handleDragStart);
    return () => {
      map.off('dragstart', handleDragStart);
    };
  }, [map, onUserPan]);

  useEffect(() => {
    if (!map || !location || !isFollowing) return;
    map.panTo([location.lat, location.lng], {
      animate: true,
      duration: 0.8,
      easeLinearity: 0.25
    });
  }, [map, location?.lat, location?.lng, isFollowing]);

  return null;
}

// OSRM Routing with no forced zoom fighting
function Routing({ start, end, onRouteInfo }) {
  const map = useMap();
  const routingControlRef = useRef(null);

  useEffect(() => {
    if (!map || !start || !end) return;

    const dLat = Math.abs(start.lat - end.lat);
    const dLng = Math.abs(start.lng - end.lng);
    if (dLat < 0.0001 && dLng < 0.0001) {
      if (onRouteInfo) {
        onRouteInfo({
          distanceKm: 0.1,
          etaMins: 1
        });
      }
      return;
    }

    if (routingControlRef.current) {
      try {
        map.removeControl(routingControlRef.current);
      } catch (e) {}
    }

    const control = L.Routing.control({
      waypoints: [
        L.latLng(start.lat, start.lng),
        L.latLng(end.lat, end.lng)
      ],
      routeWhileDragging: false,
      showAlternatives: false,
      fitSelectedRoutes: false, // Critical: don't zoom out or fight camera follow
      show: false,
      addWaypoints: false,
      lineOptions: {
        styles: [
          { color: '#1a73e8', weight: 8, opacity: 0.35 },
          { color: '#2563eb', weight: 5, opacity: 0.95 }
        ]
      }
    }).addTo(map);

    control.on('routesfound', (e) => {
      if (e.routes && e.routes[0]) {
        const route = e.routes[0];
        const s = route.summary || {};
        const coordinates = (route.coordinates || []).map(c => [c.lat, c.lng]);
        if (onRouteInfo) {
          onRouteInfo({
            distanceKm: Number((s.totalDistance / 1000).toFixed(1)),
            distanceMeters: Math.round(s.totalDistance),
            etaMins: Math.max(1, Math.round(s.totalTime / 60)),
            etaSeconds: Math.round(s.totalTime),
            routeGeometry: coordinates
          });
        }
      }
    });

    routingControlRef.current = control;

    return () => {
      if (routingControlRef.current) {
        try {
          map.removeControl(routingControlRef.current);
        } catch (e) {}
      }
    };
  }, [map, start?.lat, start?.lng, end?.lat, end?.lng, onRouteInfo]);

  return null;
}

// Optional Google Maps Component whenever VITE_GOOGLE_MAPS_API_KEY is supplied
function GoogleMapsNavigation({ start, end, heading = 0, isFollowing, onUserPan, onRecenter }) {
  const containerRef = useRef(null);
  const mapRef = useRef(null);
  const markerRef = useRef(null);
  const directionsRendererRef = useRef(null);

  useEffect(() => {
    if (!GOOGLE_MAPS_KEY) return;

    const scriptId = 'google-maps-sdk';
    const initMap = () => {
      if (!window.google || !containerRef.current) return;
      const gMap = new window.google.maps.Map(containerRef.current, {
        center: { lat: start.lat, lng: start.lng },
        zoom: 16,
        disableDefaultUI: false,
        zoomControl: true,
        streetViewControl: false,
        fullscreenControl: false
      });

      new window.google.maps.TrafficLayer().setMap(gMap);

      gMap.addListener('dragstart', () => {
        if (onUserPan) onUserPan();
      });

      mapRef.current = gMap;

      const marker = new window.google.maps.Marker({
        position: { lat: start.lat, lng: start.lng },
        map: gMap,
        title: 'Ambulance Unit',
        icon: {
          path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
          scale: 6,
          fillColor: '#d32f2f',
          fillOpacity: 1,
          strokeColor: '#ffffff',
          strokeWeight: 2,
          rotation: heading || 0
        }
      });
      markerRef.current = marker;

      const directionsService = new window.google.maps.DirectionsService();
      const directionsRenderer = new window.google.maps.DirectionsRenderer({
        map: gMap,
        suppressMarkers: true,
        polylineOptions: {
          strokeColor: '#2563eb',
          strokeWeight: 6,
          strokeOpacity: 0.9
        }
      });
      directionsRendererRef.current = directionsRenderer;

      if (end) {
        directionsService.route(
          {
            origin: { lat: start.lat, lng: start.lng },
            destination: { lat: end.lat, lng: end.lng },
            travelMode: window.google.maps.TravelMode.DRIVING
          },
          (result, status) => {
            if (status === 'OK') {
              directionsRenderer.setDirections(result);
            }
          }
        );
      }
    };

    if (window.google && window.google.maps) {
      initMap();
    } else if (!document.getElementById(scriptId)) {
      const script = document.createElement('script');
      script.id = scriptId;
      script.src = `https://maps.googleapis.com/maps/api/js?key=${GOOGLE_MAPS_KEY}&libraries=places`;
      script.async = true;
      script.defer = true;
      script.onload = initMap;
      document.head.appendChild(script);
    }
  }, []);

  useEffect(() => {
    if (!mapRef.current || !start) return;
    if (markerRef.current) {
      markerRef.current.setPosition({ lat: start.lat, lng: start.lng });
      markerRef.current.setIcon({
        path: window.google.maps.SymbolPath.FORWARD_CLOSED_ARROW,
        scale: 6,
        fillColor: '#d32f2f',
        fillOpacity: 1,
        strokeColor: '#ffffff',
        strokeWeight: 2,
        rotation: heading || 0
      });
    }
    if (isFollowing) {
      mapRef.current.panTo({ lat: start.lat, lng: start.lng });
    }
  }, [start?.lat, start?.lng, heading, isFollowing]);

  return (
    <div style={{ position: 'relative', width: '100%', height: '100%' }}>
      <div ref={containerRef} style={{ width: '100%', height: '100%' }} />
      {!isFollowing && (
        <button
          onClick={onRecenter}
          style={{
            position: 'absolute',
            bottom: '24px',
            right: '24px',
            zIndex: 1000,
            background: '#2563eb',
            color: 'white',
            border: 'none',
            borderRadius: '30px',
            padding: '10px 18px',
            fontWeight: 'bold',
            fontSize: '0.9rem',
            cursor: 'pointer',
            boxShadow: '0 4px 14px rgba(37, 99, 235, 0.4)'
          }}
        >
          📍 Recenter Camera
        </button>
      )}
    </div>
  );
}

const FLEET_UNITS = [
  { id: 'b1c0d054-8d8a-42d6-b4fc-aecfb77f0007', alias: 'Unit KA-B1C0', label: 'Bhatkal Main Road' },
  { id: 'b1c0d054-8d8a-42d6-b4fc-aecfb77f0008', alias: 'Unit KA-B1C1', label: 'Bhatkal Coastal' },
  { id: 'b2d0b054-8d8a-42d6-b4fc-aecfb77f36d0', alias: 'Unit KA-B2D0', label: 'Bhatkal Emergency Unit' },
  { id: 'b1c0d054-8d8a-42d6-b4fc-aecfb77f0009', alias: 'Unit KA-B1C2', label: 'Bhatkal Taluk Hospital' },
  { id: 'h1c0d054-8d8a-42d6-b4fc-aecfb77f0005', alias: 'Unit KA-H1C0', label: 'Honnavar Port' },
  { id: 'h1c0d054-8d8a-42d6-b4fc-aecfb77f0006', alias: 'Unit KA-H1C1', label: 'Honnavar Taluk Center' },
  { id: 'a1c0d054-8d8a-42d6-b4fc-aecfb77f0002', alias: 'Unit KA-A1C0', label: 'Mangalore Kadri' },
  { id: 'a1c0d054-8d8a-42d6-b4fc-aecfb77f0003', alias: 'Unit KA-A1C1', label: 'Mangalore Kankanady' }
];

const formatAmbulanceAlias = (uuid) => {
  if (!uuid) return '';
  const match = FLEET_UNITS.find(u => u.id === uuid);
  if (match) return `${match.alias} (${match.label})`;
  const part1 = uuid.substring(0, 4).toUpperCase();
  const part2 = uuid.substring(4, 6).toUpperCase();
  return `KA-${part1}-${part2}`;
};

export default function App() {
  const [isLoggedIn, setIsLoggedIn] = useState(false);
  const [ambulanceId, setAmbulanceId] = useState('b1c0d054-8d8a-42d6-b4fc-aecfb77f0007');
  const [socket, setSocket] = useState(null);
  const [status, setStatus] = useState('idle');
  const [assignment, setAssignment] = useState(null);
  const [erBayNotice, setErBayNotice] = useState(null);
  const [myLocation, setMyLocation] = useState(null);
  const [isFollowing, setIsFollowing] = useState(true);
  const [isPinging, setIsPinging] = useState(false);
  const [routeInfo, setRouteInfo] = useState({ distanceKm: null, distanceMeters: null, etaMins: null, etaSeconds: null });

  const mapInstanceRef = useRef(null);
  const latestRouteGeometryRef = useRef(null);
  const isDebugMode = typeof window !== 'undefined' && window.location.search.includes('debug=true');

  // Immediate hardware GPS acquisition to eliminate seeded coordinates
  const acquireHardwareGps = useCallback(() => {
    if (!navigator.geolocation) return;
    navigator.geolocation.getCurrentPosition(
      (pos) => {
        const lat = pos.coords.latitude;
        const lng = pos.coords.longitude;
        const loc = { lat, lng };
        setMyLocation(loc);
        console.log('[Ambulance App] Live hardware GPS locked:', loc);

        if (socket && socket.connected) {
          const payload = {
            ambulanceId,
            ambulance_id: ambulanceId,
            emergencyId: assignment?.emergency_id || assignment?.emergencyId,
            emergency_id: assignment?.emergency_id || assignment?.emergencyId,
            latitude: lat,
            longitude: lng,
            location: loc,
            accuracy: pos.coords.accuracy,
            speed: pos.coords.speed || 0,
            heading: pos.coords.heading || 0,
            timestamp: new Date().toISOString(),
            status,
            route_geometry: latestRouteGeometryRef.current
          };
          socket.emit('update_location', payload);
          socket.emit('ambulance:location:update', payload);
        }

        // Direct REST update to immediately overwrite seeded backend Anjumanabad coordinates
        fetch(`${API_BASE_URL}/api/ambulances/${ambulanceId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ambulance_id: ambulanceId,
            emergency_id: assignment?.emergency_id,
            lat,
            lng,
            accuracy: pos.coords.accuracy,
            timestamp: new Date().toISOString()
          })
        }).catch(() => {
          fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/location`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              ambulance_id: ambulanceId,
              emergency_id: assignment?.emergency_id,
              lat,
              lng,
              accuracy: pos.coords.accuracy,
              timestamp: new Date().toISOString()
            })
          }).catch(() => {});
        });
      },
      (err) => {
        console.warn('[Ambulance App] Hardware GPS fix warning:', err.message);
      },
      { enableHighAccuracy: true, timeout: 10000, maximumAge: 0 }
    );
  }, [ambulanceId, socket, assignment?.emergency_id, status]);

  // Unified Location Tracking Hook
  const {
    isTracking,
    trackingStatus,
    currentLocation,
    packetCount,
    telemetry,
    errorMessage,
    startTracking,
    stopTracking
  } = useLocationTracking({
    socket,
    ambulanceId,
    emergencyId: assignment?.emergency_id || assignment?.emergencyId,
    trackingToken: assignment?.tracking_token || assignment?.trackingToken,
    status,
    enabled: isLoggedIn,
    transmissionInterval: 2000,
    minDistanceMeters: 1.0,
    onLocationUpdate: ({ location }) => {
      setMyLocation(location);
    }
  });

  // Acquire hardware GPS on mount, unit switch, and shift start
  useEffect(() => {
    acquireHardwareGps();
  }, [acquireHardwareGps]);

  useEffect(() => {
    if (ambulanceId) acquireHardwareGps();
  }, [ambulanceId, acquireHardwareGps]);

  useEffect(() => {
    if (isLoggedIn) acquireHardwareGps();
  }, [isLoggedIn, acquireHardwareGps]);

  // Pulse green indicator on every emitted packet
  useEffect(() => {
    if (packetCount > 0) {
      setIsPinging(true);
      const timer = setTimeout(() => setIsPinging(false), 450);
      return () => clearTimeout(timer);
    }
  }, [packetCount]);

  // Sync currentLocation
  useEffect(() => {
    if (currentLocation && !myLocation) {
      setMyLocation(currentLocation);
    }
  }, [currentLocation, myLocation]);

  // Socket connection lifecycle
  useEffect(() => {
    if (isLoggedIn) {
      const newSocket = io(API_BASE_URL, {
        reconnection: true,
        reconnectionAttempts: 10,
        reconnectionDelay: 1000
      });
      setSocket(newSocket);

      newSocket.on('connect', () => {
        console.log('[Ambulance App] Connected to backend');
        newSocket.emit('join_ambulance', {
          ambulance_id: ambulanceId,
          ambulanceId,
          lat: myLocation?.lat,
          lng: myLocation?.lng
        });
        acquireHardwareGps();
      });

      newSocket.on('new_assignment', (data) => {
        console.log('[Ambulance App] New assignment received:', data);
        setAssignment(data);
        setStatus('assigned');
        setIsFollowing(true);
        const tripId = data.trip_id || `trip_${data.emergency_id}`;
        newSocket.emit('join_trip', { tripId });
        if (data.eta !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            etaMins: data.eta,
            etaSeconds: data.eta_seconds || (data.eta * 60)
          }));
        }
        if (data.distance !== undefined || data.distance_km !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            distanceKm: data.distance || data.distance_km,
            distanceMeters: data.distance_meters || (data.distance ? Math.round(data.distance * 1000) : null)
          }));
        }
      });

      newSocket.on('location_broadcast', (update) => {
        if (update.role === 'citizen') {
          const patLat = update.lat !== undefined ? update.lat : update.latitude;
          const patLng = update.lng !== undefined ? update.lng : update.longitude;
          if (typeof patLat === 'number' && typeof patLng === 'number') {
            setAssignment(prev => prev ? ({
              ...prev,
              patient_location: { lat: patLat, lng: patLng }
            }) : prev);
          }
        }
        if (update.eta !== undefined || update.eta_seconds !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            etaMins: update.eta !== undefined ? update.eta : Math.max(1, Math.round(update.eta_seconds / 60)),
            etaSeconds: update.eta_seconds ?? prev.etaSeconds
          }));
        }
        if (update.distance_km !== undefined || update.distanceKm !== undefined || update.distance_meters !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            distanceKm: update.distance_km ?? update.distanceKm ?? prev.distanceKm,
            distanceMeters: update.distance_meters ?? update.distanceMeters ?? prev.distanceMeters
          }));
        }
      });

      newSocket.on('ambulance:location:updated', (update) => {
        if (update.eta !== undefined || update.eta_seconds !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            etaMins: update.eta !== undefined ? update.eta : Math.max(1, Math.round(update.eta_seconds / 60)),
            etaSeconds: update.eta_seconds ?? prev.etaSeconds
          }));
        }
        if (update.distance_km !== undefined || update.distanceKm !== undefined || update.distance_meters !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            distanceKm: update.distance_km ?? update.distanceKm ?? prev.distanceKm,
            distanceMeters: update.distance_meters ?? update.distanceMeters ?? prev.distanceMeters
          }));
        }
      });

      newSocket.on('ambulance_update', (update) => {
        if (update.eta !== undefined || update.eta_seconds !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            etaMins: update.eta !== undefined ? update.eta : Math.max(1, Math.round(update.eta_seconds / 60)),
            etaSeconds: update.eta_seconds ?? prev.etaSeconds
          }));
        }
        if (update.distance_km !== undefined || update.distanceKm !== undefined || update.distance_meters !== undefined) {
          setRouteInfo(prev => ({
            ...prev,
            distanceKm: update.distance_km ?? update.distanceKm ?? prev.distanceKm,
            distanceMeters: update.distance_meters ?? update.distanceMeters ?? prev.distanceMeters
          }));
        }
      });

      newSocket.on('er_acknowledged', (data) => {
        setErBayNotice({
          prepared: true,
          bay: data.er_bay || 'Bay 1',
          notes: data.notes || 'Intake trauma team standing by'
        });
      });

      newSocket.on('hospital_resources_updated', (data) => {
        if (data.hospital) {
          setAssignment(prev => {
            if (!prev || !prev.hospital) return prev;
            if (String(prev.hospital.id) === String(data.hospital.id) || String(prev.hospital.id) === String(data.hospital_id)) {
              return {
                ...prev,
                hospital: { ...prev.hospital, ...data.hospital }
              };
            }
            return prev;
          });
        }
      });

      newSocket.on('patient_admitted', () => {
        setStatus('arrived_at_hospital');
        setErBayNotice(null);
        setTimeout(() => {
          setAssignment(null);
          setStatus('idle');
        }, 4000);
      });
      
      return () => newSocket.close();
    }
  }, [isLoggedIn, ambulanceId]);

  const handleRouteInfo = (info) => {
    setRouteInfo(info);
    if (info?.routeGeometry) {
      latestRouteGeometryRef.current = info.routeGeometry;
      if (socket && assignment) {
        socket.emit('update_location', {
          ambulanceId,
          ambulance_id: ambulanceId,
          emergencyId: assignment.emergency_id,
          emergency_id: assignment.emergency_id,
          route_geometry: info.routeGeometry,
          distance_km: info.distanceKm,
          eta: info.etaMins
        });
      }
    }
  };

  const respondToAssignment = async (accepted) => {
    try {
      if (accepted) {
        acquireHardwareGps();
      }

      if (socket && assignment) {
        socket.emit('driver_status_update', {
          ambulance_id: ambulanceId,
          emergency_id: assignment.emergency_id,
          status: accepted ? 'en_route_to_patient' : 'idle'
        });

        if (accepted && myLocation) {
          socket.emit('update_location', {
            ambulanceId,
            ambulance_id: ambulanceId,
            emergencyId: assignment.emergency_id,
            emergency_id: assignment.emergency_id,
            latitude: myLocation.lat,
            longitude: myLocation.lng,
            location: myLocation,
            accuracy: telemetry.accuracy,
            heading: telemetry.heading,
            speed: telemetry.speed,
            timestamp: new Date().toISOString(),
            status: 'en_route_to_patient',
            route_geometry: latestRouteGeometryRef.current
          });
        }
      }

      await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/respond`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ 
          accepted, 
          emergency_id: assignment.emergency_id,
          patient_location: assignment.patient_location,
          emergency_type: assignment.emergency_type,
          severity: assignment.severity,
          hospital: assignment.hospital,
          eta: assignment.eta,
          location: myLocation,
          lat: myLocation?.lat,
          lng: myLocation?.lng
        })
      });

      if (accepted && myLocation) {
        fetch(`${API_BASE_URL}/api/ambulances/${ambulanceId}/location`, {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ambulance_id: ambulanceId,
            emergency_id: assignment.emergency_id,
            lat: myLocation.lat,
            lng: myLocation.lng,
            accuracy: telemetry.accuracy,
            timestamp: new Date().toISOString()
          })
        }).catch(() => {});
      }
      
      if (accepted) {
        setStatus('en_route_to_patient');
        setIsFollowing(true);
      } else {
        setAssignment(null);
        setStatus('idle');
      }
    } catch (e) {
      console.error(e);
    }
  };

  const updateStatus = async (newStatus) => {
    try {
      if (socket && assignment) {
        socket.emit('driver_status_update', {
          ambulance_id: ambulanceId,
          emergency_id: assignment.emergency_id,
          status: newStatus
        });
      }

      await fetch(`${API_BASE_URL}/api/ambulance/${ambulanceId}/status`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status: newStatus, emergency_id: assignment?.emergency_id })
      });
      setStatus(newStatus);
      setIsFollowing(true);
      if (newStatus === 'arrived_at_hospital') {
        setTimeout(() => {
          setAssignment(null);
          setStatus('idle');
        }, 4000);
      }
    } catch (e) {
      console.error(e);
    }
  };

  // Step movement on desktop/simulator for testing
  const stepTowardsTarget = () => {
    if (!assignment || !myLocation) return;
    const target = status === 'en_route_to_patient' ? assignment.patient_location : assignment.hospital?.location;
    if (!target) return;
    
    const latDiff = target.lat - myLocation.lat;
    const lngDiff = target.lng - myLocation.lng;
    const distTotal = Math.sqrt(latDiff * latDiff + lngDiff * lngDiff);
    if (distTotal < 0.0006) {
      if (status === 'en_route_to_patient') updateStatus('en_route_to_hospital');
      else updateStatus('arrived_at_hospital');
      return;
    }
    const stepRatio = Math.min(0.2, 0.0025 / distTotal);
    const newLoc = {
      lat: Number((myLocation.lat + latDiff * stepRatio).toFixed(6)),
      lng: Number((myLocation.lng + lngDiff * stepRatio).toFixed(6))
    };
    setMyLocation(newLoc);
    if (socket) {
      const payload = {
        ambulanceId,
        ambulance_id: ambulanceId,
        emergencyId: assignment.emergency_id,
        emergency_id: assignment.emergency_id,
        trackingToken: assignment.tracking_token || assignment.trackingToken,
        latitude: newLoc.lat,
        longitude: newLoc.lng,
        location: newLoc,
        accuracy: 4.0,
        heading: 90,
        speed: 35.0,
        timestamp: new Date().toISOString(),
        status
      };
      socket.emit('ambulance:location:update', payload);
      socket.emit('update_location', payload);
    }
  };

  const handleRecenter = () => {
    setIsFollowing(true);
    if (mapInstanceRef.current && myLocation) {
      mapInstanceRef.current.panTo([myLocation.lat, myLocation.lng], {
        animate: true,
        duration: 0.6
      });
    }
  };

  const formatDriverCountdown = () => {
    if (status === 'arrived_at_hospital') return 'Arrived';
    if (routeInfo.etaMins !== null && routeInfo.etaMins !== undefined) {
      if (routeInfo.etaMins <= 1 && assignment?.distance > 1.0 && (routeInfo.distanceKm === null || routeInfo.distanceKm <= 0.2)) {
        return `${assignment.eta || 5} mins`;
      }
      if (routeInfo.etaMins <= 1) return '< 1 min';
      return `${routeInfo.etaMins} mins`;
    }
    return assignment?.eta ? `${assignment.eta} mins` : 'Calculating...';
  };

  const formatDistance = () => {
    if (routeInfo.distanceKm !== null && routeInfo.distanceKm !== undefined) {
      if (routeInfo.distanceKm <= 0.2 && assignment?.distance > 1.0) {
        return `${assignment.distance} km`;
      }
      return routeInfo.distanceKm >= 1
        ? `${routeInfo.distanceKm} km`
        : `${routeInfo.distanceMeters || Math.round(routeInfo.distanceKm * 1000)} m`;
    }
    return assignment?.distance ? `${assignment.distance} km` : 'Calculating...';
  };

  const renderStatusBadge = () => {
    switch (status) {
      case 'idle': return <span style={{ background: '#e8f5e9', color: '#2e7d32', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>🟢 Available</span>;
      case 'assigned': return <span style={{ background: '#fff3e0', color: '#ef6c00', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>⚡ New Job</span>;
      default: return <span style={{ background: '#e3f2fd', color: '#1565c0', padding: '6px 16px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>🚨 En Route</span>;
    }
  };

  if (!isLoggedIn) {
    return (
      <div style={{ padding: 40, fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", background: '#f5f5f7', color: '#333', minHeight: '100vh', display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center' }}>
        <h1 style={{ fontSize: '2.5rem', marginBottom: '10px', color: '#d32f2f' }}>Emergency App</h1>
        <h2 style={{ fontSize: '1.4rem', fontWeight: 400, color: '#666', marginBottom: '35px' }}>Driver Portal</h2>
        
        <div style={{ background: 'white', padding: '40px', borderRadius: '16px', width: '100%', maxWidth: '440px', boxShadow: '0 10px 30px rgba(0,0,0,0.08)', textAlign: 'center', boxSizing: 'border-box' }}>
          <label style={{ display: 'block', marginBottom: '10px', color: '#666', fontWeight: 'bold', fontSize: '0.95rem' }}>Select Assigned Vehicle Unit:</label>
          <select 
            value={ambulanceId} 
            onChange={(e) => setAmbulanceId(e.target.value)}
            style={{ width: '100%', padding: '14px', fontSize: 16, marginBottom: 28, background: '#f9f9f9', color: '#d32f2f', border: '1px solid #e0e0e0', borderRadius: '10px', fontWeight: 'bold' }}
          >
            {FLEET_UNITS.map(u => (
              <option key={u.id} value={u.id}>{u.alias} — {u.label}</option>
            ))}
          </select>
          <button 
            onClick={() => {
              setIsLoggedIn(true);
              acquireHardwareGps();
            }} 
            style={{ width: '100%', padding: '16px', fontSize: 18, background: '#d32f2f', color: 'white', border: 'none', borderRadius: '10px', cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(211, 47, 47, 0.3)' }}
          >
            Start Shift
          </button>
        </div>
      </div>
    );
  }

  const activeDestination = status === 'en_route_to_patient' ? assignment?.patient_location : assignment?.hospital?.location;

  return (
    <div style={{ fontFamily: "'Segoe UI', Tahoma, Geneva, Verdana, sans-serif", minHeight: '100vh', display: 'flex', flexDirection: 'column', background: '#f8fafc', color: '#1e293b' }}>
      
      {/* Top Navbar */}
      <div style={{ padding: '14px 24px', background: 'white', borderBottom: '1px solid #e2e8f0', display: 'flex', justifyContent: 'space-between', alignItems: 'center', boxShadow: '0 2px 10px rgba(0,0,0,0.04)', position: 'sticky', top: 0, zIndex: 1000, flexWrap: 'wrap', gap: '10px' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
          <span style={{ fontSize: '1.6rem' }}>🚑</span>
          <div>
            <span style={{ fontSize: '0.72rem', color: '#64748b', textTransform: 'uppercase', letterSpacing: '0.5px', fontWeight: 'bold' }}>Vehicle Unit</span>
            <div style={{ fontSize: '1.2rem', color: '#d32f2f', fontWeight: 'bold' }}>{formatAmbulanceAlias(ambulanceId)}</div>
          </div>
        </div>

        {/* Live GPS Telemetry Pill */}
        <div style={{
          display: 'flex',
          alignItems: 'center',
          gap: '10px',
          background: '#0f172a',
          color: 'white',
          padding: '6px 14px',
          borderRadius: '20px',
          fontSize: '0.8rem',
          fontFamily: 'monospace',
          boxShadow: '0 2px 8px rgba(0,0,0,0.15)'
        }}>
          <span style={{
            width: '8px',
            height: '8px',
            borderRadius: '50%',
            backgroundColor: trackingStatus === 'live' ? '#22c55e' : (trackingStatus === 'permission_denied' ? '#ef4444' : '#eab308'),
            boxShadow: isPinging ? '0 0 10px #22c55e' : 'none',
            transform: isPinging ? 'scale(1.4)' : 'scale(1.0)',
            transition: 'all 0.2s ease',
            display: 'inline-block'
          }}></span>
          <span>{myLocation ? `${myLocation.lat.toFixed(4)}, ${myLocation.lng.toFixed(4)}` : 'Locking GPS...'}</span>
          <span>| Acc: ±{telemetry.accuracy ?? '—'}m</span>
          <span>| {telemetry.speed ?? 0} km/h</span>
          <span style={{ color: '#38bdf8' }}>#{packetCount}</span>
        </div>

        <div style={{ display: 'flex', alignItems: 'center', gap: '14px' }}>
          {renderStatusBadge()}
          <button 
            onClick={() => setIsLoggedIn(false)} 
            style={{ padding: '6px 14px', background: '#f1f5f9', color: '#475569', border: '1px solid #cbd5e1', borderRadius: '8px', cursor: 'pointer', fontWeight: 'bold', fontSize: 13 }}
          >
            End Shift
          </button>
        </div>
      </div>

      <div style={{ padding: '20px', maxWidth: '1240px', margin: '0 auto', width: '100%', boxSizing: 'border-box', flex: 1, display: 'flex', flexDirection: 'column', gap: '18px' }}>

        {errorMessage && (
          <div style={{ background: '#fee2e2', border: '1px solid #ef4444', color: '#991b1b', padding: '12px 18px', borderRadius: '12px', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontWeight: 600, fontSize: '0.9rem' }}>⚠️ {errorMessage}</div>
            <button onClick={() => startTracking()} style={{ background: '#b91c1c', color: 'white', border: 'none', padding: '6px 14px', borderRadius: '6px', cursor: 'pointer', fontWeight: 'bold', fontSize: '0.82rem' }}>Retry GPS</button>
          </div>
        )}

        {status === 'idle' && (
          <div style={{ padding: '80px 40px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 12px rgba(0,0,0,0.03)' }}>
            <div style={{ fontSize: '4.5rem', marginBottom: '20px' }}>📡</div>
            <h3 style={{ fontSize: '1.6rem', margin: '0 0 10px 0', color: '#1e293b' }}>Hardware GPS Streaming Active</h3>
            <p style={{ color: '#64748b', maxWidth: '420px', lineHeight: '1.6', fontSize: '1rem', margin: 0 }}>
              Your device coordinates are streaming live to the central dispatch router. When an emergency is requested in your sector, this screen will sound and alert you immediately.
            </p>
          </div>
        )}

        {status === 'assigned' && assignment && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '20px' }}>
            <div style={{ background: '#fff1f2', padding: 26, borderRadius: 16, boxShadow: '0 10px 25px rgba(225, 29, 72, 0.08)', border: '1px solid #fecdd3' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '16px' }}>
                <h1 style={{ color: '#e11d48', margin: 0, fontSize: '1.7rem', display: 'flex', alignItems: 'center', gap: '10px' }}>
                  ⚠️ NEW EMERGENCY DISPATCH
                </h1>
                <span style={{ background: '#e11d48', color: 'white', padding: '6px 14px', borderRadius: 20, fontSize: 13, fontWeight: 'bold' }}>Immediate Action</span>
              </div>
              
              <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: '14px', marginBottom: '22px' }}>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Condition</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#e11d48', marginTop: '4px' }}>{assignment.emergency_type}</div>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Severity</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#d97706', marginTop: '4px' }}>{assignment.severity}</div>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Assigned Hospital</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#2563eb', marginTop: '4px' }}>{assignment.hospital?.name}</div>
                </div>
                <div style={{ background: 'white', padding: '16px', borderRadius: '10px', boxShadow: '0 2px 6px rgba(0,0,0,0.04)' }}>
                  <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Estimated ETA</div>
                  <div style={{ fontSize: '1.15rem', fontWeight: 'bold', color: '#059669', marginTop: '4px' }}>{assignment.eta} mins</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 16 }}>
                <button 
                  onClick={() => respondToAssignment(true)}
                  style={{ flex: 1, padding: 18, fontSize: 18, background: '#e11d48', color: 'white', border: 'none', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(225, 29, 72, 0.35)' }}
                >
                  ✓ ACCEPT DISPATCH
                </button>
                <button 
                  onClick={() => respondToAssignment(false)}
                  style={{ flex: 1, padding: 18, fontSize: 18, background: 'white', color: '#e11d48', border: '2px solid #e11d48', borderRadius: 12, cursor: 'pointer', fontWeight: 'bold' }}
                >
                  ✕ DECLINE
                </button>
              </div>
            </div>
          </div>
        )}

        {(status === 'en_route_to_patient' || status === 'en_route_to_hospital') && assignment && (
          <div style={{ display: 'flex', flexDirection: 'column', gap: '18px' }}>
            
            {/* Objective & Status Card */}
            <div style={{ padding: '20px 24px', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 16px rgba(0,0,0,0.04)', display: 'flex', flexWrap: 'wrap', justifyContent: 'space-between', alignItems: 'center', gap: '16px' }}>
              <div>
                <div style={{ fontSize: '0.8rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Current Objective</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: status === 'en_route_to_patient' ? '#2563eb' : '#059669', marginTop: '2px' }}>
                  {status === 'en_route_to_patient' ? '📍 Driving to Pick Up Patient' : `🏥 Transporting Patient to ${assignment.hospital?.name}`}
                </div>
                <div style={{ fontSize: '0.88rem', color: '#64748b', marginTop: '4px' }}>
                  Patient Condition: <strong>{assignment.emergency_type} ({assignment.severity})</strong>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '12px', alignItems: 'center', flexWrap: 'wrap' }}>
                {isDebugMode && (
                  <button 
                    onClick={stepTowardsTarget}
                    title="Simulate driving 250m closer towards destination (Debug Mode Only)"
                    style={{ padding: '12px 18px', fontSize: 14, background: '#f8fafc', color: '#1e293b', border: '1px solid #cbd5e1', borderRadius: 10, cursor: 'pointer', fontWeight: 'bold' }}
                  >
                    🚗 Test Move 250m
                  </button>
                )}
                {status === 'en_route_to_patient' ? (
                  <button 
                    onClick={() => updateStatus('en_route_to_hospital')}
                    style={{ padding: '14px 24px', fontSize: 16, background: '#2563eb', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(37, 99, 235, 0.3)' }}
                  >
                    ✓ Confirm Patient Picked Up
                  </button>
                ) : (
                  <button 
                    onClick={() => updateStatus('arrived_at_hospital')}
                    style={{ padding: '14px 24px', fontSize: 16, background: '#059669', color: 'white', border: 'none', borderRadius: 10, cursor: 'pointer', fontWeight: 'bold', boxShadow: '0 4px 14px rgba(5, 150, 105, 0.3)' }}
                  >
                    ✓ Confirm Arrived at Hospital
                  </button>
                )}
              </div>
            </div>

            {/* ER Bay Prepared Alert */}
            {erBayNotice && erBayNotice.prepared && (
              <div style={{ background: '#ecfdf5', border: '1px solid #86efac', color: '#166534', padding: '14px 20px', borderRadius: '14px', display: 'flex', alignItems: 'center', justifyContent: 'space-between', boxShadow: '0 4px 14px rgba(22, 163, 74, 0.12)', flexWrap: 'wrap', gap: '10px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
                  <span style={{ fontSize: '1.6rem' }}>🏥</span>
                  <div>
                    <div style={{ fontWeight: 'bold', fontSize: '1.05rem' }}>ER Intake Prepared: {erBayNotice.bay}</div>
                    <div style={{ fontSize: '0.85rem', color: '#14532d', marginTop: '2px' }}>{erBayNotice.notes || 'Emergency room team standing by for arrival.'}</div>
                  </div>
                </div>
                <span style={{ background: '#16a34a', color: 'white', padding: '4px 12px', borderRadius: '12px', fontSize: '0.8rem', fontWeight: 'bold' }}>Ready</span>
              </div>
            )}

            {/* Live Google Maps Navigation Metrics Card */}
            <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(180px, 1fr))', gap: '14px' }}>
              <div style={{ background: 'white', padding: '14px 18px', borderRadius: '14px', border: '1px solid #e2e8f0', borderLeft: '4px solid #2563eb', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Dynamic Road ETA</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#1e40af', marginTop: '3px' }}>
                  ⏱️ {formatDriverCountdown()}
                </div>
              </div>
              <div style={{ background: 'white', padding: '14px 18px', borderRadius: '14px', border: '1px solid #e2e8f0', borderLeft: '4px solid #059669', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Remaining Distance</div>
                <div style={{ fontSize: '1.35rem', fontWeight: 'bold', color: '#065f46', marginTop: '3px' }}>
                  📏 {formatDistance()}
                </div>
              </div>
              <div style={{ background: 'white', padding: '14px 18px', borderRadius: '14px', border: '1px solid #e2e8f0', borderLeft: '4px solid #d97706', boxShadow: '0 2px 6px rgba(0,0,0,0.03)' }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Camera Mode</div>
                <div style={{ fontSize: '1rem', fontWeight: 'bold', color: isFollowing ? '#166534' : '#d97706', marginTop: '4px' }}>
                  {isFollowing ? '🟢 Google Maps Auto-Follow' : '🟡 Free Explore (Recenter Below)'}
                </div>
              </div>
            </div>

            {/* Live Navigation Map Card */}
            <div style={{ height: '520px', borderRadius: '16px', overflow: 'hidden', border: '1px solid #e2e8f0', boxShadow: '0 4px 20px rgba(0,0,0,0.06)', position: 'relative' }}>
              
              {(() => {
                const driverAmbulanceLocation = myLocation || assignment?.ambulance?.location;
                return GOOGLE_MAPS_KEY && driverAmbulanceLocation && activeDestination ? (
                  <GoogleMapsNavigation
                    start={driverAmbulanceLocation}
                    end={activeDestination}
                    heading={telemetry.heading}
                    isFollowing={isFollowing}
                    onUserPan={() => setIsFollowing(false)}
                    onRecenter={handleRecenter}
                  />
                ) : (
                  <MapContainer 
                    center={driverAmbulanceLocation ? [driverAmbulanceLocation.lat, driverAmbulanceLocation.lng] : [assignment.patient_location.lat, assignment.patient_location.lng]} 
                    zoom={15} 
                    style={{ height: '100%', width: '100%' }}
                    whenCreated={(map) => { mapInstanceRef.current = map; }}
                  >
                    <TileLayer url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png" />
                    
                    {/* Google Maps-Style Smooth Camera Auto-Follower */}
                    <CameraFollower 
                      location={driverAmbulanceLocation} 
                      isFollowing={isFollowing} 
                      onUserPan={() => setIsFollowing(false)} 
                    />

                    {/* Rotatable Driver Ambulance Marker - Live hardware GPS strictly prioritized */}
                    {driverAmbulanceLocation && (
                      <Marker position={[driverAmbulanceLocation.lat, driverAmbulanceLocation.lng]} icon={createAmbulanceIcon(telemetry.heading)}>
                        <Popup>
                          <strong>Ambulance Unit</strong><br />
                          Speed: {telemetry.speed} km/h<br />
                          Heading: {telemetry.heading}°
                        </Popup>
                      </Marker>
                    )}

                    {/* Patient Pin */}
                    {assignment.patient_location && (
                      <Marker position={[assignment.patient_location.lat, assignment.patient_location.lng]}>
                        <Popup>Patient Location</Popup>
                      </Marker>
                    )}

                    {/* Dynamic Road Route */}
                    <Routing 
                      start={driverAmbulanceLocation || assignment.patient_location} 
                      end={activeDestination} 
                      onRouteInfo={handleRouteInfo}
                    />
                  </MapContainer>
                );
              })()}

              {/* Floating Recenter Button (Just like Google Maps) */}
              {!isFollowing && (
                <button 
                  onClick={handleRecenter}
                  style={{
                    position: 'absolute',
                    bottom: '24px',
                    right: '24px',
                    zIndex: 1000,
                    background: '#2563eb',
                    color: 'white',
                    border: 'none',
                    borderRadius: '30px',
                    padding: '10px 20px',
                    fontWeight: 'bold',
                    fontSize: '0.9rem',
                    cursor: 'pointer',
                    boxShadow: '0 4px 14px rgba(37, 99, 235, 0.45)',
                    display: 'flex',
                    alignItems: 'center',
                    gap: '6px'
                  }}
                >
                  📍 Recenter Camera
                </button>
              )}
            </div>

            {/* Destination Hospital Telemetry Card */}
            {assignment.hospital && (
              <div style={{ background: 'white', padding: '18px 24px', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 2px 8px rgba(0,0,0,0.03)' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: '10px', flexWrap: 'wrap', gap: '8px' }}>
                  <div>
                    <span style={{ fontSize: '0.75rem', color: '#64748b', textTransform: 'uppercase', fontWeight: 'bold' }}>Destination Hospital Profile</span>
                    <div style={{ fontSize: '1.2rem', fontWeight: 'bold', color: '#1e293b' }}>{assignment.hospital?.name}</div>
                  </div>
                  <div style={{ fontSize: '0.82rem', background: '#f1f5f9', color: '#475569', padding: '6px 12px', borderRadius: '8px', fontWeight: 'bold' }}>
                    Available Beds: <strong style={{ color: '#16a34a' }}>{assignment.hospital?.beds_available ?? ((assignment.hospital?.icu_beds || 0) + (assignment.hospital?.general_beds || 0))}</strong> (ICU: {assignment.hospital?.icu_beds ?? '—'}, Gen: {assignment.hospital?.general_beds ?? '—'}, Vents: {assignment.hospital?.ventilators ?? '—'})
                  </div>
                </div>

                {assignment.hospital?.specialists && assignment.hospital.specialists.length > 0 && (
                  <div>
                    <div style={{ fontSize: '0.78rem', color: '#64748b', fontWeight: 'bold', textTransform: 'uppercase', marginBottom: '6px' }}>On-Duty Specialists:</div>
                    <div style={{ display: 'flex', flexWrap: 'wrap', gap: '6px' }}>
                      {assignment.hospital.specialists.map((s, idx) => {
                        const name = typeof s === 'object' ? s.name : `Dr. ${String(s).toUpperCase()}`;
                        const spec = typeof s === 'object' ? s.specialty : s;
                        const specStatus = typeof s === 'object' ? s.status : 'Available';
                        if (specStatus === 'Off-Duty') return null;
                        return (
                          <span key={s.id || idx} style={{ background: '#f8fafc', border: '1px solid #cbd5e1', padding: '4px 10px', borderRadius: '6px', fontSize: '0.78rem', color: '#334155' }}>
                            👨‍⚕️ <strong>{name}</strong> ({spec})
                          </span>
                        );
                      })}
                    </div>
                  </div>
                )}
              </div>
            )}

          </div>
        )}
        
        {status === 'arrived_at_hospital' && (
          <div style={{ padding: '70px 40px', flex: 1, display: 'flex', flexDirection: 'column', alignItems: 'center', justifyContent: 'center', textAlign: 'center', background: 'white', borderRadius: '16px', border: '1px solid #e2e8f0', boxShadow: '0 4px 14px rgba(0,0,0,0.04)' }}>
            <div style={{ fontSize: '4.5rem', marginBottom: '20px', color: '#16a34a' }}>✅</div>
            <h2 style={{ margin: '0 0 10px 0', color: '#1e293b', fontSize: '1.8rem' }}>Mission Completed!</h2>
            <p style={{ color: '#64748b', fontSize: '1.05rem', margin: 0 }}>Patient successfully transferred to {assignment?.hospital?.name || 'the emergency department'}. Resetting unit to available...</p>
          </div>
        )}
      </div>
    </div>
  );
}
