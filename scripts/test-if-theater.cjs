// Node simulation. Never calls a network endpoint or a real model.
require('fake-indexeddb/auto');
const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict');
const ts = require('typescript'), Dexie = require('dexie');
function load(path) {
  const source = fs.readFileSync(path, 'utf8');
  const context = { exports: {}, crypto: require('node:crypto').webcrypto, structuredClone, require: name => {
    if (name === 'dexie') return Dexie;
    throw new Error('Unexpected dependency: ' + name);
  } };
  vm.runInNewContext(ts.transpile(source, { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), context);
  return context.exports;
}
(async () => {
  const domain = load('lib/if-theater.ts'), storage = load('lib/if-theater-storage.ts');
  const card = { characterId: 'original-gu', name: '顾眠／顾厌', persona: '原卡', personality: '原性格', identity: '时代身份：合成时代；财产：测试财产' };
  const script = { id: 'script-a', title: '通用合成剧本', world: '世界原文'.repeat(3000), time: '时刻设定', opening: '合成开场', player: '玩家人设', rules: '合成规则', actors: [card] };
  const save = domain.newIFSave(script), initial = JSON.stringify(save);
  script.world = 'changed'; card.identity = 'changed';
  assert.ok(save.script.world.length > 8000);
  let calls = 0;
  const signal = new AbortController().signal;
  const result = await domain.sendIFTurn(save, '合成消息', signal, async messages => {
    calls++; assert.equal(messages[0].role, 'system');
    for (const text of ['玩家人设', '时刻设定', '测试财产', '原卡', '合成规则']) assert.ok(messages[0].content.includes(text));
    assert.ok(messages[0].content.includes(save.script.world));
    return 'Mock回复';
  });
  assert.equal(calls, 1); assert.equal(JSON.stringify(save), initial);
  assert.equal(result.messages.length, save.messages.length + 2);
  const stopped = new AbortController(); stopped.abort();
  await assert.rejects(domain.sendIFTurn(save, 'test', stopped.signal, async () => { calls++; return 'bad'; }));
  assert.equal(calls, 1);
  const db = new Dexie('AiPhoneKvDB'); db.version(1).stores({ entries: 'key' });
  const sentinels = ['modern-chat', 'modern-memory', 'character-card'].map(key => ({ key, value: key + '-untouched' }));
  await db.table('entries').bulkPut(sentinels);
  const original = await storage.readIFData();
  const persisted = await storage.writeIFData({ ...original, scripts: [save.script], saves: [result] });
  await assert.rejects(storage.writeIFData({ ...original, scripts: [], saves: [] }), /另一个窗口/);
  const reloaded = await load('lib/if-theater-storage.ts').readIFData();
  assert.equal(reloaded.revision, persisted.revision);
  assert.equal(reloaded.saves[0].script.actors[0].characterId, 'original-gu');
  assert.equal(reloaded.saves[0].messages.at(-1).content, 'Mock回复');
  for (const row of sentinels) assert.deepEqual(await db.table('entries').get(row.key), row);
  const other = domain.newIFSave({ ...save.script, id: 'other', world: 'OTHER-WORLD' });
  const prompt = JSON.stringify(domain.buildIFPrompt(other, 'test'));
  assert.ok(!prompt.includes('Mock回复')); assert.ok(!prompt.includes('modern-memory-untouched'));
  for (const path of ['lib/if-theater.ts', 'lib/if-theater-storage.ts']) {
    assert.ok(!/from ["'].*(?:memory|chat-engine|group-chat)/.test(fs.readFileSync(path, 'utf8')));
  }
  console.log('PASS: one Mock transport call; full world/identity each turn; readonly snapshots; abort zero calls; script/save isolation; optimistic write conflict unchanged; simulated reload; unrelated KV sentinels unchanged');
  console.log('This script covers stage A only; B/C integration/event/ZIP tests run separately. Real Safari remains unverified.');
  db.close();
})().catch(error => { console.error(error); process.exitCode = 1; });
