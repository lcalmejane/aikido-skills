# UI kit

A project's interface vocabulary, generated from its brand colours: design tokens, standard components, icons, and optional
image assets (button skins, zone backgrounds). It sits next to the design charter in the design target
(`<design dir>/uikit/`) and is versioned with the project. Nothing in it needs an image engine.

## Cycle

1. `uikit init` reads the seed: explicit colours (`--primary`, `--accent`, `--neutral`), else a stylesheet (`--css site.css`),
   else the design charter, else a brief (`--brief f.json`), else defaults. `sources` in the result says where each value came from.
2. Open `variants.html`: **five personalities** on the same screen with the same colours (A Doux, B Net, C Relief, D Dense, E Éditorial).
   Tell the client what differs: corner radius, shadows, flat or gradient buttons, control height, serif titles.
3. `uikit set primary=#hex radius=6 ...` adjusts the seed or one parameter before choosing; `variants.html` is rebuilt.
4. `uikit decide <A-E> --by "<who>"` keeps one personality and **builds the kit**. The name is mandatory and logged.
5. `uikit set ...` later changes the kit and rebuilds it. `uikit build` rebuilds without a change (idempotent).
6. `uikit assets` draws the optional images. `uikit status` says what is missing or stale.

## Files

| File | Source | Role |
|---|---|---|
| `uikit.json` | edited through `uikit set` | Seed, chosen personality, adjustments, decision log. **The only file to edit** |
| `variants.html` | generated | Five personalities compared (`uikit variants --dark` for dark mode) |
| `tokens.json`, `tokens.css` | generated | Colours (light and dark), type scale, spacing, radius, shadows, motion, z-index, breakpoints |
| `components.css` | generated | Buttons, fields, cards, tables, menus, dialogs, tabs, alerts, badges... |
| `tokens.vscode.css` | generated | Same variables fed by `--vscode-*` first, kit value as fallback (webview, extension) |
| `icons.svg` | generated | Sprite of the icons, 24 px grid, stroke follows the personality (`icon_stroke=2` to override) |
| `showcase.html` | generated | The whole kit, both modes, with the contrast table |
| `assets/` | `uikit assets` | `buttons/` (9-slice skins), `zones/` (backgrounds), `assets.css`, `manifest.json` |

Never edit a generated file: the next build overwrites it. The prefix (`--prefix aw` at `init`, default `ui`) names every class and variable.

## Accessibility

`buildTokens` pulls every foreground/background pair to **4.5:1** (text) or **3:1** (non-text) in light **and** dark. `uikit check`
lists the failures; `uikit build` reports them as a warning. For each status (`primary`, `accent`, `danger`, `success`, `warning`,
`info`) the fill, its hover and its pressed fill keep the label readable, so a hover never loses contrast.
Image skins are measured too: on a button skin the border band of the 9-slice is excluded (the label never touches it), and the
reflect of a "relief" button is lowered until the label keeps 4.5:1 everywhere under it.

## Images (`uikit assets`)

- **Button skins**: 4 kinds (`primary`, `accent`, `danger`, `neutral`) x 3 states x 2 modes, drawn as 9-slice WebP. Use the class
  `<prefix>-btn--skin`. The label stays real text.
- **Zones**: `hero` (colour halos), `banner` (rings), `panel` (grain), `sidebar` (hatching), `footer` (grid), `empty` (dots), each
  in both modes, class `<prefix>-zone-<name>`. They are semi-transparent overlays whose strength is lowered in 5 % steps until text
  and muted text keep 4.5:1 over them. `--only hero,panel` limits the zones, `--no-buttons` / `--no-zones` skip a family.
- Images are drawn by the skill itself (pure JavaScript rasteriser), not by an image engine. WebP needs `cwebp`; without it the
  files are written as PNG with a warning, and `uikit assets` is rerun after installing it.
- Link `assets/assets.css` **after** `tokens.css` and `components.css`. Assets drawn for another personality are reported `stale`.

## Using the kit in a page

```html
<link rel="stylesheet" href="uikit/tokens.css">
<link rel="stylesheet" href="uikit/components.css">
<link rel="stylesheet" href="uikit/assets/assets.css"> <!-- optional -->
<body class="ui-root" data-theme="dark"> <!-- data-theme optional: follows prefers-color-scheme otherwise -->
  <button class="ui-btn ui-btn--primary"><svg class="ui-icon"><use href="uikit/icons.svg#check"/></svg> Save</button>
```

Open `showcase.html` for the full list of classes. The mode follows the system unless `data-theme="light|dark"` is set.

## Limits

- Five personalities are a starting point, not a design system: a client with a strong identity still adjusts with `uikit set`.
- Contrast is computed from the tokens; a layout that puts text on a photograph is not covered.
- Rendering was checked in Chrome. Other browsers use `color-mix()` (all current ones do); very old ones are not targeted.
- `icons` lists the available pictograms (`uikit icons`, `uikit icons <name>` prints one SVG) and needs no kit.
