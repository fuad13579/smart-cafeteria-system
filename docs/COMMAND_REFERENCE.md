# Smart Cafeteria Command Reference

This file explains the main commands used in this project. Run commands from the repo root unless a section says otherwise:

```powershell
C:\Users\FUAD\source\repos\smart-cafeteria-system
```

On Windows PowerShell, prefer `npm.cmd` instead of `npm` if you see:

```text
npm.ps1 cannot be loaded because running scripts is disabled on this system
```

## Quick Presentation Startup

### Start backend services

```powershell
docker compose -f infra/docker-compose.yml up -d
```

Breakdown:

- `docker compose`: uses Docker Compose to run multiple containers together.
- `-f infra/docker-compose.yml`: tells Docker Compose to use this project's compose file instead of looking for `docker-compose.yml` in the current folder.
- `up`: creates and starts the services defined in the compose file.
- `-d`: detached mode; services keep running in the background and the terminal is returned to you.

What it starts:

- PostgreSQL on `5432`
- PgBouncer on `6432`
- Redis on `6379`
- RabbitMQ on `5672` and management UI on `15672`
- Identity Provider on `8001`
- Order Gateway on `8002`
- Stock Service on `8003`
- Kitchen Queue on `8004`
- Notification Hub on `8005`
- Payment Service on `8006`

### Start web frontend

```powershell
npm.cmd --prefix apps/web run dev
```

Breakdown:

- `npm.cmd`: Windows command version of npm; avoids PowerShell execution policy blocking `npm.ps1`.
- `--prefix apps/web`: runs npm as if the current project folder is `apps/web`.
- `run dev`: runs the `dev` script from `apps/web/package.json`.
- `dev`: maps to `next dev`, which starts the Next.js development server.

Result:

- Web UI runs at `http://localhost:3000`.
- The frontend reads API settings from `apps/web/.env.local`.

## Makefile Shortcuts

The `Makefile` wraps common Docker and script commands.

### Start infra profile

```bash
make up-infra
```

Actual command:

```bash
docker compose -f infra/docker-compose.yml --profile infra up -d
```

Breakdown:

- `make up-infra`: runs the `up-infra` target from `Makefile`.
- `--profile infra`: starts services that belong to the `infra` compose profile, if profiles are defined.
- `up -d`: starts matching services in the background.

Note:

- In the current compose file, services are not explicitly tagged with profiles, so `docker compose -f infra/docker-compose.yml up -d` is the simpler presentation command.

### Start app profile and rebuild

```bash
make up-app
```

Actual command:

```bash
docker compose -f infra/docker-compose.yml --profile app up -d --build
```

Breakdown:

- `--profile app`: starts services in the `app` profile, if profiles are defined.
- `--build`: rebuilds service images before starting.
- `-d`: runs in the background.

### Start all Docker services and rebuild

```bash
make up-all
```

Actual command:

```bash
docker compose -f infra/docker-compose.yml up -d --build
```

Breakdown:

- `up`: creates and starts every service in `infra/docker-compose.yml`.
- `--build`: rebuilds Docker images from the service Dockerfiles before starting.
- `-d`: detached background mode.

Use this when:

- You changed backend service code.
- You changed Dockerfiles.
- You want a clean rebuild before demo.

### Stop Docker services

```bash
make down
```

Actual command:

```bash
docker compose -f infra/docker-compose.yml down
```

Breakdown:

- `down`: stops and removes containers and the default Docker network for this compose project.
- It does not remove named volumes by default, so database data can remain.

### Show container status

```bash
make ps
```

Actual command:

```bash
docker compose -f infra/docker-compose.yml ps
```

Breakdown:

- `ps`: lists compose services, container status, health, and port mappings.

Use this to confirm services are `Up` and `healthy`.

### Follow Docker logs

```bash
make logs
```

Actual command:

```bash
docker compose -f infra/docker-compose.yml logs -f --tail=200
```

Breakdown:

- `logs`: prints logs from compose services.
- `-f`: follows logs live.
- `--tail=200`: shows only the last 200 lines first, then continues streaming.

To inspect one service:

```powershell
docker compose -f infra/docker-compose.yml logs -f --tail=200 order-gateway
```

Breakdown:

- `order-gateway`: limits logs to the gateway service.

