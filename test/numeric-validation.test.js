'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const { spawnSync } = require('node:child_process');

const { parseStrictInt } = require('../dist/validate.js');
const { getPrePaymentHookConfig } = require('../dist/pre-payment-hook.js');

const CLI = path.join(__dirname, '..', 'dist', 'cli.js');

test('parseStrictInt accepts plain integers and numbers', () => {
  assert.equal(parseStrictInt('42'), 42);
  assert.equal(parseStrictInt(' 7 '), 7);
  assert.equal(parseStrictInt(0, { min: 0 }), 0);
  assert.equal(parseStrictInt('+5'), 5);
});

test('parseStrictInt rejects NaN, trailing junk, decimals, empty, booleans, unsafe values', () => {
  for (const bad of ['abc', '12abc', '1.5', '1e3', '', '  ', 'NaN', 'Infinity', true, undefined, null, NaN, Infinity, 1.5, '9007199254740993']) {
    assert.equal(parseStrictInt(bad), null, `should reject ${String(bad)}`);
  }
});

test('parseStrictInt enforces min and max', () => {
  assert.equal(parseStrictInt('-1', { min: 0 }), null);
  assert.equal(parseStrictInt('0', { min: 1 }), null);
  assert.equal(parseStrictInt('101', { max: 100 }), null);
  assert.equal(parseStrictInt('100', { min: 1, max: 100 }), 100);
});

test('pre-payment hook timeout rejects junk, negatives, zero and out of range', () => {
  const t = (v) => getPrePaymentHookConfig({ PRE_PAYMENT_HOOK_URL: 'https://h', PRE_PAYMENT_HOOK_TIMEOUT_MS: v }).timeoutMs;
  assert.equal(t('500'), 500);
  for (const bad of ['5000ms', '1.5', '-1', '0', '99999999999', 'abc']) assert.equal(t(bad), 3000, bad);
});

function lw(args) {
  const r = spawnSync(process.execPath, [CLI, ...args], {
    env: { ...process.env, LIGHTNING_WALLET_API_KEY: 'test_key', HOME: '/nonexistent' },
    encoding: 'utf8',
    timeout: 10000,
  });
  return r;
}

test('CLI rejects invalid numeric flags before any network call', () => {
  const cases = [
    ['pay', 'lnbc1x', '--max-fee', 'abc'],
    ['pay', 'lnbc1x', '--max-fee', '-3'],
    ['pay-api', 'https://x.test', '--max-sats', '0'],
    ['pay-api', 'https://x.test', '--max-sats', '10abc'],
    ['create-agent', 'bot', '--budget', '-1'],
    ['transactions', '--limit', '0'],
    ['transactions', '--limit', '101'],
    ['transactions', '--offset', '-2'],
    ['transactions', '--limit', 'NaN'],
    ['deposit', '-5'],
    ['deposit', 'abc'],
    ['fund-agent', 'x', '10'],
    ['fund-agent', '3', '-10'],
    ['withdraw-link', '0'],
  ];
  for (const args of cases) {
    const r = lw(args);
    assert.equal(r.status, 1, `${args.join(' ')} should exit 1`);
    assert.match(r.stderr, /must be an integer/, `${args.join(' ')}: ${r.stderr}`);
  }
});
