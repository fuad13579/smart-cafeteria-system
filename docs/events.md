# Event Contract (RabbitMQ)

Exchange recommendation: `cafeteria.events` (topic)
Content type: `application/json`

## Queue: `kitchen.jobs`
Routing key: `order.created`
Producer: `order-gateway`
Consumer: `kitchen-queue`

Payload:
```json
{
  "event": "order.created",
  "event_id": "uuid",
  "occurred_at": "2026-02-28T10:00:00Z",
  "order": {
    "order_id": "uuid-or-string",
    "student_id": "2100001",
    "status": "QUEUED",
    "eta_minutes": 12,
    "items": [
      { "id": "1", "name": "Chicken Burger", "qty": 1, "unit_price": 120 }
    ],
    "total_amount": 120
  }
}
```

Required fields:
- `event`, `event_id`, `occurred_at`, `order.order_id`, `order.items`

## Queue: `order.status`
Routing key: `order.status.changed`
Producer: `kitchen-queue`
Consumers: `notification-hub`, dashboards

Payload:
```json
{
  "event": "order.status.changed",
  "event_id": "uuid",
  "occurred_at": "2026-02-28T10:05:00Z",
  "order_id": "uuid-or-string",
  "from_status": "QUEUED",
  "to_status": "IN_PROGRESS",
  "eta_minutes": 9
}
```

Required fields:
- `event`, `event_id`, `occurred_at`, `order_id`, `to_status`

## Queue: `payment.completed`
Routing key: `payment.completed`
Producer: `payment-service`
Consumers: `order-gateway`, reporting

Payload:
```json
{
  "event": "payment.completed",
  "event_id": "uuid",
  "occurred_at": "2026-02-28T10:01:00Z",
  "payment": {
    "payment_id": "uuid-or-string",
    "order_id": "uuid-or-string",
    "student_id": "2100001",
    "amount": 120,
    "currency": "BDT",
    "method": "CARD|CASH|MFS",
    "status": "COMPLETED",
    "transaction_ref": "ref-123"
  }
}
```

Required fields:
- `event`, `event_id`, `occurred_at`, `payment.order_id`, `payment.amount`, `payment.status`

## Versioning
- Add `schema_version` field when payload shape changes.
- Consumers must ignore unknown fields for forward compatibility.
