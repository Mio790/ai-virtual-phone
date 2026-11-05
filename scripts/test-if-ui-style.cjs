// Static CSS checks and reference-palette contrast calculations, NOT rendering.
const assert = require('node:assert/strict'), fs = require('node:fs'), postcss = require('postcss');
const css = postcss.parse(fs.readFileSync('components/if-theater/if-theater.module.css', 'utf8'));
function rule(selector) { const rules = []; css.walkRules(selector, node => rules.push(node)); assert.ok(rules.length, selector); return rules; }
function value(selector, property) { let result; for (const node of rule(selector)) node.walkDecls(property, decl => { result = decl.value; }); return result; }
assert.equal(value('.root button', 'min-height'), '44px'); assert.equal(value('.root button', 'min-width'), '44px');
assert.ok(value('.root button', 'background')); assert.ok(value('.root button', 'color')); assert.ok(value('.root button', 'border'));
assert.equal(value('.root button:disabled', 'opacity'), '.45');
assert.match(value('.root textarea, .root select', 'font-size'), /16px/);
assert.ok(value('.root textarea, .root select', 'background')); assert.ok(value('.root textarea, .root select', 'border'));
assert.equal(value('.root textarea::placeholder', 'opacity'), '.8');
assert.equal(value('.scroll', 'min-height'), '0'); assert.equal(value('.scroll', 'overflow-y'), 'auto');
assert.equal(value('.root', 'overflow'), 'hidden');
assert.equal(value('.composer', 'display'), 'flex');
assert.equal(value('.root .composer textarea', 'min-height'), '44px');
assert.equal(value('.root .composer textarea', 'max-height'), '112px');
assert.equal(value('.root .composer textarea', 'resize'), 'none');
assert.equal(value('.composer > button', 'height'), '44px');
assert.equal(value('.root[data-keyboard="true"] .composer', 'padding-bottom'), '8px');
assert.equal(value('.reading h1', 'white-space'), 'nowrap');
assert.equal(value('.settingsSheet', 'max-height'), '88%');
assert.equal(value('.promptSheet .pre', 'min-height'), '0');
assert.match(value('.header', 'padding'), /safe-area-inset-top/);
assert.match(value('.footer, .composer', 'padding'), /safe-area-inset-bottom/);
assert.ok(rule('.root button:focus-visible, .root summary:focus-visible, .root input:focus-visible,\n.root textarea:focus-visible, .root select:focus-visible')[0].toString().includes('outline: 3px'));
const source = fs.readFileSync('components/if-theater/if-theater-app.tsx', 'utf8');
assert.ok(!source.includes('color: "#111"')); assert.ok(!source.includes('background: "#17151b"'));
const shell = fs.readFileSync('components/desktop-shell.tsx', 'utf8');
assert.ok(shell.includes('<IFTheaterApp onClose={() => setActiveApp(null)} onReadingChange={setIFTheaterReading} />'), 'shell receives reading state');
assert.ok(/<div data-if-global-tools hidden=\{activeApp === "iftheater" && ifTheaterReading\}[^>]+>\s*<DebugPromptPanel \/>\s*<QuickActionFloat \/>\s*<\/div>/.test(shell), 'only reading hides existing mounted tools');
assert.ok(!shell.includes('setQuickActionEnabled(false)'), 'do not alter global floating-tool preference');
function luminance(rgb) { const c = rgb.map(v => { v /= 255; return v <= .04045 ? v / 12.92 : ((v + .055) / 1.055) ** 2.4; }); return c[0] * .2126 + c[1] * .7152 + c[2] * .0722; }
function ratio(a, b) { const x = luminance(a), y = luminance(b); return (Math.max(x, y) + .05) / (Math.min(x, y) + .05); }
const blend = (a, b, alpha) => a.map((n, i) => n * alpha + b[i] * (1 - alpha));
for (const [ink, panel, input] of [ [[44,52,64], [255,255,255], [242,243,245]], [[238,240,247], [24,24,28], [35,35,42]] ]) {
  assert.ok(ratio(ink, panel) >= 7); // body and inverse primary button
  assert.ok(ratio(blend(ink, panel, .78), panel) >= 4.5); // help text
  assert.ok(ratio(blend(ink, input, .8), input) >= 4.5); // placeholder
  assert.ok(ratio(blend(ink, panel, .65), input) >= 3); // input boundary
}
console.log('PASS static mobile CSS contract: 44px buttons, disabled/focus/input boundaries, safe-area/independent scrolling, scoped theme tokens; reference light/dark text and placeholder >=4.5, input edge >=3. Custom palettes and real Safari rendering unverified.');
