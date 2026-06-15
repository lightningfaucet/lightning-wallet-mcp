'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const {
  getPrePaymentHookConfig,
  runPrePaymentHook,
  PolicyDenied,
} = require('../dist/pre-payment-hook.js');

// ---------------------------------------------------------------------------
// getPrePaymentHookConfig
// ---------------------------------------------------------------------------

test('config: returns null when no hook URL is set', () => {
  assert.equal(getPrePaymentHookConfig({}), null);
  assert.equal(getPrePaymentHookConfig({ PRE_PAYMENT_HOOK_URL: '   ' }), null);
});

test('config: defaults timeout to 3000 and fail mode to closed', () => {
  const cfg = getPrePaymentHookConfig({ PRE_PAYMENT_HOOK_URL: 'https://h' });
  assert.deepEqual(cfg, { url: 'https://h', timeoutMs: 3000, failMode: 'closed' });
});

test('config: parses a valid timeout, falls back on invalid/non-positive', () => {
  assert.equal(
    getPrePaymentHookConfig({ PRE_PAYMENT_HOOK_URL: 'https://h', PRE_PAYMENT_HOOK_TIMEOUT_MS: '500' }).timeoutMs,
    500
  );
  for (const bad of ['abc', '0', '-5', '']) {
    assert.equal(
      getPrePaymentHookConfig({ PRE_PAYMENT_HOOK_URL: 'https://h', PRE_PAYMENT_HOOK_TIMEOUT_MS: bad }).timeoutMs,
      3000
    );
  }
});

test('config: fail mode open only when explicitly "open" (case-insensitive)', () => {
  const open = (v) => getPrePaymentHookConfig({ PRE_PAYMENT_HOOK_URL: 'https://h', PRE_PAYMENT_HOOK_FAIL_MODE: v }).failMode;
  assert.equal(open('open'), 'open');
  assert.equal(open('OPEN'), 'open');
  assert.equal(open('closed'), 'closed');
  assert.equal(open('garbage'), 'closed');
  assert.equal(open(undefined), 'closed');
});

// ---------------------------------------------------------------------------
// runPrePaymentHook
// ---------------------------------------------------------------------------

const PROPOSAL = {
  proposal_id: 'p1',
  agent_id: 7,
  protocol: 'l402',
  destination_or_url: 'https://api.example/x',
  amount_sats: null,
  max_payment_sats: 1000,
  method: 'GET',
  ts: '2026-06-06T00:00:00.000Z',
};

const cfg = (over = {}) => ({ url: 'https://hook', timeoutMs: 1000, failMode: 'closed', ...over });
const respond = (obj, ok = true, status = 200) => async () => ({ ok, status, json: async () => obj });

test('hook: allow resolves and forwards the opaque attestation', async () => {
  const out = await runPrePaymentHook(PROPOSAL, cfg(), {
    fetchImpl: respond({ decision: 'allow', attestation: { token: 'abc' } }),
  });
  assert.deepEqual(out, { attestation: { token: 'abc' } });
});

test('hook: deny throws PolicyDenied carrying the structured reason', async () => {
  await assert.rejects(
    () => runPrePaymentHook(PROPOSAL, cfg(), {
      fetchImpl: respond({ decision: 'deny', reason: { code: 'over_limit', message: 'exceeds ceiling' } }),
    }),
    (err) => {
      assert.ok(err instanceof PolicyDenied);
      assert.equal(err.code, 'over_limit');
      assert.equal(err.reason.message, 'exceeds ceiling');
      assert.match(err.message, /exceeds ceiling/);
      return true;
    }
  );
});

test('hook: non-2xx denies under fail-closed and surfaces the status, proceeds under fail-open', async () => {
  await assert.rejects(
    () => runPrePaymentHook(PROPOSAL, cfg({ failMode: 'closed' }), { fetchImpl: respond({}, false, 503) }),
    (err) => {
      assert.ok(err instanceof PolicyDenied);
      assert.equal(err.code, 'policy_hook_unavailable');
      // Regression: the HTTP status must reach the error, not be swallowed and
      // re-wrapped as a generic "request failed".
      assert.match(err.message, /HTTP 503/);
      return true;
    }
  );
  const out = await runPrePaymentHook(PROPOSAL, cfg({ failMode: 'open' }), { fetchImpl: respond({}, false, 503) });
  assert.deepEqual(out, {});
});

test('hook: transport/timeout error denies under fail-closed, proceeds under fail-open', async () => {
  const abort = async () => { const e = new Error('aborted'); e.name = 'AbortError'; throw e; };
  await assert.rejects(
    () => runPrePaymentHook(PROPOSAL, cfg({ failMode: 'closed' }), { fetchImpl: abort }),
    (err) => err instanceof PolicyDenied && err.code === 'policy_hook_unavailable'
  );
  const out = await runPrePaymentHook(PROPOSAL, cfg({ failMode: 'open' }), { fetchImpl: abort });
  assert.deepEqual(out, {});
});

test('hook: malformed decision is treated as a hook error (fail-closed denies)', async () => {
  await assert.rejects(
    () => runPrePaymentHook(PROPOSAL, cfg(), { fetchImpl: respond({ decision: 'maybe' }) }),
    (err) => err instanceof PolicyDenied
  );
});

test('hook: proposal carries no api key / credentials', async () => {
  let sentBody;
  await runPrePaymentHook(PROPOSAL, cfg(), {
    fetchImpl: async (_url, opts) => { sentBody = JSON.parse(opts.body); return { ok: true, status: 200, json: async () => ({ decision: 'allow' }) }; },
  });
  assert.deepEqual(Object.keys(sentBody).sort(), [
    'agent_id', 'amount_sats', 'destination_or_url', 'max_payment_sats', 'method', 'proposal_id', 'protocol', 'ts',
  ]);
  assert.ok(!('api_key' in sentBody));
});
