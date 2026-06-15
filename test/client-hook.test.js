'use strict';

// Pin the LF API base BEFORE requiring the client (it reads the env at import).
process.env.LIGHTNING_WALLET_API_URL = 'https://lf.test/api';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { LightningFaucetClient } = require('../dist/lightning-faucet.js');
const { PolicyDenied } = require('../dist/pre-payment-hook.js');

const API = 'https://lf.test/api';
const HOOK = 'https://hook.test/policy';
const realFetch = global.fetch;

const jsonResponse = (obj, ok = true, status = 200) => ({ ok, status, json: async () => obj });

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.PRE_PAYMENT_HOOK_URL;
  delete process.env.PRE_PAYMENT_HOOK_TIMEOUT_MS;
  delete process.env.PRE_PAYMENT_HOOK_FAIL_MODE;
});

// Build a fetch stub. `hook` decides the hook response (or 'timeout'); records
// whether the funds-moving LF payment action was ever sent.
function stubFetch(hook) {
  const state = { paymentExecuted: false, hookCalled: false };
  global.fetch = async (url, opts) => {
    if (url === HOOK) {
      state.hookCalled = true;
      if (hook === 'timeout') {
        return new Promise((_, reject) => {
          opts.signal.addEventListener('abort', () => {
            const e = new Error('aborted'); e.name = 'AbortError'; reject(e);
          });
        });
      }
      return jsonResponse(hook);
    }
    // Otherwise it's the LF backend (single POST endpoint, action in the body).
    const body = JSON.parse(opts.body);
    if (body.action === 'whoami') return jsonResponse({ success: true, type: 'agent', id: 7 });
    if (body.action === 'l402_pay') {
      state.paymentExecuted = true;
      return jsonResponse({ success: true, status_code: 200, body: '{"ok":true}' });
    }
    return jsonResponse({ success: true });
  };
  return state;
}

test('deny: l402Pay raises PolicyDenied and executes NO payment', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  const state = stubFetch({ decision: 'deny', reason: { code: 'over_limit', message: 'exceeds delegation ceiling' } });
  const client = new LightningFaucetClient('test-key');

  await assert.rejects(
    () => client.l402Pay('https://api.example/paid', 'GET', undefined, 1000),
    (err) => err instanceof PolicyDenied && err.code === 'over_limit'
  );
  assert.equal(state.paymentExecuted, false, 'payment must not execute on deny');
  assert.equal(state.hookCalled, true);
});

test('allow: l402Pay proceeds and executes the payment', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  const state = stubFetch({ decision: 'allow' });
  const client = new LightningFaucetClient('test-key');

  const res = await client.l402Pay('https://api.example/paid', 'GET', undefined, 1000);
  assert.equal(state.paymentExecuted, true);
  assert.equal(res.statusCode, 200);
});

test('unconfigured: no hook call, payment proceeds unchanged', async () => {
  // PRE_PAYMENT_HOOK_URL intentionally unset.
  const state = stubFetch({ decision: 'deny' }); // would deny IF the hook were called
  const client = new LightningFaucetClient('test-key');

  await client.l402Pay('https://api.example/paid', 'GET', undefined, 1000);
  assert.equal(state.hookCalled, false, 'hook must not be contacted when unconfigured');
  assert.equal(state.paymentExecuted, true);
});

test('timeout: fail-closed denies and executes NO payment', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  process.env.PRE_PAYMENT_HOOK_TIMEOUT_MS = '50';
  const state = stubFetch('timeout');
  const client = new LightningFaucetClient('test-key');

  await assert.rejects(
    () => client.l402Pay('https://api.example/paid', 'GET', undefined, 1000),
    (err) => err instanceof PolicyDenied && err.code === 'policy_hook_unavailable'
  );
  assert.equal(state.paymentExecuted, false);
});

test('proposal_id is unique per payment attempt', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  const ids = [];
  global.fetch = async (url, opts) => {
    if (url === HOOK) {
      ids.push(JSON.parse(opts.body).proposal_id);
      return jsonResponse({ decision: 'allow' });
    }
    const body = JSON.parse(opts.body);
    if (body.action === 'whoami') return jsonResponse({ success: true, id: 7 });
    return jsonResponse({ success: true, status_code: 200, body: '{}' });
  };
  const client = new LightningFaucetClient('test-key');
  await client.l402Pay('https://api.example/a', 'GET', undefined, 1000);
  await client.l402Pay('https://api.example/b', 'GET', undefined, 1000);
  assert.equal(ids.length, 2);
  assert.notEqual(ids[0], ids[1]);
  assert.ok(ids[0] && ids[1]);
});

test('nostrZap is gated by the hook (deny blocks it, no payment)', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  let zapExecuted = false;
  global.fetch = async (url, opts) => {
    if (url === HOOK) return jsonResponse({ decision: 'deny', reason: { message: 'blocked' } });
    const body = JSON.parse(opts.body);
    if (body.action === 'whoami') return jsonResponse({ success: true, id: 7 });
    if (body.action === 'nostr_zap') { zapExecuted = true; return jsonResponse({ success: true }); }
    return jsonResponse({ success: true });
  };
  const client = new LightningFaucetClient('test-key');
  await assert.rejects(() => client.nostrZap('alice@example.com', 500), (err) => err instanceof PolicyDenied);
  assert.equal(zapExecuted, false);
});

test('keysend is also gated by the hook (deny blocks it)', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  const state = stubFetch({ decision: 'deny', reason: { message: 'blocked' } });
  // Record keysend action separately.
  const prev = global.fetch;
  global.fetch = async (url, opts) => {
    if (url !== HOOK) {
      const body = JSON.parse(opts.body);
      if (body.action === 'keysend') state.paymentExecuted = true;
    }
    return prev(url, opts);
  };
  const client = new LightningFaucetClient('test-key');

  await assert.rejects(() => client.keysend('02abc', 500, 'hi'), (err) => err instanceof PolicyDenied);
  assert.equal(state.paymentExecuted, false);
});
