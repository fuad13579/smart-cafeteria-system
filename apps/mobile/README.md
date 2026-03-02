# Mobile App (Expo) - APK Build Guide

## 1) Install dependencies

```bash
cd apps/mobile
npm install
```

## 2) Install EAS CLI and login

```bash
npm i -g eas-cli
eas login
```

## 3) EAS config

This project already includes `eas.json` with:
- `preview` profile for APK output (`android.buildType = "apk"`)
- default mock-mode env for demo builds

If you want to regenerate from scratch:

```bash
eas build:configure
```

Then keep this in `eas.json`:

```json
{
  "build": {
    "preview": {
      "distribution": "internal",
      "android": { "buildType": "apk" }
    }
  }
}
```

## 4) Build APK (recommended for demo install)

```bash
eas build --platform android --profile preview
```

EAS will provide a build URL to download the APK.

## 5) Install on Android phones

1. Open the EAS build URL on Android.
2. Download APK.
3. Allow "Install unknown apps" if prompted.
4. Install and run.

## 6) Optional: set EAS env vars for preview builds

```bash
eas env:create --name EXPO_PUBLIC_API_MODE --value mock --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_BASE_URL --value http://localhost:8002 --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_PREFIX --value /api --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_MOCK_SCENARIO --value success --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_API_MOCK_DELAY_MS --value 350 --environment preview --visibility plaintext
eas env:create --name EXPO_PUBLIC_NOTIFICATION_WS_URL --value ws://localhost:8005/ws --environment preview --visibility plaintext
```

## 7) Notes

- Current default is **Demo Mode** (`mock`), suitable for hackathon frontend demos.
- For real backend integration later, switch to:
  - `EXPO_PUBLIC_API_MODE=real`
  - `EXPO_PUBLIC_API_BASE_URL=https://<your-api-domain>`
  - `EXPO_PUBLIC_NOTIFICATION_WS_URL=wss://<your-api-domain>/ws`
