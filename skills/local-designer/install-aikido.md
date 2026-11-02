# Draw Things Skill Installation

> **Version**: 1.0.0 | **Status**: Active

## Description

Registers the `local-designer` skill, its seven commands and its two agents (agent-aikido-art-director and
agent-aikido-image-analyst, the only reader of images) in an AI-KIDO project.
Normally applied by `/skill-manage get --skill local-designer`, which copies the skill into
`prompts/hard_points/system/local-designer/` and then follows this file.

## Prerequisites

- macOS with the Draw Things app (API Server enabled: HTTP, port 7860) for any generation
- Node.js 18+ (no npm dependency); `cwebp` for WebP and thumbnails; ImageMagick or `sips` for image analysis
- The skill in `prompts/hard_points/system/local-designer/`

Browsing, `recommend`, `brief` and `moodboard build` without `--trial` work without Draw Things.

## Files to Update

### 1. `skills_list.md`

```markdown
- **local-designer** – Drive Draw Things (macOS) locally or remotely: render styles, agent-aikido-art-director and agent-aikido-image-analyst agents (every image is read by one pinned vision model), client brief and mood board with a validation lock, sweeps, parameter knowledge base. – [`prompts/hard_points/system/local-designer/SKILL.md`](prompts/hard_points/system/local-designer/SKILL.md)
```

### 2. `commands_list.md`

```markdown
- **aikido-init-design**: Create the project design charter in prompts/gen/concepts/design/ ([`aikido-init-design.md`](prompts/hard_points/system/local-designer/commands/aikido-init-design.md))
- **aikido-design-charter**: Read, check, update and annotate the design charter; generate under its identity ([`aikido-design-charter.md`](prompts/hard_points/system/local-designer/commands/aikido-design-charter.md))
- **aikido-design-audit**: Check images against the design charter palette ([`aikido-design-audit.md`](prompts/hard_points/system/local-designer/commands/aikido-design-audit.md))
- **aikido-design-brief**: Write and validate the structured client brief ([`aikido-design-brief.md`](prompts/hard_points/system/local-designer/commands/aikido-design-brief.md))
- **aikido-design-moodboard**: Build the client mood board and record the client's decision ([`aikido-design-moodboard.md`](prompts/hard_points/system/local-designer/commands/aikido-design-moodboard.md))
- **aikido-design-render**: Generate images: draft, sweep, final behind the validation lock ([`aikido-design-render.md`](prompts/hard_points/system/local-designer/commands/aikido-design-render.md))
- **aikido-design-style**: Choose, compare, compose and create render styles ([`aikido-design-style.md`](prompts/hard_points/system/local-designer/commands/aikido-design-style.md))
```

### 3. `agents_list.md`

```markdown
| 🎨 **agent-aikido-art-director** | [agent-aikido-art-director.md](prompts/hard_points/system/local-designer/agents/agent-aikido-art-director.md) | Senior illustrator: turns a brief, an image or a project into a validated render style and images |
| 👁️ **agent-aikido-image-analyst** | [agent-aikido-image-analyst.md](prompts/hard_points/system/local-designer/agents/agent-aikido-image-analyst.md) | The only reader of images: asks ONE pinned vision-language model (`vision ask` / `vision review`), local server, no fallback |
```

### 4. `.roo/commands/` and `.claude/commands/`

One mapping file per command (`aikido-init-design`, `aikido-design-charter`, `aikido-design-audit`, `aikido-design-brief`, `aikido-design-moodboard`, `aikido-design-render`, `aikido-design-style`). Example for
`aikido-design-moodboard.md`:

```markdown
---
description: "Build the client mood board and record the client's decision"
---

# Command aikido-design-moodboard

This command runs the complete definition at `prompts/hard_points/system/local-designer/commands/aikido-design-moodboard.md`.

**EXECUTION**: Read and follow the complete command definition.
```

### 5. `.claude/agents/agent-aikido-art-director.md`

