import assert from 'node:assert/strict';
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import test from 'node:test';
import { fileURLToPath } from 'node:url';
import { validateRepository } from '../scripts/validate.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

function withCopy(mutate) {
  const dir = mkdtempSync(join(tmpdir(), 'aikido-skills-'));
  try {
    for (const item of ['catalog.json', 'sources.json', 'skills']) cpSync(join(ROOT, item), join(dir, item), { recursive: true });
    mutate(dir);
    return validateRepository(dir);
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
}

test('repository is valid', () => {
  assert.deepEqual(validateRepository(ROOT), []);
});

test('catalog entry without SKILL.md is rejected', () => {
  const errors = withCopy((dir) => {
    const file = join(dir, 'catalog.json');
    const catalog = JSON.parse(readFileSync(file, 'utf8'));
    catalog.skills[0].path = 'skills/missing';
    writeFileSync(file, JSON.stringify(catalog));
  });
  assert.match(errors.join('\n'), /SKILL\.md is missing/);
});

test('unsafe catalog path and non-https source are rejected', () => {
  const errors = withCopy((dir) => {
    const catalogFile = join(dir, 'catalog.json');
    const catalog = JSON.parse(readFileSync(catalogFile, 'utf8'));
    catalog.skills[0].path = '../outside';
    writeFileSync(catalogFile, JSON.stringify(catalog));
    const sourcesFile = join(dir, 'sources.json');
    const sources = JSON.parse(readFileSync(sourcesFile, 'utf8'));
    sources.sources[0].repo = 'git@github.com:anthropics/skills.git';
    writeFileSync(sourcesFile, JSON.stringify(sources));
  });
  assert.match(errors.join('\n'), /unsafe path/);
  assert.match(errors.join('\n'), /https GitHub/);
});
