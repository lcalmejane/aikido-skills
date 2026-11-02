---
name: aikido-design-audit
description: Check images or a folder of images against the design charter palette and report the drift
category: local-designer
---

# Command: /aikido-design-audit

## Description

Measures the dominant colours of one or more images and compares them with the brand palette of the design
charter. It tells which brand colours are present, which are missing and which strong colours are not in the
brand. No image engine is needed, nothing is sent anywhere, nothing is modified.

## Usage

```
/aikido-design-audit <image|folder>...
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`.

1. Run `node <skill-dir>/scripts/local-designer.mjs charter audit <image|folder>...` from the project (or add `--root <project>`).
   A folder is read for `.png`, `.webp`, `.jpg`; a file that cannot be read is reported, not fatal.
2. Read the `summary` and the verdict of each image:
   - `on-brand`: the primary and accent colours are there and no other strong colour competes;
   - `partial`: some brand colours are close but not exact, or one is missing;
   - `off-brand`: the brand colours are absent, or another strong colour dominates;
   - `no-palette`: the charter has no palette to compare with (run `/aikido-design-charter check`).
3. **Have the image read by `agent-aikido-image-analyst`** (`vision review <image>...`, or `vision ask` for one question). The measure is made
   on a 64x64 sample of dominant colours: it flags a drift worth a look, it does not judge composition, subject or taste. A pale or dark image
   can fail on colour while being right. The analyst uses the one vision model pinned for the project ([`../references/vision.md`](../references/vision.md)).
4. For an `off-brand` image, give the user one concrete cause (which colour dominates instead) and one fix: a stronger
   palette wording in the prompt, a different seed, or `--set` / a style change through `/aikido-design-charter activate`.
   Do not regenerate without the user's agreement.

## Output

The summary (counts per verdict), then for each image its verdict, score, missing brand colours and off-brand colours.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