## Docker Operations

### Rebuild and start backend stack

```powershell
docker compose -f infra/docker-compose.yml up -d --build
```

Breakdown:

- `docker compose`: Docker's multi-container runner.
- `-f infra/docker-compose.yml`: use this repo's compose file.
- `up`: create/start services.
- `-d`: run in background.
- `--build`: rebuild service images before starting.

Use this after backend code changes.

### Stop a single service

```powershell
docker compose -f infra/docker-compose.yml stop notification-hub
```

Breakdown:

- `stop`: stops a running container without removing it.
- `notification-hub`: target service name from `infra/docker-compose.yml`.

Demo use:

- Simulates real-time notification service outage.
- Ordering can still work, but WebSocket push pauses.

### Start a stopped service

```powershell
docker compose -f infra/docker-compose.yml start notification-hub
```

Breakdown:

- `start`: starts an existing stopped container.
- `notification-hub`: target service to recover.

### Restart one service

```powershell
docker compose -f infra/docker-compose.yml restart order-gateway
```

Breakdown:

- `restart`: stops then starts the selected container.
- `order-gateway`: restarts only the API gateway, not the whole stack.

Use this for quick recovery when one service behaves incorrectly.

### Remove stopped containers from this stack

```powershell
docker compose -f infra/docker-compose.yml down --remove-orphans
```

Breakdown:

- `down`: stops and removes compose containers/network.
- `--remove-orphans`: removes containers from old compose definitions that no longer exist in the current file.

Use this if Docker Desktop shows old duplicate project containers.

## Web App Commands

### Install web dependencies

```powershell
npm.cmd --prefix apps/web install
```

Breakdown:

- `npm.cmd`: Windows npm executable.
- `--prefix apps/web`: targets the web app folder.
- `install`: installs dependencies from `apps/web/package-lock.json`.

Creates:

- `apps/web/node_modules`

### Run web development server

```powershell
npm.cmd --prefix apps/web run dev
```

Breakdown:

- `run dev`: executes the `dev` script.
- In `apps/web/package.json`, `dev` is `next dev`.

Result:

- Starts Next.js at `http://localhost:3000`.

### Build web app

```powershell
npm.cmd --prefix apps/web run build -- --webpack
```

Breakdown:

- `run build`: executes the `build` script.
- `build`: maps to `next build`.
- `--`: passes the following option to Next.js, not npm.
- `--webpack`: tells Next.js to build with webpack.

Use this to verify production build and TypeScript correctness.

### Lint web app

```powershell
npm.cmd --prefix apps/web run lint
```

Breakdown:

- `run lint`: executes the `lint` script.
- `lint`: maps to `eslint`.

Use this to catch code style and common frontend issues.

### Run built web app

```powershell
npm.cmd --prefix apps/web run start
```

Breakdown:

- `run start`: executes `next start`.
- `next start`: serves the already-built production output.

Requirement:

- Run `npm.cmd --prefix apps/web run build -- --webpack` first.

## Mobile App Commands

### Install mobile dependencies

```powershell
npm.cmd --prefix apps/mobile install
```

Breakdown:

- `--prefix apps/mobile`: targets the Expo app.
- `install`: installs mobile dependencies from `apps/mobile/package-lock.json`.

### Start Expo

```powershell
npm.cmd --prefix apps/mobile start
```

Breakdown:

- `run start`: not needed here because npm can run `start` directly.
- `start`: maps to `expo start`.
- `expo start`: starts the Metro bundler and Expo dev tools.

Use this for mobile demo through Expo Go or emulator.

### Run mobile on Android

```powershell
npm.cmd --prefix apps/mobile run android
```

Breakdown:

- `run android`: executes `expo start --android`.
- Opens the app on an Android emulator/device if configured.

### Run mobile on iOS

```powershell
npm.cmd --prefix apps/mobile run ios
```

Breakdown:

- `run ios`: executes `expo start --ios`.
- Intended for macOS/iOS simulator environments.

### Run mobile web build

```powershell
npm.cmd --prefix apps/mobile run web
```

Breakdown:

- `run web`: executes `expo start --web`.
- Starts the Expo app in a browser.

### Lint mobile app

```powershell
npm.cmd --prefix apps/mobile run lint
```

Breakdown:

