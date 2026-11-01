# Draw Things Skill Installation

> **Version**: 1.0.0 | **Status**: Active

## Description

Registers the `local-designer` skill, its four commands and its art-director agent in an AI-KIDO project.
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
- **local-designer** – Drive Draw Things (macOS) locally or remotely: render styles, art-director agent, client brief and mood board with a validation lock, sweeps, parameter knowledge base. – [`prompts/hard_points/system/local-designer/SKILL.md`](prompts/hard_points/system/local-designer/SKILL.md)
```

### 2. `commands_list.md`

```markdown
- **init-design**: Create the project design charter in prompts/gen/concepts/design/ ([`init-design.md`](prompts/hard_points/system/local-designer/commands/init-design.md))
- **design-charter**: Read, check, update and annotate the design charter; generate under its identity ([`design-charter.md`](prompts/hard_points/system/local-designer/commands/design-charter.md))
- **design-audit**: Check images against the design charter palette ([`design-audit.md`](prompts/hard_points/system/local-designer/commands/design-audit.md))
- **design-brief**: Write and validate the structured client brief ([`design-brief.md`](prompts/hard_points/system/local-designer/commands/design-brief.md))
- **design-moodboard**: Build the client mood board and record the client's decision ([`design-moodboard.md`](prompts/hard_points/system/local-designer/commands/design-moodboard.md))
- **design-render**: Generate images: draft, sweep, final behind the validation lock ([`design-render.md`](prompts/hard_points/system/local-designer/commands/design-render.md))
- **design-style**: Choose, compare, compose and create render styles ([`design-style.md`](prompts/hard_points/system/local-designer/commands/design-style.md))
```

### 3. `agents_list.md`

```markdown
| 🎨 **agent-aikido-art-director** | [art-director.md](prompts/hard_points/system/local-designer/agents/art-director.md) | Senior illustrator: turns a brief, an image or a project into a validated render style and images |
```

### 4. `.roo/commands/` and `.claude/commands/`

One mapping file per command (`init-design`, `design-charter`, `design-audit`, `design-brief`, `design-moodboard`, `design-render`, `design-style`). Example for
`design-moodboard.md`:

```markdown
---
description: "Build the client mood board and record the client's decision"
---

# Command design-moodboard

This command runs the complete definition at `prompts/hard_points/system/local-designer/commands/design-moodboard.md`.

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

Follow `prompts/hard_points/system/local-designer/agents/art-director.md`.

Use when: an image, a visual identity, a mood board or an illustration is requested.
Do not use when: no image is needed or Draw Things is unavailable and the task is not about choosing a style.
Never generate a final image for a client before a mood board direction is validated.
```

### 6. `.roomodes` (Roo / Zoo)

```yaml
  - slug: agent-aikido-art-director
    switchable: true
    name: 🎨 Art Director (Draw Things)
    roleDefinition: |-
      Senior illustrator and art director for Draw Things.
      Full specification: prompts/hard_points/system/local-designer/agents/art-director.md
      Method: brief, client mood board, validated direction, draft, tuning, final render. Checks every result before showing it.
    whenToUse: |-
      Use to create or restyle images, define a visual direction, build a client mood board or tune Draw Things parameters.
      Do not use for text-only tasks or when no image is wanted.
    groups:
      - read
      - edit
      - command
```

## Verification

```bash
node prompts/hard_points/system/local-designer/scripts/local-designer.mjs styles validate
node prompts/hard_points/system/local-designer/scripts/local-designer.mjs recommend --brief "technical diagram for a proposal"
ls .claude/commands/design-*.md .claude/agents/agent-aikido-art-director.md
grep "local-designer" skills_list.md
```

## Data and privacy

- Briefs, mood boards, trials and sweeps are written to `~/local-designer-lab/` (outside git). The CLI refuses an
  output folder inside a git repository unless `--allow-in-repo` is given.
- Nothing is sent over the network unless `--url` or `DRAWTHING_URL` points to a remote Draw Things.
- Own styles: `~/.local-designer/styles`, or a project folder listed in `$LOCAL_DESIGNER_STYLES`.

## Uninstall

`/skill-manage uninstall --skill local-designer` removes the folder and the command mappings it finds. Also remove the
`agents_list.md` line, `.claude/agents/agent-aikido-art-director.md` and the `.roomodes` entry.
