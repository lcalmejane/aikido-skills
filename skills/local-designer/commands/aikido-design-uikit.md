---
name: aikido-design-uikit
description: Create and maintain the project's UI kit (tokens, components, icons, button and zone images) from its brand colours, with a client choice between five personalities
category: local-designer
---

# Command: /aikido-design-uikit

## Description

Builds the interface vocabulary of a project in `<design dir>/uikit/`: design tokens in light and dark mode checked for
contrast, standard components, icons, and optional WebP button skins and zone backgrounds. The client chooses a
personality on one comparison page; everything is then generated and rebuilt from `uikit.json`.

## Usage

```
/aikido-design-uikit init [--primary #hex --accent #hex] [--css site.css] [--name N] [--prefix aw]
/aikido-design-uikit decide <A-E> --by "<who>"
/aikido-design-uikit set key=value ... [--by "<who>"]
/aikido-design-uikit assets [--only hero,panel]
/aikido-design-uikit status
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`; every subcommand is `node <skill-dir>/scripts/local-designer.mjs uikit <sub>`.
Method, files and limits: [`../references/uikit.md`](../references/uikit.md).

1. **Look first**: `uikit status`. If a kit exists, do not `init` again; use `set` (or `init --force`, which keeps the decision log).
2. **Seed**: ask for nothing the project already holds. `init` takes the charter, a stylesheet or a brief on its own; pass
   `--primary` / `--accent` only to override. Tell the user which source each colour came from (`sources`).
3. **Compare**: show `variants.html` (see [`../references/preview.md`](../references/preview.md) for how to display it) and explain in one sentence
   what separates the five personalities. Wait for the answer; never choose for the client.
4. **Decide**: `uikit decide <A-E> --by "<who>"`. The name is mandatory. The kit is built and the contrast result is returned:
   report any failure, do not hide it.
5. **Adjust**: `uikit set` for colours, fonts or one parameter (`radius`, `button`, `icon_stroke`...). Each change rebuilds the kit.
6. **Images** (optional): `uikit assets`. Needs `cwebp`; without it the files are PNG and a warning is returned.
   Read the result of `status`: assets drawn for another personality are `stale`.
7. **Record**: `uikit note "<remark>" --by "<who>"` for each client remark that changes the identity.

Never edit a generated file by hand; change `uikit.json` through `set`. Commit the folder with the project.

## Output

The personality, the contrast verdict (`ok` or the failing pairs), the files written, and the `next` step returned by the tool.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
