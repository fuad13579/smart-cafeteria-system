# Stack Report and Justification

## Project Scope
- Repository: https://github.com/fuad13579/smart-cafeteria-system
- Source baseline: GitHub main (as of March 2, 2026), with local branding asset updates (bKash logo update and final Nagad logo replacement).

## 1. Stack Summary

### Frontend
- Web: Next.js 16, React 19, TypeScript, Tailwind CSS
- Mobile: Expo 54, React Native 0.81, TypeScript

### Backend
- FastAPI + Uvicorn (Python microservices)
- psycopg for PostgreSQL access
- httpx for inter-service HTTP calls

### Data, Messaging, and Infra
- PostgreSQL 16
- PgBouncer
- Redis 7
- RabbitMQ 3-management
- Docker + Docker Compose

### Quality and Delivery
- GitHub Actions CI
- pytest (backend tests)
- ESLint and build checks (web/mobile)

## 2. Justification
- Microservice split provides isolation and independent scaling.
- FastAPI enables rapid and structured API delivery during hackathon timeline.
- RabbitMQ decouples critical order flow from downstream processing.
- PostgreSQL provides strong transactional consistency.
- PgBouncer helps control DB connection pressure.
- Redis improves latency for cacheable and transient state operations.
- Docker Compose gives reproducible local and demo environments.
- CI gates reduce integration regressions under rapid iteration.

## 3. Requirement-to-Stack Alignment
- Fault tolerance: service isolation + queue-based async flow + restart strategy.
- DevOps practice: containerized environment + CI workflow.
- Monitoring readiness: health/metrics endpoints aggregated for admin.
- Maintainability: typed frontend code, migration-based DB evolution, documented contracts.

## 4. Notable Tradeoffs
- Python services prioritize implementation speed over maximum low-level throughput.
- Compose is ideal for demo/local orchestration; production-scale orchestration may require a more advanced platform.
- Event-driven design increases operational complexity but improves resilience.

## 5. AI Usage Disclosure
AI-assisted tools were used for development support and documentation drafting. Final technical decisions, edits, and verification were completed by the team.

## 6. References
- Repo: https://github.com/fuad13579/smart-cafeteria-system
- CI: https://github.com/fuad13579/smart-cafeteria-system/blob/main/.github/workflows/ci.yml
- Web deps: https://github.com/fuad13579/smart-cafeteria-system/blob/main/apps/web/package.json
- Mobile deps: https://github.com/fuad13579/smart-cafeteria-system/blob/main/apps/mobile/package.json
- Compose: https://github.com/fuad13579/smart-cafeteria-system/blob/main/infra/docker-compose.yml


