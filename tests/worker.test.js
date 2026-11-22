import assert from 'node:assert/strict';
import test from 'node:test';
import worker, { parseCommand, projectPlan, match } from '../worker.js';

const OWNER = 876976709;
const tick = 1795300000;

function command(text, opts = {}) {
  return {
    update_id: 100,
    message: {
      date: tick - 2,
      text,
      entities: [{ type: 'bot_command', offset: 0, length: text.length }],
      from: { id: opts.owner ?? OWNER, is_bot: false },
      chat: { type: opts.type ?? 'supergroup', id: opts.chat ?? -1004399050706 }
    }
  };
}

test('connect is allowed only for the owner in a group', () => {
  const result = parseCommand(command('/connect@assistantbratishka_bot'), tick);
  assert.equal(result?.start, true);
  assert.equal(result?.chat.id, -1004399050706);
  assert.equal(parseCommand(command('/connect@assistantbratishka_bot', { owner: 100 }), tick), null);
  assert.equal(parseCommand(command('/connect@assistantbratishka_bot', { type: 'private' }), tick), null);
  assert.equal(parseCommand(command('/connect@other_bot'), tick), null);
});

test('old and new start/stop commands work', () => {
  assert.equal(parseCommand(command('/disconnect@assistantbratishka_bot'), tick)?.start, false);
  assert.equal(parseCommand(command('/trainboard_start@assistantbratishka_bot'), tick)?.start, true);
  assert.equal(parseCommand(command('/trainboard_stop@assistantbratishka_bot'), tick)?.start, false);
});

test('old command cannot activate bot', () => {
  assert.equal(parseCommand(command('/connect@assistantbratishka_bot'), tick + 2000), null);
});

test('bad schedule is never accepted as fresh', () => {
  const day = '2026-11-22';
  const invalid = {
    fromStorage: true,
    requestedDate: day,
    status: 'stale',
    reason: 'source-unavailable',
    snapshot: { date: day, trains: [] }
  };
  assert.throws(() => projectPlan(invalid, day), /plan-unavailable/);
});

test('unreported realtime values do not invent change', () => {
  const prev = { status: 'scheduled', delay: 5, expected: '15:05', planned: '15:00', trustedPlan: true };
  const next = { status: 'scheduled', delay: null, expected: null, planned: '15:00', trustedPlan: true };
  const updated = match(prev, next);
  assert.equal(updated.change, null);
  assert.equal(updated.value.delay, 5);
  assert.equal(updated.value.expected, '15:05');
});

test('health endpoint hides secrets and chat ID', async () => {
  const kv = { get: async () => ({
    cronAt: Math.floor(Date.now() / 1000),
    telegramVerified: true,
    enabled: true,
    chat: { id: -1001234567 }
  }) };
  const env = {
    TELEGRAM_BOT_TOKEN: '12345:abcdefghijklmnopqrstuvwxy',
    TRAINBOARD_STATE: kv
  };
  const res = await worker.fetch(new Request('https://example.test/health'), env);
  assert.equal(res.status, 200);
  const body = await res.text();
  assert.doesNotMatch(body, /12345:abcdefgh/);
  assert.doesNotMatch(body, /1001234567/);
  assert.match(body, /trainboard-alerts/);
});
