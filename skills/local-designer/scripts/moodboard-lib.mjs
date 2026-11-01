// Mood board model for the local-designer skill: structured brief, directions ("tracks") built from the
// style library, one palette per direction. Pure functions, no network, no call to Draw Things.
import { existsSync } from 'node:fs';
import { applyStyle, recommendStyles, thumbFile } from './styles-lib.mjs';
import { colourName, dominantColours, fromHex, readPixels } from './design-tools.mjs';

export const REALISM = ['photo', 'illustrated', 'schematic', 'playful'];
const REALISM_TERMS = { photo: 'photo realistic', illustrated: 'illustration drawing', schematic: 'technical diagram vector', playful: 'cartoon playful fun' };

export const BRIEF_TEMPLATE = {
  client: '', project: '', language: 'fr',
  message: 'What must the viewer understand or feel in 3 seconds?',
  audience: 'Who sees it, in which context',
  use_cases: ['slide', 'web banner'],
  subject: 'What the image must show (one concrete idea)',
  format: { ratio: '16:9' },
  realism: 'illustrated',
  keywords: [],
  brand: { palette: [], fonts: [], forbidden: [] },
  constraints: ['no text in the image'],
  references: [],
};

export function validateBrief(brief) {
  const e = [];
  if (!brief || typeof brief !== 'object') return ['brief must be an object'];
  if (!brief.client && !brief.project) e.push('client or project is required');
  if (!brief.message) e.push('message is required');
  if (!brief.audience) e.push('audience is required');
  if (!Array.isArray(brief.use_cases) || !brief.use_cases.length) e.push('use_cases must be a non-empty array');
  if (brief.language && !['fr', 'en'].includes(brief.language)) e.push('language must be fr or en');
  if (brief.realism && !REALISM.includes(brief.realism)) e.push(`realism must be one of ${REALISM.join(', ')}`);
  if (brief.format?.ratio && !/^\d+:\d+$/.test(brief.format.ratio)) e.push('format.ratio must look like 16:9');
  for (const c of brief.brand?.palette ?? []) if (!/^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c)) e.push(`brand.palette colour ${c} must be a hex like #1a2b3c`);
  return e;
}

export const briefText = (b) => [b.message, b.audience, ...(b.use_cases ?? []), ...(b.keywords ?? []), REALISM_TERMS[b.realism] ?? ''].join(' ');

const RISKS = {
  photo: ['Hands, teeth and small text are the usual weak spots: plan a few re-rolls.'],
  vector: ['Complex scenes with many objects get messy: keep one idea per image.'],
  cartoon: ['Faces and proportions vary from one image to the next: fix the seed for a series.'],
  drawing: ['Looks unfinished on purpose: confirm this suits the audience.'],
  technical: ['Any lettering or numbers will be wrong: add labels afterwards.'],
  painting: ['Mood over precision: not suited to exact products or diagrams.'],
  editorial: ['Strong identity, hard to mix with a corporate brand.'],
  '3d': ['Realism is limited: expect a stylised result.'],
  craft: ['Strong identity, small details get lost at small sizes.'],
  stylized: ['Very recognisable look: check it matches the brand tone.'],
};
const TXT = {
  en: { why: 'Matches the brief', ideal: 'Ideal for', avoid: 'Avoid', notPhoto: 'Illustrated result, not a photograph.', notIllus: 'Photographic result, not an illustration.', risks: RISKS },
  fr: {
    why: 'Correspond au brief', ideal: 'Idéal pour', avoid: 'À éviter', notPhoto: 'Résultat illustré, pas une photographie.', notIllus: 'Résultat photographique, pas une illustration.',
    risks: {
      photo: ['Les mains, les dents et les petits textes sont les points faibles habituels : prévoir quelques relances.'],
      vector: ['Les scènes chargées deviennent brouillonnes : une seule idée par image.'],
      cartoon: ['Visages et proportions varient d’une image à l’autre : fixer la graine pour une série.'],
      drawing: ['Aspect volontairement inachevé : vérifier que cela convient à la cible.'],
      technical: ['Tout texte ou chiffre généré sera faux : ajouter les légendes ensuite.'],
      painting: ['Privilégie l’ambiance à la précision : peu adapté aux produits exacts ou aux schémas.'],
      editorial: ['Identité forte, difficile à marier avec une charte d’entreprise.'],
      '3d': ['Réalisme limité : le résultat reste stylisé.'],
      craft: ['Identité forte, les petits détails se perdent en petit format.'],
      stylized: ['Look très reconnaissable : vérifier l’accord avec le ton de la marque.'],
    },
  },
};

