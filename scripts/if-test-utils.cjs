// Isolated Node loader: rejects unexpected dependencies and ALL unmocked network calls.
require('fake-indexeddb/auto');
const fs = require('node:fs'), vm = require('node:vm'), path = require('node:path'), ts = require('typescript');
function createLoader(overrides = {}) {
  const cache = new Map();
  function load(file) {
    file = path.normalize(file);
    if (cache.has(file)) return cache.get(file);
    const exports = {}; cache.set(file, exports);
    const context = { exports, crypto: require('node:crypto').webcrypto, structuredClone, TextDecoder, TextEncoder, URL, URLSearchParams, DOMException, AbortController, Blob, Response, ReadableStream,
      indexedDB: overrides.indexedDB || indexedDB, IDBKeyRange,
      FileReader: overrides.FileReader || globalThis.FileReader,
      localStorage: overrides.localStorage, navigator: {}, console,
      fetch: overrides.fetch || (() => { throw new Error('UNMOCKED NETWORK BLOCKED'); }),
      setTimeout: overrides.setTimeout || setTimeout, clearTimeout: overrides.clearTimeout || clearTimeout,
      window: overrides.window || {}, confirm: () => true,
      require(name) {
        if (name in overrides) return overrides[name];
        if (name === 'dexie') return require('dexie');
        if (name === 'jszip') return { default: require('jszip') };
        if (name === './api-log-store') return { pushApiLog() { throw new Error('Unexpected API log side effect'); } };
        if (name.startsWith('@/')) return load(name.slice(2) + '.ts');
        if (name.startsWith('.')) return load(path.join(path.dirname(file), name + '.ts'));
        throw new Error('Unexpected dependency: ' + name);
      } };
    vm.runInNewContext(ts.transpile(fs.readFileSync(file, 'utf8'), { module: ts.ModuleKind.CommonJS, target: ts.ScriptTarget.ES2020, jsx: ts.JsxEmit.ReactJSX }), context, { filename: file });
    return exports;
  }
  return load;
}
const fixture = () => ({ id: 'script', title: '合成剧本', world: '完整世界', time: '1748（仅测试）', opening: '', player: '合成主控', rules: '禁止代操', actors: [{ characterId: 'original-gu', name: '顾眠／顾厌', persona: '合成原卡', personality: '合成性格', identity: '同一身体，合成落地身份' }] });
function sse(text, finish = true) {
  return new Response(new ReadableStream({ start(c) {
    const bytes = new TextEncoder().encode(`data: ${JSON.stringify({ choices: [{ delta: { content: text } }] })}\r\n\r\n${finish ? 'data: [DONE]\r\n\r\n' : ''}`);
    c.enqueue(bytes.slice(0, 18)); c.enqueue(bytes.slice(18)); c.close();
  } }));
}
module.exports = { createLoader, fixture, sse };
