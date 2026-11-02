// Render-style library for the local-designer skill: load, validate, save, compose, recommend, gallery.
// Zero dependency, no network, no call to any image engine.
import { existsSync, mkdirSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { designStylesDir, resolveDesignDir } from './design-target.mjs';

export const BUNDLED_STYLES_DIR = resolve(dirname(fileURLToPath(import.meta.url)), '../styles');
export const USER_STYLES_DIR = join(homedir(), '.local-designer', 'styles');
// Former location (the skill was called drawthing): still read, lower priority, until `migrate` moves it.
export const LEGACY_STYLES_DIR = join(homedir(), '.drawthing', 'styles');
export const CATEGORIES = ['photo', 'vector', 'cartoon', 'drawing', 'technical', 'editorial', 'painting', '3d', 'craft', 'stylized'];
const NAME_RE = /^[a-z0-9][a-z0-9-]*$/;

// Folders searched, in order. A later folder overrides an earlier style with the same name:
// bundled < ~/.drawthing/styles (former) < ~/.local-designer/styles < <design dir>/styles (the project target)
// < $DRAWTHING_STYLES (former) < $LOCAL_DESIGNER_STYLES (colon separated).
export function styleDirs(extra = [], env = process.env, cwd = process.cwd()) {
  const split = (value) => (value ?? '').split(':').filter(Boolean);
  const envDirs = [...split(env.DRAWTHING_STYLES), ...split(env.LOCAL_DESIGNER_STYLES)];
  const target = resolveDesignDir({ env, cwd });
  return [{ dir: BUNDLED_STYLES_DIR, origin: 'bundled' }, { dir: LEGACY_STYLES_DIR, origin: 'user' }, { dir: USER_STYLES_DIR, origin: 'user' },
    ...(target ? [{ dir: designStylesDir(target), origin: 'project' }] : []),
    ...envDirs.map((dir) => ({ dir: resolve(dir), origin: 'env' })), ...extra.map((dir) => ({ dir: resolve(dir), origin: 'extra' }))];
}

export function loadStyles(dirs) {
  const list = dirs === undefined ? styleDirs() : [].concat(dirs).map((d) => (typeof d === 'string' ? { dir: d, origin: 'custom' } : d));
  const styles = {};
  for (const { dir, origin } of list) {
    if (!existsSync(dir)) continue;
    for (const file of readdirSync(dir).filter((f) => f.endsWith('.json')).sort()) {
      const style = JSON.parse(readFileSync(join(dir, file), 'utf8'));
      style.name ??= file.replace(/\.json$/, '');
      // Non-enumerable: where the style lives (never serialised, never leaks an absolute path).
      Object.defineProperty(style, 'dir', { value: dir, enumerable: false });
      Object.defineProperty(style, 'origin', { value: origin, enumerable: false });
      styles[style.name] = style;
    }
  }
  return styles;
}

export const thumbFile = (style) => (style.dir ? join(style.dir, 'thumbs', `${style.name}.webp`) : null);

// Inserts the subject into the style template ({subject} placeholder, appended when absent).
export function applyStyle(style, subject) {
  const template = String(style.template ?? '{subject}');
  return template.includes('{subject}') ? template.replace('{subject}', subject) : `${subject}. ${template}`;
}

export function validateStyle(style) {
  const errors = [];
  if (!NAME_RE.test(style?.name ?? '')) errors.push('name must be lowercase letters, digits and dashes');
  if (!style?.description) errors.push('description is required');
  if (!String(style?.template ?? '').includes('{subject}')) errors.push('template must contain {subject}');
  if (style?.category && !CATEGORIES.includes(style.category)) errors.push(`category must be one of ${CATEGORIES.join(', ')}`);
  for (const k of ['tags', 'use_cases']) if (style?.[k] !== undefined && !Array.isArray(style[k])) errors.push(`${k} must be an array`);
  if (style?.params !== undefined && (typeof style.params !== 'object' || Array.isArray(style.params))) errors.push('params must be an object');
  return errors;
}

const KEY_ORDER = ['name', 'description', 'category', 'tags', 'use_cases', 'look', 'template', 'negative', 'params', 'thumb_subject', 'composed_of', 'notes'];

export function saveStyle(style, dir = USER_STYLES_DIR) {
  const errors = validateStyle(style);
  if (errors.length) throw new Error(`Invalid style: ${errors.join('; ')}`);
  const ordered = {};
  for (const k of KEY_ORDER) if (style[k] !== undefined) ordered[k] = style[k];
  for (const k of Object.keys(style)) if (!(k in ordered)) ordered[k] = style[k];
  mkdirSync(dir, { recursive: true });
  const file = join(resolve(dir), `${style.name}.json`);
  writeFileSync(file, `${JSON.stringify(ordered, null, 2)}\n`);
  return file;
}

// ---------------------------------------------------------------------------
// Composition: build a new style from existing ones (first = structure and params, others = look)
// ---------------------------------------------------------------------------

const article = (phrase) => (/^[aeiou]/i.test(phrase) ? 'an' : 'a');
const terms = (s) => String(s ?? '').split(',').map((t) => t.trim()).filter(Boolean);
const uniq = (arr) => [...new Set(arr)];

export function composeStyles(styles, names, { name, description, note, category } = {}) {
  if (names.length < 2) throw new Error('compose needs at least two style names (the first one is the base)');
  const parts = names.map((n) => {
    if (!styles[n]) throw new Error(`Unknown style "${n}". Available: ${Object.keys(styles).join(', ')}`);
    return styles[n];
  });
  const [base, ...others] = parts;
  const baseLook = base.look ?? base.description;
  const mixed = others.map((s) => s.look ?? s.description).join(', and ');
  const lead = `${article(baseLook)} ${baseLook}`;
  const template = `${lead.charAt(0).toUpperCase()}${lead.slice(1)} of {subject}, blended with ${mixed}.${note ? ` ${note}.` : ''}`;
  return {
    name: name ?? names.join('-x-'),
    description: description ?? `${base.name} structure with ${others.map((s) => s.name).join(' + ')} influence`,
    category: category ?? base.category ?? 'stylized',
    tags: uniq(parts.flatMap((s) => s.tags ?? [])),
    use_cases: base.use_cases ?? [],
    look: `${baseLook}, blended with ${mixed}`,
    template,
    negative: uniq(parts.flatMap((s) => terms(s.negative))).join(', '),
    params: { ...(others.at(-1).params ?? {}), ...(base.params ?? {}) },
    thumb_subject: base.thumb_subject,
    composed_of: names,
  };
}

// ---------------------------------------------------------------------------
// Recommendation: rank styles for a brief (French or English keywords)
// ---------------------------------------------------------------------------

const STOP = new Set('the a an of for and or to in on with de du des la le les un une et pour en au aux dans sur avec par is are be my our nos notre mon ma that this ce cet cette'.split(' '));
const FR_EN = {
  entreprise: 'corporate business', societe: 'corporate business', professionnel: 'professional corporate', realiste: 'photo realistic',
  photographie: 'photo', vectoriel: 'vector flat', dessin: 'drawing', croquis: 'sketch', technique: 'technical', schema: 'diagram technical',
  notice: 'technical manual', manuel: 'technical manual', bd: 'comic cartoon', caricature: 'cartoon', devis: 'proposal commercial',
  proposition: 'proposal commercial', commerciale: 'commercial proposal', commercial: 'commercial proposal', vente: 'sales', ventes: 'sales',
  equipe: 'team', produit: 'product', batiment: 'architecture', immeuble: 'architecture', icone: 'icon', icones: 'icon', infographie: 'infographic',
  aquarelle: 'watercolor', peinture: 'painting', ancien: 'vintage', jeu: 'game', enfant: 'kids children', enfants: 'kids children',
  sante: 'health', formation: 'training education', industriel: 'industrial technical', logiciel: 'software tech', donnees: 'data',
  securite: 'security', diapo: 'slide presentation', diaporama: 'slide presentation', conference: 'presentation', serieux: 'serious corporate',
  ludique: 'playful fun', moderne: 'modern', minimaliste: 'minimal', sobre: 'minimal corporate', dirigeant: 'executive portrait', portrait: 'portrait',
  rapport: 'report', plan: 'blueprint technical', ingenierie: 'engineering technical', explication: 'explainer', pedagogique: 'explainer educational',
};
const norm = (s) => String(s).toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');

export function tokenize(text) {
  const out = [];
  for (const raw of norm(text).split(/[^a-z0-9]+/).filter(Boolean)) {
    if (raw.length < 2 || STOP.has(raw)) continue;
    out.push(raw.replace(/s$/, ''));
    if (FR_EN[raw]) out.push(...FR_EN[raw].split(' '));
  }
  return uniq(out);
}

export function recommendStyles(styles, brief, { limit = 5, category } = {}) {
  const want = tokenize(brief);
  const weights = [['tags', 3], ['use_cases', 3], ['category', 2], ['name', 2], ['description', 1], ['look', 1]];
  const ranked = [];
  for (const style of Object.values(styles)) {
    if (category && style.category !== category) continue;
    let score = 0;
    const matched = new Set();
    for (const [field, weight] of weights) {
      const have = new Set(tokenize([].concat(style[field] ?? []).join(' ')));
      for (const t of want) if (have.has(t)) { score += weight; matched.add(t); }
    }
    ranked.push({ name: style.name, category: style.category, score, matched: [...matched], description: style.description });
  }
  ranked.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  return { brief_terms: want, results: ranked.slice(0, limit) };
}

// ---------------------------------------------------------------------------
// Gallery (styles/README.md) with the thumbnails
// ---------------------------------------------------------------------------

export function renderGallery(styles) {
  const byCat = {};
  for (const s of Object.values(styles)) (byCat[s.category ?? 'stylized'] ??= []).push(s);
  const lines = ['# Style gallery', '',
    'Generated by `local-designer.mjs styles index` - do not edit by hand. Thumbnails are real renders (seed 42, 768x512 source, 384x256 WebP);',
    'each style uses its own `thumb_subject`, so compare a style with its neighbours of the same category rather than across categories.', ''];
  for (const cat of CATEGORIES) {
    const list = (byCat[cat] ?? []).sort((a, b) => a.name.localeCompare(b.name));
    if (!list.length) continue;
    lines.push(`## ${cat}`, '', '| Preview | Style | Use it for |', '|---|---|---|');
    for (const s of list) {
      const img = existsSync(join(s.dir ?? '', 'thumbs', `${s.name}.webp`)) ? `<img src="thumbs/${s.name}.webp" width="220">` : '(no preview yet)';
      lines.push(`| ${img} | **${s.name}**<br>${s.description} | ${(s.use_cases ?? []).join(', ')} |`);
    }
    lines.push('');
  }
  return `${lines.join('\n')}\n`;
}
