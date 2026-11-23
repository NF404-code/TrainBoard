# TrainBoard Web Push — deployment is NOT complete

This Cloudflare Worker runs independently of the Telegram Worker and the existing trainboard-freeman site. Its cron checks a saved schedule every two minutes, detects a confirmed change against a persisted baseline, and broadcasts encrypted Web Push to subscribed browsers.

## Required Cloudflare setup

1. Create a **new KV namespace** for Web Push, then add it under [[kv_namespaces]] in `push/wrangler.toml`, with binding `PUSH_STATE`.
2. Generate a proper P-256 Web Push VAPID key pair: the private key is 32 bytes in base64url format; public key is uncompressed 65-byte P-256 key in base64url. Do not put them in Git.
3. Set Worker secrets `VAPID_PUBLIC_KEY`, `VAPID_PRIVATE_KEY`, `VAPID_SUBJECT` (e.g. mailto:operator@example.com), and a long random `PUSH_PROXY_SECRET`. Also set this **same secret** as `PUSH_PROXY_SECRET` in the Cloudflare Pages project hosting the preview.
4. Deploy with `npx wrangler deploy --config push/wrangler.toml`, after verifying your Cloudflare account, worker namespace, route and bindings.
5. Deploy the Cloudflare Pages preview with Git integration and root directory `deploy`. Routes `/api/push/config`, `/api/push/subscribe`, `/api/push/unsubscribe` must proxy successfully.
6. Install the web app on iPhone via Safari's **Add to Home Screen**, open the app, and explicitly enable notifications. A denial is stored without repeated prompts.
7. Verify the subscription was stored, Cloudflare cron runs, and one **real** schedule change is delivered after closing the PWA.

### Operational limitations

- This implementation checks every **2 minutes**, not instantly. Cloudflare cron latency, upstream feed latency and push-provider delivery add delay.
- The original trainboard-freeman production website is **not** replaced or modified by this repository. The push button was added only to `deploy/public` (the separate preview).
- KV listing supports at most 1,000 subscriptions per scan; use a durable queue for more users and per-subscriber delivery retries if delivery guarantees are required.
- No source change can be detected while the source API is stale or unavailable. The first confirmed snapshot sets the baseline and does not trigger alerts.
- You must configure the existing Pages deployment separately; this repository cannot authenticate to Cloudflare by itself.
- Never check credentials, subscription endpoints or private data into GitHub.
- The Pages proxy implements shared-secret server-to-server authentication, but does not itself have abuse-rate limits. Before public launch, add Cloudflare WAF rate limits or Turnstile for subscription endpoints.
