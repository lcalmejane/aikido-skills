// Design target of a project: ONE folder that holds the design charter, the project's own styles and the mood boards.
//   <design dir>/design-charter.md      the charter
//   <design dir>/styles/                styles of the project (override the bundled ones)
//   <design dir>/moodboards/<name>/     client mood boards (versioned with the project, images in webp)
// Resolution order: --design-dir (copied into LOCAL_DESIGNER_DESIGN_DIR by the CLI) > LOCAL_DESIGNER_DESIGN_DIR >
// "design_dir" of the nearest .local-designer.json found above the current folder (relative to that file) > none (legacy layout).
import { existsSync, readFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve } from 'node:path';

export const CONFIG_FILE = '.local-designer.json';

export function findConfig(start = process.cwd()) {
  let dir = resolve(start);
  for (;;) {
    const file = join(dir, CONFIG_FILE);
    if (existsSync(file)) return file;
    const parent = dirname(dir);
    if (parent === dir) return null;
    dir = parent;
  }
}

export function resolveDesignDir({ env = process.env, cwd = process.cwd() } = {}) {
  if (env.LOCAL_DESIGNER_DESIGN_DIR) return resolve(cwd, env.LOCAL_DESIGNER_DESIGN_DIR);
  const file = findConfig(cwd);
  if (!file) return null;
  let config;
  try { config = JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${file} is not valid JSON: ${error.message}`); }
  return config.design_dir ? resolve(dirname(file), String(config.design_dir)) : null;
}

export const designStylesDir = (designDir) => join(designDir, 'styles');
export const designMoodboardsDir = (designDir) => join(designDir, 'moodboards');

export function isInside(path, parent) {
  if (!parent) return false;
  const rel = relative(resolve(parent), resolve(path));
  return rel === '' || (!rel.startsWith('..') && !isAbsolute(rel));
}
