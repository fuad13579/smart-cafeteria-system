# Project Progress Tracker

Last updated: 2026-02-28

## Overall Status
- Stage: Integration + stabilization
- Health: Docker stack builds and services report healthy
- Backend maturity: Core API routes available for login/menu/orders, with DB-backed auth now active

## Completed
1. Dockerized microservice architecture scaffolded.
2. Core infra integrated in compose: Postgres, Redis, RabbitMQ, service containers.
3. Operational scripts added: compose make targets + health-check script.
4. Web and mobile app bases integrated and lint/type checks stabilized.
5. Web cleanup completed (duplicate client files removed, env config aligned).
6. `payment-service` microservice added and wired to compose + health checks.
7. API client mode unification completed (mock/real switching for web + mobile).
8. Deterministic mock scenarios added (`success`, `timeout`, `unauthorized`, `server_error`).
9. Postman collection + local Postman environment added under `docs/postman/`.
10. Database schema updated with `students.account_balance` in base schema files.
11. Migration added for existing DBs: `database/migrations/007_account_balance.sql`.
12. Seed data updated to team test accounts across `database/002_seed.sql`, `database/migrations/002_seed.sql`, and `database/demo-seed.sql`.
13. `identity-provider` login response now returns:
- `user.name`
- `user.student_id`
- `user.account_balance`
14. Real login API verified with team credentials against running stack.
15. Web login page now supports showing logged-in user details (name, student ID, balance).
16. Header auth button behavior updated per current UX decision: fixed `Login` button beside cart.
17. Service-local Python `.venv` folders created for all backend services.

## In Progress
1. Frontend real-mode runtime alignment and final E2E polish.
2. Team backend merge/integration hardening across all services.

## Pending (High Priority)
1. Ensure web/mobile default mock mode is documented, and real mode checklist is enforced in runbooks.
2. Finish database migration/test pass on clean and existing DB volumes.
3. Complete order-status tracking validation in both web and mobile against real API.
4. Add baseline automated tests (API + frontend critical flows).
5. Apply security baseline (secrets/JWT hardening, rate limiting, network restrictions).
6. Resolve CI dependency/version drift and keep frontend checks green consistently.

## Risks / Gaps
1. Local Postgres volumes may start without schema depending on initialization path; requires explicit migration/seed run.
2. Demo seed currently expects `updated_at` columns when doing upserts; fails on minimal schema without audit migration.
3. Auth/RBAC depth beyond basic login is still limited.
4. Test coverage is still limited.
5. Service `.venv` creation is done, but package install depends on network availability in the developer environment.

## Next Milestones
1. Lock real-mode frontend demo flow: login -> menu -> place order -> order tracking.
2. Complete DB migration consistency (fresh DB + existing DB upgrade path).
3. Security baseline applied and verified.
4. Performance sanity test for target traffic profile.

## Quick Update Template

```md
### YYYY-MM-DD
- Done:
- In progress:
- Blockers:
- Next:
```
