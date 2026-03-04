# API Contract (Frozen for Integration)

Base URL (gateway): `http://localhost:8002`

## Auth
### POST `/api/login`
Request:
```json
{
  "student_id": "2100001",
  "password": "demo-pass"
}
```
Success `200`:
```json
{
  "access_token": "string",
  "user": {
    "id": "2100001",
    "student_id": "2100001",
    "name": "Ayesha Rahman"
  }
}
```
Failure:
- `401`: `{ "message": "Invalid student ID or password", "error": "Unauthorized" }`
- `5xx`: `{ "message": "...", "error": "Service Unavailable" }`

## Menu
### GET `/api/menu?context=auto|regular|iftar|saheri`
Headers:
- `Authorization: Bearer <access_token>` (recommended; backend may keep public read for demo)
- Optional (dev/demo): `X-Debug-Time: 2026-03-10T18:20:00+06:00`

Success `200`:
```json
{
  "active_context": "regular|iftar|saheri",
  "next_change_at": "2026-03-10T18:45:00+06:00",
  "items": [
    {
      "id": "1",
      "name": "Platter 1 (Khichuri + Chicken + Pickle)",
      "price": 220,
      "available": true
    }
  ]
}
```
Notes:
- `context=auto` resolves by server time (`Asia/Dhaka`) and returns `active_context`.
- `context=regular|iftar|saheri` forces that menu context.

Failure:
- `401`: `{ "message": "Unauthorized", "error": "Unauthorized" }`

## Orders
### POST `/api/orders`
Headers:
- `Authorization: Bearer <access_token>`

Request:
```json
{
  "items": [
    { "id": "1", "qty": 1 },
    { "id": "4", "qty": 2 }
  ]
}
```
Success `200`:
```json
{
  "order_id": "uuid-or-string",
  "status": "QUEUED",
  "eta_minutes": 12
}
```
Failure:
- `400`: `{ "message": "Item X not found|unavailable|invalid", "error": "Bad Request" }`
- `401`: `{ "message": "Unauthorized", "error": "Unauthorized" }`

### GET `/api/orders/{id}`
Headers:
- `Authorization: Bearer <access_token>`

Success `200`:
```json
{
  "order_id": "uuid-or-string",
  "status": "QUEUED|IN_PROGRESS|READY|COMPLETED|CANCELLED",
  "eta_minutes": 10,
  "items": [
    { "id": "1", "name": "Chicken Burger", "qty": 1, "unit_price": 120 }
  ],
  "total_amount": 120,
  "created_at": "2026-02-28T10:00:00Z"
}
```
Failure:
- `404`: `{ "message": "Order not found", "error": "Not Found" }`
- `401`: `{ "message": "Unauthorized", "error": "Unauthorized" }`

## Payment Service (Mock Wallet Endpoints)
Base URL (payment-service): `http://localhost:8006`

### POST `/wallet/topups/mock`
Request:
```json
{
  "student_id": "240041246",
  "amount": 500,
  "method": "BKASH",
  "mode": "demo",
  "details": {
    "reference_id": "TOPUP-DEMO-001"
  },
  "idempotency_key": "client-key-123"
}
```
Success `200`:
```json
{
  "ok": true,
  "replayed": false,
  "topup": {
    "topup_id": "topup-abc123",
    "amount": 500,
    "method": "BKASH",
    "status": "COMPLETED|PENDING",
    "reference_id": "TOPUP-DEMO-001",
    "redirect_url": null
  }
}
```

### POST `/wallet/webhook/{provider}`
`provider`: `bkash|nagad|bank`

Request:
```json
{
  "topup_id": "topup-abc123",
  "status": "SUCCESS",
  "provider_txn_id": "pg-789"
}
```
Success `200`:
```json
{
  "ok": true,
  "already_processed": false,
  "topup_id": "topup-abc123",
  "status": "SUCCESS"
}
```

### GET `/wallet/topups/mock/{topup_id}`
Success `200`:
```json
{
  "topup": {
    "topup_id": "topup-abc123",
    "student_id": "240041246",
    "amount": 500,
    "method": "BKASH",
    "status": "COMPLETED"
  }
}
```

## Admin (Web API)
Base URL: `http://localhost:3000`

### GET `/api/admin/health`
Success `200`:
```json
{
  "services": [
    { "name": "identity-provider", "status": "up|down|degraded" }
  ],
  "updatedAt": "2026-02-28T10:00:00Z"
}
```

### GET `/api/admin/metrics`
Success `200`:
```json
{
  "latency_ms_p50": 20,
  "latency_ms_p95": 60,
  "orders_per_min": 12,
  "queue_depth": 3,
  "queue_stats": {
    "kitchen.jobs": 2,
    "order.status": 1
  },
  "kitchen_queue_depth": 2,
  "status_queue_depth": 1,
  "rabbitmq_publish_per_sec": 0.2,
  "rabbitmq_deliver_per_sec": 0.2,
  "updatedAt": "2026-02-28T10:00:00Z"
}
```
Required keys (must exist):
- `latency_ms_p50`
- `latency_ms_p95`
- `orders_per_min`
- `queue_depth`
- `updatedAt`

### POST `/api/admin/chaos`
Request:
```json
{
  "service": "order-gateway",
  "action": "restart"
}
```
Success `200`:
```json
{
  "ok": true,
  "service": "order-gateway",
  "action": "restart",
  "message": "...",
  "at": "2026-02-28T10:00:00Z"
}
```

## WebSocket Contract
Notification hub base URL: `ws://localhost:8005`

Supported endpoints:
- `GET /ws?token=<access_token>`: stream all order-status events for the authenticated user session.
- `GET /ws/orders/{order_id}?token=<access_token>`: stream only a single order's events.

### Server event payload
Server event payload:
```json
{
  "order_id": "uuid-or-string",
  "to_status": "QUEUED|IN_PROGRESS|READY|COMPLETED|CANCELLED",
  "eta_minutes": 8,
  "occurred_at": "2026-02-28T10:00:00Z"
}
```
