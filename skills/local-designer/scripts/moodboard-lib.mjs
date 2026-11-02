// Mood board model for the local-designer skill: structured brief, directions ("tracks") built from the
// style library. A direction is shown IN SITUATION: several scenes (wide shot, detail, mood...), a palette with
// roles, typography, textures, what it says and what it rules out. Pure functions, no network, no call to any engine.
import { existsSync } from 'node:fs';
import { applyStyle, recommendStyles, thumbFile } from './styles-lib.mjs';
import { colourName, dominantColours, fromHex, readPixels } from './design-tools.mjs';
import { withRoles } from './charter-lib.mjs';

export const REALISM = ['photo', 'illustrated', 'schematic', 'playful'];
const REALISM_TERMS = { photo: 'photo realistic', illustrated: 'illustration drawing', schematic: 'technical diagram vector', playful: 'cartoon playful fun' };
const SCENE_ID_RE = /^[a-z0-9][a-z0-9-]*$/;

export const BRIEF_TEMPLATE = {
  client: '', project: '', language: 'fr',
  message: 'What must the viewer understand or feel in 3 seconds?',
  audience: 'Who sees it, in which context',
  positioning: 'One sentence: what the brand stands for, against whom or what',
  use_cases: ['slide', 'web banner'],
  subject: 'What the image must show (one concrete idea)',
  scenes: [
    { id: 'hero', label: 'Home page hero', subject: 'The subject in a wide shot, empty space on one side for a title', ratio: '16:9' },
    { id: 'detail', label: 'Close detail', subject: 'A detail of the subject, shallow depth of field', ratio: '4:3' },
    { id: 'section', label: 'Section illustration', subject: 'The subject seen from another angle, calm mood', ratio: '1:1' },
  ],
  format: { ratio: '16:9' },
  realism: 'illustrated',
  keywords: [],
  textures: [],
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
  if (brief.scenes !== undefined) {
    if (!Array.isArray(brief.scenes)) e.push('scenes must be an array');
    else {
      const seen = new Set();
      for (const [i, s] of brief.scenes.entries()) {
        if (!s || typeof s !== 'object') { e.push(`scenes[${i}] must be an object`); continue; }
        if (!SCENE_ID_RE.test(s.id ?? '')) e.push(`scenes[${i}].id must be lowercase letters, digits and dashes`);
        else if (seen.has(s.id)) e.push(`scenes[${i}].id "${s.id}" is used twice`);
        else seen.add(s.id);
        if (!s.subject) e.push(`scenes[${i}].subject is required`);
        if (s.ratio && !/^\d+:\d+$/.test(s.ratio)) e.push(`scenes[${i}].ratio must look like 16:9`);
      }
    }
  }
  return e;
}

export const briefText = (b) => [b.message, b.audience, b.positioning ?? '', ...(b.use_cases ?? []), ...(b.keywords ?? []), REALISM_TERMS[b.realism] ?? ''].join(' ');

// Scenes shown for each direction: the ones of the brief, or three framings of its subject.
export function scenesOf(brief) {
  if (Array.isArray(brief.scenes) && brief.scenes.length) {
    return brief.scenes.map((s) => ({ id: s.id, label: s.label ?? s.id, subject: s.subject, ratio: s.ratio ?? brief.format?.ratio ?? '16:9' }));
  }
  if (!brief.subject) return [];
  const fr = (brief.language ?? 'fr') === 'fr';
  return [
    { id: 'wide', label: fr ? 'Vue d’ensemble' : 'Wide view', subject: `${brief.subject}, wide establishing shot`, ratio: brief.format?.ratio ?? '16:9' },
    { id: 'detail', label: fr ? 'Détail' : 'Detail', subject: `${brief.subject}, close detail shot, shallow depth of field`, ratio: '4:3' },
    { id: 'mood', label: fr ? 'Ambiance' : 'Mood', subject: `${brief.subject}, atmospheric shot from another angle`, ratio: '1:1' },
  ];
}

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

