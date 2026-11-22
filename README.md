# TrainBoard — iPhone app + Telegram Cloudflare Worker

TrainBoard shows the Leo Express train schedule and changes. This repository is a **source snapshot**, not a fully exported production system.

## Included

- `ios/TrainBoardApp.swift` — SwiftUI prototype for iOS 17+. Fetches schedule from TrainBoard's public stored-snapshot endpoint, renders trips and locally notifies while the app can check updates.
- `cloudflare/telegram-alerts/worker.js` — recovered source of TrainBoard Telegram-alerts Cloudflare Worker.

## Not included (important)

The production web app's Vite/assets, stylesheet, manifest, full `src/` modules, server modules, deployments and production bindings are not included in this package. **Do not attempt to deploy this source snapshot over the existing production TrainBoard site.** The SwiftUI app has no `.xcodeproj` yet — create one in Xcode as described below.

## iPhone (free development on your own device)

1. Install Xcode.
2. Xcode > File > New > Project > iOS > App; Product Name `TrainBoard`, Interface `SwiftUI`, Language `Swift`.
3. Remove generated `ContentView.swift` and `TrainBoardApp.swift` from the target (delete their file references). Add `ios/TrainBoardApp.swift` to the app target.
4. Set Signing & Capabilities > Team to your Apple Account; use a unique Bundle Identifier.
5. Build and run on your iPhone. Free personal signing generally has a seven-day renewal limit.

The app polls only while active. Reliable background push notifications are **not** implemented. A distribution flow for a group of iPhones also needs its own provisioning/distribution arrangement.

## Cloudflare Worker

`cloudflare/telegram-alerts/worker.js` is a separate worker. The source references `env.TELEGRAM_BOT_TOKEN` and `env.TRAINBOARD_STATE`; these must be configured **outside GitHub** as Cloudflare Worker secrets/bindings (verify binding type and current production configuration first). No actual token is included in this repository.

## Security

Keep this repository **private** until all source files and embedded constants are reviewed. Never commit `.env`, `.dev.vars`, GitHub tokens, Cloudflare credentials or Telegram bot token. If credentials have ever been committed, rotate them.
