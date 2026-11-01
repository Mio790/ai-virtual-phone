// Simulation only. No browser or model calls.
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require('typescript');
function load(path) {
  const context = { exports: {}, Map, Set };
  vm.runInNewContext(ts.transpile(fs.readFileSync(path, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), context);
  return context.exports;
}
const { removeCompanionNPCs, CompanionIdentityError } = load('lib/map-companions.ts');
const { assertRecoveryMapCompatible } = load('lib/map-recovery-compat.ts');
const cards = [{ id: 'gu', name: '顾眠／顾厌' }, { id: 'eli', name: 'Elias Voss（Eli）' }];
const skeleton = { npcs: [{ name: '顾厌' }, { name: 'Eli' }, { name: 'Eli' }], richRegions: [] };
const untouched = JSON.stringify(skeleton);
assert.throws(() => removeCompanionNPCs(skeleton, cards), CompanionIdentityError);
assert.equal(JSON.stringify(skeleton), untouched); // cancel/no confirmation never mutates
assert.throws(() => removeCompanionNPCs(skeleton, cards, { 0: 'wrong-card' }), CompanionIdentityError);
assert.equal(JSON.stringify(skeleton), untouched);
removeCompanionNPCs(skeleton, cards, { 0: 'gu', 1: 'eli', 2: 'independent' });
assert.equal(skeleton.npcs.length, 1); // distinct namesake kept independently
assert.equal(skeleton.npcs[0].name, 'Eli');
const oldMap = { l1Nodes: [{ id: 'a', nameCn: '城' }], l2Nodes: [{ name: '广场', regionIdx: 0 }], l3Nodes: [] };
const save = { id: 'old', currentNodeId: 'a', discoveredNodes: ['a'], visitedNodes: ['l2_0'], searchedNodes: { l2_0: 1 }, agents: [{ currentNodeId: 'l2_0', discoveredNodes: ['a'], visitedNodes: ['a'], affinity: 99 }], extra: 'retain' };
const before = JSON.stringify(save);
assertRecoveryMapCompatible(oldMap, structuredClone(oldMap), [save]);
assert.equal(JSON.stringify(save), before);
for (const broken of [
  { ...oldMap, l2Nodes: [] },
  { ...oldMap, l2Nodes: [{ name: '完全不同的地点', regionIdx: 0 }] },
]) assert.throws(() => assertRecoveryMapCompatible(oldMap, broken, [save]), /无法无损匹配/);
for (const field of ['currentNodeId', 'discoveredNodes', 'visitedNodes', 'searchedNodes']) {
  const bad = structuredClone(save);
  bad[field] = field === 'currentNodeId' ? 'missing' : field === 'searchedNodes' ? { missing: 1 } : ['missing'];
  assert.throws(() => assertRecoveryMapCompatible(oldMap, oldMap, [bad]), /无法无损匹配/);
}
const badAgent = structuredClone(save); badAgent.agents[0].currentNodeId = 'missing';
assert.throws(() => assertRecoveryMapCompatible(oldMap, oldMap, [badAgent]), /无法无损匹配/);
assert.equal(JSON.stringify(save), before);
assertRecoveryMapCompatible({ l1Nodes: [], l2Nodes: [], l3Nodes: [] }, oldMap, []);
console.log('PASS identity decisions / independent namesake / invalid or cancelled decisions unchanged; old player+agent+discovered+visited+searched positions; mismatch refusal with no mutation; empty failed-world save list');
