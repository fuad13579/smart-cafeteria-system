# Smart Cafeteria Deploy Checklist

Domain (example): `api.103.182.213.241.nip.io`

## 1) Push Latest Code

```bash
cd /root/smart-cafeteria-system
git status
git add -A
git commit -m "Prepare deployment"   # skip if no changes
git push origin main
```

## 2) Pull + Build Services on VPS

```bash
cd /root/smart-cafeteria-system
git pull origin main
docker compose -f infra/docker-compose.yml up -d --build
docker compose -f infra/docker-compose.yml ps
```

## 3) Verify Reverse Proxy (Caddy)

`/etc/caddy/Caddyfile` should contain:

```caddyfile
iut-smart-cafeteria.linkpc.net {
  reverse_proxy /admin/* 127.0.0.1:8000
  reverse_proxy /api/* 127.0.0.1:8000
  reverse_proxy /ws* 127.0.0.1:8005
}
```

Reload Caddy:

```bash
sudo caddy validate --config /etc/caddy/Caddyfile
sudo systemctl reload caddy
```

## 4) Verify Public Endpoints

```bash
curl -s https://iut-smart-cafeteria.linkpc.net/admin/health
curl -s https://iut-smart-cafeteria.linkpc.net/admin/metrics
curl -s https://iut-smart-cafeteria.linkpc.net/api/menu
```

Expected:
- `/admin/health` returns service status JSON.
- `/admin/metrics` returns latency/orders/queue JSON.
- `/api/menu` returns menu payload.

## 5) Frontend Runtime Env

Important:
- `apps/web/.env.example` is ignored in this repo, so teammates must copy envs manually.
- Current frontend deployment mode is `mock` unless you explicitly switch to `real`.

### A) Frontend-only deploy (recommended for now, mock mode)

Web (`apps/web/.env.local`):

```env
NEXT_PUBLIC_API_MODE=mock
NEXT_PUBLIC_API_BASE_URL=http://localhost:8002
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_API_MOCK_SCENARIO=success
NEXT_PUBLIC_API_MOCK_DELAY_MS=350
NEXT_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
```

Mobile (`apps/mobile/.env`):

```env
EXPO_PUBLIC_API_MODE=mock
EXPO_PUBLIC_API_BASE_URL=http://localhost:8002
EXPO_PUBLIC_API_PREFIX=/api
EXPO_PUBLIC_API_MOCK_SCENARIO=success
EXPO_PUBLIC_API_MOCK_DELAY_MS=350
EXPO_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
```

### B) Full-stack deploy (real backend mode)

Web (`apps/web/.env.local`):

```env
NEXT_PUBLIC_API_MODE=real
NEXT_PUBLIC_API_BASE_URL=https://api.103.182.213.241.nip.io
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_NOTIFICATION_WS_URL=wss://api.103.182.213.241.nip.io/ws
```

Mobile (`apps/mobile/.env`):

```env
EXPO_PUBLIC_API_MODE=real
EXPO_PUBLIC_API_BASE_URL=https://api.103.182.213.241.nip.io
EXPO_PUBLIC_API_PREFIX=/api
EXPO_PUBLIC_NOTIFICATION_WS_URL=wss://api.103.182.213.241.nip.io/ws
```

Restart apps after env changes.

## 6) Manual Smoke Test (Judge Flow)

1. Login as student.
2. Open menu and add item to cart.
3. Place order.
4. Confirm token/status appears on order tracking.
5. Confirm wallet/account balance deduction after payment success.
6. Login as admin and open dashboard.
7. Confirm health + metrics load.
8. In kitchen/admin flow, set `READY`, `Extend Pickup`, and `Complete`.

## 7) Quick Failure Recovery Commands

Restart full stack:

```bash
docker compose -f infra/docker-compose.yml down
docker compose -f infra/docker-compose.yml up -d --build
```

View logs:

```bash
docker compose -f infra/docker-compose.yml logs --tail=200 order-gateway
docker compose -f infra/docker-compose.yml logs --tail=200 kitchen-queue
docker compose -f infra/docker-compose.yml logs --tail=200 notification-hub
```

## 8) Final Gate

Deploy is ready when all are true:
- `docker compose up -d --build` succeeds on fresh pull.
- `/admin/health` and `/admin/metrics` work on API domain.
- Login -> order -> tracking -> kitchen flow works.
- Web/mobile hit the intended API base URL for selected mode (`mock` or `real`).
