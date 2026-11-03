---
name: aikido-design-render
description: Generate images with Draw Things (local or remote): drafts, tuning sweeps and the final render behind the validation lock
category: local-designer
---

# Command: /aikido-design-render

## Description

Drives Draw Things through its HTTP API. For a client project the final render only runs once a mood board
direction is validated; for a personal or exploratory image it can run with a chosen style.

## Usage

```
/aikido-design-render status [--url http://host:7860]
/aikido-design-render draft  --subject "..." [--style name] [--moodboard <dir>]
/aikido-design-render sweep  --subject "..." --styles a,b,c [--seeds 1,2] [--vary guidance=3,5]
/aikido-design-render final  --moodboard <dir> --out <file.png> | --style name --prompt "..." --out <file.png>
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`. Read `references/parameters.md` before changing a parameter.

1. **status**: `node <skill-dir>/scripts/local-designer.mjs status`. Note the model and `where`. Remote or cloud: read
   `references/local-and-cloud.md` and get the user's agreement first.
2. **draft**: always `--dry-run` first, then small (`--width 512 --height 512 --steps 8`).
3. **sweep**: one subject and one seed across styles, then one parameter at a time (`--vary`). Results go to
   `~/local-designer-lab/` (outside git) with an `index.html` contact sheet. Give the user its path and wait for the choice.
4. **final**: `generate --moodboard <dir> --out final.png` refuses until a direction is validated; it then applies
   that direction's style, the brief's subject and format, and adds the forbidden terms to the negative prompt.
   Use `--sidecar` to keep prompt and seed; `--webp` for publication.
5. **Read the result** with the `agent-aikido-image-analyst` method (text, hands, faces, edges) and say what is wrong before the user
   sees it. The reader is chosen silently: the project's local vision model if set, otherwise the current model
   ([`../references/vision.md`](../references/vision.md)). Do not announce or test it.

Nothing is written into a git project until the user has validated the image.

## Output

JSON with `output`, `seed`, `seconds`, and the sidecar path; a one-line verdict on the image.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
