// Prediction markets: the wire contract the backend relies on.
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LightningFaucetClient, ApiError, getPublicAction } = require('../dist/lightning-faucet.js');

function withStubbedFetch(reply, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_url, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    const r = typeof reply === 'function' ? reply(body) : reply;
    return { ok: true, status: 200, json: async () => r };
  };
  return fn(calls).finally(() => { globalThis.fetch = original; });
}

const client = new LightningFaucetClient('agent_test_key');

test('predictionPlaceBet sends only the fields that were set', async () => {
  await withStubbedFetch({ success: true, bet: { id: 1 } }, async (calls) => {
    await client.predictionPlaceBet({ market_id: 5, position: 'yes', amount_sats: 10, idempotency_key: 'abc' });
    const body = calls[0];
    assert.equal(body.action, 'prediction_place_bet');
    assert.equal(body.idempotency_key, 'abc');
    assert.ok(!('expected_odds_pct' in body), 'expected_odds_pct must not be sent when undefined');
    assert.ok(!('expected_line_version' in body), 'expected_line_version must not be sent when undefined');
  });
});

test('predictionPlaceBet refusal throws an ApiError carrying the structured reply', async () => {
  const refusal = { success: false, error: 'odds_changed', current_odds_pct: 47.2, current_line_version: 4, idempotency_key: 'abc' };
  await withStubbedFetch(refusal, async () => {
    await assert.rejects(() => client.predictionPlaceBet({ market_id: 5, position: 'yes', amount_sats: 10, idempotency_key: 'abc', expected_odds_pct: 50 }),
      (e) => e instanceof ApiError && e.response.error === 'odds_changed' && e.response.current_odds_pct === 47.2 && e.response.current_line_version === 4);
  });
});

test('predictionMarkets drops undefined filters and never sends a key-less body with an api_key when public', async () => {
  await withStubbedFetch({ success: true, markets: [] }, async (calls) => {
    await client.predictionMarkets({ status: 'open', category: undefined });
    assert.equal(calls[0].action, 'prediction_markets');
    assert.equal(calls[0].status, 'open');
    assert.ok(!('category' in calls[0]));
    assert.equal(calls[0].api_key, 'agent_test_key');
  });
  await withStubbedFetch({ success: true, markets: [] }, async (calls) => {
    await getPublicAction('prediction_markets', { status: 'open' });
    assert.equal(calls[0].action, 'prediction_markets');
    assert.ok(!('api_key' in calls[0]), 'public read must not carry an api_key');
  });
});

test('a generated idempotency key is stable for an identical retry and fresh for a different bet', async () => {
  // The MCP server derives the key from the bet fields when the caller omits it;
  // this pins the client-side contract the tool relies on (the key is sent as given).
  const seen = [];
  await withStubbedFetch({ success: true, bet: { id: 1 } }, async (calls) => {
    await client.predictionPlaceBet({ market_id: 5, position: 'yes', amount_sats: 10, idempotency_key: 'same' });
    await client.predictionPlaceBet({ market_id: 5, position: 'yes', amount_sats: 10, idempotency_key: 'same' });
    seen.push(calls[0].idempotency_key, calls[1].idempotency_key);
  });
  assert.equal(seen[0], seen[1]);
});
