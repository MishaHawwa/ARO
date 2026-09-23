# Setup Guide — Chatbot, Hospital Scoring, Ambulance App, Real Data, Mobile

This covers everything added on top of the original project: the voice
chatbot, hospital scoreboard, ambulance driver app, real-traffic/real-hospital
data, Kaggle-based training, and turning this into a phone app.

---

## 1. Run what's already wired up

```bash
cd backend
pip install -r requirements.txt
python app.py            # http://localhost:5000

# in another terminal
cd ..
npm start                 # http://localhost:3000
```

- Citizen app: `http://localhost:3000`
- Ambulance driver app: `http://localhost:3000/ambulance?id=KA-19-EM-001`
  (open this on a second browser tab/window to see live notifications
  when you trigger an emergency on the citizen app)

Trigger any emergency on the citizen dashboard, scroll down on the tracking
screen to see the **Hospital Scoring System**, and tap the 🎙️ button
bottom-right for the **chatbot**. Watch the ambulance tab light up with a
job the instant it's assigned.

---

## 2. Turn on the chatbot (Claude API)

The chatbot works without setup (browser mic/speaker), but replies are
placeholder text until you set an API key:

```bash
export ANTHROPIC_API_KEY=sk-ant-...   # from console.anthropic.com/settings/keys
python app.py
```

Voice input needs Chrome, Edge, or Android Chrome (the Web Speech API isn't
fully supported on iOS Safari — voice *output* still works there, typing
still works everywhere).

---

## 3. Turn on live traffic

```bash
export GOOGLE_MAPS_API_KEY=AIza...    # Distance Matrix API, from console.cloud.google.com
python app.py
```

Without this key, `traffic.py` falls back to a neutral placeholder so the
app still runs — see the comments in that file for an OSRM-based
alternative if you'd rather avoid Google's billing.

---

## 4. Turn on the ambulance phone-call fallback (optional)

Only needed if you want a real phone call to fire when a driver doesn't
tap Accept within 25 seconds:

```bash
export TWILIO_ACCOUNT_SID=AC...
export TWILIO_AUTH_TOKEN=...
export TWILIO_FROM_NUMBER=+1...
```

Get these from a free Twilio trial account. Without them, the fallback
just logs to the console instead of calling — nothing breaks.

---

## 5. Replace mock hospitals with real ones

```bash
cd backend
python fetch_real_hospitals.py "Bhatkal, Karnataka, India"
```

This pulls real hospital names + GPS coordinates from OpenStreetMap (free,
no API key). It **cannot** fill in ICU/specialist/bed data — no public API
publishes that live — so it prints placeholders for you to fill in by
phone or from India's Ayushman Bharat (PM-JAY) empanelment registry
(publicservicesmap.in), then you paste the corrected list into `app.py`
in place of the mock `hospitals` list.

Requires internet access to `overpass-api.de` and `nominatim.openstreetmap.org`.

---

## 6. Train on real-world data (Kaggle)

There's no public "ambulance response time" dataset on Kaggle — that data
is operational and EMS providers don't publish it. The standard
real-world substitute for this exact problem (distance + time-of-day →
real vehicle travel time) is Kaggle's **NYC Taxi Trip Duration** dataset —
it's what academic ambulance-ETA papers use for the same reason.

```bash
pip install kaggle
# Kaggle.com -> Account -> "Create New API Token" -> downloads kaggle.json
mkdir -p ~/.kaggle && mv kaggle.json ~/.kaggle/ && chmod 600 ~/.kaggle/kaggle.json

kaggle competitions download -c nyc-taxi-trip-duration
unzip nyc-taxi-trip-duration.zip -d backend/nyc_taxi_data

cd backend
python train_eta_model_kaggle.py
```

This overwrites `backend/models/eta_model.pkl` with a model trained on
~300k real trips (real GPS, real durations, real traffic patterns),
scaled by an assumed ambulance speed multiplier (tune this once you have
even a handful of real ambulance run times to compare against — see the
comment at the top of `train_eta_model_kaggle.py`).

To go further: once your own ambulance fleet has GPS/dispatch logs, swap
`DATA_PATH` in that script for your real logs — the column names are the
only thing that changes.

---

## 7. Ship it as a phone app

The project currently has a **React web app** (this `src/` folder, what
`npm start` runs) — not React Native, despite the original README's
recommendation. The fastest path from here to an installable phone app,
without a rewrite, is **Capacitor** (wraps your existing web build in a
native shell, gives you real push notifications, GPS, vibration, etc.):

```bash
npm install @capacitor/core @capacitor/cli
npx cap init "Emergency Response" "com.yourteam.emergency"

npm run build                 # produces build/
npx cap add android           # and/or: npx cap add ios (needs a Mac + Xcode)

# point Capacitor at your CRA build output
# in capacitor.config.json set: "webDir": "build"

npx cap sync
npx cap open android          # opens Android Studio - Run ▶ on an emulator/device
```

A few things to change before this is production-ready as a phone app:

- **Point the app at your real backend URL**, not `localhost:5000` — a
  phone can't reach your laptop's localhost. Deploy `backend/app.py`
  somewhere reachable (Render, Railway, a VPS) and swap every
  `http://localhost:5000` in `src/` for that URL (put it in one config
  constant, e.g. `src/config.js`, and import it everywhere instead of
  hardcoding).
- **Background location** for the citizen and driver apps needs a native
  plugin (`@capacitor/geolocation`) instead of the browser
  `navigator.geolocation` call in `App.js` — the browser API stops once
  the app isn't in the foreground.
- **Push notifications** for the ambulance driver app: swap the
  Socket.IO-only approach for `@capacitor/push-notifications` (via
  Firebase Cloud Messaging) so a driver gets notified even with the app
  closed — Socket.IO alone only works while the app is open and connected.

If you'd rather have a "real" native app from the start (deeper GPS/background
support, smaller footprint) instead of wrapping the web app, a React Native
(Expo) rewrite of `Dashboard.js` / `LoadingScreen.js` / `TrackingScreen.js` /
`AmbulanceApp.js` is the alternative — more work upfront, matches the
original README's recommendation, and reuses the same backend untouched.

---

## Files added/changed in this pass

```
backend/
  app.py                       - scoreboard, chat, ambulance endpoints, live traffic hook
  traffic.py                   - real-time traffic factor (Google Distance Matrix / OSRM)
  fetch_real_hospitals.py      - pulls real hospitals from OpenStreetMap
  train_eta_model.py           - (from before) synthetic-data training
  train_eta_model_kaggle.py    - real-world (Kaggle NYC taxi) training
  requirements.txt             - + anthropic, twilio

src/
  App.js                       - routes "/ambulance" to the driver app
  components/
    HospitalScoreboard.js/.css - hospital scoring UI
    EmergencyChatbot.js/.css   - voice-enabled chatbot widget
    AmbulanceApp.js/.css       - ambulance driver screen
    TrackingScreen.js          - wires in the scoreboard + chatbot
```
