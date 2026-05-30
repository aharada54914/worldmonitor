import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, writeFileSync, chmodSync, existsSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { spawnSync } from 'node:child_process';

const root = resolve(new URL('..', import.meta.url).pathname);
const scriptPath = join(root, 'scripts', 'health-check.sh');

function makeFakeCurl(dir) {
  const curlPath = join(dir, 'curl');
  writeFileSync(curlPath, `#!/bin/sh
if [ "$1" = "-sf" ] || [ "$1" = "-sS" ]; then
  printf '%s\\n' "$FAKE_BODY"
  printf '__WM_HTTP_CODE__:%s\\n' "\${FAKE_HTTP_CODE:-200}"
  exit 0
fi
exit 0
`);
  chmodSync(curlPath, 0o755);
}

function runHealthCheck({ body, stateDir }) {
  const binDir = mkdtempSync(join(tmpdir(), 'wm-health-bin-'));
  makeFakeCurl(binDir);
  return spawnSync('sh', [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      WM_URL: 'http://example.test',
      WM_STATE_DIR: stateDir,
      FAKE_BODY: body,
      FAKE_HTTP_CODE: '200',
      DISCORD_WEBHOOK_URL: '',
      ALERT_EMAIL: '',
    },
    encoding: 'utf8',
  });
}

// A fake curl that answers the health GET and records the JSON payload of any
// Discord webhook POST (`curl -sf -X POST ... -d '<payload>'`) into a file so
// tests can assert on the exact message that would be delivered.
function makeCapturingCurl(dir) {
  const curlPath = join(dir, 'curl');
  writeFileSync(curlPath, `#!/bin/sh
if [ "$1" = "-sS" ]; then
  printf '%s\\n' "$FAKE_BODY"
  printf '__WM_HTTP_CODE__:%s\\n' "\${FAKE_HTTP_CODE:-200}"
  exit 0
fi
prev=""
for arg in "$@"; do
  if [ "$prev" = "-d" ] && [ -n "$WM_DISCORD_CAPTURE" ]; then
    printf '%s\\n' "$arg" >> "$WM_DISCORD_CAPTURE"
  fi
  prev="$arg"
done
exit 0
`);
  chmodSync(curlPath, 0o755);
}

function runHealthCheckCapture({ body, stateDir, capturePath }) {
  const binDir = mkdtempSync(join(tmpdir(), 'wm-health-bin-'));
  makeCapturingCurl(binDir);
  return spawnSync('sh', [scriptPath], {
    cwd: root,
    env: {
      ...process.env,
      PATH: `${binDir}:${process.env.PATH}`,
      WM_URL: 'http://example.test',
      WM_STATE_DIR: stateDir,
      FAKE_BODY: body,
      FAKE_HTTP_CODE: '200',
      DISCORD_WEBHOOK_URL: 'https://discord.example.test/webhook',
      WM_DISCORD_CAPTURE: capturePath,
      ALERT_EMAIL: '',
    },
    encoding: 'utf8',
  });
}

const PAGING_BODY = '{"status":"UNHEALTHY","shouldPage":true,"summary":{"crit":20}}';
const DATA_UNHEALTHY_BODY = '{"status":"UNHEALTHY","shouldPage":false,"summary":{"crit":4}}';
const HEALTHY_BODY = '{"status":"HEALTHY","shouldPage":false,"summary":{"crit":0}}';

describe('scripts/health-check.sh paging policy', () => {
  it('does not alert for data-only UNHEALTHY responses when shouldPage is false', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wm-health-state-'));

    const first = runHealthCheck({
      stateDir,
      body: '{"status":"UNHEALTHY","shouldPage":false,"summary":{"crit":4}}',
    });
    const second = runHealthCheck({
      stateDir,
      body: '{"status":"UNHEALTHY","shouldPage":false,"summary":{"crit":4}}',
    });

    assert.equal(first.status, 0);
    assert.match(first.stdout, /shouldPage=0/);
    assert.match(first.stdout, /ALERT SKIPPED: status=UNHEALTHY shouldPage=0/);
    assert.doesNotMatch(first.stdout, /^ALERT:/m);
    assert.equal(second.status, 0);
    assert.doesNotMatch(second.stdout, /^ALERT:/m);
    assert.doesNotMatch(second.stdout, /^RESOLVED:/m);
  });

  it('alerts once for shouldPage true and suppresses repeats by default', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wm-health-state-'));
    const body = '{"status":"UNHEALTHY","shouldPage":true,"summary":{"crit":20}}';

    const first = runHealthCheck({ stateDir, body });
    const second = runHealthCheck({ stateDir, body });

    assert.equal(first.status, 0);
    assert.match(first.stdout, /^ALERT:/m);
    assert.equal(second.status, 0);
    assert.match(second.stdout, /ALERT SUPPRESSED: status=UNHEALTHY repeat=0m/);
    assert.doesNotMatch(second.stdout, /^ALERT:/m);
  });
});

