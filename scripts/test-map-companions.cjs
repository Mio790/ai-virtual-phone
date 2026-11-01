// Node + fake-indexeddb only; no browser, model, or production data.
require('fake-indexeddb/auto');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require('typescript'), Dexie = require('dexie');
const read = path => fs.readFileSync(path, 'utf8');
function load(source, globals = {}) {
  const context = { exports: {}, console, ...globals };
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), context);
  return context.exports;
}
const { removeCompanionNPCs } = load(read('lib/map-companions.ts'));
const source = read('lib/map-storage.ts');
const agentSource = source.slice(source.indexOf('export function addAgentToSave'), source.indexOf('/** Remove a character agent'));
const { addAgentToSave } = load(agentSource, { rollStatsFromPersonality: () => ({ str: 50 }) });
const cards = [
  { id: 'c1', name: '希里安（Cillian Vale）', aliases: ['Cillian'] },
  { id: 'c2', name: '影山怜', aliases: ['怜'] },
  { id: 'c3', name: 'Elias Voss（Eli）', aliases: ['伊莱亚斯'] },
  { id: 'c4', name: '顾眠／顾厌', aliases: [] },
];
const before = JSON.stringify(cards);
for (const card of cards) for (const name of [card.name, ...card.aliases]) {
  const skeleton = { npcs: [{ name, characterId: card.id }, { name, characterId: 'independent-other' }], richRegions: [] };
  removeCompanionNPCs(skeleton, cards);
  assert.equal(skeleton.npcs.length, 1);
  assert.equal(skeleton.npcs[0].characterId, 'independent-other');
}
for (const name of ['希里安', 'Cillian Vale', 'Cillian', '影山怜', '怜', 'Elias Voss', 'Eli', '伊莱亚斯', '顾眠', '顾厌']) {
  const skeleton = { npcs: [{ name }], richRegions: [] };
  assert.throws(() => removeCompanionNPCs(skeleton, cards), /歧义/);
  assert.equal(skeleton.npcs.length, 1); // no silent deletion of a namesake
}
let save = { id: 'legacy-save', worldId: 'original-world', currentNodeId: 'a', discoveredNodes: ['a'], agents: [{ characterId: 'c4', affinity: 99, oldRelationship: 'preserve' }], extra: { old: true } };
for (const card of [...cards, ...cards]) save = addAgentToSave(save, card.id, '');
assert.equal(save.agents.length, 4);
assert.equal(JSON.stringify(save.agents.map(agent => agent.characterId).sort()), JSON.stringify(['c1', 'c2', 'c3', 'c4']));
assert.equal(save.agents[0].affinity, 99);
assert.equal(save.agents[0].oldRelationship, 'preserve');
assert.equal(JSON.stringify(cards), before);
console.log('PASS explicit identity dedup; all configured aliases ambiguity-safe; independent namesakes; four original IDs; Gu Mian/Gu Yan one agent; old relationship/card unchanged');
(async () => {
  const subset = source.slice(source.indexOf('class MapDatabase'), source.indexOf('export function deleteMapWorld')).replace('await hydrateThemeBlobs();', '');
  const api = load(subset, { Dexie });
  const world = { id: 'original-world', createdAt: 'old', updatedAt: 'old', legacy: { preserved: true } };
  await api.persistMapWorld(world, save);
  const other = new Dexie('isolated-legacy-chat-cards-memories');
  other.version(1).stores({ records: 'id' });
  const sentinels = ['chat', 'cards', 'memories'].map(id => ({ id, value: id + '-untouched' }));
  await other.table('records').bulkPut(sentinels);
  await assert.rejects(api.persistMapWorld({ ...world, updatedAt: 'bad' }, { ...save, invalid: () => {} }));
  const db = new Dexie('AiPhoneMapDB');
  db.version(2).stores({ worlds: 'id, createdAt', saves: 'id, worldId, timestamp', themeBlobs: 'id, worldId' });
  assert.deepEqual(await db.table('worlds').get(world.id), world);
  assert.equal(JSON.stringify(await db.table('saves').get(save.id)), JSON.stringify(save));
  assert.equal(api.loadMapWorlds()[0].updatedAt, 'old');
  assert.deepEqual(await other.table('records').toArray(), [...sentinels].sort((a, b) => a.id.localeCompare(b.id)));
  const reloaded = load(subset.replace(/if \(typeof window !== "undefined"\) hydrateMapStorage\(\);/, ''), { Dexie, window: {} });
  await reloaded.hydrateMapStorage();
  assert.equal(reloaded.loadMapWorlds()[0].legacy.preserved, true);
  console.log('PASS simulated reload old-world read; same ID/extra fields; transactional rollback/cache; unrelated sentinel DB untouched (not real user-data proof)');
  db.close(); other.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
