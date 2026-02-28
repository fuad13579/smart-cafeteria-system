# Backend Integration Handoff (No DB Changes)

Branch: `mango-backend-integration`

## Scope

Only service code, compose wiring, and web dependency alignment were changed.
No files under `database/` were changed.

## Files changed in this pass

- `services/payment-service/main.py`
- `services/payment-service/requirements.txt`
- `services/order-gateway/main.py`
- `infra/docker-compose.yml`
- `apps/web/package.json`
- `apps/web/package-lock.json`

## What was implemented

### Payment Service

`payment-service` is now a real service (not just `/health`):
- `POST /payments/charge`
  - idempotent by `order_id` via Redis key `payment:{order_id}`
  - returns same `transaction_id` on retries
- `GET /payments/{order_id}`
- `GET /health`
- `GET /metrics`
- `POST /chaos/fail`

### Order Gateway Integration

`order-gateway` now:
- calls `stock-service` reserve first
- calls `payment-service` charge before DB insert
- rolls back stock reservation (`/stock/release`) if payment fails
- includes payment dependency in `/health`

### Compose Wiring

- `order-gateway` now depends on healthy `payment-service` in `infra/docker-compose.yml`.

### Web CI Fix

Aligned incompatible web dependencies:
- `apps/web/package.json`: `eslint-config-next` changed from `^12.0.4` to `^16.1.6` (matching `next@16.1.6`)
- regenerated `apps/web/package-lock.json`

## Run locally

```powershell
cd C:\Users\mango\Codes\smart-cafeteria-system
docker compose -f .\infra\docker-compose.yml up -d --build
```

## Quick health checks

```powershell
curl.exe -s http://localhost:8001/health   # identity-provider
curl.exe -s http://localhost:8002/health   # order-gateway
curl.exe -s http://localhost:8003/health   # stock-service
curl.exe -s http://localhost:8004/health   # kitchen-queue
curl.exe -s http://localhost:8005/health   # notification-hub
curl.exe -s http://localhost:8006/health   # payment-service
```

## End-to-end test (PowerShell)

```powershell
# 1) Login via gateway
$good = @{ student_id = "2100001"; password = "demo-pass" } | ConvertTo-Json -Compress
$login = Invoke-RestMethod -Method Post -Uri "http://localhost:8002/api/login" -ContentType "application/json" -Body $good
$token = $login.access_token

# 2) Place order
$orderBody = @{ items = @(@{ id = "2"; qty = 1 }) } | ConvertTo-Json -Compress
$order = Invoke-RestMethod -Method Post -Uri "http://localhost:8002/api/orders" -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -Body $orderBody
$order

# 3) Verify payment record exists
Invoke-RestMethod -Method Get -Uri ("http://localhost:8006/payments/" + $order.order_id)

# 4) Poll order status
for ($i = 0; $i -lt 8; $i++) {
  Start-Sleep -Seconds 2
  Invoke-RestMethod -Method Get -Uri ("http://localhost:8002/api/orders/" + $order.order_id) -Headers @{ Authorization = "Bearer $token" }
}
```

## Chaos rollback test (payment failure should not consume stock)

```powershell
Invoke-RestMethod -Method Post -Uri "http://localhost:8006/chaos/fail" -ContentType "application/json" -Body '{"enabled":true,"mode":"error"}'

# Attempt order (expected 503)
$orderBody = @{ items = @(@{ id = "4"; qty = 1 }) } | ConvertTo-Json -Compress
try {
  Invoke-WebRequest -Method Post -Uri "http://localhost:8002/api/orders" -ContentType "application/json" -Headers @{ Authorization = "Bearer $token" } -Body $orderBody -ErrorAction Stop | Out-Null
} catch {
  $_.Exception.Response.StatusCode.value__
}

Invoke-RestMethod -Method Post -Uri "http://localhost:8006/chaos/fail" -ContentType "application/json" -Body '{"enabled":false,"mode":"error"}'

# Check availability still true for item id 4
Invoke-RestMethod -Method Get -Uri "http://localhost:8002/api/menu"
```

## Web CI parity check (optional local)

```powershell
docker run --rm -v "C:\Users\mango\Codes\smart-cafeteria-system\apps\web:/app" -w /app node:20 sh -lc "npm ci && npm run lint && npm run build"
```

## Push branch

```powershell
cd C:\Users\mango\Codes\smart-cafeteria-system
git add services/payment-service services/order-gateway infra/docker-compose.yml apps/web/package.json apps/web/package-lock.json docs/backend-integration-handoff.md
git commit -m "Add payment service integration and fix web dependency alignment"
git push
```
