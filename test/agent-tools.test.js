const { test } = require('node:test');
const assert = require('node:assert/strict');
const { AGENT_TOOLS, AGENT_TOOL_NAMES, handleAgentTool, verifyFair } = require('../dist/agent-tools.js');
const { LightningFaucetClient } = require('../dist/lightning-faucet.js');

// Backend actions these tools may send (AgentAPIHandler.php + platform API reads).
const BACKEND_ACTIONS = new Set(['link_user', 'export_transactions', 'get_agent_analytics', 'gateway_catalog', 'gateway_probe',
  'gateway_register', 'gateway_list', 'gateway_update', 'gateway_pause', 'gateway_resume', 'gateway_delete', 'gateway_stats',
  'registry_list', 'get_l402_discovered', 'pickem_state', 'get_active_tournaments']);

function stubFetch(reply, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (url, init) => {
    const body = init && init.body ? JSON.parse(init.body) : null;
    calls.push({ url: String(url), body });
    const r = typeof reply === 'function' ? reply(body, String(url)) : reply;
    return { ok: true, status: 200, json: async () => r };
  };
  return fn(calls).finally(() => { globalThis.fetch = original; });
}
const session = { getClient: () => new LightningFaucetClient('lf_test'), requireClient: () => new LightningFaucetClient('lf_test') };
const anon = { getClient: () => null, requireClient: () => { throw new Error('No API key configured'); } };

test('every tool has description, typed schema and is registered once', () => {
  assert.equal(AGENT_TOOLS.length, AGENT_TOOL_NAMES.size);
  for (const t of AGENT_TOOLS) {
    assert.ok(t.description.length > 40, t.name);
    assert.equal(t.inputSchema.type, 'object', t.name);
    assert.ok(!t.description.includes('—'), `${t.name} has an em-dash`);
  }
});

test('verify_fair matches the PHP reference vector', () => {
  const r = verifyFair({ server_seed: 'serverseed', client_seed: 'client1', nonce: 7,
    server_seed_hash: '5eb59053dcb5810322e367245f631a65589ddf7bbe950d2986a43a5f376312ef', claimed_result: 1234 });
  assert.equal(r.hmac_sha256, '1ad70d32e7e3c1facf4d9140fa646ed95236ec0f49bd80c2a255651206ae061e');
  assert.equal(r.dice_0_9999, 1234);
  assert.equal(r.commitment_matches, true);
  assert.equal(r.verified, true);
  assert.equal(verifyFair({ server_seed: 'serverseed', client_seed: 'client1', nonce: 7, claimed_result: 9 }).verified, false);
  assert.equal(verifyFair({ server_seed: 'serverseed', client_seed: 'client1', nonce: 7, server_seed_hash: '0'.repeat(64) }).verified, false);
});

test('verify_fair tool needs no key and no network', async () => {
  await stubFetch({}, async (calls) => {
    const r = await handleAgentTool('verify_fair', { server_seed: 'serverseed', client_seed: 'client1', nonce: 7 }, anon);
    assert.equal(JSON.parse(r.content[0].text).dice_0_9999, 1234);
    assert.equal(calls.length, 0);
  });
});

test('link_user and gateway_delete refuse without confirm, link_user defaults to no balance merge', async () => {
  await stubFetch({ success: true }, async (calls) => {
    await assert.rejects(handleAgentTool('link_user', { recovery_code: 'ABCDEFGH12' }, session));
    await assert.rejects(handleAgentTool('gateway_delete', { endpoint_id: 3 }, session));
    assert.equal(calls.length, 0);
    await handleAgentTool('link_user', { recovery_code: 'ABCDEFGH12', confirm: true }, session);
    assert.equal(calls[0].body.action, 'link_user');
    assert.equal(calls[0].body.merge_balance, false);
  });
});

