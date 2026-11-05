const fs = require('node:fs'), vm = require('node:vm'), assert = require('node:assert/strict'), ts = require('typescript');
const ctx = { exports: {}, crypto: require('node:crypto').webcrypto, structuredClone };
vm.runInNewContext(ts.transpile(fs.readFileSync('lib/if-theater.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), ctx);
const { forkIFSave, rerollIFSave, buildIFPrompt } = ctx.exports;
(async () => {
 const save = { id: 'old', title: 'test', scriptId: 's', memory: '', script: { world: 'world', time: '', player: '', rules: '', actors: [] }, messages: [{ role: 'user', content: 'U1' }, { role: 'assistant', content: 'A1' }, { role: 'user', content: 'OLD-FUTURE' }] };
 const original = JSON.stringify(save);
 const edited = forkIFSave(save, 0, { role: 'user', content: 'EDITED' });
 assert.equal(edited.parentSaveId, 'old');
 assert.ok(!JSON.stringify(buildIFPrompt(edited, 'next')).includes('OLD-FUTURE'));
 let calls = 0;
 const next = await rerollIFSave(save, 1, new AbortController().signal, async messages => { calls++; assert.ok(!JSON.stringify(messages).includes('A1')); assert.ok(!JSON.stringify(messages).includes('OLD-FUTURE')); return 'A2'; });
 assert.equal(calls, 1); assert.equal(next.messages.at(-1).content, 'A2'); assert.equal(JSON.stringify(save), original);
 const abort = new AbortController(); abort.abort();
 await assert.rejects(rerollIFSave(save, 1, abort.signal, async () => { calls++; return 'bad'; }));
 assert.equal(calls, 1);
 console.log('PASS immutable edit/backtrack forks; reroll one call; no sibling/future context; abort no additional request. B integration/event tests run separately.');
})().catch(error => { console.error(error); process.exitCode = 1; });