const TRAIT = {
  en: { photo: 'photographic realism', vector: 'flat vector shapes', cartoon: 'a playful cartoon tone', drawing: 'hand-drawn line', technical: 'technical diagram look', editorial: 'the editorial poster look', painting: 'painterly texture', '3d': 'the 3D render look', craft: 'paper and craft materials', stylized: 'a strongly stylised look' },
  fr: { photo: 'le réalisme photographique', vector: 'les aplats vectoriels', cartoon: 'le ton ludique du dessin animé', drawing: 'le trait dessiné à la main', technical: 'le schéma technique', editorial: 'l’affiche éditoriale', painting: 'la matière picturale', '3d': 'le rendu 3D', craft: 'le papier et l’artisanat', stylized: 'un style très marqué' },
};

const TEXTURES = {
  en: { photo: ['fine photographic grain', 'natural light', 'depth of field'], vector: ['flat colour fills', 'clean edges'], cartoon: ['bold outlines', 'flat shading'], drawing: ['pencil strokes', 'paper grain'], technical: ['thin lines', 'grid'], editorial: ['print grain', 'strong contrast'], painting: ['brush strokes', 'canvas'], '3d': ['soft shadows', 'matte surfaces'], craft: ['layered paper', 'cut edges'], stylized: ['strong graphic texture'] },
  fr: { photo: ['grain photographique fin', 'lumière naturelle', 'profondeur de champ'], vector: ['aplats de couleur', 'contours nets'], cartoon: ['contours marqués', 'ombres plates'], drawing: ['traits de crayon', 'grain du papier'], technical: ['traits fins', 'quadrillage'], editorial: ['grain d’impression', 'fort contraste'], painting: ['coups de pinceau', 'toile'], '3d': ['ombres douces', 'surfaces mates'], craft: ['papier en couches', 'bords découpés'], stylized: ['texture graphique marquée'] },
};

// Typeface proposals by family of look. Names are suggestions; the preview page loads no font (it uses the nearest system font).
const SERIF = { name: 'Playfair Display', stack: "'Playfair Display', Georgia, 'Times New Roman', serif" };
const GEO = { name: 'Poppins', stack: "'Poppins', 'Helvetica Neue', Arial, sans-serif" };
const ROUND = { name: 'Nunito', stack: "'Nunito', 'Trebuchet MS', Verdana, sans-serif" };
const TEXT = { name: 'Inter', stack: "'Inter', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif" };
const FONT_BY_CATEGORY = { photo: SERIF, painting: SERIF, editorial: SERIF, drawing: ROUND, cartoon: ROUND, craft: ROUND, vector: GEO, '3d': GEO, technical: GEO, stylized: GEO };
const safeFontName = (name) => String(name).replace(/[^A-Za-z0-9 -]/g, '').trim();

export function typographyFor(style, brief, lang = 'fr') {
  const brandFonts = (brief.brand?.fonts ?? []).map(safeFontName).filter(Boolean);
  if (brandFonts.length) {
    const stack = (n, generic) => `'${n}', ${generic}`;
    return {
      title: { name: brandFonts[0], stack: stack(brandFonts[0], 'sans-serif') },
      text: { name: brandFonts[1] ?? brandFonts[0], stack: stack(brandFonts[1] ?? brandFonts[0], 'sans-serif') },
      note: lang === 'fr' ? 'Polices de la marque (brief).' : 'Brand fonts (from the brief).',
    };
  }
  return {
    title: FONT_BY_CATEGORY[style.category] ?? GEO, text: TEXT,
    note: lang === 'fr' ? 'Proposition à valider : l’aperçu n’embarque aucune police et utilise la police système la plus proche.' : 'Proposal to validate: the preview embeds no font and uses the nearest system font.',
  };
}

