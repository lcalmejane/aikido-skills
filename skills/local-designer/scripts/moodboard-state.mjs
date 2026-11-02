// Mood board state on disk: brief.json, board.json, decision.json, moodboard.html, trials/.
// The folder lives in the project's design target (<design dir>/moodboards/<name>/), or in ~/local-designer-lab when no target is set.
// No absolute path is written in these files: they are versioned with the project.
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

export const STATES = ['proposed', 'selected', 'rejected', 'validated'];
export const FILES = { brief: 'brief.json', board: 'board.json', decision: 'decision.json', html: 'moodboard.html' };

const readJson = (file, what) => {
  if (!existsSync(file)) throw new Error(`${what} not found: ${file}`);
  try { return JSON.parse(readFileSync(file, 'utf8')); } catch (error) { throw new Error(`${what} is not valid JSON (${file}): ${error.message}`); }
};
const writeJson = (file, data) => { mkdirSync(dirname(file), { recursive: true }); writeFileSync(file, `${JSON.stringify(data, null, 2)}\n`); };

export function insideGit(path) {
  let dir = resolve(path);
  for (;;) {
    if (existsSync(join(dir, '.git'))) return true;
    const parent = dirname(dir);
    if (parent === dir) return false;
    dir = parent;
  }
}

export const boardPath = (dir, key) => join(resolve(dir), FILES[key]);
// One render per direction and per scene: trials/A-hero.png (webp next to it). Without a scene: the single legacy trial trials/A.png.
export const trialPath = (dir, id, scene) => join(resolve(dir), 'trials', scene ? `${id}-${scene}.png` : `${id}.png`);
// The file to show: the webp when present (light, versioned with the project), else the png.
export function trialImage(dir, id, scene) {
  const png = trialPath(dir, id, scene);
  const webp = png.replace(/\.png$/, '.webp');
  return existsSync(webp) ? webp : existsSync(png) ? png : null;
}

// The thumbnail path is machine specific (absolute): it is not stored. The page rebuilds it from the style name.
export const withoutThumbnails = (board) => ({ ...board, tracks: board.tracks.map(({ thumbnail, ...track }) => track) });

export function saveBoard(dir, { brief, board, html }) {
  const d = resolve(dir);
  writeJson(boardPath(d, 'brief'), brief);
  writeJson(boardPath(d, 'board'), withoutThumbnails(board));
  if (!existsSync(boardPath(d, 'decision'))) {
    writeJson(boardPath(d, 'decision'), { validated: null, validated_by: null, validated_at: null,
      tracks: Object.fromEntries(board.tracks.map((t) => [t.id, { state: 'proposed', comments: [] }])), history: [] });
  }
  if (html !== undefined) writeFileSync(boardPath(d, 'html'), html);
}

export function loadBoard(dir) {
  const d = resolve(dir);
  return { brief: readJson(boardPath(d, 'brief'), 'brief.json'), board: readJson(boardPath(d, 'board'), 'board.json'), decision: readJson(boardPath(d, 'decision'), 'decision.json') };
}

export const saveDecision = (dir, decision) => writeJson(boardPath(dir, 'decision'), decision);

// Records a state change and/or a comment for one direction. Only one direction can be validated at a time.
export function decide(dir, { track, state, comment, by = 'unknown', now = new Date() }) {
  const { board, decision } = loadBoard(dir);
  if (!board.tracks.some((t) => t.id === track)) throw new Error(`Unknown direction "${track}". Available: ${board.tracks.map((t) => t.id).join(', ')}`);
  if (state !== undefined && !STATES.includes(state)) throw new Error(`state must be one of ${STATES.join(', ')} (got ${state})`);
  if (state === undefined && !comment) throw new Error('Give --state and/or --comment');
  const at = now.toISOString();
  const entry = (decision.tracks[track] ??= { state: 'proposed', comments: [] });
  if (state === 'validated') {
    for (const [id, t] of Object.entries(decision.tracks)) if (id !== track && t.state === 'validated') { t.state = 'selected'; decision.history.push({ at, track: id, state: 'selected', by, note: `replaced by ${track}` }); }
    Object.assign(decision, { validated: track, validated_by: by, validated_at: at });
  } else if (state && decision.validated === track) {
    Object.assign(decision, { validated: null, validated_by: null, validated_at: null });
  }
  if (state) { entry.state = state; decision.history.push({ at, track, state, by }); }
  if (comment) entry.comments.push({ at, by, text: comment });
  saveDecision(dir, decision);
  return decision;
}

// The lock: generation is allowed only for a validated direction. Returns what the generation must use.
export function validatedTrack(dir) {
  const { brief, board, decision } = loadBoard(dir);
  if (!decision.validated || decision.tracks?.[decision.validated]?.state !== 'validated') {
    throw new Error(`No validated direction in ${resolve(dir)}. Show moodboard.html to the client (preview order in references/preview.md), then record the choice: moodboard decide ${dir} --track A --state validated --by "<who>".`);
  }
  const track = board.tracks.find((t) => t.id === decision.validated);
  if (!track) throw new Error(`Validated direction ${decision.validated} is missing from board.json: rebuild the mood board.`);
  return { brief, track, validated_by: decision.validated_by, validated_at: decision.validated_at };
}

export function summary(dir) {
  const { brief, board, decision } = loadBoard(dir);
  const scenes = board.scenes ?? [];
  return {
    dir: resolve(dir), client: brief.client, project: brief.project, validated: decision.validated,
    scenes: scenes.map((s) => s.id),
    tracks: board.tracks.map((t) => ({
      id: t.id, style: t.style, state: decision.tracks?.[t.id]?.state ?? 'proposed', comments: decision.tracks?.[t.id]?.comments?.length ?? 0,
      trial: Boolean(trialImage(dir, t.id)),
      renders: scenes.filter((s) => trialImage(dir, t.id, s.id)).length, expected: scenes.length,
    })),
  };
}
