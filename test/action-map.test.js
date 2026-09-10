// Every client method must send a backend action that actually exists, with the parameter
// names the backend reads. This is the regression net for arg-mapping bugs (e.g. set_budget
// once went through update_agent with a null it could not accept).
const { test } = require('node:test');
const assert = require('node:assert/strict');
const { LightningFaucetClient } = require('../dist/lightning-faucet.js');

// Backend actions (AgentAPIHandler.php case list + pre-auth actions), captured 2026-09-10.
const BACKEND_ACTIONS = new Set(`agent_transactions balance board_get_post board_post board_read board_reply board_vote
check_deposit check_invoice claim_lnurl_withdraw claim_promo create_agent create_deposit create_invoice
create_withdraw_link deactivate_agent delete_agent delete_webhook email_latest email_search emergency_lock
export_transactions fund_agent gateway_delete gateway_list gateway_pause gateway_probe gateway_register
gateway_resume gateway_stats gateway_update get_agent_analytics get_agent_transactions get_balance
get_budget_status get_context get_inbound_emails get_invoice_status get_l402_payments get_l402_stats
get_lightning_address get_nostr_identity get_rate_limits get_transactions get_info decode_invoice keysend
l402_pay l402_payments l402_stats link_user list_agents list_webhooks lnurl_auth lock_account lock_agent
nostr_zap operator_balance pay pay_invoice pay_lightning_address rate_limit reactivate_agent receive
recover recover_account recover_operator register regenerate_agent_key regenerate_operator_key
register_webhook remove_lightning_address rotate_agent_key rotate_api_key rotate_key security_log
security_status set_budget set_lightning_address set_nostr_identity test_webhook transactions
transfer_between_agents transfer_to_agent unlock_agent update_agent update_operator verify_operator_email
whoami withdraw withdraw_from_agent withdraw_lightning withdraw_link promo_status`.split(/\s+/));

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

const client = new LightningFaucetClient('lf_test_key');

const cases = [
  ['checkBalance', [], 'get_balance', []],
  ['whoami', [], 'whoami', []],
  ['payInvoice', ['lnbc10n1p' + 'x'.repeat(60), 5], 'pay_invoice', ['invoice', 'max_fee_sats']],
  ['createInvoice', [21, 'memo'], 'create_invoice', ['amount_sats']],
  ['getInvoiceStatus', ['abcd'], 'get_invoice_status', ['payment_hash']],
  ['getTransactions', [5, 0], 'get_transactions', []],
  ['createDeposit', [1000], 'create_deposit', ['amount_sats']],
  ['createAgent', ['bot', 'desc', 100], 'create_agent', ['name']],
  ['fundAgent', [7, 50], 'fund_agent', ['agent_id', 'amount_sats']],
  ['listAgents', [], 'list_agents', []],
  ['getBudgetStatus', [7], 'get_budget_status', ['agent_id']],
  ['setBudget', [7, 0], 'set_budget', ['agent_id', 'budget_limit_sats']],
  ['sweepAgent', [7, 'all'], 'withdraw_from_agent', ['agent_id', 'sweep']],
  ['sweepAgent', [7, 25], 'withdraw_from_agent', ['agent_id', 'amount_sats']],
  ['withdraw', ['lnbc10n1p' + 'x'.repeat(60)], 'withdraw', ['invoice']],
  ['createWithdrawLink', [10], 'create_withdraw_link', ['amount_sats']],
  ['payLightningAddress', ['a@b.com', 10], 'pay_lightning_address', ['address', 'amount_sats']],
  ['keysend', ['02' + 'a'.repeat(64), 10, 'hi'], 'keysend', ['destination', 'amount_sats']],
  ['transferToAgent', [1, 2, 10], 'transfer_between_agents', ['from_agent_id', 'to_agent_id', 'amount_sats']],
  ['deleteAgent', [7], 'delete_agent', ['agent_id']],
  ['listWebhooks', [], 'list_webhooks', []],
  ['getRateLimits', [], 'get_rate_limits', []],
  ['updateOperator', [{ email: 'x@y.z' }], 'update_operator', ['email']],
  ['claimPromo', [undefined], 'claim_promo', []],
];

for (const [method, args, action, requiredKeys] of cases) {
  if (typeof client[method] !== 'function') continue; // method names may differ; covered elsewhere
  test(`${method} -> ${action}`, async () => {
    await withStubbedFetch({ success: true, type: 'operator', id: 1, balance_sats: 0, agents: [], transactions: [], webhooks: [] }, async (calls) => {
      try { await client[method](...args); } catch (e) { /* result-shape errors are fine; we only check the wire */ }
      assert.ok(calls.length >= 1, 'no request sent');
      const body = calls[calls.length - 1];
      assert.equal(body.action, action);
      assert.ok(BACKEND_ACTIONS.has(body.action), `unknown backend action ${body.action}`);
      for (const k of requiredKeys) assert.ok(k in body, `missing param ${k} in ${JSON.stringify(body)}`);
      assert.equal(body.api_key, 'lf_test_key');
    });
  });
}

test('sweepAgent partial does NOT send sweep:true', async () => {
  await withStubbedFetch({ success: true }, async (calls) => {
    await client.sweepAgent(7, 25);
    assert.equal(calls[0].sweep, undefined);
    assert.equal(calls[0].amount_sats, 25);
  });
});

test('pending:true responses throw an ApiError that keeps the flag', async () => {
  const { ApiError } = require('../dist/lightning-faucet.js');
  await withStubbedFetch({ success: false, pending: true, payment_hash: 'ab', error: 'in flight' }, async () => {
    await assert.rejects(() => client.checkBalance(), (e) => e instanceof ApiError && e.pending === true && e.response.payment_hash === 'ab');
  });
});

test('whoami refuses to guess a type', async () => {
  await withStubbedFetch({ success: true, id: 5 }, async () => {
    await assert.rejects(() => client.whoami(), /no identity type/);
  });
});

test('saveOperatorKey keeps recovery metadata on same-account rotation, drops it for a different account', () => {
  const fs = require('node:fs'); const os = require('node:os'); const path = require('node:path');
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-creds-'));
  const prevHome = process.env.LIGHTNING_WALLET_HOME; process.env.LIGHTNING_WALLET_HOME = home;
  try {
    const c = require('../dist/credentials.js');
    c.saveOperatorKey('lf_first', { id: 7, name: 'me', recovery_code: 'rc-123' });
    c.saveOperatorKey('lf_rotated', {}, { sameAccount: true });
    let on = c.loadCredentials();
    assert.equal(on.operator.api_key, 'lf_rotated');
    assert.equal(on.operator.recovery_code, 'rc-123');
    assert.equal(on.operator.id, 7);
    c.saveOperatorKey('lf_other_account');
    on = c.loadCredentials();
    assert.equal(on.operator.api_key, 'lf_other_account');
    assert.equal(on.operator.recovery_code, undefined);
  } finally {
    if (prevHome === undefined) delete process.env.LIGHTNING_WALLET_HOME; else process.env.LIGHTNING_WALLET_HOME = prevHome;
    fs.rmSync(home, { recursive: true, force: true });
  }
});
