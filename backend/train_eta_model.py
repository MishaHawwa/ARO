"""
train_eta_model.py
-------------------
Trains a Random Forest Regressor that predicts ambulance ETA (in minutes)
and saves it to backend/models/eta_model.pkl for app.py to load at runtime.

WHY SYNTHETIC DATA?
This project has no historical trip logs (no real GPS/dispatch records), so
there's nothing to train on yet. Standard practice in that situation is to
generate a synthetic dataset from a domain-informed simulator (distance,
traffic, time-of-day -> ETA, plus random noise for real-world variance),
train on that, and swap in real trip data later without changing any other
code -- only this script and eta_training_data.csv would need to change.

HOW TO RUN
    cd backend
    pip install -r requirements.txt
    python train_eta_model.py

This writes:
    backend/models/eta_model.pkl        <- the trained model (joblib)
    backend/eta_training_data.csv       <- the training data, for inspection
"""

import os
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

RANDOM_SEED = 42
N_SAMPLES = 6000

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "eta_model.pkl")
DATA_PATH = os.path.join(os.path.dirname(__file__), "eta_training_data.csv")


def simulate_trip(distance_km, traffic_factor, time_of_day, rng):
    """
    Domain-informed simulator standing in for real trip logs.
    Produces a *plausible* ETA (minutes) for an ambulance trip in a small
    coastal town (Bhatkal), given:
      - distance_km:     straight-line/road distance to travel
      - traffic_factor:  0 (empty roads) .. 1 (heavy/market/festival traffic)
      - time_of_day:     0 (quiet night) .. 1 (peak school/office hours)
    """
    # Effective speed drops as traffic/time-of-day pressure rises.
    base_speed_kmh = 55 - (traffic_factor * 22) - (time_of_day * 12)
    base_speed_kmh = max(base_speed_kmh, 14)  # roads never fully gridlock

    travel_time = (distance_km / base_speed_kmh) * 60  # minutes

    # Fixed dispatch/prep overhead (getting the crew moving).
    dispatch_overhead = rng.normal(1.2, 0.4)

    # Real-world variance: potholes, level crossings, weather, driver, etc.
    road_noise = rng.normal(0, 1.0 + distance_km * 0.05)

    # Occasional longer delays (railway crossing, roadblock, breakdown).
    if rng.random() < 0.05:
        road_noise += rng.uniform(3, 8)

    eta = travel_time + dispatch_overhead + road_noise
    return max(eta, 1.0)


def build_dataset(n_samples=N_SAMPLES, seed=RANDOM_SEED):
    rng = np.random.default_rng(seed)

    distance_km = rng.uniform(0.2, 40, n_samples)
    traffic_factor = rng.uniform(0, 0.8, n_samples)
    time_of_day = rng.uniform(0, 0.8, n_samples)

    eta = np.array([
        simulate_trip(d, t, h, rng)
        for d, t, h in zip(distance_km, traffic_factor, time_of_day)
    ])

    df = pd.DataFrame({
        "distance_km": distance_km,
        "traffic_factor": traffic_factor,
        "time_of_day": time_of_day,
        "eta_minutes": eta,
    })
    return df


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)

    print(f"Generating {N_SAMPLES} synthetic training samples...")
    df = build_dataset()
    df.to_csv(DATA_PATH, index=False)
    print(f"Saved training data -> {DATA_PATH}")

    X = df[["distance_km", "traffic_factor", "time_of_day"]]
    y = df["eta_minutes"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=RANDOM_SEED
    )

    model = RandomForestRegressor(
        n_estimators=200,
        max_depth=12,
        min_samples_leaf=3,
        random_state=RANDOM_SEED,
        n_jobs=-1,
    )

    print("Training RandomForestRegressor...")
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    mae = mean_absolute_error(y_test, preds)
    r2 = r2_score(y_test, preds)
    print(f"Test MAE : {mae:.2f} minutes")
    print(f"Test R^2 : {r2:.3f}")

    importances = dict(zip(X.columns, model.feature_importances_))
    print("Feature importances:", importances)

    joblib.dump(model, MODEL_PATH)
    print(f"Saved trained model -> {MODEL_PATH}")


if __name__ == "__main__":
    main()
