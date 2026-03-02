# Smart Cafeteria System (DevSprint 2026)

A fault-tolerant, microservices-based university cafeteria ordering system designed to survive the Ramadan rush: fast API ack, safe inventory under burst traffic, and real-time order status updates.

## Why this exists
During peak Iftar rush, monolith systems choke on locks/timeouts and partial failures. This project splits the system into isolated microservices so that failures (for example, notification) do not stall the full order flow.

---

## Architecture (Required Services)
Each service is containerized and communicates over the network.

| Service | Responsibility | Key rulebook requirement |
|---|---|---|
| **Identity Provider** | AuthN/AuthZ | Single source of truth; issues secure **JWT** tokens. |
| **Order Gateway** | API entry point | **Mandatory token validation** + **cache stock check before DB** to reduce load. |
| **Stock Service** | Inventory source of truth | **Concurrency control** (for example, optimistic locking) to prevent overselling. |
| **Kitchen Queue** | Async processing | **Ack <2s**, decouple ack from cooking (simulate 3–7s). |
| **Notification Hub** | Real-time updates | Push status updates to UI, no client polling in real mode. |

Judge requirement: the whole system must run via a single `docker compose up` command.

---

## Core Engineering Requirements (Rulebook Mapping)

### Security & Authentication
- Token handshake: client authenticates with Identity Provider to receive a secure token.
- Protected routes: Gateway rejects missing/invalid bearer token with **401**.

### Resilience & Fault Tolerance
- Idempotency: handle partial failures (for example, stock deducted but response lost).
- Async processing: Kitchen decouples acknowledgment from execution.

### Performance & Caching
- Cache-first stock check at gateway; if cache says **zero stock**, reject instantly to protect DB.

### Observability & Monitoring
Each service exposes:
- `GET /health`: `200` if healthy, `503` if a dependency is down.
- `GET /metrics`: machine-readable totals, failure counts, avg latency.

### CI/CD Validation
- Unit tests: order validation + stock deduction logic.
- Pipeline: every push to `main` runs checks; build fails on test failure.

### UI Requirements
Student journey (SPA):
1. Login (token)
2. Place order
3. Live status: Pending -> Stock Verified -> In Kitchen -> Ready

Admin dashboard:
- Health grid (Green/Red per service)
- Live metrics (latency + throughput)
- Chaos toggle to kill a service and observe partial failure handling

---

## Quick Start (Localhost)
Prerequisites: Docker + Docker Compose, Node.js 20+, npm

```bash
# from repo root
cd /root/smart-cafeteria-system

# one command: build + run full backend stack
docker compose -f infra/docker-compose.yml up -d --build

# web dev
npm --prefix apps/web run dev

# mobile dev
npm --prefix apps/mobile start
```

Helpful commands:

```bash
make ps
make logs
make down
make db-reset
make demo-seed
make smoke-test
```
