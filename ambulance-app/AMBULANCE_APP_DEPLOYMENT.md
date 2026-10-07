# Ambulance Driver App - Deployment Guide

This is a modern React Progressive Web App (PWA) designed to be used by ambulance drivers on their mobile devices. 

## 1. Local Testing
To test the app on your local machine:
1. Make sure your Python backend is running (`start-backend.bat`).
2. Inside the `ambulance-app` folder, run:
   ```bash
   npm run dev
   ```
3. Open `http://localhost:5173` in your browser.

## 2. Deploying to the Web (Vercel)
Vercel is the easiest way to host this app for free.
1. Create a GitHub repository and push the `ambulance-app` code to it.
2. Go to [Vercel.com](https://vercel.com) and click **Add New Project**.
3. Import your GitHub repository.
4. Set the **Framework Preset** to `Vite`.
5. Set the Environment Variable:
   - `VITE_API_BASE_URL` = `https://aro-backend-tvkq.onrender.com` (Your Render Backend URL)
6. Click **Deploy**.

## 3. Installing as a Mobile App (PWA)
Once deployed on Vercel, drivers can install it directly onto their phone's home screen without going through the App Store!
1. The driver opens the Vercel link in Safari (iPhone) or Chrome (Android).
2. Tap the **Share** button (iOS) or **Menu** (Android).
3. Select **"Add to Home Screen"**.
4. The app will now appear on their home screen like a native app and can be opened in full-screen mode!

*(Alternatively, you can package this using CapacitorJS exactly like we did for the main emergency citizen app if you want to put it on the Google Play Store).*
