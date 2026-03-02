# Requirement Analysis and System Architecture

## Project Context
- Project: Smart Cafeteria System (Fault-Tolerant Microservices)
- Repository: https://github.com/fuad13579/smart-cafeteria-system
- Source baseline: GitHub main (as of March 2, 2026), with local branding asset updates (bKash logo update and final Nagad logo replacement).
- Rulebook reference: https://devsprint2026.vercel.app/rulebook

## 1. Problem Statement
The cafeteria system must serve many concurrent students while remaining available during partial failures. Core ordering should continue even if a non-critical component fails (for example, notification delivery).

## 2. Primary Stakeholders
- Students: authentication, menu browsing, ordering, order tracking, wallet usage.
- Admin/operators: health monitoring, metrics, menu control, topup review, kitchen visibility.
- Kitchen: queue-driven order processing and status progression.

## 3. Functional Requirements
- User authentication and role-aware access.
- Menu retrieval by context/slot and availability.
- Order creation, order lookup, and personal order history.
- Stock reservation and release logic around order lifecycle.
- Asynchronous kitchen processing through message queue.
- Real-time status notifications to clients.
- Wallet/topup and payment webhook handling.
- Admin health/metrics endpoints and operational controls.

## 4. Non-Functional Requirements
- Fault tolerance: service isolation + health checks + restart policy.
- Scalability: independently deployable services + queue decoupling + DB pooling.
- Reliability: migration-driven schema evolution, constraints, idempotency patterns.
- Observability: health and metrics endpoints, smoke-test path.
- Maintainability: API/event contracts and CI quality gates.

## 5. System Architecture

### 5.1 Services
- `identity-provider` (port 8001)
- `order-gateway` (port 8002)
- `stock-service` (port 8003)
- `kitchen-queue` (port 8004)
- `notification-hub` (port 8005)
- `payment-service` (port 8006)

### 5.2 Infrastructure
- PostgreSQL 16 (system of record)
- PgBouncer (connection pooling)
- Redis 7 (cache/fast state)
- RabbitMQ (event bus for async workflows)

### 5.3 Clients
- Web app: Next.js/React/TypeScript
- Mobile app: Expo/React Native/TypeScript

## 6. Key Flow (Order Lifecycle)
1. User logs in and gets authorized.
2. Client requests menu from gateway.
3. Client posts order to gateway.
4. Gateway validates and reserves stock.
5. Gateway persists order and publishes order-created event.
6. Kitchen consumer updates status (`QUEUED -> IN_PROGRESS -> READY -> COMPLETED`).
7. Status-change event is published.
8. Notification hub pushes live updates to clients.

## 7. Fault-Tolerance Strategy
- Queue-based decoupling prevents synchronous cascade failure.
- Health checks + `depends_on` + restart policies improve recovery.
- Separate services keep failures bounded to local components.
- DB and broker are explicit infrastructure dependencies with health probes.

## 8. Evidence Mapping to Rulebook Expectations
- Microservice architecture: `services/*` with dedicated runtime containers.
- DevOps/automation: Docker Compose runtime and CI workflow.
- Testing and quality gates: backend tests + web/mobile lint/build checks.
- Monitoring readiness: health and metrics APIs + admin endpoints.

## 9. AI Usage Disclosure
AI-assisted tools were used in development support tasks (analysis, drafting, and implementation assistance). All outputs were reviewed, edited, and validated by team members before submission.

## 10. References
- Repo: https://github.com/fuad13579/smart-cafeteria-system
- Compose: https://github.com/fuad13579/smart-cafeteria-system/blob/main/infra/docker-compose.yml
- API contract: https://github.com/fuad13579/smart-cafeteria-system/blob/main/docs/api-contract.md
- Event contract: https://github.com/fuad13579/smart-cafeteria-system/blob/main/docs/events.md
- CI workflow: https://github.com/fuad13579/smart-cafeteria-system/blob/main/.github/workflows/ci.yml


