# Smart Cafeteria Web Frontend

This is the Next.js frontend for the Smart Cafeteria System. It provides the student ordering flow, wallet page, order tracking, kitchen view, and admin dashboard.

## Prerequisites

- Node.js 20+
- npm
- Backend Docker stack running from the repo root

On Windows PowerShell, use `npm.cmd` instead of `npm` if script execution is blocked.

## Run Locally

From the repo root:

```powershell
npm.cmd --prefix apps/web install
npm.cmd --prefix apps/web run dev
```

Open:

```text
http://localhost:3000
```

The frontend expects the backend gateway at `http://localhost:8002` when running in real mode.

## Backend Requirement

Start the backend stack from the repo root before using real API mode:

```powershell
docker compose -f infra/docker-compose.yml up -d
```

This starts the backend services, database, Redis, and RabbitMQ. It does not start the Next.js frontend.

## Environment

Local environment file:

```text
apps/web/.env.local
```

Expected demo values:

```env
NEXT_PUBLIC_API_MODE=real
NEXT_PUBLIC_API_BASE_URL=http://localhost:8002
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
ACCESS_COOKIE_NAME=access_token
```

Meaning:

- `NEXT_PUBLIC_API_MODE=real`: use backend APIs instead of frontend mock responses.
- `NEXT_PUBLIC_API_BASE_URL=http://localhost:8002`: order gateway base URL.
- `NEXT_PUBLIC_API_PREFIX=/api`: gateway API prefix.
- `NEXT_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws`: notification WebSocket URL.
- `ACCESS_COOKIE_NAME=access_token`: auth cookie name used by admin API routes.

## Scripts

```powershell
npm.cmd --prefix apps/web run dev
```

Starts the Next.js development server on `http://localhost:3000`.

```powershell
npm.cmd --prefix apps/web run build -- --webpack
```

Builds the production app and runs TypeScript checks. The `-- --webpack` part passes `--webpack` to Next.js.

```powershell
npm.cmd --prefix apps/web run start
```

Serves the production build. Run the build command first.

```powershell
npm.cmd --prefix apps/web run lint
```

Runs ESLint for the web app.

## Demo Accounts

Student:

```text
Student ID: 240041246
Password: pass123
```

Admin:

```text
Student ID: admin-demo
Password: admin-pass
```

Admin dashboard:

```text
http://localhost:3000/admin
```

## Useful Checks

Check gateway directly:

```powershell
Invoke-WebRequest -UseBasicParsing http://localhost:8002/health
```

Check frontend is running:

```text
http://localhost:3000
```

Check Docker services:

```powershell
docker ps --format "table {{.Names}}\t{{.Status}}\t{{.Ports}}"
```

For the full command breakdown, see:

```text
docs/COMMAND_REFERENCE.md
```