- `run lint`: executes `expo lint`.
- Checks Expo/React Native code for lint issues.

## Health Checks

### Check service health with PowerShell

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8001/health
```

Breakdown:

- `Invoke-WebRequest`: PowerShell HTTP client.
- `-UseBasicParsing`: avoids older Internet Explorer parsing behavior.
- `http://localhost:8001/health`: Identity Provider health endpoint.

Expected output body:

```json
{"status":"ok"}
```

### Check all core services with curl

```bash
curl -i http://localhost:8001/health
curl -i http://localhost:8002/health
curl -i http://localhost:8003/health
curl -i http://localhost:8004/health
curl -i http://localhost:8005/health
curl -i http://localhost:8006/health
```

Breakdown:

- `curl`: command-line HTTP client.
- `-i`: includes response headers in output.
- `/health`: service endpoint used by Docker health checks and admin dashboard.

Ports:

- `8001`: Identity Provider
- `8002`: Order Gateway
- `8003`: Stock Service
- `8004`: Kitchen Queue
- `8005`: Notification Hub
- `8006`: Payment Service

### Run project health script

```bash
./scripts/health-check.sh
```

Breakdown:

- `./scripts/health-check.sh`: shell script that checks core service health endpoints.
- It also reports Docker Compose service state.

On Windows:

- Run this from Git Bash or WSL, not plain PowerShell.

## API Demo Commands

### Login and capture JWT token

```bash
TOKEN=$(curl -s -X POST http://localhost:8002/api/login \
  -H "Content-Type: application/json" \
  -d '{"student_id":"240041246","password":"pass123"}' \
  | python3 -c 'import json,sys; print(json.load(sys.stdin)["access_token"])')
```

Breakdown:

- `TOKEN=$(...)`: stores command output into a shell variable named `TOKEN`.
- `curl -s`: sends HTTP request silently.
- `-X POST`: uses HTTP POST.
- `http://localhost:8002/api/login`: gateway login endpoint.
- `-H "Content-Type: application/json"`: tells backend the request body is JSON.
- `-d '{...}'`: sends login credentials as JSON.
- `|`: pipes the JSON response into Python.
- `python3 -c '...'`: runs a short Python program.
- `json.load(sys.stdin)["access_token"]`: extracts the JWT token from the response.

Credentials:

- Student ID: `240041246`
- Password: `pass123`

### Print token

```bash
echo "$TOKEN"
```

Breakdown:

- `echo`: prints text.
- `"$TOKEN"`: expands the token variable.

### Place order

```bash
curl -s -X POST http://localhost:8002/api/orders \
  -H "Authorization: Bearer $TOKEN" \
  -H "Idempotency-Key: demo-order-001" \
  -H "Content-Type: application/json" \
  -d '{"items":[{"id":"1","qty":1}]}'
```

Breakdown:

- `POST /api/orders`: creates an order through the gateway.
- `Authorization: Bearer $TOKEN`: authenticates the request with the JWT.
- `Idempotency-Key: demo-order-001`: prevents accidental duplicate order creation if the same request is retried.
- `Content-Type: application/json`: declares JSON payload.
- `items`: order line items.
- `id`: menu/stock item ID.
- `qty`: quantity ordered.

Expected behavior:

- Gateway validates auth.
- Gateway checks and reserves stock.
- Gateway enqueues kitchen job.
- Response returns order ID and initial status.

### Check stock directly

```bash
curl -s http://localhost:8003/stock/1
```

Breakdown:

- `http://localhost:8003`: Stock Service.
- `/stock/1`: checks stock item with ID `1`.

Use this to prove stock changes and stock safety.

### Listen to real-time notifications

```bash
npx wscat -c "ws://localhost:8005/ws?token=$TOKEN"
```

Breakdown:

- `npx`: runs a package without permanently installing it globally.
- `wscat`: WebSocket command-line client.
- `-c`: connect to this WebSocket URL.
- `ws://localhost:8005/ws`: Notification Hub WebSocket endpoint.
- `token=$TOKEN`: authenticates the WebSocket stream.

Single-order stream:

```bash
npx wscat -c "ws://localhost:8005/ws/orders/<ORDER_ID>?token=$TOKEN"
```

Breakdown:

