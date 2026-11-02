import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { spawnSync } from 'node:child_process';
import {
  auditImage, auditZones, expandParts, gridOverlay, measureLandmarks, planToPng, renderPlan, silhouetteProfile, validateSpec, zonesOf,
} from '../skills/local-designer/scripts/character-lib.mjs';
import { decodePng, pngSize } from '../skills/local-designer/scripts/png.mjs';

const CLI = new URL('../skills/local-designer/scripts/local-designer.mjs', import.meta.url).pathname;
const tmp = () => realpathSync(mkdtempSync(join(tmpdir(), 'local-designer-character-')));

// A small figure, 3 heads tall: head (y 0-1), body (1-2), legs (2-3). Dark enough to differ from the white plan background.
const spec = (over = {}) => ({
  name: 'Test',
  height: 3,
  canvas: { width: 256, height: 256, margin: 0.05 },
  parts: [
    { id: 'legs', shape: 'rrect', cx: 0, cy: 2.5, w: 1.0, h: 1.0, r: 0.1, fill: '#808080' },
    { id: 'body', shape: 'rrect', cx: 0, cy: 1.5, w: over.bodyWidth ?? 1.6, h: 1.0, r: 0.1, fill: '#707070' },
    { id: 'head', shape: 'ellipse', cx: 0, cy: 0.5, w: over.headWidth ?? 1.2, h: 1.0, fill: '#606060' },
  ],
});
const render = (s, opts = {}) => renderPlan(s, { size: { width: 256, height: 256 }, ...opts });

test('validateSpec accepts a well-formed sheet', () => {
  const r = validateSpec(spec());
  assert.deepEqual(r.errors, []);
  assert.deepEqual(r.warnings, []);
});

test('validateSpec reports each kind of mistake', () => {
  assert.match(validateSpec(null).errors[0], /object/);
  assert.ok(validateSpec({ ...spec(), name: '' }).errors.some((e) => /name/.test(e)));
  assert.ok(validateSpec({ ...spec(), height: 0 }).errors.some((e) => /height/.test(e)));
  assert.ok(validateSpec({ ...spec(), parts: [] }).errors.some((e) => /parts/.test(e)));
  const bad = spec();
  bad.parts[0].shape = 'cube';
  assert.ok(validateSpec(bad).errors.some((e) => /shape/.test(e)));
  const dup = spec();
  dup.parts[1].id = 'legs';
  assert.ok(validateSpec(dup).errors.some((e) => /duplicate/.test(e)));
  const colour = spec();
  colour.parts[0].fill = 'grey';
  assert.ok(validateSpec(colour).errors.some((e) => /fill/.test(e)));
  const missing = spec();
  delete missing.parts[2].w;
  assert.ok(validateSpec(missing).errors.some((e) => /w must be a number/.test(e)));
  const view = spec();
  view.parts[0].view = 'left';
  assert.ok(validateSpec(view).errors.some((e) => /view/.test(e)));
});

test('validateSpec warns when the stated height does not match the drawing', () => {
  const r = validateSpec({ ...spec(), height: 4 });
  assert.deepEqual(r.errors, []);
  assert.match(r.warnings[0], /4 heads/);
});

test('capsule parts need their own coordinates', () => {
  const s = spec();
  s.parts.push({ id: 'arm', shape: 'capsule', x1: 1, y1: 1, x2: 1, y2: 2, r: 0.1 });
  assert.deepEqual(validateSpec(s).errors, []);
  s.parts.push({ id: 'bad', shape: 'capsule', cx: 1, cy: 1, w: 1, h: 1 });
  assert.ok(validateSpec(s).errors.some((e) => /x1 must be a number/.test(e)));
});

test('expandParts mirrors a part across the axis and filters by view', () => {
  const s = spec();
  s.parts.push({ id: 'ear', shape: 'ellipse', cx: -0.7, cy: 0.5, w: 0.2, h: 0.3, mirror: true });
  s.parts.push({ id: 'visor', shape: 'rrect', cx: 0, cy: 0.4, w: 1, h: 0.4, view: 'front' });
  const front = expandParts(s, 'front');
  const back = expandParts(s, 'back');
  const mirror = front.find((p) => p.id === 'ear:mirror');
  assert.equal(mirror.cx, 0.7);
  assert.ok(front.some((p) => p.id === 'visor'));
  assert.ok(!back.some((p) => p.id === 'visor'));
  assert.ok(back.some((p) => p.id === 'ear:mirror'));
});

