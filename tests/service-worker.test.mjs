import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, readFile, rm, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { basename, dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { execFileSync } from 'node:child_process';
import { runInNewContext } from 'node:vm';

const directory = await mkdtemp(join(tmpdir(), 'movana-worker-test-'));
after(async () => {
  assert.equal(dirname(resolve(directory)), resolve(tmpdir()));
  assert.ok(basename(directory).startsWith('movana-worker-test-'));
  await rm(directory, { recursive: true, force: true });
});
for (const [file, content] of Object.entries({
  'index.html': '<html>Movana test</html>', 'assets/app.js': 'app',
  'models/pose.task': 'model', 'mediapipe/wasm/vision.wasm': 'wasm',
})) {
  const target = join(directory, 'dist', file);
  await mkdir(dirname(target), { recursive: true });
  await writeFile(target, content);
}
execFileSync(process.execPath, [fileURLToPath(new URL('../scripts/service-worker.mjs', import.meta.url))], { cwd: directory });
const source = await readFile(join(directory, 'dist/sw.js'), 'utf8');
const origin = 'https://movana.test';
const response = body => ({ body, ok: true, type: 'basic', clone() { return response(body); } });

function fixture() {
  const handlers = {}, saved = new Map(), fetched = [], written = [], installed = [];
  const state = { networkFails: false, writesFail: false, cacheFails: false, body: 'network' };
  const cache = {
    async match(key) { return saved.get(key); },
    async put(key, value) { written.push(key); if (state.writesFail) throw Error('Storage full'); saved.set(key, value); },
    async addAll(keys) { installed.push(...keys); },
  };
  runInNewContext(source, {
    URL, self: { location: { origin }, addEventListener(name, handler) { handlers[name] = handler; } },
    caches: { async open() { if (state.cacheFails) throw Error('Storage unavailable'); return cache; } },
    async fetch(request, options) {
      fetched.push({ request, options });
      if (state.networkFails) throw Error('Offline');
      return response(state.body);
    },
  });
  async function request(path, options = {}) {
    let pending;
    handlers.fetch({ request: { url: new URL(path, origin).href, method: 'GET', mode: 'cors', ...options },
      respondWith(value) { pending = value; } });
    return pending === undefined ? undefined : await pending;
  }
  return { handlers, saved, fetched, written, installed, state, request };
}

test('worker only caches build assets and canonicalizes query variants', async () => {
  const f = fixture();
  let install;
  f.handlers.install({ waitUntil(pending) { install = pending; } });
  await install;
  assert.ok(f.installed.includes('/index.html'));
  assert.ok(f.installed.includes('/assets/app.js'));
  assert.ok(!f.installed.some(key => /models|mediapipe/.test(key)), 'Tracking binaries must stay lazy');
  for (const path of ['/events', '/unknown.js', '/unknown?private=value', 'https://other.test/assets/app.js']) {
    assert.equal(await f.request(path), undefined, 'Unknown and external resources are not intercepted');
  }
  assert.equal(await f.request('/assets/app.js', { method: 'POST' }), undefined);
  assert.equal(await f.request('/unknown', { mode: 'navigate' }), undefined);
  assert.equal(f.fetched.length, 0);
  assert.equal((await f.request('/assets/app.js?private=one')).body, 'network');
  assert.equal((await f.request('/assets/app.js?private=two')).body, 'network');
  assert.equal(f.fetched.length, 1, 'Query variants reuse one asset entry');
  assert.equal(f.fetched[0].request, '/assets/app.js');
  assert.deepEqual(f.written, ['/assets/app.js']);
  assert.equal((await f.request('/models/pose.task?private=three')).body, 'network');
  assert.deepEqual(f.written, ['/assets/app.js', '/models/pose.task']);
  assert.ok([...f.saved.keys()].every(key => !key.includes('?')));
});

test('navigation refreshes canonical HTML and falls back to its cached copy offline', async () => {
  const f = fixture();
  f.saved.set('/index.html', response('old app'));
  f.state.body = 'updated app';
  assert.equal((await f.request('/?utm_source=reddit&private=value', { mode: 'navigate' })).body, 'updated app');
  assert.equal(f.fetched[0].request, '/index.html');
  const options = f.fetched[0].options;
  assert.equal(options.cache, 'no-cache');
  assert.equal(options.credentials, 'omit');
  assert.equal(options.redirect, 'error');
  assert.equal(options.referrerPolicy, 'no-referrer');
  assert.deepEqual(f.written, ['/index.html']);
  f.state.networkFails = true;
  assert.equal((await f.request('/index.html?private=value', { mode: 'navigate' })).body, 'updated app');
  assert.equal(f.fetched.length, 2, 'Navigation tries the network before its cached fallback');
});

test('storage failures do not prevent usable network responses', async () => {
  const f = fixture();
  f.state.writesFail = true;
  assert.equal((await f.request('/assets/app.js')).body, 'network');
  assert.equal((await f.request('/', { mode: 'navigate' })).body, 'network');
  assert.equal(f.saved.size, 0);
  assert.equal(f.fetched.length, 2, 'A failed cache write does not repeat a successful download');
  f.state.cacheFails = true;
  assert.equal((await f.request('/assets/app.js')).body, 'network');
});
