// UI kit review pages, each a single self-contained HTML file (CSS and icon sprite inlined, no network, no script needed):
//   showcase.html  every component of the kit, light and dark side by side, plus the measured contrast table
//   variants.html  the 5 personalities (A-E) on the same screen, each in its own iframe so their tokens never collide
import { buildTokens, checkTokens, MODES, VARIANTS, variantIds } from './uikit-lib.mjs';
import { componentsCss, tokensCss } from './uikit-css.mjs';
import { ICON_NAMES, iconSvg, iconStyleOf, inlineSprite, useIcon } from './uikit-icons.mjs';

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const ic = (name, size = 18) => useIcon(name, { size });

// Components, written with the "ui" prefix and renamed once at the end. Avoid the letters "ui-" in plain text below.
function sampleBody(tokens, { dark = false } = {}) {
  const id = dark ? 'd' : 'l';
  const c = tokens.modes[dark ? 'dark' : 'light'];
  const swatch = (n) => `<div style="display:grid;gap:4px;justify-items:center"><div style="width:44px;height:44px;border-radius:var(--ui-radius-md);background:var(--ui-${n});border:1px solid var(--ui-border)"></div><span class="ui-muted" style="font-size:var(--ui-fs-xs)">${n}</span></div>`;
  return `
<section class="ui-stack">
  <div><h2>${esc(tokens.name)}</h2><p class="ui-muted">Variante ${esc(tokens.variant.id)} · ${esc(tokens.variant.label)} — ${esc(tokens.variant.description)}</p></div>

  <div class="ui-card"><div class="ui-card__header">Couleurs</div><div class="ui-card__body ui-row" style="gap:var(--ui-space-4)">
    ${['bg', 'surface', 'surface-raised', 'surface-sunken', 'border', 'text', 'text-muted', 'primary', 'primary-soft', 'accent', 'accent-soft', 'success', 'warning', 'danger', 'info'].filter((n) => c[n]).map(swatch).join('')}
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Typographie</div><div class="ui-card__body">
    <h1>Titre de niveau 1</h1><h2>Titre de niveau 2</h2><h3>Titre de niveau 3</h3>
    <p>Texte courant avec un <a href="#">lien</a>, du <code>code en ligne</code> et la touche <kbd>Ctrl</kbd>. <span class="ui-muted">Texte secondaire plus discret.</span></p>
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Boutons</div><div class="ui-card__body ui-stack">
    <div class="ui-row"><button class="ui-btn ui-btn--primary">Principal</button><button class="ui-btn ui-btn--accent">Accent</button><button class="ui-btn">Neutre</button><button class="ui-btn ui-btn--danger">Supprimer</button><button class="ui-btn ui-btn--ghost">Discret</button><button class="ui-btn ui-btn--link">Lien</button></div>
    <div class="ui-row"><button class="ui-btn ui-btn--primary ui-btn--sm">Petit</button><button class="ui-btn ui-btn--primary">${ic('send')} Avec icône</button><button class="ui-btn ui-btn--primary ui-btn--lg">Grand</button><button class="ui-btn ui-btn--icon" aria-label="Paramètres">${ic('settings')}</button><button class="ui-btn ui-btn--primary" disabled>Désactivé</button><button class="ui-btn ui-btn--primary ui-btn--loading">Chargement</button></div>
    <div class="ui-btn-group"><button class="ui-btn" aria-pressed="true">Jour</button><button class="ui-btn" aria-pressed="false">Semaine</button><button class="ui-btn" aria-pressed="false">Mois</button></div>
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Formulaire</div><div class="ui-card__body ui-stack" style="max-width:26rem">
    <div class="ui-field"><label class="ui-label" for="n${id}">Nom</label><input id="n${id}" class="ui-input" placeholder="Votre nom"><span class="ui-help">Visible par les membres de l'équipe.</span></div>
    <div class="ui-field"><label class="ui-label" for="s${id}">Recherche</label><div class="ui-input-group">${ic('search')}<input id="s${id}" class="ui-input" placeholder="Rechercher…"></div></div>
    <div class="ui-field ui-field--invalid"><label class="ui-label" for="e${id}">Courriel</label><input id="e${id}" class="ui-input" aria-invalid="true" value="nom@"><span class="ui-error">${ic('alert-circle', 16)} Adresse incomplète.</span></div>
    <div class="ui-field"><label class="ui-label" for="r${id}">Rôle</label><select id="r${id}" class="ui-select"><option>Lecteur</option><option>Éditeur</option></select></div>
    <div class="ui-field"><label class="ui-label" for="t${id}">Message</label><textarea id="t${id}" class="ui-textarea" placeholder="Votre message"></textarea></div>
    <div class="ui-row"><label class="ui-check"><input type="checkbox" checked> Case cochée</label><label class="ui-radio"><input type="radio" name="g${id}" checked> Option A</label><label class="ui-radio"><input type="radio" name="g${id}"> Option B</label><label class="ui-check"><input class="ui-switch" type="checkbox" role="switch" checked> Interrupteur</label></div>
  </div></div>

  <div class="ui-grid">
    <div class="ui-card ui-card--interactive"><div class="ui-card__body"><span class="ui-badge ui-badge--primary">Nouveau</span><h3 style="margin-top:var(--ui-space-2)">Carte interactive</h3><p class="ui-muted">Survolez-la : elle se soulève légèrement.</p></div><div class="ui-card__footer"><button class="ui-btn ui-btn--sm">Annuler</button><button class="ui-btn ui-btn--primary ui-btn--sm">Ouvrir</button></div></div>
    <div class="ui-card"><div class="ui-card__body ui-stat"><span class="ui-stat__label">Utilisateurs actifs</span><span class="ui-stat__value">12 480</span><span class="ui-badge ui-badge--success">${ic('arrow-right', 14)} +8,2 %</span></div></div>
    <div class="ui-card"><div class="ui-card__body ui-row"><span class="ui-avatar">LC</span><div><strong>Laurent</strong><div class="ui-muted" style="font-size:var(--ui-fs-sm)">Administrateur</div></div></div></div>
  </div>

  <div class="ui-card"><div class="ui-card__header">Retours</div><div class="ui-card__body ui-stack">
    <div class="ui-row"><span class="ui-badge">Défaut</span><span class="ui-badge ui-badge--primary">Principal</span><span class="ui-badge ui-badge--accent">Accent</span><span class="ui-badge ui-badge--success">Succès</span><span class="ui-badge ui-badge--warning">Attention</span><span class="ui-badge ui-badge--danger">Erreur</span><span class="ui-badge ui-badge--info">Info</span><span class="ui-tag">${ic('tag', 14)} étiquette</span></div>
    <div class="ui-alert ui-alert--info" role="status">${ic('info', 20)}<div><span class="ui-alert__title">Information</span>Une nouvelle version est disponible.</div></div>
    <div class="ui-alert ui-alert--success" role="status">${ic('check-circle', 20)}<div><span class="ui-alert__title">Enregistré</span>Vos changements ont été sauvegardés.</div></div>
    <div class="ui-alert ui-alert--warning" role="alert">${ic('alert-triangle', 20)}<div><span class="ui-alert__title">Attention</span>Cette action est difficile à annuler.</div></div>
    <div class="ui-alert ui-alert--danger" role="alert">${ic('x-circle', 20)}<div><span class="ui-alert__title">Échec</span>La connexion au serveur a été perdue.</div></div>
    <div class="ui-row"><progress class="ui-progress" value="64" max="100" style="max-width:16rem"></progress><span class="ui-spinner" role="status" aria-label="Chargement"></span><span class="ui-skeleton" style="width:10rem;height:1rem"></span></div>
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Navigation</div><div class="ui-card__body ui-stack">
    <nav aria-label="Fil d'Ariane"><ol class="ui-breadcrumb"><li><a href="#">Accueil</a></li><li><a href="#">Projets</a></li><li aria-current="page">Détail</li></ol></nav>
    <div class="ui-tabs" role="tablist"><button class="ui-tab" role="tab" aria-selected="true">Aperçu</button><button class="ui-tab" role="tab" aria-selected="false">Activité</button><button class="ui-tab" role="tab" aria-selected="false">Réglages</button></div>
    <nav class="ui-nav" aria-label="Menu" style="max-width:15rem"><a class="ui-nav__link" href="#" aria-current="page">${ic('home')} Accueil</a><a class="ui-nav__link" href="#">${ic('folder')} Projets</a><a class="ui-nav__link" href="#">${ic('users')} Équipe</a><a class="ui-nav__link" href="#">${ic('settings')} Réglages</a></nav>
    <ol class="ui-steps"><li class="is-done">Compte</li><li class="is-current">Profil</li><li>Terminé</li></ol>
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Données</div><div class="ui-card__body ui-stack">
    <div class="ui-table-wrap"><table class="ui-table ui-table--striped"><thead><tr><th>Nom</th><th>Statut</th><th class="is-num">Montant</th></tr></thead><tbody>
      <tr><td>Alpha</td><td><span class="ui-badge ui-badge--success">Actif</span></td><td class="is-num">1 240,00</td></tr>
      <tr><td>Bravo</td><td><span class="ui-badge ui-badge--warning">En attente</span></td><td class="is-num">86,50</td></tr>
      <tr><td>Charlie</td><td><span class="ui-badge ui-badge--danger">Bloqué</span></td><td class="is-num">0,00</td></tr></tbody></table></div>
    <ul class="ui-list"><li class="ui-list__item ui-list__item--action">${ic('file')}<span class="ui-list__grow">Rapport trimestriel</span><span class="ui-muted">2 Mo</span></li><li class="ui-list__item ui-list__item--action">${ic('image')}<span class="ui-list__grow">Visuel de couverture</span><span class="ui-muted">640 Ko</span></li></ul>
    <div class="ui-accordion"><details open><summary>Première question</summary><div>La réponse s'affiche ici.</div></details><details><summary>Deuxième question</summary><div>Une autre réponse.</div></details></div>
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Menu, infobulle, vide</div><div class="ui-card__body ui-row" style="align-items:flex-start;gap:var(--ui-space-6)">
    <ul class="ui-menu" role="menu"><li><a class="ui-menu__item" role="menuitem" href="#">${ic('edit')} Modifier</a></li><li><a class="ui-menu__item" role="menuitem" href="#">${ic('copy')} Dupliquer</a></li><li class="ui-menu__sep" role="separator"></li><li><a class="ui-menu__item ui-menu__item--danger" role="menuitem" href="#">${ic('trash')} Supprimer</a></li></ul>
    <span class="ui-tooltip" data-tip="Aide contextuelle" tabindex="0"><button class="ui-btn ui-btn--icon" aria-label="Aide">${ic('help')}</button></span>
    <div class="ui-empty" style="flex:1;min-width:14rem">${ic('folder', 32)}<h3>Aucun dossier</h3><p>Créez-en un pour commencer.</p><button class="ui-btn ui-btn--primary">${ic('plus')} Nouveau</button></div>
  </div></div>

  <div class="ui-card"><div class="ui-card__header">Pictos (${ICON_NAMES.length})</div><div class="ui-card__body ui-row" style="gap:var(--ui-space-4)">
    ${ICON_NAMES.map((n) => `<span class="ui-tooltip" data-tip="${n}" style="display:inline-flex">${ic(n, 24)}</span>`).join('')}
  </div></div>
</section>`;
}

