import { json, hash } from './security.mjs';
import { serveSchedule } from './schedule.mjs';
import {
  acquireLease,
  releaseLease,
  readLastRun
} from './schedule-store.mjs';

const warsawDay = ms =>
  new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Warsaw' }).format(ms);

// Never throws: null / garbage -> null instead of RangeError (or 1970 for null).
function toIso(value) {
  if (value == null) return null;
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

async function recordRun(env, run) {
  await env.DB.batch([
    env.DB.prepare(
      'INSERT INTO schedule_runs (id, started_at, finished_at, service_date, status, reason, train_count) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).bind(
      run.id,
      run.started_at,
      run.finished_at,
      run.service_date,
      run.status,
      run.reason,
      run.train_count
    ),

    env.DB.prepare(
      'DELETE FROM schedule_runs WHERE id NOT IN (SELECT id FROM schedule_runs ORDER BY finished_at DESC LIMIT 100)'
    ),

    env.DB.prepare(
      "DELETE FROM schedule_snapshots WHERE service_date < date('now', '-7 days')"
    ),
  ]);
}

export function createBackgroundHandler({
  refresh = serveSchedule,
  clock = Date.now
} = {}) {
  return async (request, env, ctx) => {
    if (request.method !== 'POST')
      return json(
        { error: 'Method not allowed' },
        405,
        { Allow: 'POST' }
      );

    const supplied = request.headers.get(
      'X-TrainBoard-Service-Key'
    );

    if (
      !env.SCHEDULE_SERVICE_KEY ||
      !supplied ||
      supplied.length > 1000 ||
      await hash(supplied) !== await hash(env.SCHEDULE_SERVICE_KEY)
    ) {
      return json(
        { error: 'Service authorization required' },
        401
      );
    }

    if (!env.DB)
      return json({ error: 'Storage unavailable' }, 503);

    const id = crypto.randomUUID();
    const startedAt = new Date(clock()).toISOString();

    const makeRun = (status, reason, serviceDate, trainCount = 0) => ({
      id,
      started_at: startedAt,
      finished_at: new Date(clock()).toISOString(),
      service_date: serviceDate || warsawDay(clock()),
      status,
      reason: reason || null,
      train_count: trainCount
    });

    let lease;
    let run;

    try {
      lease = await acquireLease(
        env,
        'background',
        clock(),
        60000,
        90000
      );

      if (!lease) {
        const lastRun = await readLastRun(env);

        return lastRun
          ? json({
              ok: true,
              skipped: true,
              run: lastRun
            })
          : json(
              { error: 'Refresh in progress' },
              429,
              { 'Retry-After': '60' }
            );
      }

      const url = new URL(
        '/api/schedule?refresh=1',
        request.url
      );

      const response = await refresh(
        new Request(url),
        env,
        ctx
      );

      // A non-JSON body (HTML error page, empty 5xx) must not skip logging.
      const result = await response.json().catch(() => null);

      if (!result || typeof result !== 'object') {
        run = makeRun('failed', 'bad-response');
      } else {
        // Original semantics kept: nothing persisted => failed.
        // If "source unavailable, stale copy served" should count as 'stale'
        // rather than 'failed', change this condition accordingly.
        const status = !result.persisted
          ? 'failed'
          : result.status === 'fresh' && result.snapshot
            ? 'fresh'
            : 'stale';

        run = makeRun(
          status,
          result.reason,
          result.requestedDate,
          result.snapshot?.trains?.length || 0
        );
      }
    } catch {
      console.warn('TrainBoard background update failed');
      run = makeRun('failed', 'exception');
    } finally {
      if (lease)
        await releaseLease(env, lease).catch(() => {});
    }

    // Failures are logged too, so /api/schedule/status never shows a stale "success".
    try {
      await recordRun(env, run);
    } catch {
      console.warn('TrainBoard run log failed');
    }

    const failed = run.status === 'failed';

    return json({
      ok: !failed,
      run,
      ...(failed && {
        error: 'Background update failed. Last saved schedule retained.'
      })
    }, failed ? 503 : 200);
  };
}

export const serveBackground = createBackgroundHandler();

export async function serveScheduleStatus(request, env) {
  if (request.method !== 'GET')
    return json(
      { error: 'Method not allowed' },
      405,
      { Allow: 'GET' }
    );

  if (!env.DB)
    return json({ error: 'Storage unavailable' }, 503);

  try {
    const lastRun = await readLastRun(env);

    const plan = await env.DB.prepare(
      'SELECT checked_at, feed_version_at FROM schedule_plan WHERE id = 1'
    ).first();

    return json({
      lastRun,
      planCheckedAt: toIso(plan?.checked_at),
      feedVersion: toIso(plan?.feed_version_at),
      serverTime: new Date().toISOString()
    }, 200, { 'Cache-Control': 'no-store' });
  } catch {
    return json({ error: 'Storage unavailable' }, 503);
  }
}