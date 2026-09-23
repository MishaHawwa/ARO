"""
train_eta_model_kaggle.py
--------------------------
Trains the ETA model on REAL trip data instead of the synthetic simulator
in train_eta_model.py.

WHICH DATASET, AND WHY
There is no public Kaggle dataset of ambulance dispatch logs (that data is
operational and hospitals/EMS providers don't publish it). The standard
substitute researchers use for exactly this problem - distance + time
features -> real-world vehicle travel time - is Kaggle's
"New York City Taxi Trip Duration" competition dataset:
    https://www.kaggle.com/c/nyc-taxi-trip-duration/data
It has pickup/dropoff GPS coordinates, a pickup timestamp, and the actual
measured trip duration for 1.45M+ real city trips - i.e. real traffic,
real road network, real time-of-day effects. That's the same prediction
problem your ETA model needs to learn, just for taxis instead of
ambulances. Academic work on ambulance ETA prediction (e.g. Mould-Millman
et al., "Ambulance Emergency Response Optimization in Developing
Countries") explicitly uses regular-vehicle travel-time data as a stand-in
for exactly this reason - your ambulance mostly obeys the same road
network as everyone else, it just gets a speed boost, which we apply
below as a multiplier once the base model is trained.

STEP 1 - GET THE DATA (one-time)
    pip install kaggle
    # Get an API token: kaggle.com -> Account -> "Create New API Token"
    # This downloads kaggle.json - put it at ~/.kaggle/kaggle.json (chmod 600)
    kaggle competitions download -c nyc-taxi-trip-duration
    unzip nyc-taxi-trip-duration.zip -d nyc_taxi_data
    # You should now have backend/nyc_taxi_data/train.csv

STEP 2 - TRAIN
    cd backend
    python train_eta_model_kaggle.py

This writes backend/models/eta_model.pkl - the same path app.py already
loads from, so no other code changes are needed once this has run.

ADAPTING THIS TO YOUR OWN CITY
Swap DATA_PATH for real trip logs of your own once you have them (from
your ambulance fleet's GPS/dispatch system, a ride-hailing partner, or a
city open-data portal) - the column names below are the only thing you'd
need to change; the feature engineering and training code stays the same.
"""

import os
import sys
import numpy as np
import pandas as pd
from sklearn.ensemble import RandomForestRegressor
from sklearn.model_selection import train_test_split
from sklearn.metrics import mean_absolute_error, r2_score
import joblib

MODEL_DIR = os.path.join(os.path.dirname(__file__), "models")
MODEL_PATH = os.path.join(MODEL_DIR, "eta_model.pkl")
DATA_PATH = os.path.join(os.path.dirname(__file__), "nyc_taxi_data", "train.csv")

# Ambulances with lights/sirens move faster than average city traffic.
# There's no universal multiplier - EMS studies vary roughly 1.2x-1.5x
# depending on city congestion - so this is a starting assumption to tune
# once you have even a handful of real ambulance timestamps to compare
# against. See the AMBULANCE_SPEED_MULTIPLIER note printed at the end.
AMBULANCE_SPEED_MULTIPLIER = 1.3


def haversine_km(lat1, lon1, lat2, lon2):
    R = 6371.0
    lat1, lon1, lat2, lon2 = map(np.radians, [lat1, lon1, lat2, lon2])
    dlat = lat2 - lat1
    dlon = lon2 - lon1
    a = np.sin(dlat / 2) ** 2 + np.cos(lat1) * np.cos(lat2) * np.sin(dlon / 2) ** 2
    return 2 * R * np.arcsin(np.sqrt(a))


def load_and_engineer_features(path, sample_size=300_000):
    if not os.path.exists(path):
        sys.exit(
            f"Couldn't find {path}.\n"
            f"Download it first - see the STEP 1 instructions at the top "
            f"of this file."
        )

    print(f"Loading {path} ...")
    df = pd.read_csv(path)

    # The full file is 1.45M rows - sample down for a quick, reproducible
    # training run on a laptop. Remove this for a final production model.
    if len(df) > sample_size:
        df = df.sample(sample_size, random_state=42)

    df["pickup_datetime"] = pd.to_datetime(df["pickup_datetime"])
    df["distance_km"] = haversine_km(
        df["pickup_latitude"], df["pickup_longitude"],
        df["dropoff_latitude"], df["dropoff_longitude"],
    )
    df["hour"] = df["pickup_datetime"].dt.hour
    df["weekday"] = df["pickup_datetime"].dt.weekday
    # time_of_day: 0 = quiet night, 1 = peak rush hour - matches the
    # 0-1 scale predict_eta() already uses.
    df["time_of_day"] = df["hour"].apply(
        lambda h: 0.8 if h in (7, 8, 9, 17, 18, 19) else (0.4 if 10 <= h <= 16 else 0.1)
    )
    # traffic_factor derived from weekday rush-hour overlap; a real
    # deployment should use traffic.py's live API instead - this column
    # exists so the model learns the *shape* of the traffic_factor -> ETA
    # relationship from real data, even though this training set has no
    # live traffic feed of its own.
    df["traffic_factor"] = np.where(
        (df["weekday"] < 5) & (df["time_of_day"] > 0.5), 0.6, 0.2
    )

    df["trip_duration_min"] = df["trip_duration"] / 60.0

    # Clean obviously bad rows (GPS glitches, 0-distance trips, multi-hour
    # outliers) - standard practice on this dataset.
    df = df[
        (df["distance_km"] > 0.2) & (df["distance_km"] < 40) &
        (df["trip_duration_min"] > 1) & (df["trip_duration_min"] < 90)
    ]

    # Convert taxi time -> ambulance-equivalent time for the label, since
    # that's what we actually want the model to predict.
    df["eta_minutes"] = df["trip_duration_min"] / AMBULANCE_SPEED_MULTIPLIER

    return df[["distance_km", "traffic_factor", "time_of_day", "eta_minutes"]]


def main():
    os.makedirs(MODEL_DIR, exist_ok=True)
    df = load_and_engineer_features(DATA_PATH)
    print(f"Training on {len(df)} real trips after cleaning.")

    X = df[["distance_km", "traffic_factor", "time_of_day"]]
    y = df["eta_minutes"]

    X_train, X_test, y_train, y_test = train_test_split(
        X, y, test_size=0.2, random_state=42
    )

    model = RandomForestRegressor(
        n_estimators=200, max_depth=14, min_samples_leaf=5,
        random_state=42, n_jobs=-1,
    )
    print("Training RandomForestRegressor on real trip data...")
    model.fit(X_train, y_train)

    preds = model.predict(X_test)
    print(f"Test MAE : {mean_absolute_error(y_test, preds):.2f} minutes")
    print(f"Test R^2 : {r2_score(y_test, preds):.3f}")

    joblib.dump(model, MODEL_PATH)
    print(f"Saved trained model -> {MODEL_PATH}")
    print(
        f"\nNote: eta_minutes = taxi_duration / {AMBULANCE_SPEED_MULTIPLIER} "
        f"(an assumed ambulance speed boost). Once you log even a few dozen "
        f"real ambulance run times, compare them to this model's raw "
        f"prediction and adjust AMBULANCE_SPEED_MULTIPLIER at the top of "
        f"this file, then retrain."
    )


if __name__ == "__main__":
    main()