const TXT = {
  en: { why: 'Matches the brief', ideal: 'Ideal for', avoid: 'Avoid', notPhoto: 'Illustrated result, not a photograph.', notIllus: 'Photographic result, not an illustration.', rules: 'Ruled out', brandNo: 'Forbidden by the brand', risks: RISKS },
  fr: {
    why: 'Correspond au brief', ideal: 'Idéal pour', avoid: 'À éviter', notPhoto: 'Résultat illustré, pas une photographie.', notIllus: 'Résultat photographique, pas une illustration.', rules: 'Écarte', brandNo: 'Interdit par la marque',
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

// Brand colours first, with a role each; then a few colours sampled from the style's reference thumbnail.
function paletteOf(style, brief) {
  const brand = withRoles((brief.brand?.palette ?? []).slice(0, 12).map((hex) => ({ hex }))).map((c) => ({ ...c, brand: true }));
  let thumb = [];
  const file = thumbFile(style);
  if (file && existsSync(file)) {
    try { thumb = dominantColours(readPixels(file).data, 4).map((c) => ({ hex: c.hex, name: c.name, role: 'sampled' })); } catch { /* palette is optional */ }
  }
  return [...brand, ...thumb].slice(0, Math.max(6, brand.length + 3));
}

export function buildTrack(id, style, brief, scored = {}) {
  const lang = brief.language ?? 'fr';
  const x = TXT[lang] ?? TXT.fr;
  const notes = style.notes ? [style.notes] : [];
  const mismatch = brief.realism === 'photo' && style.category !== 'photo' ? [x.notPhoto]
    : brief.realism && brief.realism !== 'photo' && style.category === 'photo' ? [x.notIllus] : [];
  return {
    id, style: style.name, category: style.category, description: style.description,
    thumbnail: thumbFile(style), palette: paletteOf(style, brief),
    typography: typographyFor(style, brief, lang),
    textures: [...new Set([...(brief.textures ?? []), ...((TEXTURES[lang] ?? TEXTURES.fr)[style.category] ?? [])])].slice(0, 6),
    keywords: [...new Set(style.tags ?? [])].slice(0, 8),
    says: [style.look ?? style.description].filter(Boolean),
    rejects: [],
    why: scored.matched?.length ? [`${x.why} : ${scored.matched.join(', ')}`] : [],
    dos: [style.look, ...(style.use_cases?.length ? [`${x.ideal} : ${style.use_cases.slice(0, 3).join(', ')}`] : [])].filter(Boolean),
    donts: trackNegative(style, brief) ? [`${x.avoid} : ${trackNegative(style, brief).split(',').map((t) => t.trim()).slice(0, 8).join(', ')}`] : [],
    risks: [...mismatch, ...(x.risks[style.category] ?? []), ...notes],
    sample_prompts: brief.subject ? [{ subject: brief.subject, prompt: applyStyle(style, brief.subject) }] : [],
    negative: trackNegative(style, brief),
    params: style.params ?? {},
  };
}

// What a direction rules out: the looks carried by the OTHER directions (that is how a choice is made), plus what the brand forbids.
function rejectsFor(track, tracks, brief) {
  const lang = brief.language ?? 'fr';
  const x = TXT[lang] ?? TXT.fr;
  const traits = TRAIT[lang] ?? TRAIT.fr;
  const others = [...new Set(tracks.filter((t) => t.id !== track.id && t.category !== track.category).map((t) => traits[t.category]).filter(Boolean))];
  const out = others.map((t) => `${x.rules} : ${t}`);
  if (brief.brand?.forbidden?.length) out.push(`${x.brandNo} : ${brief.brand.forbidden.slice(0, 8).join(', ')}`);
  return out;
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
  const scenes = scenesOf(brief);
  if (!scenes.length) warnings.push('No subject and no scenes in the brief: the situations cannot be rendered.');
  const tracks = picked.map((p, i) => buildTrack(String.fromCharCode(65 + i), styles[p.name], brief, p));
  for (const t of tracks) t.rejects = rejectsFor(t, tracks, brief);
  return { created: new Date().toISOString(), scenes, tracks, warnings };
}
