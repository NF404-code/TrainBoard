# TrainBoard source recovery status

This repository contains a **partial** TrainBoard source snapshot, not a complete export or an independently deployable application.

## Verified recovered files

- `ios/TrainBoardApp.swift` — SwiftUI prototype prepared for this repository
- `cloudflare/telegram-alerts/worker.js` — text of Telegram alerts Cloudflare Worker
- `web/src/main.js` — recovered from saved source text
- `web/src/notifications.mjs` — recovered from saved source text
- `web/src/workspace.mjs` — recovered from saved source text
- `web/server/worker.mjs` — recovered from saved source text
- `web/server/schedule.mjs` — recovered from saved source text
- `web/server/background.mjs` — recovered from saved source text

The `web/` modules were fetched from the owner's indexed TrainBoard Library files. Their text was complete as returned by the index, but original-source byte equivalence and deployment-version parity were **not verified**. No production configuration was changed.

## Known missing web dependencies (not exhaustive)

Frontend:
- `web/src/arrival-slots.mjs`
- `web/src/schedule-date.mjs`
- `web/src/import-payload.mjs`
- `web/src/style.css`, `theme.css`, `history.css`, `access.css`, `premium.css`

Server:
- `web/src/gtfs.mjs`
- `web/server/updates.mjs`
- `web/server/schedule-store.mjs`
- `web/server/security.mjs`
- `web/server/notes.mjs`
- `web/server/auth.mjs`
- `web/server/board-access.mjs`

Build and runtime:
- package manifest, bundler configuration, generated `virtual:trainboard-assets`, HTML/static assets, PWA service worker and manifest
- Cloudflare/hosting deployment configuration and environment bindings (do not commit secrets)
- native iOS `.xcodeproj` or Swift package, distribution and push-notification infrastructure

Do **not** deploy `web/` over the currently running website until missing files are recovered and a clean build and integration tests pass.
