// React hook/event harness, NOT DOM rendering, touch hardware, or Safari validation.
// Executes the actual TSX handlers against the real IF core + Mock SSE + fake IndexedDB.
const { createLoader, fixture, sse } = require('./if-test-utils.cjs');
const assert = require('node:assert/strict');
const Dexie = require('dexie');
const tick = () => new Promise(resolve => setImmediate(resolve));
function harness(loadOptions) {
  const hooks = [], effects = [], cleanups = [], timers = new Map(), dependencies = []; let index = 0, tree;
  const readings = [];
  const onReadingChange = value => readings.push(value);
  function effectHook(effect, deps) {
    const i = index++, previous = dependencies[i];
    if (!previous || !deps || deps.some((value, j) => !Object.is(value, previous[j]))) {
      dependencies[i] = deps; effects.push(() => { cleanups[i]?.(); cleanups[i] = effect(); });
    }
  }
  const react = {
    useState(initial) { const i = index++; if (!(i in hooks)) hooks[i] = initial; return [hooks[i], value => { hooks[i] = typeof value === 'function' ? value(hooks[i]) : value; }]; },
    useRef(initial) { const i = index++; if (!(i in hooks)) hooks[i] = { current: initial }; return hooks[i]; },
    useEffect: effectHook, useLayoutEffect: effectHook,
  };
  const jsx = (type, props, key) => ({ type, props: props || {}, key });
  const load = createLoader({ ...loadOptions, react, 'react/jsx-runtime': { jsx, jsxs: jsx, Fragment: Symbol('fragment') },
    setTimeout(callback) { const id = Symbol(); timers.set(id, callback); return id; }, clearTimeout(id) { timers.delete(id); },
    '@/lib/character-storage': { loadCharacters: () => [{ id: 'original-gu', name: '顾眠／顾厌', persona: '合成原卡' }] },
    '@/lib/settings-storage': { loadApiConfigs: () => [{ id: 'mock', provider: 'Custom', baseUrl: 'https://mock.invalid/v1', apiKey: 'SYNTHETIC', defaultModel: 'mock' }] },
  });
  const module = load('components/if-theater/if-theater-app.tsx'), App = module.default;
  function render(setup) { index = 0; tree = App({ onClose() {}, onReadingChange }); setup?.(tree); effects.splice(0).forEach(effect => effect()); return tree; }
  const text = node => Array.isArray(node) ? node.map(text).join('') : node && typeof node === 'object' ? text(node.props?.children) : node == null || typeof node === 'boolean' ? '' : String(node);
  function nodes() { const all = []; function walk(node) { if (Array.isArray(node)) return node.forEach(walk); if (!node || typeof node !== 'object') return; all.push(node); walk(node.props?.children); } walk(tree); return all; }
  const find = (type, label) => { const n = nodes().find(n => n.type === type && (n.props['aria-label'] === label || text(n) === label)); assert.ok(n, `${type}: ${label}`); return n; };
  const click = async (type, label) => { const node = find(type, label); assert.ok(!node.props.disabled, `disabled ${label}`); await node.props.onClick(); render(); };
  return { load, render, nodes, text, find, click, timers, readings, fitComposer: module.fitIFComposer, unmount: () => cleanups.forEach(cleanup => cleanup?.()), mount: async setup => { render(setup); for (let i = 0; i < 5; i++) await tick(); render(); } };
}
(async () => {
  let calls = 0, responseText = 'UI-A1', blocked = false, prompts = [];
  const databases = [];
  class TestDexie extends Dexie { constructor(...args) { super(...args); databases.push(this); } }
  TestDexie.default = TestDexie;
  const h = harness({ dexie: TestDexie, window: { prompt: () => 'EDITED-BY-MENU' }, fetch: async (_url, init) => {
    calls++; prompts.push(JSON.parse(init.body).messages);
    if (!blocked) return sse(responseText);
    return new Response(new ReadableStream({ start(controller) { controller.enqueue(new TextEncoder().encode('data: {"choices":[{"delta":{"content":"UI-STOP-PART"}}]}\n\n')); } }));
  } });
  const domain = h.load('lib/if-theater.ts'), storage = h.load('lib/if-theater-storage.ts');
  const save = domain.newIFSave(fixture()); save.title = '合成存档';
  await storage.writeIFData({ revision: 0, scripts: [fixture()], saves: [save] });
  await h.mount();
  assert.equal(h.render().props.className, 'root');
  assert.ok(h.nodes().some(n => n.type === 'header' && n.props.className === 'header'));
  assert.ok(h.nodes().some(n => n.type === 'main' && n.props.className === 'scroll'));
  await h.click('button', '合成存档 · 0 条');
  assert.ok(h.nodes().some(n => n.type === 'footer' && n.props.className === 'composer'));
  assert.equal(h.readings.at(-1), true);
  assert.ok(!h.nodes().some(n => n.props['aria-label'] === 'Stop'));
  assert.ok(!h.nodes().some(n => n.type === 'select'));
  assert.equal(h.find('textarea', '剧场消息').props.rows, 1);
  const composer = h.nodes().find(n => n.type === 'footer');
  assert.equal(composer.props.children.filter(Boolean).length, 2);
  await h.click('button', '聊天设置');
  h.find('select', '本轮 API 配置').props.onChange({ target: { value: 'mock' } }); h.render();
  h.find('textarea', 'IF 专属记忆').props.onChange({ target: { value: 'UI-PRIVATE-MEMORY' } }); h.render();
  await h.click('button', '保存专属记忆（不调用模型）'); assert.equal(calls, 0);
  assert.equal((await storage.readIFData()).saves[0].memory, 'UI-PRIVATE-MEMORY');
  h.find('textarea', '剧场消息').props.onChange({ target: { value: 'PROMPT-PREVIEW' } }); h.render();
  await h.click('button', '查看本轮完整 Prompt');
  assert.equal(h.find('div', 'Prompt 查看').props['aria-modal'], 'true');
  assert.ok(h.nodes().some(n => n.type === 'pre' && h.text(n).includes('PROMPT-PREVIEW')));
  const main = h.nodes().find(n => n.type === 'main');
  assert.ok(!h.text(main).includes('PROMPT-PREVIEW')); assert.equal(calls, 0);
  await h.click('button', '关闭 Prompt');
  async function send(input) { h.find('textarea', '剧场消息').props.onChange({ target: { value: input } }); h.render(); await h.click('button', '发送一次请求'); }
  await send('UI-U1'); responseText = 'UI-OLD-FUTURE'; await send('UI-U2');
  assert.ok(prompts.every(prompt => JSON.stringify(prompt).includes('UI-PRIVATE-MEMORY')));
  let data = await storage.readIFData(); assert.equal(calls, 2, h.text(h.render())); assert.equal(data.saves.length, 1);
  // A scroll cancels the long press; a stationary primary press opens it.
  let articles = h.nodes().filter(n => n.type === 'article');
  articles[1].props.onPointerDown({ isPrimary: true, clientX: 1, clientY: 1 });
  articles[1].props.onPointerMove({ clientX: 1, clientY: 30 }); assert.equal(h.timers.size, 0);
  articles[1].props.onPointerDown({ isPrimary: true, clientX: 1, clientY: 1 });
  for (const callback of h.timers.values()) callback(); h.timers.clear(); h.render();
  const menu = h.find('div', '气泡操作');
  assert.equal(menu.props['aria-modal'], 'true'); assert.equal(menu.props.className, 'sheet');
  responseText = 'UI-A2';
  await h.click('button', 'Re-roll（一次请求）');
  data = await storage.readIFData(); assert.equal(calls, 3); assert.equal(data.saves.length, 2);
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('UI-A1'));
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('UI-OLD-FUTURE'));
  assert.ok(h.nodes().some(n => n.type === 'span' && h.text(n).includes('2 / 2')));
  await h.click('button', '上一个回复版本');
  assert.ok(h.nodes().some(n => n.type === 'p' && h.text(n) === 'UI-OLD-FUTURE'));
  responseText = 'UI-ROOT-NEXT'; await send('ROOT-NEXT');
  assert.ok(JSON.stringify(prompts.at(-1)).includes('UI-A1'));
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('UI-A2'));
  await h.click('button', '下一个回复版本');
  responseText = 'UI-ALT-NEXT'; await send('ALT-NEXT');
  assert.ok(JSON.stringify(prompts.at(-1)).includes('UI-A2'));
  assert.ok(!JSON.stringify(prompts.at(-1)).includes('UI-ROOT-NEXT'));
  // Menu editing/backtracking are explicit new branches and retain all previous saves.
  articles = h.nodes().filter(n => n.type === 'article');
  articles[0].props.onContextMenu({ preventDefault() {} }); h.render();
  await h.click('button', 'Edit'); data = await storage.readIFData();
  assert.equal(data.saves.length, 3); assert.equal(data.saves.at(-1).messages[0].content, 'EDITED-BY-MENU');
  assert.equal(data.saves.at(-1).messages.length, 1);
  await h.click('button', '聊天设置');
  await h.click('button', '另存当前分支'); assert.equal((await storage.readIFData()).saves.length, 4);
  // Backtrack and Delete also preserve the source branch and its future.
  articles = h.nodes().filter(n => n.type === 'article');
  articles[0].props.onContextMenu({ preventDefault() {} }); h.render();
  await h.click('button', 'Backtrack'); assert.equal((await storage.readIFData()).saves.length, 5);
  articles = h.nodes().filter(n => n.type === 'article');
  articles[0].props.onContextMenu({ preventDefault() {} }); h.render();
  await h.click('button', 'Delete'); data = await storage.readIFData();
  assert.equal(data.saves.length, 6); assert.equal(data.saves.at(-1).messages.length, 0);
  await h.click('button', '聊天设置');
  const selectBranch = h.nodes().find(n => n.type === 'select' && n.props.id === 'if-branch');
  await selectBranch.props.onChange({ target: { value: save.id } }); h.render();
  // Stop via actual UI handler while reader waits for more chunks.
  blocked = true;
  h.find('textarea', '剧场消息').props.onChange({ target: { value: 'STOP-NOW' } }); h.render();
  const generating = h.find('button', '发送一次请求').props.onClick();
  for (let i = 0; i < 50; i++) { await tick(); h.render(); if (h.nodes().some(n => n.type === 'article' && h.text(n).includes('UI-STOP-PART'))) break; }
  h.render(); assert.ok(!h.nodes().some(n => n.props['aria-label'] === '发送一次请求'));
  await h.click('button', 'Stop'); await generating; h.render();
  assert.ok(!h.nodes().some(n => n.props['aria-label'] === 'Stop'));
  data = await storage.readIFData(); assert.equal(data.saves.length, 6);
  assert.equal(data.saves[0].messages.at(-1).content, 'UI-STOP-PART'); assert.equal(data.saves[0].messages.at(-1).incomplete, true);
  // Main write failure surfaces an error and recovery button; original history stays visible.
  blocked = false; responseText = 'UI-WRITE-FAIL';
  const proto = databases[0].Table.prototype, nativePut = proto.put;
  proto.put = function(row, ...rest) { if (row.key === 'ai_phone_if_theater_v1') throw new Error('UI-SYNTHETIC write failure'); return nativePut.call(this, row, ...rest); };
  const beforeFailureCalls = calls, oldHistory = JSON.stringify(data.saves[0]);
  await send('FAIL-WRITE');
  assert.match(h.text(h.render()), /UI-SYNTHETIC write failure/);
  assert.equal(calls, beforeFailureCalls + 1);
  assert.equal(JSON.stringify((await storage.readIFData()).saves[0]), oldHistory);
  proto.put = nativePut;
  await h.click('button', '聊天设置');
  await h.click('button', '恢复部分回复（版本冲突时拒绝覆盖）');
  assert.equal(calls, beforeFailureCalls + 1);
  assert.equal((await storage.readIFData()).saves[0].messages.at(-1).content, responseText);
  const reload = await createLoader()('lib/if-theater-storage.ts').readIFData();
  assert.equal(reload.replyVersions[0].saveIds.length, 2); assert.equal(reload.saves.length, 6);
  assert.equal(reload.activeSaveId, save.id);
  const reopened = harness({ fetch: () => { throw new Error('Reopen must not call API'); } });
  const scroller = { scrollTop: 0, scrollHeight: 2000, clientHeight: 400 };
  await reopened.mount(() => { reopened.nodes().find(n => n.type === 'main').props.ref.current = scroller; });
  assert.equal(scroller.scrollTop, 2000, 'reopening saved conversation starts at latest');
  // Trigger the same layout effect as a draft/height change. DOM geometry is simulated.
  reopened.find('textarea', '剧场消息').props.onChange({ target: { value: 'DRAFT' } }); reopened.render();
  assert.equal(scroller.scrollTop, 2000);
  scroller.scrollTop = 100;
  reopened.nodes().find(n => n.type === 'main').props.onScroll({ currentTarget: scroller });
  reopened.find('textarea', '剧场消息').props.onChange({ target: { value: 'DRAFT-2' } }); reopened.render();
  assert.equal(scroller.scrollTop, 100, 'reading older history must not be pulled to tail');
  await reopened.click('button', '回到大厅');
  await reopened.click('button', `合成存档 · ${reload.saves[0].messages.length} 条`);
  assert.equal(scroller.scrollTop, 2000, 'entering save resets follow-to-latest');
  assert.ok(reopened.nodes().some(n => n.type === 'p' && reopened.text(n) === responseText));
  assert.ok(reopened.nodes().some(n => n.type === 'span' && reopened.text(n).includes('1 / 2')));
  // Editor/dismissal is presentation-only: labelled fields and bottom actions,
  // no write and no request when cancelling an unsaved template.
  await reopened.click('button', '回到大厅');
  assert.equal(reopened.readings.at(-1), false);
  const beforeEditor = JSON.stringify(await storage.readIFData()), beforeEditorCalls = calls;
  await reopened.click('button', '＋ 新建剧本');
  for (const label of ['剧本标题', '完整世界观', '时刻设定', '开场白', '主控人设', '剧本规则']) {
    const field = reopened.find('textarea', label); assert.ok(field.props.placeholder); assert.ok(field.props['aria-describedby']);
  }
  assert.ok(reopened.nodes().some(n => n.type === 'footer' && n.props.className === 'footer'));
  await reopened.click('button', '取消');
  assert.equal(JSON.stringify(await storage.readIFData()), beforeEditor); assert.equal(calls, beforeEditorCalls);
  // Only a geometry simulation, not a real keyboard/WebKit test.
  const listeners = new Map(), viewport = { height: 420, offsetTop: 0, scale: 1, addEventListener: (name, fn) => listeners.set(name, fn), removeEventListener: name => listeners.delete(name) };
  const properties = {}, element = { dataset: {}, style: { setProperty: (key, value) => { properties[key] = value; } }, parentElement: { getBoundingClientRect: () => ({ top: 0, bottom: 800, height: 800 }) } };
  const keyboard = harness({ window: { visualViewport: viewport }, requestAnimationFrame: callback => { callback(); return 1; }, cancelAnimationFrame: () => {} });
  await keyboard.mount(tree => { tree.props.ref.current = element; });
  assert.equal(properties['--if-visible-height'], '420px'); assert.equal(element.dataset.keyboard, 'true');
  viewport.height = 800; listeners.get('resize')();
  assert.equal(properties['--if-visible-height'], '800px'); assert.equal(element.dataset.keyboard, 'false');
  keyboard.unmount(); assert.equal(listeners.size, 0);
  const field = { style: {}, scrollHeight: 1000 };
  h.fitComposer(field, 400); assert.equal(field.style.height, '88px'); assert.equal(field.style.overflowY, 'auto');
  field.scrollHeight = 20; h.fitComposer(field, 400); assert.equal(field.style.height, '44px'); assert.equal(field.style.overflowY, 'hidden');
  h.fitComposer(field, 0); assert.equal(field.style.height, '44px');
  console.log('PASS actual TSX event/hook harness + Mock SSE/fake IndexedDB: scrolling cancels long press; menu Re-roll; version arrows/count; normal Send stays on branch; selected history only; Edit/Delete/Backtrack/fork; Stop; failed write + local recovery; remount restores active branch/versions. NOT browser/iPhone validation.');
  console.log('PASS compact RP UI structure: two-child composer, Send/Stop state swap, API/memory/branches in settings, Prompt dialog outside message flow without request, reading signal restored on exit, composer growth cap/shrink; visualViewport resize/cleanup geometry simulation only. NOT browser/iPhone validation.');
})().catch(error => { console.error(error); process.exitCode = 1; });
