---
name: aikido-init-design
description: Create the project's design charter (palette, typography, render style, constraints) in the project's design target (design/ or prompts/gen/concepts/design/)
category: local-designer
---

# Command: /aikido-init-design

## Description

Builds `prompts/gen/concepts/design/design-charter.md`: the visual identity of the project, read later by anyone
(human or agent) who generates an image. It is written from what already exists: a validated mood board
direction, a client brief, and/or a scan of the project (README, style sheets, logos).

A charter is a **draft** until a render style is validated by a named person. Only an **active** charter unlocks
`generate --charter`. The charter holds text and hex colours only: no image and no absolute path, so it can be
committed. Mood boards and renders stay in `~/local-designer-lab` (outside git).

## Usage

```
/aikido-init-design                          scan the project, create a draft
/aikido-init-design --brief brief.json       start from a client brief
/aikido-init-design --moodboard <dir>        start from the direction the client validated: creates an active charter
/aikido-init-design --force                  rebuild an existing charter (revision +1, decision log kept)
```

## Prerequisites

- An AI-KIDO project (`prompts/gen/` exists). Outside one, pass `--root <project>` or `--dir <folder>`.
- `<skill-dir>` is the folder holding `SKILL.md`. No image engine is needed: this command never generates an image.

## Behavior

1. **Look first**: if `prompts/gen/concepts/design/design-charter.md` exists, run `charter show` and ask whether to
   update it (`/aikido-design-charter`) or rebuild it (`--force`). Never overwrite silently.
2. **Choose the sources** with the user, in this order of trust:
   a. a **validated mood board**: `node <skill-dir>/scripts/local-designer.mjs charter init --moodboard <dir> --by "<who>"`
      (refuses if no direction is validated: ask the client first, see `/aikido-design-moodboard`);
   b. a **brief**: `brief template`, fill it with the user, `brief check`, then `charter init --brief brief.json`;
   c. a **scan** of the project: `charter init --scan` (brand colours and fonts found in style sheets, keywords and
      suitable styles from the README and `package.json`). Heuristic: show the result and have it confirmed.
   Sources can be combined: `--brief brief.json --scan`.
3. **Dry run**: add `--dry-run` to show the charter without writing anything, then explain the palette roles
   (primary, accent, secondary, neutral) and the proposed style in plain words.
4. **Create it**: run without `--dry-run`. The folder `design/` gets an `index.md` and the parent `index.md` gets one
   line, once (`--no-index` skips this).
5. **Draft or active?** A scan or brief alone gives a draft with 3 style candidates. To activate it:
   validate a direction with the client and rerun with `--moodboard <dir> --force`, or, if the user decides directly,
   `charter activate --style NAME --by "<who>"` (the validator's name is mandatory).
6. **Check**: `charter check` must report no error. Read the warnings out loud (missing palette, missing message).
7. **Tell the user** what to do next: `generate --charter --prompt "<subject>" --out file.png`, and where the file is.
   Remind that the charter is a project file: it goes in the commit with the rest of `prompts/gen/`.

## Rules

- Never invent a palette, a font or a validator. Missing information stays empty and is reported as a warning.
- Never put a client mood board, a render or a path to one in the charter (only the mood board's folder name is kept).
- The text between the markers is generated from the JSON block: edit the JSON, then run `charter render`.
  Anything written after the end marker (section Notes) is never touched by the tools.

## Output

Path of the charter, its state (draft or active), revision, style, warnings, and the next step.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
