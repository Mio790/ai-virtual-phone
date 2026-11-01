// Actual IF controller + SSE parser + transactional storage, synthetic data only.
const { createLoader, fixture, sse } = require('./if-test-utils.cjs');
const assert = require('node:assert/strict'), Dexie = require('dexie');
(async () => {
  const databases = [];
  class TestDexie extends Dexie { constructor(...args) { super(...args); databases.push(this); } }
  TestDexie.default = TestDexie;
  const load = createLoader({ dexie: TestDexie }), domain = load('lib/if-theater.ts'), storage = load('lib/if-theater-storage.ts');
  const stream = load('lib/if-theater-stream.ts'), turns = load('lib/if-theater-turn.ts');
  const config = { provider: 'Custom', baseUrl: 'https://mock.invalid/v1', apiKey: 'SYNTHETIC-NOT-A-KEY', defaultModel: 'claude-model-name-does-not-select-protocol' };
  const db = new Dexie('AiPhoneKvDB'); db.version(1).stores({ entries: 'key' });
  const sentinels = ['modern-chat', 'modern-memory', 'character-card', 'old-world'].map(key => ({ key, value: key + '-untouched' }));
  await db.table('entries').bulkPut(sentinels);
  let data = await storage.writeIFData({ revision: 0, scripts: [fixture()], saves: [domain.newIFSave(fixture())], extraLegacyField: 'preserved' });
  const rootId = data.saves[0].id;
  let calls = 0, prompts = [], text = 'A1', finish = true;
  const transport = (messages, signal, delta) => stream.streamIFReply(config, messages, signal, delta, async (url, init) => {
    calls++; assert.equal(url, 'https://mock.invalid/v1/chat/completions');
    const body = JSON.parse(init.body); assert.equal(body.stream, true); prompts.push(body.messages);
    assert.ok(body.messages[0].content.includes('合成落地身份'));
    return sse(text, finish);
  });
  const run = async (id, input, index, signal = new AbortController().signal, onDelta = () => {}) => {
    const result = await turns.runIFStreamingTurn(data, id, input, signal, transport, onDelta, index);
    data = result.data; return result;
  };
  await run(rootId, 'U1'); text = 'ORIGINAL-FUTURE'; await run(rootId, 'U2');
  assert.equal(data.saves.length, 1, 'normal chat does not fork'); assert.equal(calls, 2);
  const original = JSON.stringify(data.saves[0]);
  text = 'A2'; let result = await run(rootId, '', 1);
  const alternate = result.saveId;
  assert.equal(calls, 3); assert.equal(JSON.stringify(data.saves[0]), original);
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('ORIGINAL-FUTURE')); assert.ok(!JSON.stringify(prompts.at(-1)).includes('A1'));
  text = 'A3'; result = await run(alternate, '', 1);
  assert.equal(data.replyVersions[0].saveIds.length, 3);
  assert.equal(data.saves.length, 3);
  // Selecting a swipe is selecting its saved history, not overwriting the root.
  text = 'ALT-FUTURE'; await run(alternate, 'only-A2');
  assert.ok(JSON.stringify(prompts.at(-1)).includes('A2'));
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('A3'));
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('ORIGINAL-FUTURE'));
  text = 'ROOT-FUTURE'; await run(rootId, 'only-A1');
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('ALT-FUTURE'));
  assert.ok(JSON.stringify(prompts.at(-1)).includes('ORIGINAL-FUTURE'));
  assert.equal(data.saves.length, 3);
  assert.equal(data.extraLegacyField, 'preserved');
  // Stop while a delta is visible: one request, partial reply persisted on same branch.
  const abort = new AbortController(); text = 'STOP-PART';
  result = await run(rootId, 'stop', undefined, abort.signal, () => abort.abort());
  assert.ok(result.warning); assert.equal(data.saves[0].messages.at(-1).incomplete, true);
  assert.equal(data.saves[0].messages.at(-1).content, 'STOP-PART');
  const beforeAbortCalls = calls; const pre = new AbortController(); pre.abort();
  await assert.rejects(run(rootId, 'preabort', undefined, pre.signal)); assert.equal(calls, beforeAbortCalls);
  // EOF without [DONE]/finish_reason is not silently reported as a complete reply.
  text = 'BROKEN-PART'; finish = false;
  result = await run(rootId, 'broken'); assert.match(result.warning, /中断/);
  assert.equal(data.saves[0].messages.at(-1).incomplete, true); finish = true;
  // Inject failure AFTER the main row's put, at readback: entire transaction rolls back.
  const prototype = databases[0].Table.prototype, nativePut = prototype.put, nativeGet = prototype.get;
  let armed = false;
  prototype.put = async function(row, ...rest) { const result = await nativePut.call(this, row, ...rest); if (row.key === 'ai_phone_if_theater_v1') armed = true; return result; };
  prototype.get = function(key, ...rest) { if (armed && key === 'ai_phone_if_theater_v1') { armed = false; throw new Error('SYNTHETIC readback failure'); } return nativeGet.call(this, key, ...rest); };
  const beforeFailure = JSON.stringify(data), beforeFailureCalls = calls;
  text = 'WRITE-FAILED-REPLY'; let visible = '';
  await assert.rejects(run(rootId, 'disk-failure', undefined, undefined, x => visible = x), /readback failure/);
  prototype.put = nativePut; prototype.get = nativeGet;
  assert.equal(calls, beforeFailureCalls + 1); assert.equal(visible, text);
  assert.equal(JSON.stringify(await storage.readIFData()), beforeFailure, 'failed transaction does not mutate old data');
  const reload = createLoader(), reloadStorage = reload('lib/if-theater-storage.ts');
  const checkpoints = await reloadStorage.readIFPending(); assert.equal(checkpoints.length, 1); assert.equal(checkpoints[0].text, text);
  const recovered = await reload('lib/if-theater-turn.ts').recoverIFPending(checkpoints[0]);
  data = recovered.data; assert.equal(data.saves[0].messages.at(-1).content, text);
  assert.equal(calls, beforeFailureCalls + 1, 'local recovery makes zero requests');
  assert.equal((await storage.readIFPending()).length, 0);
  // A cleanup failure after commit must return the committed data, not stale UI state.
  const nativeDelete = prototype.delete;
  prototype.delete = function(key, ...rest) { if (key.startsWith('ai_phone_if_pending_')) throw new Error('SYNTHETIC cleanup failure'); return nativeDelete.call(this, key, ...rest); };
  text = 'COMMITTED-DESPITE-CLEANUP'; result = await run(rootId, 'cleanup');
  assert.match(result.warning, /已落盘/); assert.equal(data.saves[0].messages.at(-1).content, text);
  prototype.delete = nativeDelete;
  for (const checkpoint of await storage.readIFPending()) {
    await assert.rejects(turns.recoverIFPending(checkpoint), /另一个窗口/);
    await storage.clearIFPending(checkpoint.id);
  }
  // Storage fails before request: no spending, no history mutation.
  prototype.put = function(row, ...rest) { if (row.key.startsWith('ai_phone_if_pending_')) throw new Error('SYNTHETIC quota'); return nativePut.call(this, row, ...rest); };
  const preQuota = calls;
  await assert.rejects(run(rootId, 'quota'), /quota/); assert.equal(calls, preQuota); prototype.put = nativePut;
  // Emulate reload while checkpoint exists but history commit has not happened.
  let release, checkpointReady;
  const ready = new Promise(resolve => { checkpointReady = resolve; });
  const crashed = turns.runIFStreamingTurn(data, rootId, 'crash', new AbortController().signal, async (_messages, _signal, delta) => {
    await delta('DURABLE-BEFORE-RELOAD'); checkpointReady();
    await new Promise(resolve => { release = resolve; }); throw new Error('simulated tab ended');
  }, () => {});
  await ready;
  const crashCheckpoint = (await reloadStorage.readIFPending())[0];
  const afterCrash = await turns.recoverIFPending(crashCheckpoint); data = afterCrash.data;
  release(); await assert.rejects(crashed, /另一个窗口/);
  // A stale request cannot overwrite the separately recovered branch.
  assert.equal((await storage.readIFData()).revision, data.revision);
  for (const row of sentinels) assert.deepEqual(await db.table('entries').get(row.key), row);
  const final = await createLoader()('lib/if-theater-storage.ts').readIFData();
  assert.equal(final.saves.length, 3); assert.equal(final.replyVersions[0].saveIds.length, 3);
  assert.equal(final.saves[0].script.actors[0].characterId, 'original-gu');
  console.log('PASS integrated Mock SSE + fake IndexedDB: same-save continuation; 3 swipes; isolated futures; Stop/EOF partials; zero-call preabort/quota; transaction rollback; checkpoint recovery/reload/conflict; legacy fields and modern sentinels unchanged.');
  db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
