const { test } = require('node:test');
const assert = require('node:assert/strict');
const { callTool, TOOL_DEFINITIONS } = require('../dist/tools.js');
const { LightningFaucetClient } = require('../dist/lightning-faucet.js');

const client = new LightningFaucetClient('agent_' + '0'.repeat(48));
const session = { keySource: 'header', getClient: () => client, setClient() {}, requireClient: () => client };
const anon = { keySource: 'none', getClient: () => null, setClient() {}, requireClient() { throw new Error('no key'); } };
const creds = {};

async function stub(reply, fn) {
  const calls = [];
  const original = globalThis.fetch;
  globalThis.fetch = async (_u, init) => {
    const body = JSON.parse(init.body);
    calls.push(body);
    return { ok: true, status: 200, json: async () => (typeof reply === 'function' ? reply(body) : reply) };
  };
  try { await fn(calls); } finally { globalThis.fetch = original; }
}

test('new board tools are registered', () => {
  const names = new Set(TOOL_DEFINITIONS.map((t) => t.name));
  for (const n of ['board_inbox', 'board_tip', 'board_bounty_create', 'board_bounty_award', 'board_bounty_close', 'board_set_profile', 'board_agent_profile']) {
    assert.ok(names.has(n), n);
    const d = TOOL_DEFINITIONS.find((t) => t.name === n).description;
    assert.ok(!d.includes('—'), `${n} has an em-dash`);
  }
});

test('inbox.hint is surfaced first in the tool text', async () => {
  await stub({ success: true, posts: [], inbox: { unread_count: 2, hint: 'You have 2 unread replies. Call board_inbox.' } }, async () => {
    const r = await callTool('board_read', {}, { session, creds });
    assert.ok(r.content[0].text.startsWith('You have 2 unread replies. Call board_inbox.\n\n{'));
  });
  await stub({ success: true, posts: [] }, async () => {
    const r = await callTool('board_read', {}, { session, creds });
    assert.ok(r.content[0].text.startsWith('{'));
  });
});

test('tools send the contract parameters', async () => {
  await stub({ success: true }, async (calls) => {
    await callTool('board_tip', { post_id: 5, amount_sats: 7 }, { session, creds });
    await callTool('board_bounty_create', { content: 'x'.repeat(30), reward_sats: 50, deadline_hours: 24 }, { session, creds });
    await callTool('board_bounty_award', { bounty_id: 1, reply_id: 2, amount_sats: 10 }, { session, creds });
    await callTool('board_inbox', {}, { session, creds });
    assert.deepEqual(calls.map((c) => c.action), ['board_tip', 'board_bounty_create', 'board_bounty_award', 'board_inbox']);
    assert.equal(calls[3].unread_only, true);
    const n = calls.length;
    const bad = await callTool('board_tip', { post_id: 5, amount_sats: 20000 }, { session, creds });
    assert.equal(bad.isError, true);
    assert.equal(calls.length, n);
  });
});

test('board_agent_profile works without a key', async () => {
  await stub({ success: true, agent: { id: 9 } }, async (calls) => {
    await callTool('board_agent_profile', { agent_id: 9 }, { session: anon, creds });
    assert.equal(calls[0].action, 'board_agent_profile');
    assert.equal(calls[0].api_key, undefined);
  });
});

test('register_webhook accepts board events and wildcard; board_read passes status', async () => {
  await stub({ success: true, webhook_id: 1, url: 'https://x.io/h', events: ['board.reply', '*'], secret: 's' }, async (calls) => {
    const r = await callTool('register_webhook', { url: 'https://x.io/h', events: ['board.reply', 'board.bounty_awarded', '*'] }, { session, creds });
    assert.notEqual(r.isError, true);
    await callTool('board_read', { topic: 'bounty', status: 'open' }, { session, creds });
    assert.equal(calls[1].status, 'open');
    const bad = await callTool('board_read', { status: 'closed' }, { session, creds });
    assert.equal(bad.isError, true);
  });
});
