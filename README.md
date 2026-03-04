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

# install frontend dependencies (first time only)
npm --prefix apps/web install
npm --prefix apps/mobile install

# web dev
npm --prefix apps/web run dev

# mobile dev
npm --prefix apps/mobile start
```

Helpful commands:

```bash
make up-infra
make up-all
make ps
make logs
make down
make db-reset
make demo-seed
make smoke-test
```

## Service Ports
| Service | Port |
|---|---|
| Web (Next.js) | `3000` |
| Identity Provider | `8001` |
| Order Gateway | `8002` |
| Stock Service | `8003` |
| Kitchen Queue | `8004` |
| Notification Hub | `8005` |
| Payment Service (future/demo scope) | `8006` |
| Postgres | `5432` |
| PgBouncer | `6432` |
| Redis | `6379` |
| RabbitMQ AMQP | `5672` |
| RabbitMQ Management UI | `15672` |

## Admin Page Access
1. Start the stack and web app:
```bash
docker compose -f infra/docker-compose.yml up -d --build
npm --prefix apps/web run dev
```
2. Open `http://localhost:3000/login`
3. Sign in with admin demo account:
- Student ID: `admin-demo`
- Password: `admin-pass`
4. Open `http://localhost:3000/admin`

Notes:
- The Admin link appears in the top navbar only for users with admin role.
- If you use mock mode for web, the same admin credentials work there as well.

## Sign Up Integration (Web + Mobile + Backend)
New student account creation is integrated across frontend and backend.

What is implemented:
- Web signup form on `/login` (toggle: Sign in / Sign up)
- Mobile signup flow on login screen
- Backend registration endpoint with database insert
- Gateway proxy for registration in API path

Registration fields:
- Full Name
- Student ID
- Email
- Password

API route:
- `POST /api/auth/register`

Expected behavior:
- On successful signup, user is created in the `students` table.
- Response returns auth session payload (token + user).
- Frontend stores user session and continues as logged-in user.

Quick test:
1. Open web login page: `http://localhost:3000/login`
2. Switch to `Sign up`
3. Create a new account with unique student ID/email
4. Confirm login state appears after submit

## Environment Setup
Frontend supports `mock` and `real` API modes.

Web (`apps/web/.env.local`):
```bash
NEXT_PUBLIC_API_MODE=mock
NEXT_PUBLIC_API_BASE_URL=http://localhost:8002
NEXT_PUBLIC_API_PREFIX=/api
```

Mobile (`apps/mobile/.env`):
```bash
EXPO_PUBLIC_API_MODE=mock
EXPO_PUBLIC_API_BASE_URL=http://localhost:8002
EXPO_PUBLIC_API_PREFIX=/api
```

Use `real` mode when backend stack is running. Keep `mock` for demo-only frontend runs.

## Demo Accounts
| Role | Student ID | Password |
|---|---|---|
| Admin | `admin-demo` | `admin-pass` |
| Student | `240041246` | `pass123` |
| Student | `240041248` | `pass 246` |
| Student | `240041250` | `pass 369` |

## Smoke Test
Run end-to-end integration checks after starting Docker stack:

```bash
make smoke-test
```

Expected result: all phases pass (`auth`, `menu`, `create`, `status`, `admin metrics`) with no `FAIL` lines.

## Demo Script
Judge-facing demo sequence is documented in:
- `docs/demo-script.md`

## Payment Scope For Submission
This submission uses **Option 2** (no wallet/top-up claims in judged flow):
- Student and admin UI navigation does not expose wallet/top-up pages.
- Judge demo flow is strictly: login -> menu -> order -> live status -> admin health/metrics/chaos.
- Mock wallet/provider webhook endpoints remain in backend as future work, not part of required demo.

## Known Limitations
- Web order tracking may use polling in some flows; websocket updates are available in real mode where configured.
- Production deployment needs real TLS/domain setup and reverse-proxy routing for API/admin paths.
