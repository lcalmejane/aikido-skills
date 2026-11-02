// Self-contained HTML page of a mood board: images are embedded (data URI), so the single file can be
// e-mailed to a client. No script, no external resource, nothing fetched when it is opened.
// Each direction is shown as a board: the scenes (situations), the palette with roles, the typography,
// the textures, what the direction says and rules out, and a small page preview built from those choices.
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const LABELS = {
  fr: {
    title: 'Mood board', brief: 'Brief', message: 'Message', audience: 'Cible', positioning: 'Positionnement', usage: 'Usages', format: 'Format', realism: 'Niveau de réalisme',
    palette: 'Palette', typography: 'Typographie', textures: 'Matières et textures', keywords: 'Mots-clés', says: 'Ce que cette piste dit', rejects: 'Ce que cette piste écarte',
    dos: 'À privilégier', donts: 'À éviter', risks: 'Points de vigilance', sample: 'Exemple de sujet', why: 'Pourquoi cette piste',
    state: { proposed: 'Proposée', selected: 'Retenue', rejected: 'Écartée', validated: 'Validée' },
    comments: 'Commentaires', scenes: 'Mises en situation', reference: 'Imagette de référence (autre sujet)', track: 'Piste', preview: 'Aperçu de page', previewNote: 'Maquette indicative : couleurs, police et image de la piste, sans contenu définitif.',
    title1: 'Titre de la page', cta: 'Appel à l’action', body: 'Un court texte d’introduction montre le ton et la lisibilité de la typographie choisie.', missing: 'Rendu non généré',
    roles: { primary: 'Principale', accent: 'Accent', secondary: 'Secondaire', neutral: 'Neutre', sampled: 'Échantillon' },
    questions: 'Pour arbitrer', q1: 'Quelle piste exprime le mieux le positionnement ci-dessus, et pour qui ?', q2: 'Que faut-il garder, retirer ou ajouter (couleurs, ambiance, éléments) ?',
    q3: 'Les images doivent-elles montrer des personnes, des lieux, des objets ou rester symboliques ?', q4: 'Droits : les images générées par IA doivent respecter les usages permis et l’identité de la marque.',
    validated: 'Piste validée', none: 'Aucune piste validée pour le moment',
    answer: 'Merci d’indiquer la lettre de la piste retenue (ou de plusieurs), avec vos remarques : couleurs, ambiance, éléments à ajouter ou retirer.',
    note: 'Les rendus sont de petite taille et servent à juger l’esprit, pas le détail. Valider une piste engage une orientation, pas chaque détail.',
  },
  en: {
    title: 'Mood board', brief: 'Brief', message: 'Message', audience: 'Audience', positioning: 'Positioning', usage: 'Uses', format: 'Format', realism: 'Realism level',
    palette: 'Palette', typography: 'Typography', textures: 'Materials and textures', keywords: 'Keywords', says: 'What this direction says', rejects: 'What this direction rules out',
    dos: 'Do', donts: 'Avoid', risks: 'Watch points', sample: 'Sample subject', why: 'Why this direction',
    state: { proposed: 'Proposed', selected: 'Selected', rejected: 'Rejected', validated: 'Validated' },
    comments: 'Comments', scenes: 'Situations', reference: 'Reference thumbnail (other subject)', track: 'Direction', preview: 'Page preview', previewNote: 'Indicative mock-up: colours, font and image of the direction, no final content.',
    title1: 'Page title', cta: 'Call to action', body: 'A short intro text shows the tone and the legibility of the chosen typography.', missing: 'Not rendered',
    roles: { primary: 'Primary', accent: 'Accent', secondary: 'Secondary', neutral: 'Neutral', sampled: 'Sampled' },
    questions: 'To decide', q1: 'Which direction best expresses the positioning above, and for whom?', q2: 'What to keep, remove or add (colours, mood, elements)?',
    q3: 'Should the images show people, places, objects, or stay symbolic?', q4: 'Rights: AI-generated images must respect the permitted uses and the brand identity.',
    validated: 'Validated direction', none: 'No direction validated yet',
    answer: 'Please reply with the letter of the direction you prefer (or several), plus remarks: colours, mood, elements to add or remove.',
    note: 'Renders are small and show the spirit, not the detail. Validating a direction commits an orientation, not every detail.',
  },
};

