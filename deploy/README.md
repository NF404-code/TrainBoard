# TrainBoard preview — Cloudflare Pages

This is a **separate, deployable PWA preview** based on the currently available TrainBoard public schedule endpoint. It does **not** replace the original TrainBoard web app and does not provide closed-app push notifications.

## Deployment settings (free plan)

Use Cloudflare dashboard → **Workers & Pages** → **Create application** → **Pages** → **Connect to Git**.

- Git provider: **GitHub**
- Repository: **NF404-code/TrainBoard** (private repositories supported)
- Project name: **trainboard-preview** (or another available name)
- Production branch: **main**
- **Root directory:** `deploy`
- Framework preset: **None**
- **Build command:** `exit 0`
- **Build output directory:** `public`

Choose **Save and Deploy**. A live `https://<project-name>.pages.dev` URL will appear **only after Cloudflare confirms successful deployment**. Do not guess this URL in advance.

The project uses `deploy/functions/api/schedule.js` as a server-side, read-only proxy to the existing TrainBoard endpoint. This avoids client-side CORS issues. It has no secret or Cloudflare configuration dependencies. The upstream endpoint must permit server-side access; without a confirmed successful deployment and live API check, fetching schedules cannot be guaranteed.

## Verify live deployment

1. Open your Pages URL. The interface should render even if the train feed is temporarily unavailable.
2. Open `https://<project-name>.pages.dev/api/schedule`. It should return JSON with `snapshot`, `snapshot.date`, `status`, and `fromStorage`.
3. Confirm the displayed date and the "fresh" or "stale" status.
4. On iPhone Safari, use Share → Add to Home Screen for an app-like PWA.

## Limits

The interface checks updates every 30 seconds **while visible**, but browser suspension stops checks and there is no reliable closed-app push system. This preview does not include workspace history, authentication, premium view, or the complete existing production site. The original deployment remains untouched.

The static files are in `deploy/public/`. Cloudflare Pages Functions are in `deploy/functions/` (not in the static output directory). Cloudflare Pages Git integration automatically redeploys future commits to `main`, once configured.

**Privacy:** a private GitHub repository does not make the published Pages URL private. Use Cloudflare Access for group-only website access.
