---
name: aikido-design-charter
description: Read, validate, update and annotate the project's design charter; generate images under its identity
category: local-designer
---

# Command: /aikido-design-charter

## Description

Day-to-day use of the design charter created by `/aikido-init-design`: see it, check it, record a decision, change the
validated style, and generate images that follow it.

## Usage

```
/aikido-design-charter show
/aikido-design-charter check
/aikido-design-charter activate --style NAME --by "<who>" [--note "..."]
/aikido-design-charter note "decision or remark" --by "<who>"
/aikido-design-charter render
/aikido-design-charter generate --prompt "<subject>" --out <file.png>
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`; every subcommand is `node <skill-dir>/scripts/local-designer.mjs charter <sub>`.

1. **show**: state (draft or active), revision, style, and whether the text and the JSON block still agree.
2. **check**: validates the palette, the style (it must exist in the library) and the validator. Fix errors before
   anything else; read the warnings to the user.
3. **activate**: changes the validated style. `--by` is mandatory and logged with the date. Tell the user that the
   change affects every later image of the project, and use `/aikido-design-audit` on recent images if they matter.
4. **note**: one line in the decision log (who, when, what). Use it for each client remark that changes the identity.
5. **render**: rewrites the readable text from the JSON block after a hand edit. Free notes below the end marker are kept.
6. **generate**: `node <skill-dir>/scripts/local-designer.mjs generate --charter --prompt "<subject>" --out file.png`.
   Refuses while the charter is a draft. Applies the charter's style, its negative prompt (style terms + forbidden
   terms) and its format ratio. `--prompt` is the subject only: the look comes from the charter. Run `status` first and
   try `--dry-run`. `--charter` and `--moodboard` are two different locks and cannot be combined.

Always say which charter revision produced an image: the result of `generate` includes it.

## Output

State and revision of the charter, what changed, and for `generate` the image path with the charter block of the result.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