const REALISM_LABEL = {
  fr: { photo: 'photo réaliste', illustrated: 'illustré', schematic: 'schématique', playful: 'ludique' },
  en: { photo: 'realistic photo', illustrated: 'illustrated', schematic: 'schematic', playful: 'playful' },
};
const esc = (s) => String(s ?? '').replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const MIME = { '.webp': 'image/webp', '.png': 'image/png', '.jpg': 'image/jpeg', '.jpeg': 'image/jpeg' };

export function dataUri(file) {
  if (!file || !existsSync(file)) return null;
  return `data:${MIME[extname(file).toLowerCase()] ?? 'application/octet-stream'};base64,${readFileSync(file).toString('base64')}`;
}

const list = (items) => (items?.length ? `<ul>${items.map((i) => `<li>${esc(i)}</li>`).join('')}</ul>` : '');
const section = (title, body) => (body ? `<h4>${esc(title)}</h4>${body}` : '');

// Relative luminance, to pick a readable text colour on a given background.
function luminance(hex) {
  const h = String(hex).replace('#', '');
  const full = h.length === 3 ? [...h].map((c) => c + c).join('') : h;
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(full.slice(i, i + 2), 16) / 255).map((v) => (v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4));
  return 0.2126 * r + 0.7152 * g + 0.0722 * b;
}
const validHex = (c) => /^#([0-9a-f]{3}|[0-9a-f]{6})$/i.test(c?.hex ?? '');

// Colours of the page preview, taken from the palette: a light and a dark base, a main colour and an accent.
export function previewColours(palette = []) {
  const p = palette.filter(validHex);
  const byLum = [...p].sort((a, b) => luminance(b.hex) - luminance(a.hex));
  const light = (p.find((c) => c.role === 'neutral' && luminance(c.hex) > 0.5) ?? byLum[0])?.hex ?? '#fafafa';
  const dark = (p.find((c) => c.role === 'neutral' && luminance(c.hex) < 0.15) ?? byLum.at(-1))?.hex ?? '#1d1d1f';
  const main = (p.find((c) => c.role === 'primary') ?? p[0])?.hex ?? dark;
  const accent = (p.find((c) => c.role === 'accent') ?? p[1] ?? p[0])?.hex ?? main;
  const on = (bg) => (luminance(bg) > 0.4 ? dark : light);
  return { light, dark, main, accent, onMain: on(main), onAccent: on(accent) };
}

// images[trackId] is { sceneId: file } (current) or a single file (former single trial).
function trackImages(images, trackId, scenes) {
  const entry = images?.[trackId];
  if (!entry) return [];
  if (typeof entry === 'string') return [{ scene: { id: 'trial', label: '' }, file: entry }];
  return scenes.map((scene) => ({ scene, file: entry[scene.id] ?? null }));
}

function pagePreview(t, L, hero) {
  const c = previewColours(t.palette);
  const font = t.typography ?? {};
  const bg = hero ? `background-image:linear-gradient(90deg,${esc(c.light)}f0 0%,${esc(c.light)}b0 45%,transparent 100%),url('${hero}');background-size:cover;background-position:center;` : `background:${esc(c.light)};`;
  return `<div class="page" style="${bg}color:${esc(c.dark)}">
<div class="nav" style="border-bottom:1px solid ${esc(c.dark)}22"><b style="font-family:${esc(font.title?.stack)}">${esc(t.style)}</b><span style="font-family:${esc(font.text?.stack)}">${esc(L.track)} ${esc(t.id)}</span></div>
<div class="hero"><h5 style="font-family:${esc(font.title?.stack)};color:${esc(c.main)}">${esc(L.title1)}</h5>
<p style="font-family:${esc(font.text?.stack)}">${esc(L.body)}</p>
<span class="cta" style="background:${esc(c.accent)};color:${esc(c.onAccent)};font-family:${esc(font.text?.stack)}">${esc(L.cta)}</span></div></div>`;
}

