const fs = require('node:fs'), vm = require('node:vm'), ts = require('typescript'), assert = require('node:assert/strict');
const context = { exports: {}, TextDecoder, DOMException, require: () => ({ buildChatCompletionsUrl: x => x, determineBaseUrl: () => 'https://mock.invalid', buildRequestHeaders: () => ({}), isNativeAnthropicApi: () => false, isNativeGoogleApi: () => false }) };
vm.runInNewContext(ts.transpile(fs.readFileSync('lib/if-theater-stream.ts', 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020 }), context);
(async () => {
 let calls = 0, shown = '';
 const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"合成回复"}}]}\n\ndata: [DONE]\n\n');
 const request = async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 16)); c.enqueue(bytes.slice(16)); c.close(); } })); };
 assert.equal(await context.exports.streamIFReply({}, [], new AbortController().signal, x => shown += x, request), '合成回复');
 assert.equal(shown, '合成回复'); assert.equal(calls, 1);
 const stopped = new AbortController();
 await assert.rejects(context.exports.streamIFReply({}, [], stopped.signal, () => stopped.abort(), request));
 assert.equal(calls, 2);
 console.log('PASS Mock SSE split frames, live deltas, one request per invocation, abort after delta; no network/model.');
})().catch(error => { console.error(error); process.exitCode = 1; });
