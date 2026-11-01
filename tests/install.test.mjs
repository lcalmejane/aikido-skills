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
  assert.deepEqual(commands.sort(), ['design-audit', 'design-brief', 'design-charter', 'design-moodboard', 'design-render', 'design-style', 'init-design']);
  for (const cmd of commands) {
    const file = `commands/${cmd}.md`;
    assert.ok(existsSync(join(SKILL, file)), `${file} is missing`);
    const front = /^---\n([\s\S]*?)\n---/.exec(read(file))?.[1] ?? '';
    assert.match(front, new RegExp(`^name:\\s*${cmd}\\s*$`, 'm'), `${file}: front matter name`);
    assert.match(front, /^description:\s*\S/m, `${file}: description`);
  }
});

test('install-aikido.md registers every command and the agent', () => {
  const install = read('install-aikido.md');
  for (const cmd of ['init-design', 'design-charter', 'design-audit', 'design-brief', 'design-moodboard', 'design-render', 'design-style']) assert.ok(install.includes(cmd), cmd);
  assert.ok(install.includes('agent-aikido-art-director'));
  assert.ok(install.includes('skills_list.md') && install.includes('commands_list.md') && install.includes('agents_list.md'));
});

test('markdown links inside the skill point to existing files', () => {
  const files = ['SKILL.md', 'install-aikido.md', 'agents/art-director.md', 'commands/design-brief.md',
    'commands/design-moodboard.md', 'commands/design-render.md', 'commands/design-style.md', 'commands/init-design.md',
    'commands/design-charter.md', 'commands/design-audit.md'];
  const missing = [];
  for (const rel of files) {
    for (const m of read(rel).matchAll(/\]\(((?!https?:|#|prompts\/)[^)\s#]+)\)/g)) {
      if (!existsSync(resolve(SKILL, dirname(rel), m[1]))) missing.push(`${rel} -> ${m[1]}`);
    }
  }
  assert.deepEqual(missing, []);
});

test('SKILL.md version matches the catalog and no path depends on the checkout location', () => {
  const catalog = JSON.parse(readFileSync(resolve(SKILL, '../../catalog.json'), 'utf8'));
  const entry = catalog.skills.find((s) => s.name === 'local-designer');
  assert.match(read('SKILL.md'), new RegExp(`^- \\*\\*Version\\*\\*: ${entry.version.replace(/\./g, '\\.')}\\s*$`, 'm'));
  assert.ok(!read('SKILL.md').includes('node skills/local-designer/'), 'SKILL.md must not hard-code skills/local-designer/');
});