describe('api/health.js paging contract', () => {
  it('pages only for availability failures such as Redis being unavailable', async () => {
    const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
    const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    delete process.env.UPSTASH_REDIS_REST_URL;
    delete process.env.UPSTASH_REDIS_REST_TOKEN;

    try {
      const mod = await import(`${pathToFileURL(join(root, 'api', 'health.js')).href}?redis-down`);
      const response = await mod.default(new Request('http://example.test/api/health?compact=1'));
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, 'REDIS_DOWN');
      assert.equal(body.availabilityStatus, 'DOWN');
      assert.equal(body.shouldPage, true);
    } finally {
      if (oldUrl == null) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
      if (oldToken == null) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
    }
  });

  it('does not page for data quality failures while Redis is reachable', async () => {
    const oldUrl = process.env.UPSTASH_REDIS_REST_URL;
    const oldToken = process.env.UPSTASH_REDIS_REST_TOKEN;
    const oldFetch = globalThis.fetch;

    process.env.UPSTASH_REDIS_REST_URL = 'https://redis.example.test';
    process.env.UPSTASH_REDIS_REST_TOKEN = 'test-token';
    globalThis.fetch = async (_url, init) => {
      const commands = JSON.parse(init.body);
      return new Response(JSON.stringify(commands.map(() => ({ result: null }))), { status: 200 });
    };

    try {
      const mod = await import(`${pathToFileURL(join(root, 'api', 'health.js')).href}?data-unhealthy`);
      const response = await mod.default(new Request('http://example.test/api/health?compact=1'));
      const body = await response.json();

      assert.equal(response.status, 200);
      assert.equal(body.status, 'UNHEALTHY');
      assert.equal(body.availabilityStatus, 'UP');
      assert.equal(body.alertSeverity, 'data');
      assert.equal(body.shouldPage, false);
    } finally {
      globalThis.fetch = oldFetch;
      if (oldUrl == null) delete process.env.UPSTASH_REDIS_REST_URL;
      else process.env.UPSTASH_REDIS_REST_URL = oldUrl;
      if (oldToken == null) delete process.env.UPSTASH_REDIS_REST_TOKEN;
      else process.env.UPSTASH_REDIS_REST_TOKEN = oldToken;
    }
  });
});

describe('scripts/health-check.sh incident-aware recovery', () => {
  it('resolves exactly once when a paging incident clears into a lingering data-only UNHEALTHY state', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wm-health-state-'));

    // 1. A real paging incident opens (e.g. Redis down / site unreachable).
    const paging = runHealthCheck({ stateDir, body: PAGING_BODY });
    // 2-4. The paging condition clears, but the data layer is still UNHEALTHY
    //      (stale/empty data — shouldPage:false). The health check keeps firing
    //      every couple of minutes on this same state.
    const clear1 = runHealthCheck({ stateDir, body: DATA_UNHEALTHY_BODY });
    const clear2 = runHealthCheck({ stateDir, body: DATA_UNHEALTHY_BODY });
    const clear3 = runHealthCheck({ stateDir, body: DATA_UNHEALTHY_BODY });

    assert.equal(paging.status, 0);
    assert.match(paging.stdout, /^ALERT:/m);

    // The incident must resolve exactly once, then go quiet — never spam a
    // "復旧" message on every subsequent cron tick.
    assert.match(clear1.stdout, /^RESOLVED:/m);
    assert.doesNotMatch(clear2.stdout, /^RESOLVED:/m);
    assert.doesNotMatch(clear3.stdout, /^RESOLVED:/m);
  });

  it('does not emit a self-contradictory "復旧 / UNHEALTHY" recovery message', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wm-health-state-'));
    const capturePath = join(stateDir, 'discord-capture.txt');

    runHealthCheckCapture({ stateDir, body: PAGING_BODY, capturePath });
    runHealthCheckCapture({ stateDir, body: DATA_UNHEALTHY_BODY, capturePath });

    assert.ok(existsSync(capturePath), 'expected a Discord webhook payload to be captured');
    const payloads = readFileSync(capturePath, 'utf8');

    // The recovery embed must not headline a recovery while immediately asserting
    // the status is still UNHEALTHY — that is the nonsensical message users saw.
    assert.doesNotMatch(payloads, /復旧[^\n]*\\nステータス: \*\*UNHEALTHY\*\*/);
    // When data is still degraded, recovery must frame it as availability/paging
    // recovery and surface the data status as separate, clearly-labelled context.
    assert.match(payloads, /データ状態/);
  });

  it('resolves once and stays quiet on a clean recovery to HEALTHY', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wm-health-state-'));

    runHealthCheck({ stateDir, body: PAGING_BODY });
    const recovered = runHealthCheck({ stateDir, body: HEALTHY_BODY });
    const steady = runHealthCheck({ stateDir, body: HEALTHY_BODY });

    assert.match(recovered.stdout, /^RESOLVED:/m);
    assert.doesNotMatch(steady.stdout, /^RESOLVED:/m);
    assert.doesNotMatch(steady.stdout, /^ALERT:/m);
  });

  it('sanitizes a corrupt/out-of-range epoch in the state file without erroring', () => {
    const stateDir = mkdtempSync(join(tmpdir(), 'wm-health-state-'));
    // A legacy/corrupt state file whose epoch is all-digits but far out of 64-bit
    // range. The numeric guard must reset it to 0 rather than letting `[ -gt ]`
    // throw and silently strand the incident.
    writeFileSync(join(stateDir, 'health-check.state'), 'UNREACHABLE|99999999999999999999999999\n');

    const run = runHealthCheck({ stateDir, body: HEALTHY_BODY });

    assert.equal(run.status, 0);
    assert.doesNotMatch(run.stderr, /integer expression expected|Illegal number|arithmetic/i);
    // The corrupt epoch must not be written straight back to the state file.
    assert.doesNotMatch(readFileSync(join(stateDir, 'health-check.state'), 'utf8'), /99999999999999999999999999/);
  });
});
