# Lovable Builder Mobile App

This adds a Windows-friendly Expo mobile app plus an optional SwiftUI iOS handoff. The Expo app is the primary local app for this Windows workspace.

## App Paths

- Windows-friendly Expo app: `mobile/LovableBuilderExpo`
- Optional Swift app handoff: `swift/LovableBuilder/LovableBuilder.xcodeproj`
- Mobile API: `/api/mobile-builder`
- Builder engine: `lib/mobile-builder`
- Convex DB functions: `convex/mobileBuilder.ts`
- Convex schema: `convex/schema.ts`

## Flow

1. Tap `Enter App`.
2. The Swift app calls `POST /api/mobile-builder` with `action: "enter"`.
3. A single-user session is returned immediately.
4. The build screen calls `POST /api/mobile-builder` with `action: "build"` and the prompt.
5. The server generates static web app files.
6. If `DAYTONA_API_KEY` is configured, the server creates a Daytona sandbox, uploads files, starts `node server.mjs`, and returns a signed preview URL.
7. If Daytona is not configured, the Swift app still renders the generated inline preview.
8. If `CONVEX_URL` is configured and the Convex functions are deployed, generated projects sync to Convex.

## Environment Variables

```bash
DAYTONA_API_KEY=your_daytona_api_key_here
DAYTONA_API_URL=https://app.daytona.io/api
DAYTONA_TARGET=us
CONVEX_URL=https://your-convex-deployment.convex.cloud
VITE_CONVEX_URL=https://your-convex-deployment.convex.cloud
BUILDER_API_BASE_URL=https://your-production-domain.com
```

`DAYTONA_API_KEY` stays server-side. The Swift app only calls your own backend.

## Local Mobile Preview

For Windows, use the Expo app:

```bash
cd mobile/LovableBuilderExpo
npm run typecheck
npm run export:web
npm run serve:web
```

The exported preview serves at `http://localhost:8081` by default. The app calls the builder backend at `http://localhost:3000/api/mobile-builder`.

For Expo Go on a physical phone, set `EXPO_PUBLIC_BUILDER_API_BASE_URL` to a LAN or production URL that the phone can reach.

The Swift project remains available for a future Mac/Xcode iOS build, but it is not required for Windows development.
