---
name: aikido-design-moodboard
description: Build the client mood board (3 visual directions) and record the client's decision before any final image
category: local-designer
---

# Command: /aikido-design-moodboard

## Description

Builds `moodboard.html`, a single file for the client (images embedded, no script, no external link) with three
directions taken from different style families, each shown in several situations (scenes), with its palette and roles,
typography, textures, what it says and rules out, and a page preview. Then records which one is validated. Final
generation stays locked until a direction is validated.

## Usage

```
/aikido-design-moodboard build  <brief.json> [--trial] [--styles a,b,c] [--design-dir <dir>]
/aikido-design-moodboard decide <dir> <track> <selected|rejected|validated> [--comment "..."] [--by "Name"]
/aikido-design-moodboard status <dir>
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`.

1. **build**: `node <skill-dir>/scripts/local-designer.mjs moodboard build --brief <brief.json> [--trial]`.
   The brief should carry `positioning`, `textures` and 3-4 `scenes` (home hero, detail, section, mood).
   `--trial` renders every scene of every direction (640 px, 8 steps, webp): it needs Draw Things running
   (`status` first, local unless the user agreed otherwise) and takes about 35 seconds per image (12 renders is about 7 minutes).
2. **Read every trial** with the `agent-aikido-image-analyst` method (checklist of the brief, `vision checks --brief <brief.json>`; with a local model set,
   `vision review <dir>/trials/*.webp --brief <brief.json>`: wrong object, missing item, text, odd hands or faces) and state the problems before
   sending the page. The reader is chosen silently: the project's local model if set, otherwise the current model
   ([`../references/vision.md`](../references/vision.md)). Do not announce or test it.
   Trials show the spirit, not the detail: a scene's precise instructions are often not followed. Redo a bad one with
   `moodboard trial <dir> --track B --scene geste`, or tell the client plainly.
3. Show `moodboard.html` to the client, choosing the preview in this order ([`../references/preview.md`](../references/preview.md)):
   1) the agent CLI / LLM host, if it can display or render HTML (or at least the trial images);
   2) the IDE built-in browser (VS Code and forks), serving the folder on `127.0.0.1` when `file://` is refused;
   3) an external browser (`open` / `xdg-open` / `start`) only when neither is available.
   Say which one you used. Wait for the answer; never choose for the client.
4. **decide**: `node <skill-dir>/scripts/local-designer.mjs moodboard decide <dir> --track B --state validated --by "Name"`.
   One validated direction at a time; the page is rebuilt with state and comments, history stays in `decision.json`.
   Refresh the same preview view after each rebuild.
5. **status**: `moodboard status <dir>` shows each direction's state and what blocks generation.

The folder defaults to `<design dir>/moodboards/<date>-<project>` when the project has a design target
(`.local-designer.json`, `LOCAL_DESIGNER_DESIGN_DIR` or `--design-dir`), so the board is versioned with the charter.
Without a target it goes to `~/local-designer-lab`, and the CLI refuses a folder inside a git repository.
An existing board with decisions is not overwritten: use another `--out-dir` or `--force`.

## Output

Path of `moodboard.html`, state of each direction, and whether `/aikido-design-render` is unlocked.

## Agent

`agent-aikido-art-director` ([`../agents/agent-aikido-art-director.md`](../agents/agent-aikido-art-director.md)).
