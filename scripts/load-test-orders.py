#!/usr/bin/env python3
import argparse
import json
import statistics
import threading
import time
import urllib.error
import urllib.request
import uuid
from concurrent.futures import ThreadPoolExecutor, as_completed


def _request_json(method: str, url: str, payload: dict | None = None, token: str | None = None) -> tuple[int, dict]:
    body = None
    headers = {"Content-Type": "application/json"}
    if payload is not None:
        body = json.dumps(payload).encode("utf-8")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    req = urllib.request.Request(url=url, method=method, data=body, headers=headers)
    try:
        with urllib.request.urlopen(req, timeout=8) as resp:
            raw = resp.read().decode("utf-8")
            return resp.status, json.loads(raw) if raw else {}
    except urllib.error.HTTPError as exc:
        raw = exc.read().decode("utf-8") if exc.fp else ""
        try:
            parsed = json.loads(raw) if raw else {}
        except Exception:
            parsed = {"raw": raw}
        return exc.code, parsed


def percentile(values: list[float], pct: float) -> float:
    if not values:
        return 0.0
    seq = sorted(values)
    idx = round((pct / 100.0) * (len(seq) - 1))
    idx = max(0, min(len(seq) - 1, idx))
    return seq[idx]


def main() -> int:
    parser = argparse.ArgumentParser(description="Quick load test for order creation.")
    parser.add_argument("--base-url", default="http://localhost:8002", help="Gateway base URL.")
    parser.add_argument("--student-id", default="240041246", help="Student ID for login.")
    parser.add_argument("--password", default="pass123", help="Password for login.")
    parser.add_argument("--rate", type=int, default=10, help="Target requests/sec.")
    parser.add_argument("--duration", type=int, default=3, help="Duration in seconds.")
    parser.add_argument("--concurrency", type=int, default=20, help="Worker concurrency.")
    args = parser.parse_args()

    if args.rate <= 0 or args.duration <= 0 or args.concurrency <= 0:
        print("rate, duration, and concurrency must be > 0")
        return 2

    login_status, login_data = _request_json(
        "POST",
        f"{args.base_url.rstrip('/')}/api/login",
        {"student_id": args.student_id, "password": args.password},
    )
    if login_status != 200 or "access_token" not in login_data:
        print(f"Login failed ({login_status}): {login_data}")
        return 1
    token = str(login_data["access_token"])

    menu_status, menu_data = _request_json("GET", f"{args.base_url.rstrip('/')}/api/menu", token=token)
    if menu_status != 200:
        print(f"Menu request failed ({menu_status}): {menu_data}")
        return 1

    items = menu_data.get("items", [])
    available = [item for item in items if item.get("available")]
    if not available:
        print("No available menu items found.")
        return 1
    item_id = str(available[0]["id"])

    total_requests = args.rate * args.duration
    lock = threading.Lock()
    success = 0
    failures = 0
    latencies_ms: list[float] = []

    start = time.perf_counter()

    def fire_one(i: int) -> None:
        nonlocal success, failures
        t0 = time.perf_counter()
        key = f"lt-{int(time.time() * 1000)}-{i}-{uuid.uuid4().hex[:8]}"
        req = urllib.request.Request(
            url=f"{args.base_url.rstrip('/')}/api/orders",
            method="POST",
            data=json.dumps({"items": [{"id": item_id, "qty": 1}]}).encode("utf-8"),
            headers={
                "Content-Type": "application/json",
                "Authorization": f"Bearer {token}",
                "Idempotency-Key": key,
            },
        )
        code = 0
        try:
            with urllib.request.urlopen(req, timeout=8) as resp:
                code = resp.status
        except urllib.error.HTTPError as exc:
            code = exc.code
        except Exception:
            code = 0
        elapsed = (time.perf_counter() - t0) * 1000.0
        with lock:
            latencies_ms.append(elapsed)
            if code == 200:
                success += 1
            else:
                failures += 1

    with ThreadPoolExecutor(max_workers=args.concurrency) as pool:
        futures = []
        for i in range(total_requests):
            target = start + (i / args.rate)
            sleep_for = target - time.perf_counter()
            if sleep_for > 0:
                time.sleep(sleep_for)
            futures.append(pool.submit(fire_one, i))
        for future in as_completed(futures):
            future.result()

    elapsed_total = max(time.perf_counter() - start, 0.001)
    achieved_rps = (success + failures) / elapsed_total
    success_rate = (success / (success + failures)) * 100.0 if (success + failures) else 0.0
    p50 = percentile(latencies_ms, 50)
    p95 = percentile(latencies_ms, 95)
    avg = statistics.mean(latencies_ms) if latencies_ms else 0.0

    print("Load test summary")
    print(f"- target_rate_rps: {args.rate}")
    print(f"- duration_sec: {args.duration}")
    print(f"- total_requests: {total_requests}")
    print(f"- success: {success}")
    print(f"- failures: {failures}")
    print(f"- success_rate_pct: {success_rate:.2f}")
    print(f"- achieved_rps: {achieved_rps:.2f}")
    print(f"- latency_ms_avg: {avg:.2f}")
    print(f"- latency_ms_p50: {p50:.2f}")
    print(f"- latency_ms_p95: {p95:.2f}")

    # Treat this as a target check, not a strict benchmark.
    if achieved_rps < (args.rate * 0.8):
        print("Result: FAIL (achieved throughput below 80% of target)")
        return 1
    print("Result: PASS")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
