#!/usr/bin/env node
import { existsSync, readFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const SAFE_NAME = /^[a-z0-9][a-z0-9-]*$/;
const SAFE_PATH = /^(?!\/)(?!.*\.\.)[A-Za-z0-9._/-]+$/;
const LAYOUTS = new Set(['skills-dir', 'plugin-marketplace']);

export function validateRepository(root = ROOT) {
  const errors = [];
  const readJson = (file) => {
    try {
      return JSON.parse(readFileSync(join(root, file), 'utf8'));
    } catch (error) {
      errors.push(`${file}: ${error.message}`);
      return null;
    }
  };

  const catalog = readJson('catalog.json');
  if (catalog) {
    if (catalog.schemaVersion !== 1) errors.push('catalog.json: schemaVersion must be 1');
    const names = new Set();
    for (const skill of catalog.skills ?? []) {
      const label = `catalog.json skill ${skill.name}`;
      if (!SAFE_NAME.test(skill.name ?? '')) errors.push(`${label}: invalid name`);
      if (names.has(skill.name)) errors.push(`${label}: duplicate name`);
      names.add(skill.name);
      if (!skill.description || !skill.version) errors.push(`${label}: description and version are required`);
      if (!SAFE_PATH.test(skill.path ?? '')) {
        errors.push(`${label}: unsafe path`);
        continue;
      }
      const file = join(root, skill.path, 'SKILL.md');
      if (!existsSync(file)) {
        errors.push(`${label}: ${skill.path}/SKILL.md is missing`);
        continue;
      }
      const text = readFileSync(file, 'utf8');
      if (!new RegExp(`^name:\\s*${skill.name}\\s*$`, 'm').test(text)) errors.push(`${label}: front matter name differs`);
      if (text.split('\n').length > 500) errors.push(`${label}: SKILL.md exceeds 500 lines`);
    }
  }

  const sources = readJson('sources.json');
  if (sources) {
    if (sources.schemaVersion !== 1) errors.push('sources.json: schemaVersion must be 1');
    const ids = new Set();
    for (const source of sources.sources ?? []) {
      const label = `sources.json source ${source.id}`;
      if (!SAFE_NAME.test(source.id ?? '')) errors.push(`${label}: invalid id`);
      if (ids.has(source.id)) errors.push(`${label}: duplicate id`);
      ids.add(source.id);
      if (!/^https:\/\/github\.com\/[\w.-]+\/[\w.-]+\.git$/.test(source.repo ?? '')) errors.push(`${label}: repo must be an https GitHub .git URL`);
      if (!LAYOUTS.has(source.layout)) errors.push(`${label}: unknown layout`);
      if (!Array.isArray(source.roots) || source.roots.length === 0 || !source.roots.every((p) => SAFE_PATH.test(p))) errors.push(`${label}: invalid roots`);
      if (source.trust !== 'third-party') errors.push(`${label}: trust must be third-party`);
    }
  }
  return errors;
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  const errors = validateRepository();
  if (errors.length > 0) {
    process.stderr.write(`${errors.join('\n')}\n`);
    process.exit(1);
  }
  process.stdout.write('catalog.json and sources.json are valid\n');
}
