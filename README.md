# smart-cafeteria-system

## Frontend Env Setup

Important:
- `apps/web/.env.example` is ignored in this repo.
- Share required web env vars through this README/`DEPLOY_CHECKLIST.md`.

### Frontend-only (mock mode)

Web (`apps/web/.env.local`)
```env
NEXT_PUBLIC_API_MODE=mock
NEXT_PUBLIC_API_BASE_URL=http://localhost:8002
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_API_MOCK_SCENARIO=success
NEXT_PUBLIC_API_MOCK_DELAY_MS=350
NEXT_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
```

Mobile (`apps/mobile/.env`)
```env
EXPO_PUBLIC_API_MODE=mock
EXPO_PUBLIC_API_BASE_URL=http://localhost:8002
EXPO_PUBLIC_API_PREFIX=/api
EXPO_PUBLIC_API_MOCK_SCENARIO=success
EXPO_PUBLIC_API_MOCK_DELAY_MS=350
EXPO_PUBLIC_NOTIFICATION_WS_URL=ws://localhost:8005/ws
```

### Full-stack (real mode)

Web (`apps/web/.env.local`)
```env
NEXT_PUBLIC_API_MODE=real
NEXT_PUBLIC_API_BASE_URL=https://api.103.182.213.241.nip.io
NEXT_PUBLIC_API_PREFIX=/api
NEXT_PUBLIC_NOTIFICATION_WS_URL=wss://api.103.182.213.241.nip.io/ws
```

Mobile (`apps/mobile/.env`)
```env
EXPO_PUBLIC_API_MODE=real
EXPO_PUBLIC_API_BASE_URL=https://api.103.182.213.241.nip.io
EXPO_PUBLIC_API_PREFIX=/api
EXPO_PUBLIC_NOTIFICATION_WS_URL=wss://api.103.182.213.241.nip.io/ws
```
