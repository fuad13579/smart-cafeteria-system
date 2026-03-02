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
make ps
make logs
make down
make db-reset
make demo-seed
make smoke-test
```

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

## Wallet Page Guide
Student wallet page is available at:
- `http://localhost:3000/wallet`

Student flow:
1. Sign in as a student user.
2. Open `Wallet` from the navbar.
3. Click `Add Money`.
4. Enter amount and select method (`bKash`, `Nagad`, `Bank`).
5. Submit payment details in the same popup form.

Transaction behavior:
- `bKash` / `Nagad` in demo mode: completes immediately (or near-immediate demo success), balance updates.
- `Bank`: created as `PENDING` and waits for admin review.

Admin bank verification:
1. Sign in as admin (`admin-demo` / `admin-pass`).
2. Open `http://localhost:3000/admin`.
3. In **Bank Top-up Verification Queue**, approve or reject pending bank top-ups.

## Known Limitations
- Wallet payment providers (`bKash`, `Nagad`, `Bank`) are demo-mode integrations.
- Web order tracking may use polling in some flows; websocket updates are available in real mode where configured.
- Production deployment needs real TLS/domain setup and reverse-proxy routing for API/admin paths.
