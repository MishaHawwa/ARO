"""
fetch_real_hospitals.py
------------------------
Pulls REAL hospitals/clinics for a given place from OpenStreetMap via the
free, keyless Overpass API, and prints them in the exact dict shape
app.py's `hospitals` list expects - so you can paste the output straight in.

This replaces the "not just mock" hospital data with actual named,
geolocated facilities. OSM won't know which ones have a cardiac ICU or a
neurologist on staff though - nobody publishes that live - so this script
fills those in as False/[] and prints a checklist for you (or your team)
to fill in by calling the hospitals or checking their websites. That's the
realistic path: real locations from open data, real capabilities from a
phone call, because no public API exposes live ICU/specialist status.

USAGE
    cd backend
    python fetch_real_hospitals.py "Bhatkal, Karnataka, India"

Requires internet access (Overpass API, api.openstreetmap.org mirror).
"""

import sys
import json
import time
import urllib.request
import urllib.parse

OVERPASS_URL = "https://overpass-api.de/api/interpreter"
NOMINATIM_URL = "https://nominatim.openstreetmap.org/search"


def geocode_place(place_name):
    """Turn a place name into a bounding box using Nominatim (free, keyless,
    but ask nicely: 1 request/sec, custom User-Agent required)."""
    params = urllib.parse.urlencode({"q": place_name, "format": "json", "limit": 1})
    req = urllib.request.Request(
        f"{NOMINATIM_URL}?{params}",
        headers={"User-Agent": "medilink-eta-project/1.0 (student project)"},
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        results = json.loads(resp.read())
    if not results:
        raise ValueError(f"Could not geocode '{place_name}'")
    r = results[0]
    return float(r["lat"]), float(r["lon"])


def fetch_hospitals(lat, lon, radius_m=15000):
    """Query Overpass for amenity=hospital / amenity=clinic within radius_m
    metres of (lat, lon)."""
    query = f"""
    [out:json][timeout:30];
    (
      node["amenity"="hospital"](around:{radius_m},{lat},{lon});
      way["amenity"="hospital"](around:{radius_m},{lat},{lon});
      node["amenity"="clinic"](around:{radius_m},{lat},{lon});
    );
    out center tags;
    """
    data = urllib.parse.urlencode({"data": query}).encode()
    req = urllib.request.Request(OVERPASS_URL, data=data,
                                  headers={"User-Agent": "medilink-eta-project/1.0"})
    with urllib.request.urlopen(req, timeout=40) as resp:
        result = json.loads(resp.read())
    return result.get("elements", [])


def to_app_format(elements):
    hospitals = []
    for i, el in enumerate(elements, start=1):
        tags = el.get("tags", {})
        name = tags.get("name")
        if not name:
            continue  # skip unnamed nodes, they're rarely useful here
        lat = el.get("lat") or el.get("center", {}).get("lat")
        lon = el.get("lon") or el.get("center", {}).get("lon")
        if lat is None or lon is None:
            continue
        hospitals.append({
            "id": i,
            "name": name,
            "location": {"lat": round(lat, 6), "lng": round(lon, 6)},
            "cardiac_icu": False,     # <- fill in for real after calling the hospital
            "neuro_icu": False,       # <- fill in for real
            "trauma_center": False,   # <- fill in for real
            "burn_unit": False,       # <- fill in for real
            "maternity_ward": "maternity" in tags.get("healthcare", ""),
            "beds_available": None,   # <- OSM doesn't have live bed counts; needs a
                                       #    real feed from the hospital/district health office
            "specialists": [],        # <- fill in for real
            "osm_type": el.get("type"),
            "osm_address": tags.get("addr:full") or tags.get("addr:street", ""),
        })
    return hospitals


def main():
    place = sys.argv[1] if len(sys.argv) > 1 else "Bhatkal, Karnataka, India"
    print(f"Geocoding '{place}'...")
    lat, lon = geocode_place(place)
    print(f"Center: {lat}, {lon}")

    time.sleep(1)  # be polite to Nominatim/Overpass rate limits
    print("Querying OpenStreetMap for hospitals/clinics nearby...")
    elements = fetch_hospitals(lat, lon)
    hospitals = to_app_format(elements)

    print(f"\nFound {len(hospitals)} named facilities.\n")
    print("hospitals = ", json.dumps(hospitals, indent=4))

    print(
        "\n--- NEXT STEP ---\n"
        "OSM gives real names/locations but not live ICU/specialist/bed data "
        "(no public API has that). For each hospital above, replace the "
        "False/[]/None placeholders with real answers - call the hospital, "
        "check the district health office's list, or use India's Ayushman "
        "Bharat (PM-JAY) empanelment registry (publicservicesmap.in) as a "
        "starting point for facility types. Then paste the corrected list "
        "into backend/app.py in place of the mock `hospitals` list."
    )


if __name__ == "__main__":
    main()