test('expandParts mirrors the rotation and the ends of a capsule', () => {
  const s = spec();
  s.parts.push({ id: 'arm', shape: 'capsule', x1: -1, y1: 1, x2: -1.2, y2: 2, r: 0.1, mirror: true });
  s.parts.push({ id: 'cuff', shape: 'rrect', cx: -1, cy: 2, w: 0.4, h: 0.4, rot: 10, mirror: true });
  const out = expandParts(s, 'front');
  const arm = out.find((p) => p.id === 'arm:mirror');
  assert.equal(arm.x1, 1);
  assert.equal(arm.x2, 1.2);
  assert.equal(out.find((p) => p.id === 'cuff:mirror').rot, -10);
});

test('renderPlan returns the asked size and is deterministic', () => {
  const a = render(spec());
  const b = render(spec());
  assert.equal(a.width, 256);
  assert.equal(a.height, 256);
  assert.equal(a.channels, 3);
  assert.ok(a.pixels.equals(b.pixels));
  assert.ok(a.pixels.some((v) => v < 200), 'something is drawn');
});

test('renderPlan refuses an invalid sheet', () => {
  assert.throws(() => render({ ...spec(), parts: [] }), /Invalid character spec/);
});

test('renderPlan draws the lines only, or the guides, on request', () => {
  const filled = render(spec());
  const lines = render(spec(), { lines: true });
  const guided = render(spec(), { guides: true });
  const dark = (img) => img.pixels.reduce((n, v, i) => n + (i % 3 === 0 && v < 150 ? 1 : 0), 0);
  assert.ok(dark(lines) < dark(filled), 'outline only has fewer dark pixels than a filled plan');
  assert.ok(!guided.pixels.equals(filled.pixels), 'guides change the picture');
});

test('planToPng writes a PNG that decodes to the same size', () => {
  const png = planToPng(render(spec()));
  assert.deepEqual(pngSize(png), { width: 256, height: 256 });
  assert.equal(decodePng(png).channels, 3);
});

test('silhouetteProfile gives the width of the figure in head units', () => {
  const rows = silhouetteProfile(spec(), { rows: 6 });
  assert.equal(rows.length, 6);
  const atHead = rows[1]; // y = 0.75 inside the head
  assert.ok(atHead.width > 1.0 && atHead.width <= 1.2, `head width ${atHead.width}`);
  const atBody = rows[3]; // y = 1.75 inside the body
  assert.ok(Math.abs(atBody.width - 1.6) < 0.02, `body width ${atBody.width}`);
  const atLegs = rows[5];
  assert.ok(Math.abs(atLegs.width - 1.0) < 0.02, `legs width ${atLegs.width}`);
});

test('zonesOf splits the body by default and takes the sheet zones when given', () => {
  const names = zonesOf(spec()).map((z) => z.name);
  assert.deepEqual(names, ['head', 'shoulders-arms', 'trousers', 'feet']);
  assert.equal(zonesOf(spec()).find((z) => z.name === 'feet').info, true);
  const custom = zonesOf({ ...spec(), zones: [{ name: 'all', y0: 0, y1: 3 }] });
  assert.deepEqual(custom, [{ name: 'all', y0: 0, y1: 3, info: false }]);
});

test('auditZones: the plan itself is on-model', () => {
  const r = auditZones(render(spec()), spec());
  assert.equal(r.verdict, 'on-model', JSON.stringify(r.zones));
  assert.ok(Math.abs(r.widthToHeight - r.expectedWidthToHeight) < 0.03);
});

test('auditZones: a wider body is too-wide and off-model', () => {
  const r = auditZones(render(spec({ bodyWidth: 2.4 })), spec());
  assert.equal(r.verdict, 'off-model');
  assert.equal(r.zones.find((z) => z.zone === 'shoulders-arms').status, 'too-wide');
});

test('auditZones: a thinner body is too-narrow and off-model', () => {
  const r = auditZones(render(spec({ bodyWidth: 1.0, headWidth: 0.8 })), spec());
  assert.equal(r.verdict, 'off-model');
  assert.ok(r.zones.some((z) => z.status === 'too-narrow'));
});

test('auditZones: the tolerance decides', () => {
  const slightly = render(spec({ bodyWidth: 1.75 }));
  assert.equal(auditZones(slightly, spec(), { tolerance: 0.05 }).verdict, 'off-model');
  assert.equal(auditZones(slightly, spec(), { tolerance: 0.2 }).verdict, 'on-model');
});

test('auditZones: the info zone is reported but does not change the verdict', () => {
  const wideFeet = spec();
  wideFeet.parts[0].w = 2.4; // the legs, which the feet zone also measures
  const s = spec();
  s.zones = [
    { name: 'head', y0: 0, y1: 0.8 },
    { name: 'body', y0: 1.1, y1: 1.9 },
    { name: 'feet', y0: 2.7, y1: 3, info: true },
  ];
  const r = auditZones(render(wideFeet), s);
  const feet = r.zones.find((z) => z.zone === 'feet');
  assert.match(feet.status, /info, not counted/);
  assert.equal(r.verdict, 'on-model');
});

