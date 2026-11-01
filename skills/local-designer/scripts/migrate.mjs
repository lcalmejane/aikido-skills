// One-time move of the data kept under the skill's former name (drawthing) to the local-designer names.
//   ~/drawthing-lab -> ~/local-designer-lab        ~/.drawthing -> ~/.local-designer
// Text files inside the moved folders (board.json, index.html, logs...) have the old absolute paths rewritten.
import { existsSync, readdirSync, readFileSync, renameSync, statSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';

const TEXT_FILE = /\.(json|html|md|out|log|txt)$/i;
const MAX_TEXT_BYTES = 5 * 1024 * 1024;
const MOVES = [['drawthing-lab', 'local-designer-lab'], ['.drawthing', '.local-designer']];
const REWRITES = [
  [/\/skills\/drawthing\//g, '/skills/local-designer/'],
  [/\/drawthing-lab\b/g, '/local-designer-lab'],
  [/\/\.drawthing\b/g, '/.local-designer'],
];

export function rewriteText(text) {
  return REWRITES.reduce((acc, [from, to]) => acc.replace(from, to), text);
}

function* walk(dir) {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    const info = statSync(path);
    if (info.isDirectory()) yield* walk(path);
    else if (info.isFile() && TEXT_FILE.test(name) && info.size <= MAX_TEXT_BYTES) yield path;
  }
}

const filesToRewrite = (dir) => [...walk(dir)].filter((f) => rewriteText(readFileSync(f, 'utf8')) !== readFileSync(f, 'utf8'));

export function planMigration(home) {
  return MOVES.filter(([from]) => existsSync(join(home, from))).map(([from, to]) => {
    const src = join(home, from);
    const dst = join(home, to);
    const blocked = existsSync(dst) ? `${dst} already exists: nothing is moved, merge by hand` : null;
    return { from: src, to: dst, blocked, rewrites: filesToRewrite(src).length };
  });
}

export function applyMigration(home) {
  const done = [];
  for (const step of planMigration(home)) {
    if (step.blocked) {
      done.push({ ...step, moved: false });
      continue;
    }
    renameSync(step.from, step.to);
    let rewritten = 0;
    for (const file of filesToRewrite(step.to)) {
      writeFileSync(file, rewriteText(readFileSync(file, 'utf8')));
      rewritten += 1;
    }
    done.push({ ...step, moved: true, rewrites: rewritten });
  }
  return done;
}
