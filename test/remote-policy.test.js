const { test } = require('node:test');
const assert = require('node:assert/strict');
const P = require('../dist/remote-policy.js');
const { TOOL_DEFINITIONS } = require('../dist/tools.js');

const NAMES = new Set(TOOL_DEFINITIONS.map((t) => t.name));

test('every classified tool exists, and the classes do not overlap', () => {
  for (const set of [P.ANON_TOOLS, P.MONEY_TOOLS, P.STDIO_ONLY_TOOLS]) {
    for (const n of set) assert.ok(NAMES.has(n), `${n} is not a tool`);
  }
  for (const n of P.MONEY_TOOLS) {
    assert.ok(!P.ANON_TOOLS.has(n), `${n} is money-moving and anonymous`);
    assert.ok(!P.STDIO_ONLY_TOOLS.has(n), `${n} is money-moving and stdio-only`);
  }
  for (const n of P.ANON_TOOLS) assert.ok(!P.STDIO_ONLY_TOOLS.has(n), n);
});

test('any tool whose name says it pays, sends, bets or moves sats is in MONEY_TOOLS', () => {
  const moneyish = /^(pay_|keysend|withdraw|fund_|transfer_|sweep_|nostr_zap|claim_|prediction_place_bet|arena_join|board_(post|reply|vote))/;
  for (const n of NAMES) if (moneyish.test(n)) assert.ok(P.MONEY_TOOLS.has(n), `${n} looks money-moving but is not gated`);
});

test('decideTool: anonymous, authenticated, stdio-only and kill switch', () => {
  assert.deepEqual(P.decideTool('get_info', { authenticated: false, killSwitch: false }), { allow: true, money: false });
  assert.equal(P.decideTool('check_balance', { authenticated: false, killSwitch: false }).error, 'auth_required');
  assert.equal(P.decideTool('pay_invoice', { authenticated: false, killSwitch: true }).error, 'auth_required');
  assert.deepEqual(P.decideTool('pay_invoice', { authenticated: true, killSwitch: false }), { allow: true, money: true });
  assert.equal(P.decideTool('pay_invoice', { authenticated: true, killSwitch: true }).error, 'money_tools_disabled');
  assert.deepEqual(P.decideTool('check_balance', { authenticated: true, killSwitch: true }), { allow: true, money: false });
  for (const n of P.STDIO_ONLY_TOOLS) assert.equal(P.decideTool(n, { authenticated: true, killSwitch: false }).error, 'not_available_remotely');
});

test('parseBearer accepts lf_ and agent_ keys only', () => {
  const op = 'lf_' + 'a'.repeat(48);
  const ag = 'agent_' + '0'.repeat(48);
  assert.deepEqual(P.parseBearer(undefined), { kind: 'none' });
  assert.deepEqual(P.parseBearer(''), { kind: 'none' });
  assert.deepEqual(P.parseBearer(`Bearer ${op}`), { kind: 'key', key: op });
  assert.deepEqual(P.parseBearer(`bearer ${ag}`), { kind: 'key', key: ag });
  assert.equal(P.parseBearer(`Basic ${op}`).kind, 'invalid');
  assert.equal(P.parseBearer('Bearer sk-live-123').kind, 'invalid');
  assert.equal(P.parseBearer(`Bearer ${op} extra`).kind, 'invalid');
  assert.equal(P.parseBearer([`Bearer ${op}`, `Bearer ${ag}`]).kind, 'invalid');
});

test('keyTag is short and not the key', () => {
  const k = 'lf_' + 'b'.repeat(48);
  assert.equal(P.keyTag(k).length, 12);
  assert.ok(!k.includes(P.keyTag(k)));
});

