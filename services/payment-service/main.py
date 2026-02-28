from fastapi import FastAPI

app = FastAPI()
metrics = {
    "health_checks_total": 0,
}


@app.get("/health")
def health():
    metrics["health_checks_total"] += 1
    return {"status": "ok"}


@app.get("/metrics")
def get_metrics():
    return metrics
