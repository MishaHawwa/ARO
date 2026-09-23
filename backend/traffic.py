"""
traffic.py
----------
Turns a live route query into the traffic_factor (0-1) that predict_eta()
in app.py expects, using a real routing API instead of the fixed formula
that was there before (`min(0.3, distance * 0.05)`).

Two options, pick one and set the matching env var:

  OPTION A - Google Distance Matrix API (best real-time traffic, paid
             after a free tier; needs GOOGLE_MAPS_API_KEY)
  OPTION B - OSRM (open-source routing; no traffic awareness on the public
             demo server, but free and needs no key - good for development)

Both return the same shape so app.py doesn't care which one is active:
    get_traffic_factor(origin, dest) -> float in [0, 1]

HOW TO WIRE THIS INTO app.py
    from traffic import get_traffic_factor
    ...
    traffic_factor = get_traffic_factor(nearest_ambulance['location'], best_hospital['location'])
(replacing the line `traffic_factor = min(0.3, distance_to_hospital * 0.05)`)
"""

import os
import json
import urllib.request
import urllib.parse

GOOGLE_MAPS_API_KEY = os.environ.get("GOOGLE_MAPS_API_KEY")


def _google_traffic_factor(origin, dest):
    """Uses Distance Matrix with departure_time=now to get duration_in_traffic
    vs plain duration; the ratio is a direct, real measurement of how much
    current traffic is slowing this exact route down."""
    params = urllib.parse.urlencode({
        "origins": f"{origin['lat']},{origin['lng']}",
        "destinations": f"{dest['lat']},{dest['lng']}",
        "departure_time": "now",
        "key": GOOGLE_MAPS_API_KEY,
    })
    url = f"https://maps.googleapis.com/maps/api/distancematrix/json?{params}"
    with urllib.request.urlopen(url, timeout=8) as resp:
        data = json.loads(resp.read())

    element = data["rows"][0]["elements"][0]
    if element.get("status") != "OK":
        raise RuntimeError(f"Distance Matrix error: {element.get('status')}")

    duration = element["duration"]["value"]
    duration_in_traffic = element.get("duration_in_traffic", {}).get("value", duration)

    if duration <= 0:
        return 0.0
    # 1.0x free-flow -> factor 0, 2.0x free-flow (gridlock) -> factor 1
    ratio = duration_in_traffic / duration
    factor = max(0.0, min(1.0, ratio - 1.0))
    return factor


def _osrm_traffic_factor(origin, dest):
    """OSRM's public demo server has no live traffic data, so this can only
    return a neutral factor - it's here so the app still runs with zero
    setup during development. Swap for a self-hosted OSRM with traffic
    profiles, or Option A, before relying on this for real dispatch."""
    return 0.15  # neutral placeholder, same order of magnitude as before


def get_traffic_factor(origin, dest):
    try:
        if GOOGLE_MAPS_API_KEY:
            return _google_traffic_factor(origin, dest)
        return _osrm_traffic_factor(origin, dest)
    except Exception as e:
        print(f"[Traffic] Live traffic lookup failed ({e}), falling back to 0.2")
        return 0.2
