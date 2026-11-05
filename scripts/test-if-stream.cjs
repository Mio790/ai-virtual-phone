const assert = require('node:assert/strict');
const context = { exports: require('./if-test-utils.cjs').createLoader()('lib/if-theater-stream.ts') };
(async () => {
 let calls = 0, shown = '';
 const bytes = new TextEncoder().encode('data: {"choices":[{"delta":{"content":"合成回复"}}]}\n\ndata: [DONE]\n\n');
 const request = async () => { calls++; return new Response(new ReadableStream({ start(c) { c.enqueue(bytes.slice(0, 16)); c.enqueue(bytes.slice(16)); c.close(); } })); };
 const config = { provider: 'Custom', baseUrl: 'https://mock.invalid/v1', defaultModel: 'gemini-anything' };
 assert.equal(await context.exports.streamIFReply(config, [], new AbortController().signal, x => shown += x, request), '合成回复');
 assert.equal(shown, '合成回复'); assert.equal(calls, 1);
 const stopped = new AbortController();
 await assert.rejects(context.exports.streamIFReply(config, [], stopped.signal, () => stopped.abort(), request));
 assert.equal(calls, 2);
 for (const provider of ['Anthropic', 'Google']) {
   await assert.rejects(context.exports.streamIFReply({ provider }, [], new AbortController().signal, () => {}, request), /未发起请求/);
   for (const defaultModel of ['claude-test', 'gemini-test', 'gpt-test']) {
     await context.exports.streamIFReply({ ...config, provider, defaultModel }, [], new AbortController().signal, () => {}, request);
   }
 }
 const beforeNative = calls;
 for (const baseUrl of ['https://relay.invalid/v1/messages', 'https://relay.invalid/v1beta', 'https://api.anthropic.com/v1', 'https://generativelanguage.googleapis.com/v1']) {
   await assert.rejects(context.exports.streamIFReply({ ...config, baseUrl }, [], new AbortController().signal, () => {}, request), /未发起请求/);
 }
 assert.equal(calls, beforeNative);
 let failureCalls = 0;
 await assert.rejects(context.exports.streamIFReply(config, [], new AbortController().signal, () => {}, async () => { failureCalls++; return new Response('', { status: 429 }); }), /429/);
 assert.equal(failureCalls, 1);
 for (const frame of ['data: {broken}\n\n', 'data: {"choices":[{"delta":{"content":"partial"},"finish_reason":"length"}]}\n\n']) {
   const before = calls;
   await assert.rejects(context.exports.streamIFReply(config, [], new AbortController().signal, () => {}, async () => { calls++; return new Response(frame); }));
   assert.equal(calls, before + 1, 'malformed/truncated output does not trigger retry');
 }
 const waiting = new AbortController();
 const stopRead = context.exports.streamIFReply(config, [], waiting.signal, () => {}, async () => new Response(new ReadableStream({ start() {} })));
 setTimeout(() => waiting.abort(), 5); await assert.rejects(stopRead, /已停止/);
 console.log('PASS Mock SSE split frames, live deltas, one request per invocation, abort after delta; no network/model.');
})().catch(error => { console.error(error); process.exitCode = 1; });