const PAGE_CSS = `body{margin:0}.rv-bar{display:flex;gap:1rem;align-items:center;flex-wrap:wrap;padding:.75rem 1.25rem;background:#111;color:#eee;font:14px/1.4 system-ui,sans-serif}.rv-bar a{color:#9cf}.rv-bar b{font-size:15px}
.rv-pair{display:grid;grid-template-columns:1fr 1fr;gap:0}.rv-pair>div{padding:1.25rem;min-width:0}@media (max-width:1100px){.rv-pair{grid-template-columns:1fr}}
.rv-table{border-collapse:collapse;font:13px/1.4 ui-monospace,monospace;margin:1rem 1.25rem}.rv-table td,.rv-table th{border:1px solid #8884;padding:2px 8px;text-align:left}.rv-fail{color:#c00;font-weight:700}.rv-adv{color:#a60}`;

function contrastTable(tokens) {
  const r = checkTokens(tokens);
  const bad = r.results.filter((x) => !x.pass);
  const rows = bad.map((x) => `<tr class="${x.level === 'advisory' ? 'rv-adv' : 'rv-fail'}"><td>${x.mode}</td><td>${x.fg}</td><td>${x.bg}</td><td>${x.ratio}</td><td>${x.min}</td><td>${x.level === 'advisory' ? 'avertissement' : 'échec'}</td></tr>`).join('');
  return `<section style="font-family:system-ui,sans-serif;padding:0 1.25rem"><h2>Contrastes mesurés</h2><p>${r.total} paires vérifiées : ${r.total - bad.length} conformes${r.failures.length ? `, <b class="rv-fail">${r.failures.length} en échec</b>` : ''}${r.warnings.length ? `, ${r.warnings.length} avertissement(s) (bouton plein contre la page, critère WCAG 1.4.11 non bloquant)` : ''}.</p>`
    + (bad.length ? `<table class="rv-table"><tr><th>mode</th><th>texte/élément</th><th>fond</th><th>ratio</th><th>min</th><th></th></tr>${rows}</table>` : '') + '</section>';
}