test('each key-gated tool sends an action the backend serves', async () => {
  const cases = {
    export_transactions: { format: 'csv', start_date: '2026-10-01' },
    get_agent_analytics: { period: '7d' },
    gateway_probe: { upstream_url: 'https://example.com/x' },
    gateway_register: { name: 'n', upstream_url: 'https://example.com/x', price_sats: 10 },
    gateway_list: {}, gateway_update: { endpoint_id: 1, price_sats: 5 }, gateway_pause: { endpoint_id: 1 },
    gateway_resume: { endpoint_id: 1 }, gateway_delete: { endpoint_id: 1, confirm: true }, gateway_stats: { endpoint_id: 1 },
  };
  await stubFetch({ success: true, transactions: [], csv: 'a,b\n' }, async (calls) => {
    for (const [name, args] of Object.entries(cases)) {
      const r = await handleAgentTool(name, args, session);
      assert.ok(r, name);
      assert.equal(calls.at(-1).body.action, name);
      assert.ok(BACKEND_ACTIONS.has(calls.at(-1).body.action), name);
      assert.equal(calls.at(-1).body.api_key, 'lf_test');
    }
  });
});

test('gateway_delete never forwards the confirm flag', async () => {
  await stubFetch({ success: true }, async (calls) => {
    await handleAgentTool('gateway_delete', { endpoint_id: 4, confirm: true }, session);
    assert.deepEqual(Object.keys(calls[0].body).sort(), ['action', 'api_key', 'endpoint_id']);
  });
});

test('export_transactions truncates oversized CSV and says so', async () => {
  await stubFetch({ success: true, csv: 'x'.repeat(200000) }, async () => {
    const r = JSON.parse((await handleAgentTool('export_transactions', {}, session)).content[0].text);
    assert.equal(r.truncated, true);
    assert.ok(r.csv.length <= 60000);
    assert.match(r.next, /Narrow/);
  });
});

test('public reads work without a key', async () => {
  await stubFetch((body) => body.action === 'get_active_tournaments'
    ? { success: true, tournaments: [{ id: 1, name: 'T', game_type: 'slots', leaderboard: [{ rank: 1, player: 'p', score: 3, secret: 'x' }] }, { id: 2, game_type: 'dice' }] }
    : { success: true, entries: [] }, async (calls) => {
    const t = JSON.parse((await handleAgentTool('tournament_list', { game_type: 'slots' }, anon)).content[0].text);
    assert.equal(t.count, 1);
    assert.deepEqual(t.tournaments[0].top_5[0], { rank: 1, player: 'p', score: 3 });
    await handleAgentTool('pickem_browse', {}, anon);
    await handleAgentTool('gateway_catalog', {}, anon);
    await handleAgentTool('list_l402_apis', { source: 'registry', search: 'x' }, anon);
    await handleAgentTool('list_l402_apis', { source: 'discovered' }, anon);
    for (const c of calls) if (c.body) assert.ok(BACKEND_ACTIONS.has(c.body.action), c.body.action);
  });
});

test('invalid input is rejected before any request', async () => {
  await stubFetch({ success: true }, async (calls) => {
    await assert.rejects(handleAgentTool('export_transactions', { format: 'xml' }, session));
    await assert.rejects(handleAgentTool('gateway_register', { name: 'n', upstream_url: 'not a url', price_sats: 1 }, session));
    await assert.rejects(handleAgentTool('gateway_register', { name: 'n', upstream_url: 'https://e.com', price_sats: 0 }, session));
    assert.equal(calls.length, 0);
  });
});

test('agent-only tools explain themselves when called with an operator key', async () => {
  await stubFetch({ success: false, error: 'Unknown operator action: export_transactions' }, async () => {
    await assert.rejects(handleAgentTool('export_transactions', {}, session), (e) => e.message === 'requires_agent_key' && /set_agent_credentials/.test(e.response.hint));
  });
});

test('verify_fair compares the claim against one explicit mapping', () => {
  // nonce 0 gives roll 40039 and dice 39: a dice claim of 40039 must not verify.
  const base = { server_seed: 'serverseed', client_seed: 'client1', nonce: 0 };
  assert.equal(verifyFair({ ...base, claimed_result: 39 }).verified, true);
  assert.equal(verifyFair({ ...base, claimed_result: 40039 }).verified, false);
  assert.equal(verifyFair({ ...base, claimed_result: 40039, result_type: 'roll' }).verified, true);
  assert.equal(verifyFair({ ...base, claimed_result: 39, result_type: 'roll' }).verified, false);
});
