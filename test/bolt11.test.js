'use strict';

const { test } = require('node:test');
const assert = require('node:assert/strict');

const { bolt11AmountSats } = require('../dist/bolt11.js');

// The body after the '1' separator is irrelevant to amount parsing; these use
// short placeholder data parts. Only the HRP (ln<currency><amount>) matters.
test('bolt11: decodes nano amounts', () => {
  assert.equal(bolt11AmountSats('lnbc2500n1pjxyzqqdata'), 250);
  assert.equal(bolt11AmountSats('lnbc1500n1pqdata'), 150);
});

test('bolt11: decodes micro and milli amounts', () => {
  assert.equal(bolt11AmountSats('lnbc1u1pqdata'), 100); // 1e-6 BTC
  assert.equal(bolt11AmountSats('lnbc20m1pqdata'), 2_000_000); // 0.02 BTC
});

test('bolt11: handles testnet and regtest prefixes', () => {
  assert.equal(bolt11AmountSats('lntb500u1pqdata'), 50_000);
  assert.equal(bolt11AmountSats('lnbcrt10u1pqdata'), 1_000);
});

test('bolt11: case-insensitive (bech32 may be upper-cased)', () => {
  assert.equal(bolt11AmountSats('LNBC2500N1PJXYZQQDATA'), 250);
});

test('bolt11: amountless / unparseable / non-invoice -> null', () => {
  assert.equal(bolt11AmountSats('lnbc1pqamountless'), null); // no digits before separator
  assert.equal(bolt11AmountSats('not-an-invoice'), null);
  assert.equal(bolt11AmountSats(''), null);
  assert.equal(bolt11AmountSats('lnxx2500n1pqdata'), null); // unknown currency prefix
});
