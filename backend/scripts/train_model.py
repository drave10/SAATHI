"""Train the EXPERIMENTAL ML advisory on synthetic data.  Usage (from backend/):  python -m scripts.train_model"""
import argparse
import json

from app.engine import ml


def main():
    p = argparse.ArgumentParser()
    p.add_argument("--samples", type=int, default=6000)
    p.add_argument("--seed", type=int, default=42)
    a = p.parse_args()
    metrics = ml.train(a.samples, a.seed)
    print(json.dumps(metrics, indent=2))
    print(f"\nSaved model to {ml.MODEL_PATH}\nSaved metrics to {ml.METRICS_PATH}")


if __name__ == "__main__":
    main()