function trackCard(t, st, L, board, images) {
  const state = st?.state ?? 'proposed';
  const scenes = board.scenes ?? [];
  const shots = trackImages(images, t.id, scenes);
  const ref = dataUri(t.thumbnail);
  const first = shots.find((s) => s.file);
  const heroUri = first ? dataUri(first.file) : null;
  const gallery = shots.map((s) => {
    const uri = s.file ? dataUri(s.file) : null;
    return `<figure class="shot">${uri ? `<img src="${uri}" alt="">` : `<div class="blank">${esc(L.missing)}</div>`}${s.scene.label ? `<figcaption>${esc(s.scene.label)}</figcaption>` : ''}</figure>`;
  }).join('');
  const swatches = (t.palette ?? []).map((c) => `<li><span class="sw" style="background:${esc(c.hex)}"></span><span class="sn"><b>${esc(c.name)}</b><br><code>${esc(c.hex)}</code><br><small>${esc(L.roles[c.role] ?? c.role ?? '')}</small></span></li>`).join('');
  const ty = t.typography;
  const typo = ty ? `<div class="typo"><p class="tt" style="font-family:${esc(ty.title?.stack)}">${esc(ty.title?.name)} <small>${esc(L.title1)}</small></p><p class="tx" style="font-family:${esc(ty.text?.stack)}">${esc(ty.text?.name)} - ${esc(L.body)}</p><small>${esc(ty.note)}</small></div>` : '';
  const comments = (st?.comments ?? []).map((c) => `<li><b>${esc(c.by ?? '')}</b> ${esc(c.at?.slice(0, 10) ?? '')} - ${esc(c.text)}</li>`).join('');
  return `<article class="card ${esc(state)}">
<header><span class="badge">${esc(t.id)}</span><h3>${esc(t.style)}</h3><span class="pill ${esc(state)}">${esc(L.state[state] ?? state)}</span></header>
<p class="desc">${esc(t.description)}</p>
${shots.length ? `<h4>${esc(L.scenes)}</h4><div class="shots">${gallery}</div>` : (ref ? `<div class="shots"><figure class="shot"><img src="${ref}" alt=""><figcaption>${esc(L.reference)}</figcaption></figure></div>` : '')}
<div class="cols">
<div>${section(L.says, list(t.says))}${section(L.rejects, list(t.rejects))}${section(L.keywords, t.keywords?.length ? `<p class="kw">${t.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</p>` : '')}${section(L.textures, t.textures?.length ? `<p class="kw tex">${t.textures.map((k) => `<span>${esc(k)}</span>`).join('')}</p>` : '')}</div>
<div>${swatches ? `<h4>${esc(L.palette)}</h4><ul class="pal">${swatches}</ul>` : ''}${typo ? `<h4>${esc(L.typography)}</h4>${typo}` : ''}</div>
</div>
<h4>${esc(L.preview)}</h4>${pagePreview(t, L, heroUri)}<small>${esc(L.previewNote)}</small>
${section(L.why, list(t.why))}${section(L.dos, list(t.dos))}${section(L.donts, list(t.donts))}${section(L.risks, list(t.risks))}
${t.sample_prompts?.[0] ? `<h4>${esc(L.sample)}</h4><p class="sample">${esc(t.sample_prompts[0].subject)}</p>` : ''}
${comments ? `<h4>${esc(L.comments)}</h4><ul class="com">${comments}</ul>` : ''}
</article>`;
}

export function renderMoodboardHtml(board, decision = {}, images = {}) {
  const L = LABELS[board.brief?.language] ?? LABELS.fr;
  const b = board.brief ?? {};
  const row = (k, v) => (v ? `<tr><th>${esc(k)}</th><td>${esc(Array.isArray(v) ? v.join(', ') : v)}</td></tr>` : '');
  const fmt = b.format ? [b.format.ratio, b.format.width && b.format.height ? `${b.format.width}x${b.format.height}` : ''].filter(Boolean).join(' - ') : '';
  const validated = decision.validated ? board.tracks.find((t) => t.id === decision.validated) : null;
  return `<!doctype html><html lang="${esc(b.language ?? 'fr')}"><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">
<title>${esc(L.title)} - ${esc(b.client ?? '')} ${esc(b.project ?? '')}</title>
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1280px;margin:0 auto;padding:24px;color:#1d1d1f;background:#fafafa}
h1{margin:0 0 4px}.sub{color:#666;margin:0 0 20px}table{border-collapse:collapse;margin-bottom:20px}th{text-align:left;padding:2px 14px 2px 0;color:#555;vertical-align:top}
.grid{display:grid;grid-template-columns:1fr;gap:26px}.card{background:#fff;border:1px solid #ddd;border-radius:12px;padding:20px}
.card.validated{border:2px solid #1a7f37}.card.rejected{opacity:.6}header{display:flex;gap:10px;align-items:center}header h3{margin:0;flex:1;font-size:20px}
.badge{background:#1d1d1f;color:#fff;border-radius:50%;width:32px;height:32px;display:grid;place-items:center;font-weight:700}
.pill{font-size:12px;border-radius:12px;padding:2px 10px;background:#eee}.pill.selected{background:#fff3c4}.pill.validated{background:#c9f0d3}.pill.rejected{background:#f8d0d0}
.shots{display:grid;grid-template-columns:repeat(auto-fit,minmax(260px,1fr));gap:10px}figure{margin:0}.shot img{width:100%;border-radius:8px;display:block}
.blank{aspect-ratio:16/9;display:grid;place-items:center;background:#f0f0f0;border-radius:8px;color:#999;font-size:13px}figcaption{font-size:12px;color:#777;margin-top:3px}
.cols{display:grid;grid-template-columns:repeat(auto-fit,minmax(300px,1fr));gap:24px}
h4{margin:16px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#555}ul{margin:0;padding-left:18px}.desc{color:#444}
.pal{list-style:none;padding:0;display:grid;grid-template-columns:repeat(auto-fill,minmax(150px,1fr));gap:8px}.pal li{display:flex;gap:8px;align-items:center}
.sw{width:42px;height:42px;border-radius:8px;border:1px solid #0002;flex:none}.sn{font-size:12px;line-height:1.3}.sn code{color:#555}
.kw span{display:inline-block;background:#eef;border-radius:10px;padding:1px 9px;margin:0 4px 4px 0;font-size:13px}.kw.tex span{background:#f3ece0}
.typo .tt{font-size:26px;margin:2px 0}.typo .tx{margin:2px 0 6px}.typo small,.card>small{color:#777}
.page{border:1px solid #0002;border-radius:10px;overflow:hidden;min-height:230px;margin:6px 0}.nav{display:flex;justify-content:space-between;padding:10px 18px;font-size:13px}
.hero{max-width:52%;padding:28px 18px 34px}.hero h5{font-size:30px;line-height:1.15;margin:0 0 8px}.hero p{margin:0 0 14px}.cta{display:inline-block;border-radius:6px;padding:7px 16px;font-weight:600}
.sample{font-style:italic;color:#444}.box{background:#fff;border:1px solid #ddd;border-radius:10px;padding:12px 16px;margin:20px 0}.ok{border-color:#1a7f37}
.ask li{margin:2px 0}small{color:#777}</style>
<h1>${esc(L.title)} - ${esc(b.project ?? b.client ?? '')}</h1><p class="sub">${esc(b.client ?? '')}</p>
<table>${row(L.positioning, b.positioning)}${row(L.message, b.message)}${row(L.audience, b.audience)}${row(L.usage, b.use_cases)}${row(L.format, fmt)}${row(L.realism, REALISM_LABEL[b.language ?? 'fr']?.[b.realism] ?? b.realism)}${row(L.keywords, b.keywords)}</table>
<div class="box ${validated ? 'ok' : ''}"><b>${esc(validated ? `${L.validated} : ${validated.id} - ${validated.style}` : L.none)}</b>${validated ? '' : `<br>${esc(L.answer)}`}</div>
<section class="grid">${board.tracks.map((t) => trackCard(t, decision.tracks?.[t.id], L, board, images)).join('\n')}</section>
<div class="box"><b>${esc(L.questions)}</b><ul class="ask"><li>${esc(L.q1)}</li><li>${esc(L.q2)}</li><li>${esc(L.q3)}</li><li>${esc(L.q4)}</li></ul></div>
<p><small>${esc(L.note)}</small></p></html>
`;
}
