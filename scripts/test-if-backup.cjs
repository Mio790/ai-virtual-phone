const { createLoader, fixture } = require('./if-test-utils.cjs');
const assert = require('node:assert/strict'), Dexie = require('dexie'), { IDBFactory } = require('fake-indexeddb');
// JSZip uses FileReader in browsers. Node-only adapter; not a Safari API test.
class NodeFileReader {
  readAsArrayBuffer(blob) { blob.arrayBuffer().then(result => { this.result = result; this.onload?.({ target: this }); }, error => { this.error = error; this.onerror?.(error); }); }
  readAsDataURL(blob) { blob.arrayBuffer().then(buffer => { this.result = `data:${blob.type};base64,${Buffer.from(buffer).toString('base64')}`; this.onload?.({ target: this }); }); }
}
globalThis.FileReader = NodeFileReader;
function isolated() {
  const factory = new IDBFactory(), instances = [];
  class ScopedDexie extends Dexie { constructor(name) { super(name, { indexedDB: factory, IDBKeyRange }); instances.push(this); } }
  ScopedDexie.default = ScopedDexie;
  const local = new Map(), localStorage = { get length() { return local.size; }, key: i => [...local.keys()][i] ?? null, getItem: key => local.get(key) ?? null, setItem: (key, value) => local.set(key, value), removeItem: key => local.delete(key) };
  const load = createLoader({ dexie: ScopedDexie, indexedDB: factory, FileReader: NodeFileReader, localStorage,
    window: { localStorage, location: { origin: 'https://isolated-test.invalid' } } });
  return { load, instances };
}
(async () => {
  const content = ({ revision, ...data }) => JSON.stringify(data);
  const source = isolated(), load = source.load, storage = load('lib/if-theater-storage.ts'), domain = load('lib/if-theater.ts');
  const backup = load('lib/data-management/backup.ts'), kv = load('lib/kv-db.ts'), modules = load('lib/data-management/modules.ts');
  const script = { ...fixture(), world: 'Full-world-'.repeat(1200) }, save = domain.newIFSave(script);
  let data = await storage.writeIFData({ revision: 0, scripts: [script], saves: [save], extraLegacy: 'retained' });
  // Reproduce stale hydrated cache after import/reload followed by direct IF writes.
  await kv.kvSetAsync('ai_phone_if_theater_v1', JSON.stringify(data));
  data = await storage.writeIFData(domain.editIFMemory(data, save.id, 'IF-MEMORY-DO-NOT-LOSE'));
  let applied = domain.applyIFReply(data, save.id, 'U', 'A1');
  data = await storage.writeIFData(applied.data);
  applied = domain.applyIFReply(data, save.id, '', 'A2', false, 1); data = await storage.writeIFData(applied.data);
  const fork = domain.forkIFSave(data.saves[0], 1);
  data = await storage.writeIFData({ ...data, activeSaveId: applied.saveId, saves: [...data.saves, fork] });
  const pending = { id: 'backup-pending', data, saveId: save.id, input: 'partial-user', text: 'PARTIAL-DURABLE' };
  await storage.checkpointIFReply(pending);
  for (const key of ['modern-chat', 'modern-memory', 'character-card']) await kv.kvSetAsync(key, key + '-synthetic');
  const creative = modules.DATA_MODULES.find(module => module.id === 'creative');
  const ifSource = creative.sources.find(source => source.databaseOnly);
  assert.ok(ifSource); assert.ok(ifSource.prefixes.includes('ai_phone_if_delta_'));
  const full = await backup.createBackupBlob();
  const parsed = await backup.readBackupBlob(full.blob);
  const allRecords = parsed.modules.flatMap(module => module.sources.flatMap(source => source.records || []));
  const savedRows = allRecords.filter(row => row.key === 'ai_phone_if_theater_v1');
  assert.equal(savedRows.length, 1, 'IF is not duplicated in cache backup');
  assert.equal(JSON.stringify(JSON.parse(savedRows[0].value)), JSON.stringify(data), 'database wins over stale shared cache');
  // Fresh, genuinely independent fake IndexedDB factory; restore the actual ZIP.
  const target = isolated(), restore = target.load('lib/data-management/backup.ts');
  const result = await restore.importBackupBlob(full.blob);
  assert.equal(result.errors.length, 0);
  const restoredStorage = target.load('lib/if-theater-storage.ts');
  assert.equal(content(await restoredStorage.readIFData()), content(data));
  assert.equal((await restoredStorage.readIFPending())[0].text, pending.text);
  assert.equal((await restoredStorage.readIFData()).saves[0].script.actors[0].characterId, 'original-gu');
  // Existing device: default import skips, overwrite is explicit and IF-only scoped.
  const targetKV = target.load('lib/kv-db.ts');
  const sentinelBefore = JSON.stringify(targetKV.kvEntries().filter(row => !row.key.startsWith('ai_phone_if_')));
  await restoredStorage.writeIFData(domain.editIFMemory(await restoredStorage.readIFData(), save.id, 'NEW-LOCAL-MEMORY'));
  let imported = await restore.importBackupBlob(full.blob, ['creative']);
  assert.equal(imported.errors.length, 0); assert.ok(imported.skipped > 0);
  assert.equal((await restoredStorage.readIFData()).saves[0].memory, 'NEW-LOCAL-MEMORY');
  imported = await restore.importBackupBlob(full.blob, ['creative'], { overwrite: true });
  assert.equal(imported.errors.length, 0); assert.ok(imported.overwritten > 0);
  assert.equal(content(await restoredStorage.readIFData()), content(data));
  assert.equal(JSON.stringify(targetKV.kvEntries().filter(row => !row.key.startsWith('ai_phone_if_'))), sentinelBefore);
  // Actual write failure during overwrite cannot mutate database or shared memory cache.
  const db = target.instances.filter(db => db.name === 'AiPhoneKvDB').at(-1), proto = db.Table.prototype, put = proto.put;
  proto.put = function(row, ...rest) { if (row.key === 'ai_phone_if_theater_v1') throw new DOMException('Synthetic quota', 'QuotaExceededError'); return put.call(this, row, ...rest); };
  imported = await restore.importBackupBlob(full.blob, ['creative'], { overwrite: true });
  proto.put = put;
  assert.ok(imported.errors.some(error => error.includes('quota')));
  assert.equal(content(await restoredStorage.readIFData()), content(data));
  assert.equal(targetKV.kvGet('ai_phone_if_theater_v1'), null, 'IF restore never poisons shared cache');
  await assert.rejects(restoredStorage.importIFRecord('ai_phone_if_theater_v1', '{"saves":[]}', true), /不完整/);
  await assert.rejects(restore.importBackupBlob(new Blob(['not-a-zip'])));
  // Legacy cache-module payload still routes through the scoped IF importer.
  const idb = target.load('lib/data-management/idb.ts');
  const legacy = await idb.importSource({ type: 'kv', records: [{ key: 'ai_phone_if_theater_v1', value: JSON.stringify(data) }] }, true);
  assert.equal(legacy.errors.length, 0);
  // Re-export restored data and import a second time into another fresh factory.
  const second = await restore.createBackupBlob(), third = isolated();
  const secondResult = await third.load('lib/data-management/backup.ts').importBackupBlob(second.blob);
  assert.equal(secondResult.errors.length, 0);
  const thirdStorage = third.load('lib/if-theater-storage.ts');
  assert.equal(content(await thirdStorage.readIFData()), content(data));
  const importedPending = (await thirdStorage.readIFPending())[0];
  const resumed = await third.load('lib/if-theater-turn.ts').recoverIFPending(importedPending);
  assert.equal(resumed.data.saves[0].messages.at(-1).content, pending.text);
  // An archive imported while an old request is active invalidates that writer.
  const oldRevision = await restoredStorage.readIFData();
  await restoredStorage.importIFRecord('ai_phone_if_theater_v1', JSON.stringify(oldRevision), true);
  await assert.rejects(restoredStorage.writeIFData(oldRevision), /另一个窗口/);
  console.log(`PASS actual full ZIP export/parse/import/re-export into independent fake IndexedDB: ${full.blob.size} bytes; full world, snapshots, 3 saves, branches/swipes, memory, active selection, checkpoint; stale cache guard; explicit overwrite/skip; legacy route; corrupt ZIP/data and quota errors; unrelated keys unchanged.`);
})().catch(error => { console.error(error); process.exitCode = 1; });
