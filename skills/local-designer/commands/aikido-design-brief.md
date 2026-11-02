---
name: aikido-design-brief
description: Write and validate the structured client brief (JSON) that frames every Draw Things image
category: local-designer
---

# Command: /aikido-design-brief

## Description

Produces `brief.json`, the contract between the client and the art director: message, audience, uses, concrete
subject, format, realism level, brand palette and forbidden terms. No image is generated here.

## Usage

```
/aikido-design-brief [project folder | free description]
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md` (installed: `prompts/hard_points/system/local-designer/`).

1. **Entry point** (see `references/art-direction.md`):
   - a project folder → `node <skill-dir>/scripts/local-designer.mjs project-scan <dir>` (read-only), then confirm with the user what was inferred
   - a written need → `node <skill-dir>/scripts/local-designer.mjs recommend --brief "<text>"`
   - nothing yet → ask the brief questions, 3 at a time (message, audience, uses, format, brand, realism)
2. `node <skill-dir>/scripts/local-designer.mjs brief template` → fill it with the answers.
   `subject`: one concrete idea. `brand.palette`: hex colours. `brand.forbidden`: what must never appear.
3. `node <skill-dir>/scripts/local-designer.mjs brief check <file>` until it reports no error.
4. Save the file **outside git** (default `~/local-designer-lab/<date>-<project>/brief.json`): it holds client data.

## Output

Path of the validated `brief.json` and a three-line summary (message, audience, subject).
Next step: `/aikido-design-moodboard`.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