const retag = (html, p) => (p === 'ui' ? html : html.replace(/\bui-/g, `${p}-`));

export function showcaseHtml(tokens, { assetsHref = null } = {}) {
  const p = tokens.prefix;
  const css = `${tokensCss(tokens)}\n${componentsCss(tokens)}\n${PAGE_CSS}`;
  const panes = MODES.map((m) => `<div class="ui-root" data-theme="${m}"><p class="ui-muted" style="margin:0 0 1rem"><b>Mode ${m === 'light' ? 'clair' : 'sombre'}</b></p>${sampleBody(tokens, { dark: m === 'dark' })}</div>`).join('');
  const body = `<div class="rv-bar"><b>${esc(tokens.name)} · UI kit</b><span>Variante ${esc(tokens.variant.id)} · ${esc(tokens.variant.label)}</span><span>${ICON_NAMES.length} pictos</span><span>Page générée, ne pas la modifier : ajustez avec <code>uikit set clé=valeur</code>, elle est reconstruite à chaque <code>uikit build</code></span></div>`
    + inlineSprite(tokens) + `<div class="rv-pair">${retag(panes, p)}</div>` + contrastTable(tokens);
  return `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(tokens.name)} — UI kit</title>`
    + `<style>${css}</style>${assetsHref ? `<link rel="stylesheet" href="${esc(assetsHref)}">` : ''}</head><body>${body}</body></html>\n`;
}

