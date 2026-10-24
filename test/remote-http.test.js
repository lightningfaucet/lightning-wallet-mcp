// End-to-end test of the remote Streamable HTTP server against a mock agent API on 127.0.0.1.
// Uses the official SDK client, so it exercises the real wire protocol.
const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');
const { Client } = require('@modelcontextprotocol/sdk/client/index.js');
const { StreamableHTTPClientTransport } = require('@modelcontextprotocol/sdk/client/streamableHttp.js');

const OP_KEY = 'lf_' + 'c'.repeat(48);
const CLIENT_IP = '203.0.113.9';
const killFile = path.join(fs.mkdtempSync(path.join(os.tmpdir(), 'lfmcp-')), 'KILL');
let backend, backendHits = [], server, base, logs = '';

function listen(srv) {
  return new Promise((resolve) => srv.listen(0, '127.0.0.1', () => resolve(srv.address().port)));
}

before(async () => {
  backend = http.createServer((req, res) => {
    let body = '';
    req.on('data', (c) => { body += c; });
    req.on('end', () => {
      const json = JSON.parse(body || '{}');
      backendHits.push({ xff: req.headers['x-forwarded-for'], body: json });
      const replies = {
        get_info: { success: true, version: 'mock', status: 'ok' },
        get_balance: json.api_key === OP_KEY ? { success: true, balance_sats: 0 } : { success: false, error: 'Invalid API key' },
        pay: { success: true, preimage: 'p', amount_sats: 1 },
      };
      res.writeHead(200, { 'Content-Type': 'application/json' });
      res.end(JSON.stringify(replies[json.action] || { success: false, error: 'unknown action' }));
    });
  });
  const backendPort = await listen(backend);
  const probe = http.createServer();
  const port = await listen(probe);
  await new Promise((r) => probe.close(r));
  server = spawn(process.execPath, [path.join(__dirname, '..', 'dist', 'http-server.js')], {
    env: {
      ...process.env,
      LF_MCP_PORT: String(port),
      LIGHTNING_WALLET_API_URL: `http://127.0.0.1:${backendPort}`,
      LF_MCP_KILL_SWITCH_FILE: killFile,
      LF_MCP_RL_ANON_TOOLS_PER_MIN: '6',
      LF_MCP_MAX_BODY_BYTES: '4096',
      PRE_PAYMENT_HOOK_URL: '',
    },
  });
  server.stdout.on('data', (d) => { logs += d; });
  server.stderr.on('data', (d) => { logs += d; });
  base = `http://127.0.0.1:${port}`;
  for (let i = 0; i < 50; i++) {
    try { if ((await fetch(`${base}/health`)).ok) return; } catch { /* starting */ }
    await new Promise((r) => setTimeout(r, 100));
  }
  throw new Error('server did not start: ' + logs);
});

after(() => { server?.kill(); backend?.close(); });

async function connect(headers = {}) {
  const client = new Client({ name: 'test', version: '1' });
  const transport = new StreamableHTTPClientTransport(new URL(`${base}/mcp`), {
    requestInit: { headers: { 'X-Real-IP': CLIENT_IP, ...headers } },
  });
  await client.connect(transport);
  return client;
}
const parse = (r) => JSON.parse(r.content[0].text);

test('initialize and tools/list hide stdio-only tools', async () => {
  const c = await connect();
  const { tools } = await c.listTools();
  const names = tools.map((t) => t.name);
  assert.ok(names.includes('get_info') && names.includes('pay_invoice'));
  for (const n of ['register_operator', 'recover_account', 'set_operator_key', 'set_agent_credentials', 'forget_credentials']) assert.ok(!names.includes(n), n);
  assert.match(c.getInstructions(), /Authorization: Bearer/);
  await c.close();
});

test('anonymous read-only call forwards the caller address and no key', async () => {
  backendHits = [];
  const c = await connect();
  const r = await c.callTool({ name: 'get_info', arguments: {} });
  assert.equal(r.isError, undefined);
  assert.equal(backendHits.length, 1);
  assert.equal(backendHits[0].xff, CLIENT_IP);
  assert.equal(backendHits[0].body.ip_address, CLIENT_IP);
  assert.equal(backendHits[0].body.api_key, undefined);
  await c.close();
});

