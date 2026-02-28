# Backend Integration Handoff (No DB Changes)

Branch: `mango-backend-integration`

## What was changed

Only service logic and service dependencies were changed:
- `services/order-gateway/main.py`
- `services/order-gateway/requirements.txt`
- `services/stock-service/main.py`
- `services/stock-service/requirements.txt`
- `services/kitchen-queue/main.py`
- `services/kitchen-queue/requirements.txt`
- `services/notification-hub/main.py`
- `services/notification-hub/requirements.txt`

## What was NOT changed

No changes under `database/`.

## New/updated backend behavior

- Order gateway now:
  - keeps existing `/api/login`, `/api/menu`, `/api/orders`
  - reserves stock via `stock-service`
  - publishes kitchen job to RabbitMQ queue `kitchen.jobs`
  - exposes `/metrics` and `/chaos/fail`
- Stock service now provides:
  - `GET /stock/{item_id}`
  - `POST /stock/reserve`
  - `POST /stock/release`
  - `/metrics`, `/chaos/fail`
- Kitchen queue now:
  - consumes `kitchen.jobs`
  - updates order status `QUEUED -> IN_PROGRESS -> READY`
  - publishes status events to queue `order.status`
  - exposes `/metrics`, `/chaos/fail`
- Notification hub now:
  - validates token from existing `auth_tokens` table
  - websocket endpoint `GET /ws?token=...`
  - consumes `order.status` and pushes live events
  - exposes `/metrics`, `/chaos/fail`

## Local run

```powershell
cd C:\Users\mango\Codes\smart-cafeteria-system
docker compose -f .\infra\docker-compose.yml up --build -d
```

If Docker daemon is down, start Docker Desktop first.

## Push this branch

```powershell
cd C:\Users\mango\Codes\smart-cafeteria-system
git add services/order-gateway services/stock-service services/kitchen-queue services/notification-hub docs/backend-integration-handoff.md
git commit -m "Implement backend service integration without DB schema changes"
git push -u origin mango-backend-integration
```

Then open a PR from `mango-backend-integration` to `main`.
