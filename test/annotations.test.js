const { test } = require('node:test');
const assert = require('node:assert/strict');
const { TOOL_DEFINITIONS } = require('../dist/tools.js');
const { TOOL_KINDS } = require('../dist/annotations.js');
const { MONEY_TOOLS, STDIO_ONLY_TOOLS } = require('../dist/remote-policy.js');

const byName = new Map(TOOL_DEFINITIONS.map((t) => [t.name, t]));

test('every tool has complete MCP annotations', () => {
  for (const t of TOOL_DEFINITIONS) {
    const a = t.annotations;
    assert.ok(a, `${t.name} has no annotations`);
    assert.ok(typeof a.title === 'string' && a.title.length > 0, `${t.name} title`);
    for (const k of ['readOnlyHint', 'destructiveHint', 'idempotentHint', 'openWorldHint']) {
      assert.equal(typeof a[k], 'boolean', `${t.name}.${k}`);
    }
    assert.ok(!(a.readOnlyHint && a.destructiveHint), `${t.name} is both read-only and destructive`);
    assert.ok(TOOL_KINDS[t.name], `${t.name} is not classified in src/annotations.ts (defaults to destructive)`);
  }
  for (const name of Object.keys(TOOL_KINDS)) assert.ok(byName.has(name), `annotations.ts classifies unknown tool ${name}`);
});

test('every parameter has a description', () => {
  for (const t of TOOL_DEFINITIONS) {
    for (const [key, schema] of Object.entries(t.inputSchema.properties || {})) {
      assert.ok(typeof schema.description === 'string' && schema.description.trim().length > 0, `${t.name}.${key} lacks a description`);
    }
  }
});

test('money-moving and irreversible tools are destructive, not read-only', () => {
  const explicit = ['pay_invoice', 'keysend', 'pay_lightning_address', 'pay_l402_api', 'withdraw', 'transfer_to_agent',
    'fund_agent', 'sweep_agent', 'delete_agent', 'rotate_api_key', 'deactivate_agent', 'place_bet', 'play_dice',
    'prediction_place_bet', 'arena_join', 'board_post', 'board_tip', 'gateway_delete', 'delete_webhook'];
  for (const name of [...explicit, ...MONEY_TOOLS]) {
    const t = byName.get(name);
    assert.ok(t, `${name} missing from tool list`);
    assert.equal(t.annotations.readOnlyHint, false, `${name} must not be read-only`);
    assert.equal(t.annotations.destructiveHint, true, `${name} must be destructive`);
  }
});

test('lookups are read-only', () => {
  for (const name of ['check_balance', 'get_info', 'decode_invoice', 'get_transactions', 'list_agents', 'get_budget_status',
    'get_rate_limits', 'export_transactions', 'get_agent_analytics', 'get_invoice_status', 'whoami', 'board_read']) {
    assert.equal(byName.get(name).annotations.readOnlyHint, true, name);
  }
});

test('remote tools/list tools carry annotations too', () => {
  const remote = TOOL_DEFINITIONS.filter((t) => !STDIO_ONLY_TOOLS.has(t.name));
  assert.ok(remote.length > 0);
  for (const t of remote) assert.ok(t.annotations, t.name);
});
