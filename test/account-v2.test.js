const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callTool, TOOL_DEFINITIONS } = require('../dist/tools.js');
const { LightningFaucetClient } = require('../dist/lightning-faucet.js');
const { ANON_TOOLS, MONEY_TOOLS } = require('../dist/remote-policy.js');

const client = new LightningFaucetClient('lf_' + '0'.repeat(40));
const session = { keySource: 'header', getClient: () => client, setClient() {}, requireClient: () => client };
const anon = { keySource: 'none', getClient: () => null, setClient() {}, requireClient() { throw new Error('no key'); } };
const creds = {};

async function stub(reply, fn, status = 200) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    calls.push(JSON.parse(init.body));
    return { ok: status < 400, status, json: async () => reply };
  };
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

const bet = { market_id: 9, position: 'yes', amount_sats: 50, expected_odds_pct: 58, expected_line_version: 2, idempotency_key: 'bet-1' };
const roll = { wager_sats: 10, target: 5000, direction: 'under', idempotency_key: 'roll-1' };

test('account v2 tools are registered; descriptions say real linked-account sats, no em-dashes', () => {
  for (const n of ['place_bet', 'play_dice', 'get_agent_limits']) {
    const t = TOOL_DEFINITIONS.find((d) => d.name === n);
    assert.ok(t, n);
    assert.ok(!t.description.includes('—'), n);
  }
  for (const n of ['place_bet', 'play_dice']) {
    const t = TOOL_DEFINITIONS.find((d) => d.name === n);
    assert.match(t.description, /REAL deposited sats/, n);
    assert.match(t.description, /linked/, n);
    assert.match(t.description, /Bonus sats are never used/, n);
    assert.match(t.description, /idempotency_key is required/, n);
    assert.ok(t.inputSchema.required.includes('idempotency_key'), n);
  }
  assert.ok(TOOL_DEFINITIONS.find((d) => d.name === 'place_bet').inputSchema.required.includes('expected_odds_pct'));
});

test('place_bet and play_dice are money tools needing a key; get_agent_limits is a keyed read', () => {
  for (const n of ['place_bet', 'play_dice']) {
    assert.ok(MONEY_TOOLS.has(n), n);
    assert.ok(!ANON_TOOLS.has(n), n);
  }
  assert.ok(!ANON_TOOLS.has('get_agent_limits'));
});

test('place_bet sends exactly the bet fields, caller key untouched', async () => {
  await stub({ success: true, bet: { id: 1 } }, async (calls) => {
    await callTool('place_bet', bet, { session, creds });
    assert.equal(calls[0].action, 'place_bet');
    assert.deepEqual(Object.keys(calls[0]).filter((k) => !['action', 'api_key'].includes(k)).sort(), ['amount_sats', 'expected_line_version', 'expected_odds_pct', 'idempotency_key', 'market_id', 'position']);
    assert.equal(calls[0].idempotency_key, 'bet-1');
  });
});

test('play_dice sends exactly the roll fields', async () => {
  await stub({ success: true, roll: 1 }, async (calls) => {
    await callTool('play_dice', roll, { session, creds });
    assert.equal(calls[0].action, 'play_dice');
    assert.equal(calls[0].wager_sats, 10);
    assert.equal(calls[0].idempotency_key, 'roll-1');
  });
});

async function refused(name, args) {
  try {
    const r = await callTool(name, args, { session, creds });
    return r.isError === true;
  } catch (e) { return true; }
}

test('both tools require an idempotency key and the offered price (nothing is generated)', async () => {
  await stub({ success: true }, async (calls) => {
    assert.ok(await refused('place_bet', { ...bet, idempotency_key: undefined }));
    assert.ok(await refused('place_bet', { ...bet, expected_odds_pct: undefined }));
    assert.ok(await refused('place_bet', { ...bet, expected_line_version: undefined }));
    assert.ok(await refused('place_bet', { ...bet, idempotency_key: 'has space' }));
    assert.ok(await refused('play_dice', { ...roll, idempotency_key: undefined }));
    assert.ok(await refused('play_dice', { ...roll, target: 0 }));
    assert.ok(await refused('play_dice', { ...roll, direction: 'sideways' }));
    assert.equal(calls.length, 0, 'invalid input never reaches the backend');
  });
});

test('an owner cap refusal is handed back as a structured reply with a next step, not thrown', async () => {
  await stub({ success: false, error: 'owner_cap_per_day', remaining_today_sats: 40, limit_sats: 2000 }, async () => {
    const r = await callTool('place_bet', bet, { session, creds });
    const body = JSON.parse(r.content[0].text);
    assert.equal(body.error, 'owner_cap_per_day');
    assert.equal(body.idempotency_key, 'bet-1');
    assert.match(body.next, /get_agent_limits/);
  });
});

test('an unlinked key gets a next step pointing at link_account', async () => {
  await stub({ success: false, error: 'account_not_linked' }, async () => {
    const r = await callTool('play_dice', roll, { session, creds });
    assert.match(JSON.parse(r.content[0].text).next, /link_account/);
  });
});

test('without a key the tools are refused', async () => {
  for (const [name, args] of [['place_bet', bet], ['play_dice', roll], ['get_agent_limits', {}]]) {
    let refused = false;
    try {
      const r = await callTool(name, args, { session: anon, creds });
      refused = r.isError === true;
    } catch (e) { refused = true; }
    assert.ok(refused, name);
  }
});