test('anonymous caller cannot use keyed or stdio-only tools', async () => {
  backendHits = [];
  const c = await connect();
  const r = await c.callTool({ name: 'check_balance', arguments: {} });
  assert.equal(r.isError, true);
  assert.equal(parse(r).error, 'auth_required');
  const s = await c.callTool({ name: 'register_operator', arguments: {} });
  assert.equal(parse(s).error, 'not_available_remotely');
  assert.equal(backendHits.length, 0);
  await c.close();
});

test('authenticated call uses the bearer key; whoami-style persistence is off', async () => {
  backendHits = [];
  const c = await connect({ Authorization: `Bearer ${OP_KEY}` });
  const r = await c.callTool({ name: 'check_balance', arguments: {} });
  assert.equal(parse(r).balance_sats, 0);
  assert.equal(backendHits[0].body.api_key, OP_KEY);
  await c.close();
  assert.ok(!logs.includes(OP_KEY), 'key leaked into logs');
  assert.match(logs, /"tool":"check_balance","auth":"key:[0-9a-f]{12}"/);
});

test('kill switch file refuses money tools at once and leaves reads working', async () => {
  const c = await connect({ Authorization: `Bearer ${OP_KEY}` });
  fs.writeFileSync(killFile, '1');
  try {
    backendHits = [];
    const r = await c.callTool({ name: 'pay_invoice', arguments: { bolt11: 'lnbc10n1pjunk' } });
    assert.equal(parse(r).error, 'money_tools_disabled');
    assert.equal(backendHits.length, 0);
    const h = await (await fetch(`${base}/health`)).json();
    assert.equal(h.money_tools_enabled, false);
    const b = await c.callTool({ name: 'check_balance', arguments: {} });
    assert.equal(parse(b).balance_sats, 0);
  } finally {
    fs.unlinkSync(killFile);
  }
  await c.close();
});

test('per-IP anonymous tool rate limit', async () => {
  const c = await connect({ 'X-Real-IP': '198.51.100.77' });
  let limited = null;
  for (let i = 0; i < 8 && !limited; i++) {
    const r = await c.callTool({ name: 'verify_fair', arguments: { server_seed: 's', client_seed: 'c', nonce: 1 } });
    if (r.isError && parse(r).error === 'rate_limited') limited = parse(r);
  }
  assert.ok(limited, 'never rate limited');
  assert.ok(limited.retry_after_seconds > 0);
  await c.close();
});

test('caller without a public address cannot reach the backend', async () => {
  backendHits = [];
  const c = await connect({ 'X-Real-IP': '10.0.0.5' });
  const r = await c.callTool({ name: 'get_info', arguments: {} });
  // get_info falls back to the public path, which is pinned too: both refuse.
  assert.equal(r.isError, true);
  assert.equal(backendHits.length, 0);
  await c.close();
});

test('HTTP guards: body cap, Origin, Host, GET, malformed key', async () => {
  const post = (body, headers = {}) => fetch(`${base}/mcp`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Accept: 'application/json, text/event-stream', 'X-Real-IP': CLIENT_IP, ...headers },
    body,
  });
  const init = JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 'x', version: '1' } } });
  assert.equal((await post('x'.repeat(5000))).status, 413);
  assert.equal((await post(init, { Origin: 'https://evil.example' })).status, 403);
  const ok = await post(init, { Origin: 'https://claude.ai' });
  assert.equal(ok.status, 200);
  assert.equal(ok.headers.get('access-control-allow-origin'), 'https://claude.ai');
  const hostStatus = await new Promise((resolve, reject) => {
    const u = new URL(`${base}/mcp`);
    const req = http.request({ host: u.hostname, port: u.port, path: '/mcp', method: 'POST', headers: { Host: 'evil.example', 'Content-Type': 'application/json' } }, (res) => { res.resume(); resolve(res.statusCode); });
    req.on('error', reject);
    req.end(init);
  });
  assert.equal(hostStatus, 403);
  assert.equal((await post(init, { Authorization: 'Bearer sk-not-ours' })).status, 401);
  assert.equal((await fetch(`${base}/mcp`)).status, 405);
  assert.equal((await fetch(`${base}/nope`)).status, 404);
});
