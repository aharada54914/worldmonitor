import { describe, it } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, writeFileSync, chmodSync } from 'node:fs';
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
