# Project Progress Tracker

Last updated: 2026-03-04

## Overall Status
- Stage: Submission-ready baseline
- Health: Full Docker stack starts clean and service health checks pass
- CI: Latest `main` pipeline is green
- Product state: Student flow, admin observability, and chaos demo path are all operational

## Completed
1. Dockerized microservice architecture scaffolded.
2. Core infra integrated in compose: Postgres, Redis, RabbitMQ, service containers.
3. Operational scripts added: compose make targets + health-check script.
4. Web and mobile app bases integrated and lint/type checks stabilized.
5. API client mode unification completed (mock/real switching for web + mobile).
6. Deterministic DB initialization enforced in Compose (`001_schema.sql`, `002_seed.sql` mounts).
7. Identity Provider password handling migrated to bcrypt with legacy hash upgrade path.
8. Gateway auth hardening completed:
   - Unauthorized requests return `401`
   - Admin-only routes enforce `403` for non-admin users
9. Stock safety hardening completed:
   - Reservation lifecycle now supports reserve -> confirm/release
   - TTL-based stale reservation reaper added
   - Concurrency-safe reservation behavior validated under burst
10. Notification contract alignment completed:
   - WebSocket endpoints support both `/ws?token=...` and `/ws/orders/{id}?token=...`
11. Admin dashboard upgraded:
   - Health grid + metrics + chaos controls working
   - Queue depth includes both `kitchen.jobs` and `order.status`
12. Web/mobile navigation and responsive updates completed (mobile-clean header behavior).
13. Submission documentation upgraded:
   - README rewritten as guidebook
   - Demo script added (`docs/demo-script.md`)
   - API contract documentation updated
14. CI/local quality gates validated:
   - Web lint/build pass
   - Mobile lint pass
   - Backend tests pass
   - Smoke test and health-check pass

## In Progress
1. Final submission report cleanup in `submission/` docs.
2. Post-submission production deployment planning.

## Pending (High Priority)
1. Expand automated test coverage beyond current gateway-centric baseline.
2. Add stronger production security controls (secret management, service-to-service auth, rate limiting).
3. Finalize payment roadmap decision for post-demo phase (full integration or permanent scope trim).

## Risks / Gaps
1. Vercel deployment is frontend-only; backend stack must run on separate infrastructure.
2. Cross-service integration tests are still limited compared to full production-grade coverage.
3. Payment/wallet endpoints exist but are out of judged core flow scope for current submission.

## Next Milestones
1. Production environment rollout for backend services (managed DB/queue/cache + service hosting).
2. Advanced observability (dashboards/alerts, SLO tracking).
3. Full mobile release readiness (artifact build + QA matrix).

## Quick Update Template

```md
### YYYY-MM-DD
- Done:
- In progress:
- Blockers:
- Next:
```
