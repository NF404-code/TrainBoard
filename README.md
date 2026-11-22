# TrainBoard — расписание Leo Express

**Snapshot of recovered source code.** This is a **partial source archive**, not a reproducible build of the running TrainBoard service. The production deployment remains independent and was not modified by this repository upload.

## Repository contents

| Path | Contents | Status |
| --- | --- | --- |
| `ios/TrainBoardApp.swift` | SwiftUI iPhone app prototype (iOS 17+) | Prototype, no Xcode project yet |
| `cloudflare/telegram-alerts/worker.js` | Telegram notifications Cloudflare Worker | Recovered standalone source, requires Cloudflare bindings |
| `web/src/main.js` | Frontend entry point | Partial, missing styles and imports |
| `web/src/workspace.mjs` | Local workspace and notes handling | Partial, missing import-payload module |
| `web/src/notifications.mjs` | Service worker notification integration | Partial |
| `web/server/worker.mjs` | Web request router | Partial, missing server modules and generated assets |
| `web/server/schedule.mjs` | Train schedule service | Partial, missing GTFS and storage modules |
| `web/server/background.mjs` | Server-side schedule refresh/status | Partial, missing security and storage modules |

The six `web/` files were recovered from saved, indexed TrainBoard source text. They were not reconstructed from a complete production export, and byte-for-byte parity with the deployed code has **not** been established. See [docs/SOURCE_STATUS.md](docs/SOURCE_STATUS.md).

## Run the iPhone prototype locally

1. Install Xcode on a Mac.
2. Create **File → New → Project → iOS → App**. Choose Product Name `TrainBoard`, Interface **SwiftUI**, Language **Swift**, deployment target **iOS 17+**.
3. Replace the generated Swift entry and view with `ios/TrainBoardApp.swift`; remove the generated `@main` entry to prevent duplicates.
4. Choose your Apple Account under **Signing & Capabilities → Team**, and assign a unique bundle identifier.
5. Run on a connected iPhone. Free personal signing normally requires periodic renewal (often every 7 days).

The app reads the stored public schedule snapshot from the current TrainBoard site and polls while active. **Reliable background push notifications are not implemented**; the local notification behavior depends on active polling.

## Cloudflare Worker

The Telegram worker uses runtime `env.TELEGRAM_BOT_TOKEN` and `env.TRAINBOARD_STATE` bindings. Provide credentials only in Cloudflare's secret/configuration system, **not in Git**. Verify the existing production binding names and storage type before deploying. This repo does not include a deployment configuration or secret values.

## Important

- **Do not deploy the incomplete `web/` directory over the current production TrainBoard site.**
- Keep this repository **private**. Review hardcoded identifiers and integration addresses before making it public.
- Never commit `.env`, `.dev.vars`, GitHub tokens, Cloudflare tokens, Telegram bot tokens, private keys, or user data.
- This repository has **not** been build-tested as a full web or iOS application. Missing dependencies are documented.