test('resolveClientIp trusts forwarded headers only from trusted proxies', () => {
  const trusted = new Set(['127.0.0.1', '::1']);
  assert.equal(P.resolveClientIp('127.0.0.1', { 'x-real-ip': '203.0.113.5' }, trusted), '203.0.113.5');
  assert.equal(P.resolveClientIp('::ffff:127.0.0.1', { 'x-forwarded-for': '198.51.100.1, 10.0.0.1' }, trusted), '198.51.100.1');
  assert.equal(P.resolveClientIp('198.51.100.9', { 'x-real-ip': '203.0.113.5' }, trusted), '198.51.100.9');
  assert.equal(P.resolveClientIp('127.0.0.1', { 'x-real-ip': 'not-an-ip' }, trusted), '127.0.0.1');
  assert.equal(P.resolveClientIp(undefined, {}, trusted), null);
});

test('isPrivateIp', () => {
  for (const ip of ['127.0.0.1', '10.1.2.3', '192.168.1.27', '172.16.0.1', '100.64.0.1', '169.254.1.1', '::1', 'fd00::1', 'fe80::1', '0.0.0.0']) assert.ok(P.isPrivateIp(ip), ip);
  for (const ip of ['203.0.113.5', '8.8.8.8', '172.32.0.1', '2606:4700::1']) assert.ok(!P.isPrivateIp(ip), ip);
});

test('origin and host checks', () => {
  const origins = new Set(['https://claude.ai']);
  assert.ok(P.originAllowed('https://claude.ai', origins));
  assert.ok(P.originAllowed('http://localhost:6274', origins));
  assert.ok(!P.originAllowed('https://evil.example', origins));
  assert.ok(!P.originAllowed('http://localhost.evil.example', origins));
  const hosts = new Set(['lightningfaucet.com', '127.0.0.1']);
  assert.ok(P.hostAllowed('lightningfaucet.com', hosts));
  assert.ok(P.hostAllowed('127.0.0.1:8893', hosts));
  assert.ok(!P.hostAllowed('evil.example', hosts));
  assert.ok(!P.hostAllowed(undefined, hosts));
});

test('RateLimiter fixed window', () => {
  const rl = new P.RateLimiter();
  const t0 = 1_000_000;
  assert.equal(rl.hit('a', 2, 60_000, t0), 0);
  assert.equal(rl.hit('a', 2, 60_000, t0 + 1), 0);
  assert.equal(rl.hit('a', 2, 60_000, t0 + 2), 60);
  assert.equal(rl.hit('b', 2, 60_000, t0 + 2), 0);
  assert.equal(rl.hit('a', 2, 60_000, t0 + 60_000), 0);
  const small = new P.RateLimiter(2);
  small.hit('x', 5, 1000, t0); small.hit('y', 5, 1000, t0); small.hit('z', 5, 1000, t0);
  assert.ok(small.size <= 2);
});

test('capResult keeps output under the cap and says so', () => {
  const small = { content: [{ type: 'text', text: 'ok' }] };
  assert.equal(P.capResult(small), small);
  const big = { content: [{ type: 'text', text: 'x'.repeat(100_000) }] };
  const out = P.capResult(big);
  assert.ok(out.content[0].text.length <= P.MAX_RESULT_CHARS);
  const parsed = JSON.parse(out.content[0].text);
  assert.equal(parsed.truncated, true);
  assert.equal(parsed.original_chars, 100_000);
  // Characters that JSON escapes must not push the result past the cap.
  const escapy = { content: [{ type: 'text', text: JSON.stringify({ data: '"\\\n'.repeat(40_000) }, null, 2) }] };
  const out2 = P.capResult(escapy);
  assert.ok(out2.content[0].text.length <= P.MAX_RESULT_CHARS, `got ${out2.content[0].text.length}`);
  assert.equal(JSON.parse(out2.content[0].text).truncated, true);
});

test('amountForLog reads amounts, never secrets', () => {
  assert.equal(P.amountForLog('keysend', { amount_sats: 21, destination: 'x' }), 21);
  assert.equal(P.amountForLog('pay_l402_api', { url: 'https://x', max_payment_sats: 50 }), 50);
  assert.equal(P.amountForLog('pay_invoice', { bolt11: 'lnbc10u1pxyz' }), 1000);
  assert.equal(P.amountForLog('get_info', {}), null);
  assert.equal(P.amountForLog('get_info', undefined), null);
});
