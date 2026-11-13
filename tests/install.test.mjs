import assert from 'node:assert/strict';
import test from 'node:test';
import { existsSync, mkdtempSync, readFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { slug } from '../skills/local-designer/scripts/local-designer.mjs';
import { tokenize } from '../skills/local-designer/scripts/styles-lib.mjs';

const SKILL = resolve(dirname(fileURLToPath(import.meta.url)), '../skills/local-designer');
const CLI = join(SKILL, 'scripts/local-designer.mjs');
const read = (rel) => readFileSync(join(SKILL, rel), 'utf8');

test('slug keeps the letters of accented words', () => {
  assert.equal(slug('Proposition infogérance'), 'proposition-infogerance');
  assert.equal(slug('Éléments à retirer'), 'elements-a-retirer');
  assert.equal(slug('???'), 'x');
});

test('tokenize drops one-letter fragments left by apostrophes', () => {
  const t = tokenize("schéma d'architecture cloud");
  assert.ok(!t.includes('d'));
  for (const w of ['schema', 'architecture', 'cloud']) assert.ok(t.includes(w), w);
});

test('the CLI runs when started through a symbolic link', () => {
  const dir = mkdtempSync(join(tmpdir(), 'local-designer-link-'));
  try {
    const link = join(dir, 'local-designer.mjs');
    symlinkSync(CLI, link);
    const out = spawnSync(process.execPath, [link, 'recommend', '--brief', 'cloud architecture'], { encoding: 'utf8' });
    assert.equal(out.status, 0, out.stderr);
    assert.equal(JSON.parse(out.stdout).status, 'ok');
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test('every command declared in SKILL.md has a definition with a matching name', () => {
  const text = read('SKILL.md');
  const section = text.split(/^## Available Commands\s*$/m)[1]?.split(/^## /m)[0] ?? '';
  const commands = [...section.matchAll(/^- `\/([a-z0-9-]+)/gm)].map((m) => m[1]);
  assert.deepEqual(commands.sort(), ['aikido-design-audit', 'aikido-design-brief', 'aikido-design-charter', 'aikido-design-config', 'aikido-design-moodboard', 'aikido-design-render', 'aikido-design-style', 'aikido-design-uikit', 'aikido-init-design']);
  for (const cmd of commands) {
    const file = `commands/${cmd}.md`;
    assert.ok(existsSync(join(SKILL, file)), `${file} is missing`);
    const front = /^---\n([\s\S]*?)\n---/.exec(read(file))?.[1] ?? '';
    assert.match(front, new RegExp(`^name:\\s*${cmd}\\s*$`, 'm'), `${file}: front matter name`);
    assert.match(front, /^description:\s*\S/m, `${file}: description`);
  }
});

test('install-aikido.md registers every command and both agents', () => {
  const install = read('install-aikido.md');
  for (const cmd of ['aikido-init-design', 'aikido-design-charter', 'aikido-design-audit', 'aikido-design-brief', 'aikido-design-moodboard', 'aikido-design-render', 'aikido-design-style', 'aikido-design-uikit']) assert.ok(install.includes(cmd), cmd);
  assert.ok(install.includes('agent-aikido-art-director'));
  assert.ok(install.includes('agent-aikido-image-analyst'));
  assert.ok(install.includes('.claude/agents/agent-aikido-image-analyst.md'));
  assert.ok(install.includes('slug: agent-aikido-image-analyst'));
  assert.ok(install.includes('skills_list.md') && install.includes('commands_list.md') && install.includes('agents_list.md'));
  for (const setting of ['discover', 'setup', '.local-designer.json', 'preserv']) assert.ok(install.includes(setting), setting);
});

test('markdown links inside the skill point to existing files', () => {
  const files = ['SKILL.md', 'install-aikido.md', 'agents/agent-aikido-art-director.md', 'agents/agent-aikido-image-analyst.md', 'references/vision.md', 'references/runtime-configuration.md', 'references/people-and-casting.md',
    'references/preview.md', 'references/art-direction.md', 'references/character-design.md', 'commands/aikido-design-brief.md',
    'commands/aikido-design-moodboard.md', 'commands/aikido-design-render.md', 'commands/aikido-design-style.md', 'commands/aikido-init-design.md',
    'commands/aikido-design-charter.md', 'commands/aikido-design-audit.md', 'commands/aikido-design-uikit.md', 'references/uikit.md'];
  const missing = [];
  for (const rel of files) {
    for (const m of read(rel).matchAll(/\]\(((?!https?:|#|prompts\/)[^)\s#]+)\)/g)) {
      if (!existsSync(resolve(SKILL, dirname(rel), m[1]))) missing.push(`${rel} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

// The rule "one reader for every image" must stay written wherever an agent or a command is told to judge an image.
test('every place that judges an image delegates to the image analyst and the skill documents the vision command', () => {
  for (const rel of ['agents/agent-aikido-art-director.md', 'commands/aikido-design-moodboard.md', 'commands/aikido-design-render.md',
    'commands/aikido-design-audit.md', 'references/art-direction.md', 'references/character-design.md', 'SKILL.md']) {
    assert.match(read(rel), /image[- ]analyst/, `${rel} must send image reading to agent-aikido-image-analyst`);
  }
  assert.match(read('SKILL.md'), /\| `vision status\\\|models\\\|pin\\\|checks\\\|ask\\\|review` \|/, 'SKILL.md lists the vision command');
  const front = /^---\n([\s\S]*?)\n---/.exec(read('agents/agent-aikido-image-analyst.md'))?.[1] ?? '';
  const analyst = read('agents/agent-aikido-image-analyst.md');
  assert.match(analyst, /never pin, re-pin or unpin/i, 'the analyst must not pin a model by itself');
  assert.match(analyst, /Never announce it, never test it before each use, never ask the user/i, 'reading must stay silent');
  assert.match(analyst, /current model/i, 'without a local model the current model reads');
  for (const file of ['agents/agent-aikido-art-director.md', 'commands/aikido-design-moodboard.md', 'commands/aikido-design-render.md', 'commands/aikido-design-audit.md', 'SKILL.md']) {
    assert.ok(!/pin one with the user|no model is pinned|neither you nor another model|only reader of images|never judge the pixels by yourself/i.test(read(file)), `${file} must not require a pinned reader`);
  }
  assert.match(front, /^name:\s*agent-aikido-image-analyst\s*$/m);
  assert.match(front, /^description:\s*\S/m);
  assert.ok(!/fallback to|falls back to|try another model/i.test(read('references/vision.md').replace(/no fallback|No fallback|never[^.]*fallback/gi, '')), 'vision.md must not describe a fallback');
});

test('SKILL.md version matches the catalog and no path depends on the checkout location', () => {
  const catalog = JSON.parse(readFileSync(resolve(SKILL, '../../catalog.json'), 'utf8'));
  const entry = catalog.skills.find((s) => s.name === 'local-designer');
  assert.match(read('SKILL.md'), new RegExp(`^- \\*\\*Version\\*\\*: ${entry.version.replace(/\./g, '\\.')}\\s*$`, 'm'));
  assert.ok(!read('SKILL.md').includes('node skills/local-designer/'), 'SKILL.md must not hard-code skills/local-designer/');
});
