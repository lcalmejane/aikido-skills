---
name: design-style
description: Choose, compare, compose and create Draw Things render styles from a need, an image or a project
category: local-designer
---

# Command: /design-style

## Description

Works on the 29 bundled render styles (photo, vector, cartoon, drawing, technical, painting...) and on the user's own.
Use it to pick a look, to build a new one from an image, or to blend two existing ones.

## Usage

```
/design-style recommend "<need in French or English>"
/design-style list [--category c] [--tag t]
/design-style show <name>
/design-style from-image <image> [--save --name n]
/design-style compose <a> <b> [--name n --save]
/design-style thumb <name>
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`; the CLI is `node <skill-dir>/scripts/local-designer.mjs`.

1. **recommend** → `recommend --brief "<need>"` ranks styles; show the top three with their thumbnails (`styles/thumbs/`).
2. **list / show** → `styles list`, `styles show <name>`: template, negative prompt, default parameters.
3. **from-image** → `analyze <image>`, `match <image>`, then `styles draft <image> --name n --save` (palette, light, nearest styles).
4. **compose** → `styles compose a b --name n --save`: `a` gives structure and parameters, the others the look.
5. **thumb** → `styles thumb <name>` renders the style's own thumbnail outside git (Draw Things required).
6. Personal styles live in `~/.local-designer/styles`; a project's own styles in a folder listed in `$LOCAL_DESIGNER_STYLES`.

`recommend`, `analyze` and `match` are heuristics: they support a choice, the user decides by looking at the thumbnails.

## Output

A short list (name, category, why it fits) or the path of the saved style file.

## Agent

`art-director` ([`../agents/art-director.md`](../agents/art-director.md)).