- `<ORDER_ID>`: replace with an actual order ID from the order response.
- This listens only for updates for one order.

## Chaos Mode Commands

### Enable chaos failure for Stock Service

```bash
curl -s -X POST http://localhost:8003/chaos/fail \
  -H "Content-Type: application/json" \
  -d '{"enabled":true,"mode":"error"}'
```

Breakdown:

- `POST /chaos/fail`: service endpoint for simulated failure.
- `"enabled": true`: turns failure mode on.
- `"mode": "error"`: service returns errors instead of normal responses.

What it does:

- It does not stop Docker.
- It makes that service intentionally return failures such as `503`.
- Admin dashboard health should show the service as unhealthy/down.

### Disable chaos failure

```bash
curl -s -X POST http://localhost:8003/chaos/fail \
  -H "Content-Type: application/json" \
  -d '{"enabled":false,"mode":"error"}'
```

Breakdown:

- `"enabled": false`: clears simulated failure mode.
- `"mode": "error"`: included for payload shape; mode no longer matters when disabled.

### Stop notification service as a real failure demo

```powershell
docker compose -f infra/docker-compose.yml stop notification-hub
```

Breakdown:

- This actually stops the Notification Hub container.
- Real-time order updates stop until the service is started again.

Recover:

```powershell
docker compose -f infra/docker-compose.yml start notification-hub
```

## Testing Commands

### Run smoke test

```bash
./scripts/smoke-test.sh
```

Breakdown:

- Runs a scripted end-to-end check.
- Logs in.
- Loads menu.
- Places an order.
- Checks expected status behavior.

On Windows:

- Run from Git Bash or WSL.

### Run gateway tests

```bash
services/order-gateway/.venv/bin/python -m pytest -q services/order-gateway/tests
```

Breakdown:

- `services/order-gateway/.venv/bin/python`: Python interpreter inside the gateway virtual environment.
- `-m pytest`: runs pytest as a Python module.
- `-q`: quiet output.
- `services/order-gateway/tests`: test directory.

Windows PowerShell variant:

```powershell
services\order-gateway\.venv\Scripts\python.exe -m pytest -q services\order-gateway\tests
```

### Run load test

```bash
python3 ./scripts/load-test-orders.py --rate 10 --duration 3 --concurrency 20
```

Breakdown:

- `python3`: runs Python 3.
- `./scripts/load-test-orders.py`: load-test script for order creation.
- `--rate 10`: target request rate.
- `--duration 3`: run for 3 seconds.
- `--concurrency 20`: allow up to 20 concurrent operations.

Use this to demonstrate burst behavior and stock safety.

## Database Commands

### Back up database

```bash
./scripts/db-backup.sh
```

Breakdown:

- Runs a PostgreSQL dump through the script.
- Saves a timestamped backup under the configured backup folder.

### Restore database

```bash
./scripts/db-restore.sh ./backups/db/cafeteria_YYYYMMDD_HHMMSS.sql.gz
```

Breakdown:

- `./scripts/db-restore.sh`: restore script.
- `./backups/db/...sql.gz`: compressed SQL backup file to restore.

Makefile variant:

```bash
make db-restore FILE=./backups/db/cafeteria_YYYYMMDD_HHMMSS.sql.gz
```

Breakdown:

- `FILE=...`: passes the backup file path into the Makefile target.

### Reset database

```bash
./scripts/db-reset.sh
```

Breakdown:

- Resets local database state.
- Intended for local/dev use only.

### Run database tests

```bash
./database/run-db-tests.sh
```

Breakdown:

- Applies/validates database schema and test assertions.

Makefile variant:

```bash
make db-test
```

Actual command:

```bash
./database/run-db-tests.sh
```

### Seed demo data

```bash
./scripts/demo-seed.sh
```

Breakdown:

- Inserts or refreshes demo data needed for local presentation flows.

## Virtual Environment Commands

### Create virtual environment for one service

```bash
make venv-service SERVICE=order-gateway
```

Actual command:

```bash
./scripts/setup-service-venv.sh order-gateway
```

Breakdown:

- `SERVICE=order-gateway`: Makefile variable identifying which service to set up.
- `setup-service-venv.sh`: creates a Python virtual environment for that service.

### Create virtual environments for all services

```bash
make venv-all
```

Actual command:

