# Dependencies and Documentation

## Project Baseline
- Repository: https://github.com/fuad13579/smart-cafeteria-system
- Source baseline: GitHub main (as of March 2, 2026), with local branding asset updates (bKash logo update and final Nagad logo replacement).

## 1. Runtime and Platform Dependencies
- Docker Engine / Docker Desktop
- Docker Compose
- Container images:
  - `postgres:16`
  - `edoburu/pgbouncer:latest`
  - `redis:7`
  - `rabbitmq:3-management`

## 2. Backend Dependencies (Python)

### identity-provider
- fastapi==0.110.0
- uvicorn==0.27.1
- psycopg[binary]==3.1.18
- PyJWT==2.9.0

### order-gateway
- fastapi==0.110.0
- uvicorn==0.27.1
- psycopg[binary]==3.1.18
- httpx==0.27.2
- pika==1.3.2
- redis==5.0.8
- qrcode==8.2

### stock-service
- fastapi==0.110.0
- uvicorn==0.27.1
- psycopg[binary]==3.1.18
- redis==5.0.8
- pika==1.3.2

### kitchen-queue
- fastapi==0.110.0
- uvicorn==0.27.1
- psycopg[binary]==3.1.18
- pika==1.3.2

### notification-hub
- fastapi==0.110.0
- uvicorn==0.27.1
- psycopg[binary]==3.1.18
- pika==1.3.2
- httpx==0.27.2

### payment-service
- fastapi==0.110.0
- uvicorn==0.27.1
- psycopg[binary]==3.1.18
- pika==1.3.2

## 3. Frontend Dependencies

### Web (`apps/web/package.json`)
- next@16.1.6
- react@19.2.3
- react-dom@19.2.3
- next-themes@^0.4.6
- typescript@^5
- eslint@^9.39.3
- eslint-config-next@^16.1.6
- tailwindcss@^4

### Mobile (`apps/mobile/package.json`)
- expo@~54.0.33
- react@19.1.0
- react-native@0.81.5
- expo-router@~6.0.23
- @react-navigation/native@^7.1.28
- zustand@^5.0.11
- typescript@~5.9.2
- eslint@^9.25.0

## 4. Configuration Dependencies
From `.env.example`:
- Database: `POSTGRES_*`
- Pooling: `PGBOUNCER_*`
- Messaging: `RABBITMQ_*`
- Cache: `REDIS_URL`
- Auth/security: `JWT_*`, cookie and CORS settings
- Frontend runtime settings for web/mobile API targets

## 5. Documentation Inventory
- `README.md`: runtime/env setup notes
- `DEPLOY_CHECKLIST.md`: deployment and verification checklist
- `docs/api-contract.md`: API contract
- `docs/events.md`: messaging/event contract
- `docs/backend-integration-handoff.md`: backend integration notes
- `docs/demo-accounts.md`: demo credentials
- `database/README.md`: migration, backup, restore, db-test flow
- `.github/workflows/ci.yml`: CI workflow definition
- `scripts/smoke-test.sh`: end-to-end smoke verification script

## 6. Testing and CI Dependencies
- Python 3.12 + pytest for backend unit tests in CI.
- Node.js 20 + npm ci for web/mobile lint/build checks.
- CI jobs:
  - Backend Unit Tests
  - Web Build & Lint
  - Mobile Lint

## 7. AI Usage Disclosure
AI-assisted tools were used for support in coding and documentation workflows. All deliverables were reviewed and finalized by the team.

## 8. Evidence Links
- Repo: https://github.com/fuad13579/smart-cafeteria-system
- Latest commit used: https://github.com/fuad13579/smart-cafeteria-system/commit/facb4f613c7bc35168f09d4527d60f99cc9179a7
- CI file: https://github.com/fuad13579/smart-cafeteria-system/blob/main/.github/workflows/ci.yml
- Compose: https://github.com/fuad13579/smart-cafeteria-system/blob/main/infra/docker-compose.yml


