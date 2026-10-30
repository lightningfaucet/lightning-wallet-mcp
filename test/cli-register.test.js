'use strict';

// `lw register` must not call the API when credentials are already saved, must offer
// --force, and must point rate-limited users at their saved credentials.

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const http = require('node:http');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { spawn } = require('node:child_process');

const CLI = path.join(__dirname, '..', 'dist', 'cli.js');

let server;
let apiUrl;
let calls = 0;
let mode = 'ok';

before(async () => {
  server = http.createServer((req, res) => {
    calls++;
    req.resume();
    req.on('end', () => {
      res.setHeader('content-type', 'application/json');
      if (mode === 'rate') {
        res.end(JSON.stringify({ success: false, error: 'Rate limit exceeded. Maximum 1 registrations per hour.' }));
      } else {
        res.end(JSON.stringify({ success: true, operator_id: 77, api_key: 'op_new_key', recovery_code: 'rc-new' }));
      }
    });
  });
  await new Promise((r) => server.listen(0, '127.0.0.1', r));
  apiUrl = `http://127.0.0.1:${server.address().port}/api`;
});

after(() => server.close());

function runCli(args, home) {
  return new Promise((resolve) => {
    const env = { ...process.env, LIGHTNING_WALLET_HOME: home, LIGHTNING_WALLET_API_URL: apiUrl };
    delete env.LIGHTNING_WALLET_API_KEY;
    delete env.LIGHTNING_WALLET_NO_PERSIST;
    const child = spawn(process.execPath, [CLI, ...args], { env });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => (stdout += d));
    child.stderr.on('data', (d) => (stderr += d));
    child.on('close', (code) => resolve({ code, stdout, stderr }));
  });
}

function tmpHome(withCreds) {
  const home = fs.mkdtempSync(path.join(os.tmpdir(), 'lw-reg-'));
  if (withCreds) {
    fs.writeFileSync(
      path.join(home, 'credentials.json'),
      JSON.stringify({ version: 1, active: 'operator', operator: { api_key: 'op_saved_key', id: 5, saved_at: 'now' } }),
    );
  }
  return home;
}

test('register with saved credentials does not call the API', async () => {
  const home = tmpHome(true);
  calls = 0;
  mode = 'ok';
  const r = await runCli(['register'], home);
  assert.equal(r.code, 0);
  assert.equal(calls, 0);
  const out = JSON.parse(r.stdout);
  assert.equal(out.already_registered, true);
  assert.match(out.message, /Already registered/);
  assert.ok(out.message.includes(path.join(home, 'credentials.json')));
  assert.match(out.force_hint, /--force/);
  assert.ok(!r.stdout.includes('op_saved_key'), 'must not print the saved key');
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'credentials.json'), 'utf8'));
  assert.equal(saved.operator.api_key, 'op_saved_key');
});

test('register --force calls the API and replaces saved credentials', async () => {
  const home = tmpHome(true);
  calls = 0;
  mode = 'ok';
  const r = await runCli(['register', '--force'], home);
  assert.equal(r.code, 0);
  assert.equal(calls, 1);
  const saved = JSON.parse(fs.readFileSync(path.join(home, 'credentials.json'), 'utf8'));
  assert.equal(saved.operator.api_key, 'op_new_key');
});

test('register with no saved credentials registers and mentions a deposit', async () => {
  const home = tmpHome(false);
  calls = 0;
  mode = 'ok';
  const r = await runCli(['register'], home);
  assert.equal(r.code, 0);
  assert.equal(calls, 1);
  const out = JSON.parse(r.stdout);
  assert.match(out.next_step, /lw deposit/);
  assert.ok(!/free sats/i.test(r.stdout));
});

test('rate limit error tells the user to reuse saved credentials', async () => {
  const home = tmpHome(false);
  calls = 0;
  mode = 'rate';
  const r = await runCli(['register'], home);
  assert.equal(r.code, 1);
  assert.equal(calls, 1);
  assert.match(r.stderr, /Rate limit exceeded/);
  assert.match(r.stderr, /reuse your saved credentials/);
});