// One page, five iframes: each variant brings its own custom properties, so isolating them is the only reliable comparison.
export function variantsHtml(seed, { name = 'kit', prefix = 'ui', overrides = {}, dark = false, decided = null } = {}) {
  const frames = variantIds().map((vid) => {
    const t = buildTokens({ seed, variant: vid, overrides, name, prefix });
    const css = `${tokensCss(t)}\n${componentsCss(t)}`;
    const check = checkTokens(t);
    const doc = `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><style>${css}body{margin:0;padding:1rem}</style></head><body class="${prefix}-root" data-theme="${dark ? 'dark' : 'light'}">${inlineSprite(t)}${retag(sampleBody(t, { dark }), prefix)}</body></html>`;
    const v = VARIANTS[vid];
    return `<figure style="margin:0;display:grid;gap:.5rem"><figcaption style="font:14px/1.4 system-ui,sans-serif"><b style="font-size:18px">${vid} · ${esc(v.label)}</b>${decided === vid ? ' <span style="background:#2a7;color:#fff;border-radius:99px;padding:1px 10px;font-size:12px">retenue</span>' : ''}<br>${esc(v.description)}<br><span style="opacity:.7">Angle ${t.params.radius}px · contrôles ${t.params.control}px · bouton ${t.params.button}${t.params.uppercase ? ' · capitales' : ''} · ${check.ok ? `contrastes OK (${check.total})` : `<b class="rv-fail">${check.failures.length} contraste(s) en échec</b>`}</span></figcaption>`
      + `<iframe title="Variante ${vid}" style="width:100%;height:78vh;border:1px solid #8886;border-radius:8px;background:#fff" srcdoc="${esc(doc)}"></iframe></figure>`;
  }).join('\n');
  return `<!doctype html>\n<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><title>${esc(name)} — pistes de UI kit</title>`
    + `<style>${PAGE_CSS}.rv-grid{display:grid;grid-template-columns:repeat(auto-fit,minmax(min(100%,34rem),1fr));gap:1.5rem;padding:1.25rem;font-family:system-ui,sans-serif}</style></head><body>`
    + `<div class="rv-bar"><b>${esc(name)} · cinq pistes de UI kit</b><span>Même écran, mêmes couleurs de marque, cinq personnalités. Choisir avec <code>uikit decide &lt;A-E&gt;</code>.</span><span>${dark ? 'mode sombre' : 'mode clair'}</span></div>`
    + `<div class="rv-grid">${frames}</div></body></html>\n`;
}

export { iconSvg, iconStyleOf };