```bash
./scripts/setup-service-venv.sh --all
```

Breakdown:

- `--all`: tells the script to set up every service virtual environment.

## Git Commands Used During Development

### Check branch and working tree

```powershell
git status
```

Breakdown:

- Shows current branch.
- Shows modified, staged, untracked, or clean files.

Compact variant:

```powershell
git status --short --branch
```

Breakdown:

- `--short`: compact status output.
- `--branch`: includes current branch and upstream info.

### Show recent commits

```powershell
git log --oneline --max-count=3
```

Breakdown:

- `log`: shows commit history.
- `--oneline`: one commit per line.
- `--max-count=3`: only show latest three commits.

### Stage files

```powershell
git add apps/web/src/lib/api.ts apps/mobile/src/lib/api.ts
```

Breakdown:

- `git add`: stages files for the next commit.
- Each path after `git add` is included in the commit.

### Commit staged changes

```powershell
git commit -m "Fix demo wallet balance sync across web and mobile"
```

Breakdown:

- `commit`: creates a new Git commit from staged files.
- `-m`: supplies the commit message inline.

### Push current branch

```powershell
git push
```

Breakdown:

- Sends local commits to the configured remote branch.

### Push safely after rewriting history

```powershell
git push --force-with-lease
```

Breakdown:

- `--force-with-lease`: force-pushes only if the remote branch has not changed unexpectedly.
- Safer than `--force` because it protects teammates' newer remote commits.

Use only when:

- You intentionally rewrote local history.
- You verified the branch and remote state.

## Troubleshooting Commands

### Check what uses port 3000

```powershell
netstat -ano | findstr :3000
```

Breakdown:

- `netstat -ano`: lists network connections with process IDs.
- `|`: sends output to the next command.
- `findstr :3000`: filters lines containing port `3000`.

Use this when Next.js says port `3000` is already in use.

### Check Docker containers directly

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

Breakdown:

- `docker ps`: lists running containers.
- `--format`: controls output columns.
- `{{.Names}}`: container name.
- `{{.Status}}`: running and health status.
- `{{.Ports}}`: exposed port mappings.

### Test frontend to backend proxy

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:3000/api/admin/health
```

Breakdown:

- Calls the Next.js admin health API route.
- That route checks admin auth and then checks backend service health.

Important:

- This requires the web frontend to be running on port `3000`.
- It may return `401` if you are not logged in as admin.

### Test gateway directly

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8002/health
```

Breakdown:

- Calls the Order Gateway directly.
- Bypasses the frontend.

Use this to separate backend problems from frontend problems.

## Environment Settings

### Web app real backend mode

File:

```text
apps/web/.env.local
```

Expected values:

```env
NEXT_PUBLIC_API_MODE=real
NEXT_PUBLIC_API_BASE_URL=http://localhost:8002
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
```

Meaning:

- `NEXT_PUBLIC_API_MODE=real`: frontend uses real backend calls instead of mock responses.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8002`: gateway base URL.
- `NEXT_PUBLIC_API_PREFIX=/api`: gateway API prefix.
- `NEXT_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws`: WebSocket notification endpoint.

### Mobile app real backend mode

File:

```text
apps/mobile/.env
```

Expected values:

```env
EXPO_PUBLIC_API_MODE=real
EXPO_PUBLIC_API_BASE_URL=http://localhost:8002
EXPO_PUBLIC_API_PREFIX=/api
EXPO_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
```

Meaning:

- `EXPO_PUBLIC_*`: public Expo runtime environment variables.
- These tell the mobile app where the backend services are.

## Presentation Demo Order

Use this sequence when time is short:

1. Confirm Docker is healthy:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

2. Start web:

```powershell
npm.cmd --prefix apps/web run dev
```

3. Open:

```text
http://localhost:3000
```

4. Student login:

```text
Student ID: 240041246
Password: pass123
```

5. Admin login:

```text
Student ID: admin-demo
Password: admin-pass
```

6. Admin dashboard:

```text
http://localhost:3000/admin
```

7. If a service demo breaks, recover with:

```powershell
docker compose -f infra/docker-compose.yml restart <service-name>
```

Replace `<service-name>` with:

```text
identity-provider
order-gateway
stock-service
kitchen-queue
notification-hub
payment-service
```
