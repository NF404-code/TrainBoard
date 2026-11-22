import { ARRIVAL_SLOTS } from '../src/arrival-slots.mjs';
import { loadGtfs } from '../src/gtfs.mjs';
import { warsawDate } from '../src/schedule-date.mjs';
import { addTripUpdates } from './updates.mjs';
import { readPlan, writePlan, writeSnapshot, storedSnapshot, acquireLease, releaseLease } from './schedule-store.mjs';

const HOUR = 60 * 60 * 1000;
const CACHE_TTL = 7 * 24 * HOUR / 1000;
const RETRY_DELAY = 60 * 1000;
const PLAN_REFRESH_INTERVAL = 3 * 60 * 1000;
const FEED_MAX_AGE = 72 * HOUR;
// Every visitor sends ?refresh=1; honour "force realtime" at most this often.
const FORCE_MIN_INTERVAL = 30 * 1000;
const NO_STORE = { 'Cache-Control': 'no-store' };

// Real calendar date, not just the YYYY-MM-DD shape (rejects 2026-13-45, 2026-02-31).
function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value ?? '')) return false;
  const time = Date.parse(value + 'T12:00:00Z');
  return Number.isFinite(time) && new Date(time).toISOString().startsWith(value);
}

export function createScheduleService({ loadPlan = loadGtfs, addUpdates = addTripUpdates, clock = Date.now } = {}) {
  let latest;
  let inFlight;
  let lastFailureAt = 0;
  let lastForcedAt = 0;

  function cacheKey(request) {
    return new Request(new URL('/__trainboard/schedule-v3-delays', request.url));
  }

  function snapshotFor(feed, date) {
    if (!feed || date < feed.coverageStart || date > feed.coverageEnd) return null;
    const trains = feed.days[date] || [];
    const carried = date === feed.coverageStart ? feed.carriedOvernight : [];
    return {
      date,
      coverageStart: feed.coverageStart,
      coverageEnd: feed.coverageEnd,
      feedVersion: feed.feedVersion,
      checkedAt: feed.checkedAt,
      priorServiceDateCovered: date > feed.coverageStart,
      trains: ARRIVAL_SLOTS.flatMap(slot => {
        const current = trains.find(train => train.slotId === slot.id);
        const previous = carried?.find(train => train.slotId === slot.id);
        return current ? [current] : previous ? [previous] : [];
      }),
    };
  }

  function inheritOvernight(feed, previous) {
    const date = feed.coverageStart;
    const previousSnapshot = snapshotFor(previous, date);
    return (previousSnapshot?.trains || [])
      .filter(train => train.serviceDate < date)
      .map(train => ({ ...train, previousFeed: true }));
  }

  async function readCache(key, env) {
    const durable = await readPlan(env);
    if (durable && (!latest || Date.parse(durable.feedVersion) > Date.parse(latest.feedVersion) ||
        (durable.feedVersion === latest.feedVersion && Date.parse(durable.checkedAt) > Date.parse(latest.checkedAt)))) {
      latest = durable;
      lastFailureAt = 0;
    }
    if (latest) return latest;
    try {
      const response = await globalThis.caches?.default?.match(key);
      if (response) latest ??= await response.json();
    } catch {
      // The in-memory snapshot is also usable when the edge cache is unavailable.
    }
    return latest;
  }

  function compactDay(trains) {
    return trains.map(train => {
      const origin = train.stops[0];
      const destination = train.stops.at(-1);
      return {
        number: train.number,
        slotId: train.slotId,
        targetArrival: train.targetArrival,
        tripId: train.tripId,
        serviceDate: train.serviceDate,
        depart: (origin.departure ?? origin.arrival).slice(0, 5),
        time: (destination.arrival ?? destination.departure).slice(0, 5),
        station: destination.name,
        arrivalDate: destination.arrivalDate ?? destination.departureDate,
        stopSequence: destination.stopSequence,
      };
    });
  }

  async function updateFeed(key, env, ctx) {
    try {
      const feed = await loadPlan({ signal: AbortSignal.timeout(18000) });
      if (latest && Date.parse(feed.feedVersion) < Date.parse(latest.feedVersion)) {
        throw new Error('GTFS publication predates the cached version');
      }
      const carriedOvernight = inheritOvernight(feed, latest);
      feed.days = Object.fromEntries(Object.entries(feed.days).map(([date, trains]) => [date, compactDay(trains)]));
      const candidate = { ...feed, carriedOvernight, checkedAt: new Date(clock()).toISOString() };
      await writePlan(env, candidate);
      latest = candidate;
      lastFailureAt = 0;

      const cache = globalThis.caches?.default;
      if (cache) {
        const body = Response.json(latest, { headers: { 'Cache-Control': `public, max-age=${CACHE_TTL}` } });
        const write = cache.put(key, body).catch(() => {});
        ctx?.waitUntil(write);
      }
    } catch (error) {
      lastFailureAt = clock();
      console.warn('TrainBoard schedule refresh failed:', error instanceof Error ? error.message : String(error));
    }
  }

  // Realtime layer. Never throws because of the realtime feed itself:
  // a broken feed degrades to realtimeStatus "unavailable" instead of being
  // reported to the client as "storage-unavailable".
  async function withRealtime(planned, env, wantsForce) {
    const unavailable = { ...planned, realtimeStatus: 'unavailable', realtimeUpdatedAt: null, realtimeCheckedAt: null };

    // clock(), not the request's start time: the plan update above may have taken ~18 s,
    // and a lease computed from a stale "now" would already be (nearly) expired.
    const lease = await acquireLease(env, 'realtime', clock(), 20000);
    if (!lease) {
      const stored = await storedSnapshot(env, planned.date, clock());
      return stored?.snapshot?.feedVersion === planned.feedVersion
        ? { ...stored.snapshot, checkedAt: planned.checkedAt }
        : unavailable;
    }

    try {
      const force = wantsForce && clock() - lastForcedAt >= FORCE_MIN_INTERVAL;
      if (force) lastForcedAt = clock();

      let snapshot;
      try {
        snapshot = await addUpdates(planned, { signal: AbortSignal.timeout(18000), force });
      } catch (error) {
        console.warn('TrainBoard realtime update failed:', error instanceof Error ? error.message : String(error));
      }
      snapshot ||= unavailable;

      if (snapshot.realtimeStatus === 'unavailable') {
        const prior = await storedSnapshot(env, planned.date, clock());
        if (prior?.snapshot?.feedVersion === planned.feedVersion && prior.snapshot.realtimeUpdatedAt) {
          snapshot = {
            ...prior.snapshot, checkedAt: planned.checkedAt, realtimeStatus: 'stale', realtimeCheckedAt: snapshot.realtimeCheckedAt,
          };
        }
      }
      return snapshot;
    } finally {
      await releaseLease(env, lease).catch(() => {});
    }
  }

  return async function serveSchedule(request, env = {}, ctx) {
    if (request.method !== 'GET') return new Response(null, { status: 405, headers: { Allow: 'GET' } });
    const url = new URL(request.url), now = clock(), currentDate = warsawDate(new Date(now));

    const requestedDate = url.searchParams.get('date');
    if (requestedDate !== null && !validDate(requestedDate))
      return Response.json({ error: 'Invalid date' }, { status: 400, headers: NO_STORE });
    const date = requestedDate ?? currentDate;

    try {
      if (url.searchParams.get('stored') === '1') {
        const stored = await storedSnapshot(env, date, now);
        return Response.json(stored ? { ...stored, fromStorage: true } : { requestedDate: date, status: 'stale', reason: 'not-stored', snapshot: null }, { status: stored ? 200 : 404, headers: NO_STORE });
      }
      const key = cacheKey(request);
      await readCache(key, env);
      const lastCheck = Date.parse(latest?.checkedAt);
      const wantsForce = url.searchParams.has('refresh');
      const interval = wantsForce ? RETRY_DELAY : PLAN_REFRESH_INTERVAL;
      // A missing/garbled checkedAt means "check now"; without the isFinite guard
      // warsawDate(new Date(NaN)) throws on every request and the plan never recovers.
      const needsUpdate = !latest || lastFailureAt || !Number.isFinite(lastCheck) ||
        now - lastCheck >= interval ||
        warsawDate(new Date(lastCheck)) !== currentDate || !snapshotFor(latest, date);
      if (needsUpdate && now - lastFailureAt >= RETRY_DELAY) {
        if (!inFlight) {
          inFlight = (async () => {
            const lease = await acquireLease(env, 'plan', clock(), RETRY_DELAY);
            if (!lease) return;
            try { await updateFeed(key, env, ctx); }
            finally { await releaseLease(env, lease).catch(() => {}); }
          })().finally(() => { inFlight = undefined; });
        }
        await inFlight;
        await readCache(key, env);
      }

      const planned = snapshotFor(latest, date);
      const snapshot = planned?.trains.length ? await withRealtime(planned, env, wantsForce) : planned;

      const current = clock();
      const feedTime = Date.parse(snapshot?.feedVersion);
      const reason = !latest || lastFailureAt ? 'source-unavailable'
        : !snapshot ? 'date-uncovered'
        : current - Date.parse(snapshot.checkedAt) > PLAN_REFRESH_INTERVAL * 2 ? 'check-overdue'
        : Number.isFinite(feedTime) && current - feedTime > FEED_MAX_AGE ? 'feed-old' : null;
      const result = { requestedDate: date, status: reason ? 'stale' : 'fresh', reason, snapshot };
      await writeSnapshot(env, result, clock());
      return Response.json({ ...result, persisted: !!env.DB }, { headers: NO_STORE });
    } catch {
      console.warn('TrainBoard schedule storage unavailable');
      return Response.json({ requestedDate: date, status: 'stale', reason: 'storage-unavailable', snapshot: snapshotFor(latest, date), persisted: false }, { headers: NO_STORE });
    }
  };
}
export const serveSchedule = createScheduleService();