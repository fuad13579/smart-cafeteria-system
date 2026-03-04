# Demo Script (Judge Runbook)

## 1) Bring up stack
```bash
make up-all
make ps
./scripts/health-check.sh
```

Expected:
- All containers are `Up` and healthy.
- All core `/health` endpoints return `200`.

## 2) Student flow (end-to-end)
1. Open `http://localhost:3000/login`
2. Sign in as student:
- Student ID: `240041246`
- Password: `pass123`
3. Open `Menu`, add item to cart, place order.
4. Open tracking page and show live status progression:
- `QUEUED -> IN_PROGRESS -> READY`

## 3) Admin dashboard
1. Sign in as admin:
- Student ID: `admin-demo`
- Password: `admin-pass`
2. Open `http://localhost:3000/admin`
3. Show:
- Health grid (green/red per service)
- Metrics cards (p50, p95, throughput)
- Queue depth cards for `kitchen.jobs` and `order.status`

## 4) Rush simulation
Run from repo root:
```bash
python3 ./scripts/load-test-orders.py --rate 10 --duration 3 --concurrency 20
```

Show on `/admin`:
- Queue depth rises during burst
- Queue depth falls after workers drain

## 5) Chaos + recovery
On `/admin`:
1. Choose `stock-service` (or `kitchen-queue`)
2. Click `Run chaos`
3. Show service becomes unhealthy (red/down)
4. Click `Recover all services`
5. Show health recovers and order flow degrades gracefully/recovers

## 6) Final proof points
- Place one more order and show `READY` with pickup token UI.
- Mention deterministic DB init and green local checks (`smoke-test`, web lint/build, backend tests).
- Mention wallet/top-up flow is intentionally out of submission scope (Option 2).