// Negative prompt for a direction: the style's own terms plus what the client forbids in the brief.
export function trackNegative(style, brief) {
  const terms = [...String(style?.negative ?? '').split(','), ...(brief.brand?.forbidden ?? [])].map((t) => t.trim()).filter(Boolean);
  return [...new Set(terms)].join(', ');
}

function paletteOf(style, brief) {
  const brand = (brief.brand?.palette ?? []).slice(0, 3).map((hex) => ({ hex: hex.toLowerCase(), name: colourName(fromHex(hex)), brand: true }));
  let thumb = [];
  const file = thumbFile(style);
  if (file && existsSync(file)) {
    try { thumb = dominantColours(readPixels(file).data, 4).map((c) => ({ hex: c.hex, name: c.name })); } catch { /* palette is optional */ }
  }
  return [...brand, ...thumb].slice(0, 6);
}

export function buildTrack(id, style, brief, scored = {}) {
  const x = TXT[brief.language] ?? TXT.fr;
  const notes = style.notes ? [style.notes] : [];
  const mismatch = brief.realism === 'photo' && style.category !== 'photo' ? [x.notPhoto]
    : brief.realism && brief.realism !== 'photo' && style.category === 'photo' ? [x.notIllus] : [];
  return {
    id, style: style.name, category: style.category, description: style.description,
    thumbnail: thumbFile(style), palette: paletteOf(style, brief),
    keywords: [...new Set(style.tags ?? [])].slice(0, 8),
    why: scored.matched?.length ? [`${x.why} : ${scored.matched.join(', ')}`] : [],
    dos: [style.look, ...(style.use_cases?.length ? [`${x.ideal} : ${style.use_cases.slice(0, 3).join(', ')}`] : [])].filter(Boolean),
    donts: trackNegative(style, brief) ? [`${x.avoid} : ${trackNegative(style, brief).split(',').map((t) => t.trim()).slice(0, 8).join(', ')}`] : [],
    risks: [...mismatch, ...(x.risks[style.category] ?? []), ...notes],
    sample_prompts: brief.subject ? [{ subject: brief.subject, prompt: applyStyle(style, brief.subject) }] : [],
    negative: trackNegative(style, brief),
    params: style.params ?? {},
  };
}

// Picks `count` directions: best score first, then the best ones from categories not yet used (variety is the point of a mood board).
export function pickStyles(styles, brief, { count = 3, only = [], boost = {} } = {}) {
  if (only.length) {
    for (const n of only) if (!styles[n]) throw new Error(`Unknown style "${n}". Available: ${Object.keys(styles).join(', ')}`);
    return only.map((name) => ({ name, matched: [] }));
  }
  const ranked = recommendStyles(styles, briefText(brief), { limit: Object.keys(styles).length }).results
    .map((r) => ({ ...r, score: r.score + (boost[r.name] ?? 0) })).sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));
  const chosen = [];
  const seen = new Set();
  for (const r of ranked) if (chosen.length < count && !seen.has(r.category)) { chosen.push(r); seen.add(r.category); }
  for (const r of ranked) if (chosen.length < count && !chosen.includes(r)) chosen.push(r);
  return chosen;
}

export function buildMoodboard(styles, brief, options = {}) {
  const errors = validateBrief(brief);
  if (errors.length) throw new Error(`Invalid brief: ${errors.join('; ')}`);
  const picked = pickStyles(styles, brief, options);
  const warnings = [];
  if (!options.only?.length && picked.every((p) => p.score === 0)) warnings.push('No style matches the brief vocabulary: add keywords or use_cases, or pass --styles.');
  if (!brief.subject) warnings.push('No subject in the brief: trials and the generation lock need one.');
  return {
    created: new Date().toISOString(),
    tracks: picked.map((p, i) => buildTrack(String.fromCharCode(65 + i), styles[p.name], brief, p)),
    warnings,
  };
}
