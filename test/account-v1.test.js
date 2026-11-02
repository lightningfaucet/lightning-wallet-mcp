const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callTool, TOOL_DEFINITIONS } = require('../dist/tools.js');
const { LightningFaucetClient } = require('../dist/lightning-faucet.js');
const { ANON_TOOLS, MONEY_TOOLS } = require('../dist/remote-policy.js');

const client = new LightningFaucetClient('lf_' + '0'.repeat(40));
const session = { keySource: 'header', getClient: () => client, setClient() {}, requireClient: () => client };
const anon = { keySource: 'none', getClient: () => null, setClient() {}, requireClient() { throw new Error('no key'); } };
const creds = {};

async function stub(reply, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return { ok: true, status: 200, json: async () => reply };
  };
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

test('account v1 tools are registered without em-dashes', () => {
  for (const n of ['markets_browse', 'link_account', 'get_earn_status']) {
    const t = TOOL_DEFINITIONS.find((d) => d.name === n);
    assert.ok(t, n);
    assert.ok(!t.description.includes('—'), n);
  }
});

test('markets_browse is anonymous; link_account and get_earn_status need a key', () => {
  assert.ok(ANON_TOOLS.has('markets_browse'));
  assert.ok(!ANON_TOOLS.has('link_account'));
  assert.ok(!ANON_TOOLS.has('get_earn_status'));
  assert.ok(!MONEY_TOOLS.has('markets_browse'));
});

test('markets_browse works with no key and sends only browse filters', async () => {
  await stub({ success: true, markets: [] }, async (calls) => {
    await callTool('markets_browse', { category: 'nfl', limit: 5 }, { session: anon, creds });
    assert.equal(calls[0].action, 'markets_browse');
    assert.equal(calls[0].category, 'nfl');
    assert.equal(calls[0].api_key, undefined);
  });
});

test('link_account sends the code; get_earn_status sends no params', async () => {
  await stub({ success: true }, async (calls) => {
    await callTool('link_account', { link_code: 'ABCD-EFGH-JKLM-NPQR' }, { session, creds });
    await callTool('get_earn_status', {}, { session, creds });
    assert.equal(calls[0].action, 'link_account');
    assert.equal(calls[0].link_code, 'ABCD-EFGH-JKLM-NPQR');
    assert.equal(calls[1].action, 'get_earn_status');
  });
});

test('link_account and get_earn_status refuse without a key', async () => {
  for (const [name, args] of [['get_earn_status', {}], ['link_account', { link_code: 'ABCD-EFGH-JKLM-NPQR' }]]) {
    let refused = false;
    try {
      const r = await callTool(name, args, { session: anon, creds });
      refused = r.isError === true;
    } catch (e) { refused = true; }
    assert.ok(refused, name);
  }
});
