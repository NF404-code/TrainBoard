import assets from 'virtual:trainboard-assets';
import { serveSchedule } from './schedule.mjs';
import { serveNotes, serveImport } from './notes.mjs';
import { serveAuth, serveTeam } from './auth.mjs';
import { serveBackground, serveScheduleStatus } from './background.mjs';
import { serveBoardSession } from './board-access.mjs';

const SECURITY_HEADERS = {
  'X-Content-Type-Options': 'nosniff',
  'Referrer-Policy': 'no-referrer',
  'Permissions-Policy': 'camera=(), microphone=(), geolocation=()',
  'Content-Security-Policy':
    "default-src 'self'; script-src 'self'; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; font-src 'self' https://fonts.gstatic.com; img-src 'self' data:; connect-src 'self'; worker-src 'self'; object-src 'none'; base-uri 'none'; form-action 'self'",
};

const IMPORT_PATHS = new Set([
  '/api/notes/import',
  '/api/notes/import-preview',
  '/api/notes/import-receipt',
]);

// Decoded bytes + ETag are computed once per isolate instead of on every request.
const decoded = new Map();

function decodeBase64(base64) {
  const binary = atob(base64);
  const bytes = new Uint8Array(binary.length);
  for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
  return bytes;
}

async function prepare(key, item) {
  let entry = decoded.get(key);
  if (!entry) {
    const bytes = decodeBase64(item.body);
    const digest = new Uint8Array(await crypto.subtle.digest('SHA-1', bytes));
    const etag = '"' + Array.from(digest.slice(0, 8), b => b.toString(16).padStart(2, '0')).join('') + '"';
    entry = { bytes, etag };
    decoded.set(key, entry);
  }
  return entry;
}

function etagMatches(header, etag) {
  if (!header) return false;
  if (header.trim() === '*') return true;
  return header.split(',').some(value => value.trim().replace(/^W\//, '') === etag);
}

async function serveStatic(request, pathname) {
  if (request.method !== 'GET' && request.method !== 'HEAD')
    return new Response('Method not allowed', {
      status: 405,
      headers: { Allow: 'GET, HEAD' },
    });

  const key = pathname === '/' ? '/index.html' : pathname;
  const item = Object.hasOwn(assets, key) ? assets[key] : null;

  if (!item)
    return new Response('Not found', { status: 404 });

  const { bytes, etag } = await prepare(key, item);

  const headers = {
    ...SECURITY_HEADERS,
    'Content-Type': item.contentType,
    'Cache-Control': pathname.startsWith('/assets/')
      ? 'public, max-age=86400'
      : 'no-cache', // with ETag: revalidated, 304 when unchanged
    ETag: etag,
  };

  if (etagMatches(request.headers.get('If-None-Match'), etag))
    return new Response(null, { status: 304, headers });

  return new Response(request.method === 'HEAD' ? null : bytes, { headers });
}

export default {
  async fetch(request, env, ctx) {
    const { pathname } = new URL(request.url);

    if (pathname === '/api/schedule')
      return serveSchedule(request, env, ctx);

    if (pathname === '/api/schedule/background')
      return serveBackground(request, env, ctx);

    if (pathname === '/api/schedule/status')
      return serveScheduleStatus(request, env);

    if (pathname === '/api/notes')
      return serveNotes(request, env);

    if (pathname === '/api/notes/session')
      return serveBoardSession(request, env);

    if (IMPORT_PATHS.has(pathname))
      return serveImport(request, env);

    if (pathname.startsWith('/api/auth/'))
      return serveAuth(request, env);

    if (pathname === '/api/team')
      return serveTeam(request, env);

    return serveStatic(request, pathname);
  },
};