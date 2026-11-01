// Self-contained HTML page of a mood board: images are embedded (data URI), so the single file can be
// e-mailed to a client. No script, no external resource, nothing fetched when it is opened.
import { existsSync, readFileSync } from 'node:fs';
import { extname } from 'node:path';

const LABELS = {
  fr: {
    title: 'Mood board', brief: 'Brief', message: 'Message', audience: 'Cible', usage: 'Usages', format: 'Format', realism: 'Niveau de réalisme',
    palette: 'Palette', keywords: 'Mots-clés', dos: 'À privilégier', donts: 'À éviter', risks: 'Points de vigilance', sample: 'Exemple de sujet',
    why: 'Pourquoi cette piste', state: { proposed: 'Proposée', selected: 'Retenue', rejected: 'Écartée', validated: 'Validée' },
    comments: 'Commentaires', trial: 'Essai sur votre sujet', reference: 'Imagette de référence (autre sujet)', track: 'Piste',
    answer: 'Merci d’indiquer la lettre de la piste retenue (ou de plusieurs), avec vos remarques : couleurs, ambiance, éléments à ajouter ou retirer.',
    validated: 'Piste validée', none: 'Aucune piste validée pour le moment',
    note: 'Les imagettes de référence illustrent le style de rendu, pas votre sujet. Les essais éventuels sont de petite taille et servent à juger l’esprit, pas le détail.',
  },
  en: {
    title: 'Mood board', brief: 'Brief', message: 'Message', audience: 'Audience', usage: 'Uses', format: 'Format', realism: 'Realism level',
    palette: 'Palette', keywords: 'Keywords', dos: 'Do', donts: 'Avoid', risks: 'Watch points', sample: 'Sample subject',
    why: 'Why this direction', state: { proposed: 'Proposed', selected: 'Selected', rejected: 'Rejected', validated: 'Validated' },
    comments: 'Comments', trial: 'Trial on your subject', reference: 'Reference thumbnail (other subject)', track: 'Direction',
    answer: 'Please reply with the letter of the direction you prefer (or several), plus remarks: colours, mood, elements to add or remove.',
    validated: 'Validated direction', none: 'No direction validated yet',
    note: 'Reference thumbnails show the rendering style, not your subject. Trials, when present, are small and show the spirit, not the detail.',
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

function trackCard(t, st, L, images) {
  const state = st?.state ?? 'proposed';
  const thumb = dataUri(t.thumbnail);
  const trial = images[t.id] ? dataUri(images[t.id]) : null;
  const swatches = (t.palette ?? []).map((c) => `<span class="sw" style="background:${esc(c.hex)}" title="${esc(c.name)} ${esc(c.hex)}"></span>`).join('');
  const comments = (st?.comments ?? []).map((c) => `<li><b>${esc(c.by ?? '')}</b> ${esc(c.at?.slice(0, 10) ?? '')} - ${esc(c.text)}</li>`).join('');
  return `<article class="card ${esc(state)}">
<header><span class="badge">${esc(t.id)}</span><h3>${esc(t.style)}</h3><span class="pill ${esc(state)}">${esc(L.state[state] ?? state)}</span></header>
<p class="desc">${esc(t.description)}</p>
<div class="imgs">${trial ? `<figure><img src="${trial}" alt=""><figcaption>${esc(L.trial)}</figcaption></figure>` : ''}${thumb ? `<figure><img src="${thumb}" alt=""><figcaption>${esc(L.reference)}</figcaption></figure>` : ''}</div>
${swatches ? `<h4>${esc(L.palette)}</h4><div class="pal">${swatches}</div>` : ''}
${t.keywords?.length ? `<h4>${esc(L.keywords)}</h4><p class="kw">${t.keywords.map((k) => `<span>${esc(k)}</span>`).join('')}</p>` : ''}
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
<style>body{font:15px/1.5 system-ui,sans-serif;max-width:1200px;margin:0 auto;padding:24px;color:#1d1d1f;background:#fafafa}
h1{margin:0 0 4px}.sub{color:#666;margin:0 0 20px}table{border-collapse:collapse;margin-bottom:20px}th{text-align:left;padding:2px 14px 2px 0;color:#555;vertical-align:top}
.grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(340px,1fr));gap:18px}.card{background:#fff;border:1px solid #ddd;border-radius:10px;padding:16px}
.card.validated{border:2px solid #1a7f37}.card.rejected{opacity:.55}header{display:flex;gap:10px;align-items:center}header h3{margin:0;flex:1;font-size:18px}
.badge{background:#1d1d1f;color:#fff;border-radius:50%;width:30px;height:30px;display:grid;place-items:center;font-weight:700}
.pill{font-size:12px;border-radius:12px;padding:2px 10px;background:#eee}.pill.selected{background:#fff3c4}.pill.validated{background:#c9f0d3}.pill.rejected{background:#f8d0d0}
.imgs{display:grid;gap:8px}figure{margin:0}img{width:100%;border-radius:6px;display:block}figcaption{font-size:12px;color:#777;margin-top:2px}
h4{margin:14px 0 4px;font-size:13px;text-transform:uppercase;letter-spacing:.04em;color:#555}ul{margin:0;padding-left:18px}.desc{color:#444}
.pal{display:flex;gap:6px}.sw{width:34px;height:34px;border-radius:6px;border:1px solid #0002}.kw span{display:inline-block;background:#eef;border-radius:10px;padding:1px 9px;margin:0 4px 4px 0;font-size:13px}
.sample{font-style:italic;color:#444}.box{background:#fff;border:1px solid #ddd;border-radius:10px;padding:12px 16px;margin:20px 0}.ok{border-color:#1a7f37}
small{color:#777}</style>
<h1>${esc(L.title)} - ${esc(b.project ?? b.client ?? '')}</h1><p class="sub">${esc(b.client ?? '')}</p>
<table>${row(L.message, b.message)}${row(L.audience, b.audience)}${row(L.usage, b.use_cases)}${row(L.format, fmt)}${row(L.realism, REALISM_LABEL[b.language ?? 'fr']?.[b.realism] ?? b.realism)}${row(L.keywords, b.keywords)}</table>
<div class="box ${validated ? 'ok' : ''}"><b>${esc(validated ? `${L.validated} : ${validated.id} - ${validated.style}` : L.none)}</b>${validated ? '' : `<br>${esc(L.answer)}`}</div>
<section class="grid">${board.tracks.map((t) => trackCard(t, decision.tracks?.[t.id], L, images)).join('\n')}</section>
<p><small>${esc(L.note)}</small></p></html>
`;
}
