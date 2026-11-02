---
name: design-moodboard
description: Build the client mood board (3 visual directions) and record the client's decision before any final image
category: local-designer
---

# Command: /design-moodboard

## Description

Builds `moodboard.html`, a single file for the client (images embedded, no script, no external link) with three
directions taken from different style families, then records which one is validated. Final generation stays locked
until a direction is validated.

## Usage

```
/design-moodboard build  <brief.json> [--trial] [--styles a,b,c]
/design-moodboard decide <dir> <track> <selected|rejected|validated> [--comment "..."] [--by "Name"]
/design-moodboard status <dir>
```

## Behavior

`<skill-dir>` is the folder holding `SKILL.md`.

1. **build**: `node <skill-dir>/scripts/local-designer.mjs moodboard build --brief <brief.json> [--trial]`.
   `--trial` renders small images (512 px, 8 steps) of the real subject: it needs Draw Things running
   (`status` first, local unless the user agreed otherwise) and takes about 40 seconds per direction.
2. **Check the trials yourself** (wrong object, text, odd faces) and state the problems before sending the page.
3. Send `moodboard.html` to the client. Wait for the answer; never choose for the client.
4. **decide**: `node <skill-dir>/scripts/local-designer.mjs moodboard decide <dir> --track B --state validated --by "Name"`.
   One validated direction at a time; the page is rebuilt with state and comments, history stays in `decision.json`.
5. **status**: `moodboard status <dir>` shows each direction's state and what blocks generation.

The folder defaults to `~/local-designer-lab/<date>-moodboard-<project>`. The CLI refuses a folder inside a git
repository: a client mood board is never committed.

## Output

Path of `moodboard.html`, state of each direction, and whether `/design-render` is unlocked.

## Agent

`art-director` ([`../agents/art-director.md`](../agents/art-director.md)).
