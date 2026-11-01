// Simulation only: not Safari or real browser verification.
// Prerequisites: npm install --no-save --package-lock=false fake-indexeddb
require('fake-indexeddb/auto');
const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const ts = require('typescript');
const Dexie = require('dexie');
const read = path => fs.readFileSync(path, 'utf8');
const load = (source, globals = {}) => {
  const context = { exports: {}, console, ...globals };
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), context);
  return context.exports;
};
const engine = read('lib/map-rpg-engine.ts');
const parser = engine.slice(engine.indexOf('function parseWorldTaggedFields'), engine.indexOf('export async function generateWorldSkeleton')) + engine.slice(engine.indexOf('export function parseWorldSkeleton'), engine.indexOf('// ═════════', engine.indexOf('export function parseWorldSkeleton')));
const { parseWorldSkeleton } = load(parser);
const { generateMap } = load(read('lib/map-engine.ts'));
const storage = read('lib/map-storage.ts');
const subset = storage.slice(storage.indexOf('class MapDatabase'), storage.indexOf('export function deleteMapWorld')).replace('await hydrateThemeBlobs();', '');
const createStorage = () => load(subset, { Dexie });
const raw = '[世界名]测试世界\n[世界观]原始世界观\n#区域1\n[id]a\n[中文名]城\n[英文名]City\n[地理]plains\n[河流数]0\n##L2节点1\n[名称]广场\n#主线\n[标题]调查\n[阶段1地点]广场\n[阶段1简介]调查\n#档案\n[隐藏真相]秘密\n[结局]结束';
(async () => {
  const api = createStorage();
  const skeleton = parseWorldSkeleton(raw);
  assert.equal(skeleton.world.lore, '原始世界观');
  const renderedMap = generateMap({ ...skeleton.mapInput, seed: 42 }, JSON.parse(read('public/countries.geo.json')));
  assert.ok(renderedMap.l1Nodes.length);
  console.log('PASS tagged parser + real map algorithm (no model)');
  // All input transports must preserve the exact bytes delivered to the parser.
  for (const text of [JSON.parse(JSON.stringify({ rawResponse: raw })).rawResponse, raw, await new Blob([raw]).text()]) assert.equal(parseWorldSkeleton(text).world.name, '测试世界');
  console.log('PASS log/paste/text-file payload parsing (not UI events)');
  assert.throws(() => parseWorldSkeleton(raw + 'x'.repeat(8100) + '\n…[日志截断：原文共 99999 字符]'), /截断/);
  assert.throws(() => parseWorldSkeleton(raw.split('#档案')[0]), /不完整/);
  console.log('PASS marked truncation >8000 and incomplete input rejected');
  const world = { id: 'original-failed-id', skeleton, renderedMap, createdAt: 'old', updatedAt: 'old', legacyExtra: { preserved: true } };
  const save = { id: 'test-save', worldId: world.id, agents: [], legacyExtra: 'untouched' };
  await api.persistMapWorld(world, save);
  const db = new Dexie('AiPhoneMapDB');
  db.version(2).stores({ worlds: 'id, createdAt', saves: 'id, worldId, timestamp', themeBlobs: 'id, worldId' });
  assert.equal((await db.table('worlds').get(world.id)).legacyExtra.preserved, true);
  await assert.rejects(api.persistMapWorld({ ...world, updatedAt: 'BAD' }, { ...save, invalid: () => {} }));
  assert.equal((await db.table('worlds').get(world.id)).updatedAt, 'old');
  assert.equal(api.loadMapWorlds()[0].updatedAt, 'old');
  assert.equal((await db.table('saves').get(save.id)).legacyExtra, 'untouched');
  console.log('PASS transaction readback, clone-failure rollback, cache unchanged, unknown legacy fields preserved');
  const reloaded = createStorage();
  // No real window: inspect the same simulated durable database directly.
  assert.equal((await db.table('worlds').get(world.id)).id, world.id);
  assert.equal(db.verno, 2);
  assert.ok(reloaded.persistMapWorld);
  console.log('PASS stable original world ID and unchanged schema version; NOT real reload durability');
  const agentSource = storage.slice(storage.indexOf('export function addAgentToSave'), storage.indexOf('export function addAgentToSave') + 250);
  assert.match(agentSource, /agents.some\(a => a.characterId === characterId\).*return save/);
  console.log('PASS existing agent ID duplicate guard (source assertion only; aliases remain unverified)');
  db.close();
  console.log('LIMITATIONS: no UI event test, no Safari, no real IndexedDB/reload, no real user-data compatibility proof');
})().catch(error => { console.error(error); process.exitCode = 1; });
