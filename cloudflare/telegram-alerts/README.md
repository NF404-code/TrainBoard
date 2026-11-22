# TrainBoard Telegram alerts Worker

**Important:** The source in this directory is maintained in GitHub, but this repository is **not yet connected to the deployed Cloudflare Worker**. A successful commit or GitHub Actions check does not change the live Telegram bot. The separate Cloudflare Pages project `trainboard-preview` does not deploy this Worker.

## Version 2.2 — closest changed train, single card

- Monitor the four configured Leo Express slots using the stored TrainBoard plan and a fresh GTFS-RT feed.
- Detect confirmed changes to arrivals/delays, cancellations, skipped stops, planned train number, platform and track.
- On each scheduled check, select **the nearest upcoming affected arrival**. If several trains changed simultaneously, display **one** card for the nearest train, not a digest.
- Send one PNG photo with a human-readable change caption; retain the returned Telegram `message_id`.
- Delete the previous **bot-owned** photo message in the same paired chat/topic after recording the new successful send. Failed deletions are retried.
- Do not send test photos on pairing, text on disconnect, or outage/stale-data notifications.
- Remove an older own photo after 47 hours even when no new alert is sent; the Telegram API does not permit deletions after 48 hours.

**Important limitations:** A clean start without prior monitoring state cannot reconstruct an earlier event as a change; already-sent messages that the Worker state does not know cannot be retroactively deleted. Deletions depend on Telegram group permissions and API availability. Updates occur no faster than the Worker cron and the source updates. A source outage produces silence, not an invented change.

## Existing Cloudflare Worker

Live target: `trainboard-alerts` (`https://trainboard-alerts.slavchenkoyurii.workers.dev`).

**Do not overwrite the running Worker before backing up its current script and checking the bindings.** On 2026-11-22 its public `/health` returned a different response from the version in this repository, so the deployed code is not confirmed to match this snapshot.

Manual rollout in Cloudflare:
1. Open **Workers & Pages → trainboard-alerts → Edit code**.
2. Save a private copy of the **current** deployed source in case rollback is needed. Do not paste credentials into GitHub.
3. Verify the existing binding `TRAINBOARD_STATE` points to the intended KV namespace (or D1 database), and the secret `TELEGRAM_BOT_TOKEN` is present. Preserve the existing bindings and cron (`*/2 * * * *`) when deploying.
4. Replace the script with the complete contents of `worker.js`, then **Deploy**.
5. Check `/health` on the Worker URL: the expected JSON includes `"version":"2.2.0"`. If it does not, this source has not been deployed.
6. In the Telegram group/topic, if pairing is needed, the bot owner sends `/trainboard_start@assistantbratishka_bot`. Pairing produces no bot message. `/trainboard_stop@assistantbratishka_bot` disables notifications silently.
7. Verify an actual schedule change causes a **single photo** and the previously posted bot photo is deleted. Avoid manufacturing false railway changes.

This deployment is **independent** of `trainboard-preview.pages.dev`.