```markdown
---
name: agent-aikido-art-director
description: Senior illustrator and art director. Chooses a visual language before generating: client brief, mood board validated by the client, Draw Things render styles, drafts and final images.
tools: Bash, Read, Write, Grep
model: inherit
---

# Art director

Follow `prompts/hard_points/system/local-designer/agents/agent-aikido-art-director.md`.

Use when: an image, a visual identity, a mood board or an illustration is requested.
Do not use when: no image is needed or Draw Things is unavailable and the task is not about choosing a style.
Never generate a final image for a client before a mood board direction is validated.
```

### 5b. `.claude/agents/agent-aikido-image-analyst.md`

```markdown
---
name: agent-aikido-image-analyst
description: Image analyst. The only agent that reads an image: it asks the one vision-language model pinned for the project, so every analysis goes through the same model. Use for any judgement on the pixels of an image (defects, text, pose, likeness, comparison).
tools: Bash, Read
model: inherit
---

# Image analyst

Follow `prompts/hard_points/system/local-designer/agents/agent-aikido-image-analyst.md`.

Use when: an image has to be checked, described or compared (a render, a trial, a reference, a crop).
Do not use when: only colour measures are needed (`analyze`), or no image is involved.
Never read an image yourself or with another model: if no vision model is pinned (`vision status`), say so and ask the user to pin one. Never run `vision pin` yourself.
```

### 6. `.roomodes` (Roo / Zoo)

```yaml
  - slug: agent-aikido-art-director
    switchable: true
    name: 🎨 Art Director (Draw Things)
    roleDefinition: |-
      Senior illustrator and art director for Draw Things.
      Full specification: prompts/hard_points/system/local-designer/agents/agent-aikido-art-director.md
      Method: brief, client mood board, validated direction, draft, tuning, final render. Checks every result before showing it.
    whenToUse: |-
      Use to create or restyle images, define a visual direction, build a client mood board or tune Draw Things parameters.
      Do not use for text-only tasks or when no image is wanted.
    groups:
      - read
      - edit
      - command
  - slug: agent-aikido-image-analyst
    switchable: true
    name: 👁️ Image Analyst (pinned vision model)
    roleDefinition: |-
      Only reader of images for the local-designer skill. Asks the ONE vision-language model pinned in .local-designer.json.
      Full specification: prompts/hard_points/system/local-designer/agents/agent-aikido-image-analyst.md
      Method: vision status, precise question or checklist (vision ask / vision review), verdict with evidence. No fallback model.
    whenToUse: |-
      Use for any judgement on the pixels of an image: defects, text, pose, likeness to a reference, comparison of renders.
      Do not use for colour measures only (analyze) or tasks with no image.
    groups:
      - read
      - command
```

## Verification

```bash
node prompts/hard_points/system/local-designer/scripts/local-designer.mjs styles validate
node prompts/hard_points/system/local-designer/scripts/local-designer.mjs recommend --brief "technical diagram for a proposal"
node prompts/hard_points/system/local-designer/scripts/local-designer.mjs vision status
ls .claude/commands/aikido-design-*.md .claude/agents/agent-aikido-art-director.md .claude/agents/agent-aikido-image-analyst.md
grep "local-designer" skills_list.md
```

## Data and privacy

- Briefs, mood boards, trials and sweeps are written to `~/local-designer-lab/` (outside git). The CLI refuses an
  output folder inside a git repository unless `--allow-in-repo` is given.
- Nothing is sent over the network unless `--url` or `DRAWTHING_URL` points to a remote Draw Things.
- `vision` sends images only to the vision server pinned in `.local-designer.json` (default `http://127.0.0.1:1234/v1`). A server
  outside this machine is refused unless `--allow-remote` is given after the user agreed. Commit `.local-designer.json`: it holds
  the model id and a URL, no secret.
- Own styles: `~/.local-designer/styles`, or a project folder listed in `$LOCAL_DESIGNER_STYLES`.

## Uninstall

`/skill-manage uninstall --skill local-designer` removes the folder and the command mappings it finds. Also remove the
`agents_list.md` lines, `.claude/agents/agent-aikido-art-director.md`, `.claude/agents/agent-aikido-image-analyst.md` and the two `.roomodes` entries.
The `vision` key of `.local-designer.json` is project data: keep or remove it as the user decides.
