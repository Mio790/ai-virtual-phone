const { createLoader, fixture } = require('./if-test-utils.cjs');
const assert = require('node:assert/strict'), Dexie = require('dexie');
(async () => {
  const databases = [];
  class TestDexie extends Dexie { constructor(...args) { super(...args); databases.push(this); } }
  TestDexie.default = TestDexie;
  const load = createLoader({ dexie: TestDexie }), domain = load('lib/if-theater.ts'), storage = load('lib/if-theater-storage.ts');
  const script = { ...fixture(), world: 'WORLD-UNABRIDGED-'.repeat(16000) };
  const root = domain.newIFSave(script); root.messages = Array.from({ length: 1000 }, (_, i) => ({ role: i % 2 ? 'assistant' : 'user', content: `HISTORY-${i}-` + 'x'.repeat(160) }));
  const branch = domain.forkIFSave(root, root.messages.length);
  let data = await storage.writeIFData({ revision: 0, scripts: [script], saves: [root, branch], extraField: 'legacy-preserved' });
  const memory = 'BRANCH-ONLY-MEMORY\n' + '长期设定'.repeat(8000);
  data = await storage.writeIFData(domain.editIFMemory(data, root.id, memory));
  assert.equal(data.saves[1].memory, '');
  for (let i = 0; i < 3; i++) {
    const prompt = JSON.stringify(domain.buildIFPrompt(data.saves[0], `next-${i}`));
    assert.ok(prompt.includes(memory.split('\n')[0])); assert.ok(prompt.includes(script.world));
    assert.ok(prompt.includes('合成落地身份')); assert.ok(prompt.includes('HISTORY-999-'));
  }
  assert.ok(!JSON.stringify(domain.buildIFPrompt(data.saves[1], 'other')).includes('BRANCH-ONLY-MEMORY'));
  const reloaded = await createLoader()('lib/if-theater-storage.ts').readIFData();
  assert.equal(reloaded.saves[0].memory, memory);
  assert.equal(domain.newIFSave(script).memory, '');
  // Count the actual bytes sent to IndexedDB, not just a mocked call count.
  const proto = databases[0].Table.prototype, nativePut = proto.put;
  let snapshots = 0, deltaWrites = 0, snapshotBytes = 0, deltaBytes = 0;
  proto.put = function(row, ...args) {
    if (row.key.startsWith('ai_phone_if_pending_')) { snapshots++; snapshotBytes += row.value.length; }
    if (row.key.startsWith('ai_phone_if_delta_')) { deltaWrites++; deltaBytes += row.value.length; }
    return nativePut.call(this, row, ...args);
  };
  const started = performance.now();
  const result = await load('lib/if-theater-turn.ts').runIFStreamingTurn(data, root.id, 'long-stream', new AbortController().signal, async (_messages, _signal, delta) => {
    for (let i = 0; i < 1000; i++) await delta('chunk');
    return 'chunk'.repeat(1000);
  }, () => {});
  const elapsed = Math.round(performance.now() - started);
  proto.put = nativePut; data = result.data;
  assert.equal(snapshots, 1); assert.equal(deltaWrites, 1001); assert.ok(snapshotBytes > 500000);
  assert.ok(snapshotBytes + deltaBytes < snapshotBytes * 15, 'no full-history serialization on each delta');
  assert.equal(data.saves[0].messages.at(-1).content, 'chunk'.repeat(1000));
  assert.equal(data.saves[0].script.world, script.world); assert.equal(data.saves[0].memory, memory);
  // Legacy stage-B checkpoint (one full row, no delta key) still recovers locally.
  const db = databases[0], legacy = { id: 'old-checkpoint', data, saveId: root.id, input: 'old-input', text: 'LEGACY-PARTIAL' };
  await db.table('entries').put({ key: 'ai_phone_if_pending_old-checkpoint', value: JSON.stringify(legacy) });
  const pending = await storage.readIFPending(); assert.equal(pending[0].text, 'LEGACY-PARTIAL');
  const recovered = await load('lib/if-theater-turn.ts').recoverIFPending(pending[0]); data = recovered.data;
  assert.equal(data.saves[0].messages.at(-1).content, 'LEGACY-PARTIAL');
  // Quota failure in memory edit must preserve stored memory AND the caller snapshot.
  const before = JSON.stringify(data);
  proto.put = function(row, ...args) { if (row.key === 'ai_phone_if_theater_v1') throw new DOMException('Synthetic quota full', 'QuotaExceededError'); return nativePut.call(this, row, ...args); };
  await assert.rejects(storage.writeIFData(domain.editIFMemory(data, root.id, 'SHOULD-NOT-SAVE')), /quota/);
  proto.put = nativePut;
  assert.equal(JSON.stringify(data), before); assert.equal(JSON.stringify(await storage.readIFData()), before);
  const corrupt = { id: 'corrupt', data, saveId: root.id, input: 'u', text: 'durable' };
  await storage.checkpointIFReply(corrupt);
  await db.table('entries').put({ key: 'ai_phone_if_delta_corrupt', value: '{"text":null}' });
  await assert.rejects(storage.readIFPending(), /检查点损坏/);
  assert.equal(JSON.stringify(await storage.readIFData()), before);
  await db.table('entries').put({ key: 'ai_phone_if_delta_corrupt', value: '{"text":"durable"}' });
  await storage.clearIFPending(corrupt.id);
  const qaLoad = createLoader({ setTimeout: callback => setTimeout(callback, 0) });
  const qa = qaLoad('lib/if-theater-test-support.ts');
  assert.equal(qa.isIFOfflineAcceptance({ hostname: 'deploy-preview-2--mio-ai-virtual-phone.netlify.app', search: '?ifTheaterTest=1' }), true);
  for (const hostname of ['mio-ai-virtual-phone.netlify.app', 'deploy-preview-2--mio-ai-virtual-phone.netlify.app.evil.invalid', 'localhost']) {
    assert.equal(qa.isIFOfflineAcceptance({ hostname, search: '?ifTheaterTest=1' }), false);
  }
  assert.equal(qa.isIFOfflineAcceptance({ hostname: 'deploy-preview-2--mio-ai-virtual-phone.netlify.app', search: '' }), false);
  let qaCalls = 0, shown = '';
  await qaLoad('lib/if-theater-stream.ts').streamIFReply(qa.IF_TEST_CONFIG, [{ role: 'user', content: 'synthetic' }], new AbortController().signal, delta => { shown += delta; }, async (...args) => { qaCalls++; return qa.requestIFAcceptance(...args); });
  assert.equal(qaCalls, 1); assert.match(shown, /本地合成验收/);
  console.log(`PASS C memory isolation/injection/reload, 1000-turn full prompt, 1000-delta checkpoint: ${elapsed}ms; snapshot=${snapshotBytes} chars once; delta=${deltaBytes} chars total; legacy checkpoint recovery; memory QuotaExceeded rollback.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
