'use strict';

process.env.LIGHTNING_WALLET_API_URL = 'https://lf.test/api';

const { test, afterEach } = require('node:test');
const assert = require('node:assert/strict');

const { LightningFaucetClient } = require('../dist/lightning-faucet.js');
const { PolicyDenied } = require('../dist/pre-payment-hook.js');

const HOOK = 'https://hook.test/policy';
const realFetch = global.fetch;
const jsonResponse = (obj) => ({ ok: true, status: 200, json: async () => obj });

afterEach(() => {
  global.fetch = realFetch;
  delete process.env.PRE_PAYMENT_HOOK_URL;
});

// Records every LF backend action and every hook proposal.
function stub(decision) {
  const state = { actions: [], proposals: [] };
  global.fetch = async (url, opts) => {
    const body = JSON.parse(opts.body);
    if (url === HOOK) {
      state.proposals.push(body);
      return jsonResponse(decision);
    }
    if (body.action === 'whoami') return jsonResponse({ success: true, type: 'agent', id: 7 });
    state.actions.push(body.action);
    return jsonResponse({ success: true });
  };
  return state;
}

const calls = {
  fundAgent: (c) => c.fundAgent(1, 100),
  sweepAgent: (c) => c.sweepAgent(1, 'all'),
  sweepAgentPartial: (c) => c.sweepAgent(1, 50),
  transferToAgent: (c) => c.transferToAgent(2, 100),
  transferBetweenAgents: (c) => c.transferToAgent(2, 100, 1),
  boardTip: (c) => c.boardTip(5, 10),
  boardBountyCreate: (c) => c.boardBountyCreate('x', 100, 24),
  boardBountyAward: (c) => c.boardBountyAward(1, 2, 100),
  arenaJoin: (c) => c.arenaJoin(3),
  arenaPlay: (c) => c.arenaPlay(4, 50, 'over'),
  placeBet: (c) => c.placeBet({ market_id: 1, position: 'yes', amount_sats: 10, expected_odds_pct: 50, expected_line_version: 1, idempotency_key: 'k' }),
  playDice: (c) => c.playDice({ wager_sats: 10, target: 50, direction: 'over', idempotency_key: 'k' }),
  predictionPlaceBet: (c) => c.predictionPlaceBet({ market_id: 1, position: 'yes', amount_sats: 10, idempotency_key: 'k' }),
};

for (const [name, fn] of Object.entries(calls)) {
  test(`deny-all hook blocks ${name} before request() is reached (bb#339)`, async () => {
    process.env.PRE_PAYMENT_HOOK_URL = HOOK;
    const state = stub({ decision: 'deny', reason: { code: 'nope', message: 'denied' } });
    await assert.rejects(() => fn(new LightningFaucetClient('k')), (e) => e instanceof PolicyDenied);
    assert.deepEqual(state.actions, [], 'no money-moving action may reach the backend');
    assert.equal(state.proposals.length, 1);
    assert.equal(state.proposals[0].protocol, 'platform');
  });

  test(`no hook configured: ${name} reaches the backend unchanged`, async () => {
    const state = stub({ decision: 'deny' });
    await fn(new LightningFaucetClient('k'));
    assert.equal(state.proposals.length, 0);
    assert.equal(state.actions.length, 1);
  });
}

test('proposal carries action name and known amount, null when unknown', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  const state = stub({ decision: 'allow' });
  const c = new LightningFaucetClient('k');
  await c.fundAgent(1, 100);
  await c.sweepAgent(1, 'all');
  await c.arenaJoin(3);
  const [fund, sweep, arena] = state.proposals;
  assert.equal(fund.method, 'fund_agent');
  assert.equal(fund.amount_sats, 100);
  assert.equal(sweep.amount_sats, null);
  assert.equal(arena.amount_sats, null);
  assert.equal(arena.destination_or_url, 'arena_join:tournament:3');
});

test('control: payLightningAddress is still denied', async () => {
  process.env.PRE_PAYMENT_HOOK_URL = HOOK;
  const state = stub({ decision: 'deny' });
  await assert.rejects(() => new LightningFaucetClient('k').payLightningAddress('a@b.c', 10), (e) => e instanceof PolicyDenied);
  assert.deepEqual(state.actions, []);
});