test('auditZones refuses an image with no figure', () => {
  const blank = { width: 64, height: 64, channels: 3, pixels: Buffer.alloc(64 * 64 * 3, 255) };
  assert.throws(() => auditZones(blank, spec()), /No figure found/);
});

test('auditImage lists the rows and flags a thick figure', () => {
  const ok = auditImage(render(spec()), spec(), { rows: 12 });
  assert.equal(ok.rows.length, 12);
  assert.ok(ok.meanAbsDelta < 0.12);
  const thick = auditImage(render(spec({ bodyWidth: 2.6 })), spec(), { rows: 12 });
  assert.ok(thick.heavierRows > 0);
});

test('measureLandmarks converts pixels to head units', () => {
  const r = measureLandmarks({
    points: { top: [250, 48], chin: [250, 175], sole: [250, 485] },
    widths: { trousers: [[160, 350], [347, 350]] },
  });
  assert.equal(r.headPx, 127);
  assert.equal(r.totalHeightInHeads, 3.441);
  assert.equal(r.points.chin.y, 1);
  assert.equal(r.widths.trousers.width, 1.472);
});

test('measureLandmarks needs top and chin', () => {
  assert.throws(() => measureLandmarks({ points: { top: [0, 0] } }), /top and points.chin/);
  assert.throws(() => measureLandmarks({ points: { top: [0, 100], chin: [0, 50] } }), /below top/);
});

test('gridOverlay keeps the size of the image', () => {
  const png = planToPng(render(spec()));
  const grid = gridOverlay(png, { step: 32 });
  assert.deepEqual(pngSize(grid), { width: 256, height: 256 });
  assert.ok(!decodePng(grid).pixels.equals(decodePng(png).pixels));
});

// ---------- command line ----------

const run = (args) => {
  const r = spawnSync('node', [CLI, ...args], { encoding: 'utf8', env: { ...process.env, HOME: tmp() } });
  return { code: r.status, json: JSON.parse(r.stdout || '{}') };
};

test('character check: ok for a good sheet, invalid for a bad one', () => {
  const dir = tmp();
  writeFileSync(join(dir, 'ok.json'), JSON.stringify(spec()));
  writeFileSync(join(dir, 'bad.json'), JSON.stringify({ name: 'x', height: 3, parts: [{ id: 'a', shape: 'cube' }] }));
  assert.equal(run(['character', 'check', join(dir, 'ok.json')]).json.status, 'ok');
  const bad = run(['character', 'check', join(dir, 'bad.json')]);
  assert.equal(bad.json.status, 'invalid');
  assert.ok(bad.json.errors.length > 0);
});

test('character plan then audit: the plan passes, a different figure does not', () => {
  const dir = tmp();
  const good = join(dir, 'good.json');
  const wide = join(dir, 'wide.json');
  writeFileSync(good, JSON.stringify(spec()));
  writeFileSync(wide, JSON.stringify(spec({ bodyWidth: 2.4 })));
  const planFile = join(dir, 'plan.png');
  const widePng = join(dir, 'wide.png');
  assert.equal(run(['character', 'plan', good, '--out', planFile, '--size', '256']).json.status, 'ok');
  assert.equal(run(['character', 'plan', wide, '--out', widePng, '--size', '256']).json.status, 'ok');
  assert.ok(existsSync(planFile));
  assert.deepEqual(pngSize(readFileSync(planFile)), { width: 256, height: 256 });
  assert.equal(run(['character', 'audit', good, planFile]).json.verdict, 'on-model');
  assert.equal(run(['character', 'audit', good, widePng]).json.verdict, 'off-model');
});

test('character grid and measure work from the command line', () => {
  const dir = tmp();
  const sheet = join(dir, 's.json');
  const plan = join(dir, 'p.png');
  writeFileSync(sheet, JSON.stringify(spec()));
  run(['character', 'plan', sheet, '--out', plan, '--size', '256']);
  const grid = run(['character', 'grid', plan, '--out', join(dir, 'g.png')]);
  assert.equal(grid.json.status, 'ok');
  assert.ok(existsSync(join(dir, 'g.png')));
  const lm = join(dir, 'lm.json');
  writeFileSync(lm, JSON.stringify({ points: { top: [0, 0], chin: [0, 100], sole: [0, 345] } }));
  assert.equal(run(['character', 'measure', lm]).json.totalHeightInHeads, 3.45);
});

test('character without a valid sub-command or arguments fails with a usage message', () => {
  const none = run(['character']);
  assert.equal(none.code, 1);
  assert.match(none.json.error, /Usage: character/);
  assert.match(run(['character', 'audit']).json.error, /Usage: character audit/);
  assert.match(run(['character', 'plan', '/nonexistent.json']).json.error, /ENOENT|Usage/);
});
