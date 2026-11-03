---
name: local-designer
description: Local image design for agents: art direction, client brief and mood board with a validation lock before generation, a UI kit (design tokens in light and dark, standard components, icons, button and zone images) with five personalities to choose from, 29 reusable render styles with thumbnails, style recommendation from a brief, an image or a project folder, sweeps with a contact sheet kept outside git, and a parameter knowledge base. Generation goes through a connector; two are available for Draw Things (macOS app): the HTTP API and gRPC, which lists the server's real models and reaches a local, remote or offload server.
---

# Local Designer Skill

## Description
An art director for agents: choose a visual language, validate it with the client, then create and tune
images with the user (drafts, final art, style exploration, parameter tuning). The skill holds the
**tools** (`scripts/`), 29 render presets with thumbnails (`styles/`), two agents (`agents/`): agent-aikido-art-director and
agent-aikido-image-analyst (the method that reads images: the project's optional local vision model, otherwise the current model, silently),
four `/design-*` commands (`commands/`) and the **knowledge** on parameters and looks (`references/`).

## Connectors
Image generation is done by a connector, the engine installed on the machine. Each one is a module in
`scripts/connectors/` that follows one contract, so the tool never talks to an engine directly.

| Connector | Id | Status | Notes |
|---|---|---|---|
| **Draw Things** (macOS app, A1111-compatible HTTP API `/sdapi/v1/*`) | `drawthing` | Available, tested locally | `DRAWTHING_URL` / `--url` select the server. Model names must be copied from the app |
| **Draw Things gRPC** (same app, server offload) | `drawthing-grpc` | Available, tested on a real server | `--grpc host:port` (default `127.0.0.1:7859`). Lists the server's models and LoRA, shows progress, TLS with fingerprint. Prefer it when enabled: [`references/grpc.md`](references/grpc.md) |
| ComfyUI | `comfyui` | Not written | Needs a workflow template tied to the user's install: see [`references/connectors.md`](references/connectors.md) |

Pick one with `--connector <id>` or `LOCAL_DESIGNER_CONNECTOR`; otherwise the first one that answers is used.
`connectors` lists them. Brief, mood board, styles, analysis and the validation lock do not depend on the
engine and run without one. A flag the chosen engine does not support is an error, never silently ignored.
The contract and how to add a connector are in [`references/connectors.md`](references/connectors.md).

## Metadata
- **Name**: local-designer
- **Version**: 5.3.0
- **Category**: generation
- **Requires**: Node.js 18+, `cwebp` (WebP export, thumbnails), ImageMagick or `sips` (image analysis). For generation with the Draw Things connector: macOS and the app with its API server enabled

## Prerequisite (user action, once per session)
In Draw Things, open the advanced settings, enable **API Server**, protocol **gRPC** (port **7859**, recommended)
or **HTTP** (port **7860**). Keep the app open. Then:

```bash
node scripts/local-designer.mjs status          # model and settings in use, local/remote
node scripts/local-designer.mjs status --full   # every setting the app exposes
```
All `node scripts/...` examples run from the skill folder (`<skill-dir>`: where this `SKILL.md` lives, e.g.
`prompts/hard_points/system/local-designer/` once installed). From elsewhere, use `node <skill-dir>/scripts/local-designer.mjs`.

Remote machine or cloud: `--url http://host:7860` or `DRAWTHING_URL`. Read
[`references/local-and-cloud.md`](references/local-and-cloud.md) first: only local mode is verified, and
anything that leaves the machine needs the user's agreement.

## Commands

| Command | Purpose |
|---|---|
| `status [--full]` | Check the engine, show the connector used, its current model/settings and whether the target is local or remote |
| `connectors` | List the registered engines, what each supports and which one answers |
| `migrate [--dry-run]` | Move data kept under the former name (`~/drawthing-lab`, `~/.drawthing`) to `~/local-designer-lab`, `~/.local-designer` and fix the paths inside |
| `generate` | Create one image (`--out` required, `.png`) |
| `sweep` | Create many images (styles x seeds x parameter values) in a folder **outside git** with an `index.html` contact sheet |
| `inspect <png>` | Print the prompt, seed, model, steps stored in a PNG by any registered engine |
| `styles ...` | Browse and manage render styles (see below) |
| `recommend --brief "..."` | Rank styles for a need written in French or English |
| `analyze <image>` | Measure palette, light, contrast, flatness of an image and describe it |
| `match <image>` | Library styles whose thumbnail is closest to an image |
| `project-scan [dir]` | Infer subject, brand palette, fonts and suitable styles from a project folder (read only) |
| `brief template` / `brief check <file>` | Structured client brief (JSON): print the template, validate a file |
| `moodboard build --brief f.json` | Build the client mood board (`moodboard.html`, `board.json`, `decision.json`) in the design target (`<design dir>/moodboards/<date>-<project>/`); `--trial` adds small renders of each scene |
| `moodboard decide <dir> --track A --state validated` | Record the client's answer (`selected`, `rejected`, `validated`, `--comment`, `--by`) |
| `moodboard trial|status|html <dir>` | Render trials, one per direction and per scene (`--track A,B --scene hero,detail --size 640 --steps 8 --resume`, saved as webp), show the state, rebuild the page |
| `generate --moodboard <dir>` | **Lock**: refuses to run until a direction is validated, then uses its style, the brief subject, format and forbidden list |
| `charter init\|show\|check\|render\|activate\|note` | Project design charter, stored in the design target (`<design dir>/design-charter.md`) |
| `charter audit <image\|folder>...` | Compare the dominant colours of images with the charter palette (verdict per image + summary) |
| `generate --charter --prompt "subject"` | **Lock**: refuses to run until the charter is active, then uses its style, negative prompt and format ratio |
| `character check\|grid\|measure\|plan\|audit` | Character model sheet (proportions in head units): plan drawn from the sheet as the `--init` image, then `audit` answers `on-model` or `off-model` per zone. Method and tested values: `references/character-design.md` section 5 |
| `uikit init\|variants\|decide\|set\|build\|check\|icons\|assets\|status\|note` | **UI kit** of the project in `<design dir>/uikit/`: tokens, components, icons, WebP button skins and zone backgrounds. Five personalities compared on one page, one chosen with `decide --by`. No image engine needed. See "UI kit" below and [`references/uikit.md`](references/uikit.md) |
| `vision status\|models\|pin\|checks\|ask\|review` | **Optional local reader of images.** A vision-language model set in `.local-designer.json` (`vision`), local server only (OpenAI-compatible: LM Studio, Ollama, llama.cpp...). Without it the current model reads the images itself, silently. `checks` prints the checklist of a brief for any reader, `ask` answers a question about 1-4 images, `review` answers a checklist per image (`ok`, `to-check`, `fail`). Used through `agent-aikido-image-analyst`: [`references/vision.md`](references/vision.md) |

### Design target (where the design of a project lives)
One folder holds everything: `design-charter.md`, `styles/` (the project's own styles, they override the bundled ones),
`moodboards/<date>-<project>/` and `uikit/`. It is found, in this order: `--design-dir <dir>`, `LOCAL_DESIGNER_DESIGN_DIR`, the `design_dir`
key of the nearest `.local-designer.json` above the current folder (relative to that file), then none (former layout below).
```json
{ "design_dir": "design" }
```
Everything in it is versioned with the project, so **no absolute path is ever written** and renders are webp (about 20-50 KB each).
Without a target, the former layout applies: charter in `prompts/gen/concepts/design/`, mood boards in `~/local-designer-lab`,
and the CLI refuses a mood board folder inside a git repository (a client brief is not project source). Inside the target it is allowed.

### Design charter (the project's identity)
A mood board is one proposal to the client. The charter is the **durable result**: palette with roles,
typography, validated render style, forbidden terms, constraints and a dated decision log, in
`<design dir>/design-charter.md` (text and hex colours only: no image, no absolute path, safe to commit).
1. `charter init` from a validated mood board (`--moodboard <dir>`), a brief (`--brief f.json`) and/or a project scan (`--scan`).
   Brief or scan alone give a **draft** (3 style candidates); a validated direction gives an **active** charter.
2. `charter activate --style NAME --by "<who>"` validates a style directly. The validator's name is mandatory.
3. `generate --charter --prompt "<subject>" --out f.png`: only once active. `--charter` and `--moodboard` are two different locks.
4. `charter note "..." --by who` logs a client remark; `charter audit <images>` measures colour drift against the palette.
5. The JSON block between the markers is the source of truth; `charter render` rewrites the text from it. Notes written
   after the end marker are never touched. Run from the project (target found by `.local-designer.json`), or pass
   `--design-dir <folder>`, `--root <project>` (former layout) or `--dir <folder>`.
Commands: `/aikido-init-design`, `/aikido-design-charter`, `/aikido-design-audit`.

### UI kit (the project's interface vocabulary)
`uikit init` takes the brand colours from options, a stylesheet (`--css`), the charter or a brief, then writes `uikit.json` and
`variants.html`: **five personalities** (Doux, Net, Relief, Dense, Éditorial) with the same colours, to compare. `uikit decide <A-E> --by "<who>"`
keeps one and builds `tokens.css` / `tokens.json` (light and dark), `components.css`, `tokens.vscode.css` (`--vscode-*` first), `icons.svg`
and `showcase.html`. Every pair of colours is pulled to 4.5:1 (3:1 for non-text), hover and pressed fills included. `uikit set key=value`
adjusts and rebuilds; `uikit assets` adds WebP button skins and zone backgrounds drawn by the skill itself. Only `uikit.json` is edited,
everything else is generated. Command: `/aikido-design-uikit`. Details: [`references/uikit.md`](references/uikit.md).

### Mood board (validate a direction with the client before generating)
A direction is shown **in situation**, not as one picture: the same scenes rendered in each style, so the client compares like with like.
1. `brief template`, fill it: message, audience, **positioning** (one sentence), uses, format, realism, brand palette / fonts / forbidden terms,
   **textures**, and 3-4 **`scenes`** (`id`, `label`, `subject`, `ratio`: home hero, close detail, section, mood). Without `scenes`, three
   framings of `subject` are used. Then `brief check`.
2. `moodboard build --brief brief.json [--styles a,b,c] [--count 3] [--trial]`: directions A, B, C taken from different families. Each board
   has the scenes, the palette **with roles**, a typography proposal, textures, keywords, **what it says and what it rules out** (the looks of the
   other directions plus the brand's forbidden list), do / avoid, risks and a small **page preview** built from its colours and font.
   `--trial` renders every scene (3 directions x 4 scenes = 12 renders, about 7 minutes locally), as webp.
   Trials are small (8 steps): they show the **spirit**, not the detail, and a scene's precise instructions are often not followed
   (wrong object, missing item). Look at each one, say what is off, and re-run `moodboard trial <dir> --track B --scene geste` before sending.
3. Show `moodboard.html` (one file, images embedded, no script, no link) to the client and wait for the answer. The page has an Auto / Light / Dark switch at the top (radio buttons and CSS only, so it still works by e-mail): it changes the page and the page mock-ups, never the generated images. Judge a direction in both versions before validating it. Preview in this order
   ([`references/preview.md`](references/preview.md)): 1) the agent CLI / LLM host itself, if it can display HTML or images; 2) the IDE built-in
   browser (VS Code and forks), served on `127.0.0.1` if `file://` is refused; 3) only then an external browser (`open`, `xdg-open`, `start`).
4. `moodboard decide <dir> --track B --state validated --by "Name"`: one validated direction at a time; the page is rebuilt with the state and comments.
5. `generate --moodboard <dir> --out final.png`: only now. History is kept in `decision.json`.
The folder defaults to `<design dir>/moodboards/<date>-<project>` (or `~/local-designer-lab/<date>-moodboard-<project>` without a target).
An existing board with decisions is never overwritten: pick another `--out-dir` (for example `...-v2`) or pass `--force`.

### `styles` subcommands
| Subcommand | Purpose |
|---|---|
| `styles` / `styles list [--category c] [--tag t]` | List styles with category, description and thumbnail path |
| `styles show <name>` (or `styles <name>`) | Template, negative prompt, default params |
| `styles compose a b [--name n] [--note "..."] [--save]` | New style: `a` gives structure and params, the others the look |
| `styles draft <image> [--name n] [--save]` | Draft a style from an image (palette, light, nearest styles) |
| `styles save --file f.json [--dir D]` | Validate and store a style (default `~/.local-designer/styles`) |
| `styles thumb [name...] [--all] [--resume]` | Render each style's own `thumb_subject` (seed 42, 768x512, 16 steps) outside git and store a 384x256 WebP in `styles/thumbs/` |
| `styles index` | Regenerate `styles/README.md`, the illustrated gallery |
| `styles validate` | Check every style and list the ones without thumbnail |

Style folders (later overrides earlier): bundled `styles/`, `~/.local-designer/styles`, then each folder of `$LOCAL_DESIGNER_STYLES`
(colon separated: use it for a project's own styles, kept in that project).

### Style format
`name`, `description`, `category` (photo, vector, cartoon, drawing, technical, editorial, painting, 3d, craft, stylized),
`tags`, `use_cases`, `look` (one phrase, used when composing), `template` (must contain `{subject}`), `negative`,
`params` (`steps`, `guidance`, `sampler`, `shift`), `thumb_subject`, optional `notes`, `composed_of`.

### `generate` options
- Prompt: `--prompt`, `--prompt-file`, or `--from ref.png` (reuses prompt, seed, model, size, steps, guidance, sampler, shift of a Draw Things PNG; other flags override).
- Style: `--style name` (the prompt becomes the **subject** inserted in the style template; the style's negative prompt and default params apply unless overridden).
- Image: `--width`, `--height` (multiples of 64), `--seed`, `--steps`, `--guidance`, `--sampler`, `--shift`, `--seed-mode`, `--clip-skip`, `--model`, `--negative`.
- img2img: `--init in.png --strength 0.6`.
- LoRA: `--lora file.ckpt:0.6` (repeatable). `--plain` removes the app's LoRAs and ControlNets.
- Any other app setting: `--set key=value` (repeatable, value parsed as JSON, e.g. `--set tiled_decoding=true`).
- Output: `--webp [--quality 82]`, `--sidecar` (writes `.json` with prompt and settings), `--dry-run` (prints the exact request), `--timeout` (seconds, default 900).

### `sweep` options
`--subject "..."` (required), `--styles a,b` or `--styles all`, `--seeds 1,2,3`, `--vary key=v1,v2` (repeatable, cartesian
product, e.g. `--vary guidance=3,5 --vary steps=12,24`), `--out-dir DIR` (default `~/local-designer-lab/<date>-<subject>`),
`--resume`, `--dry-run`, plus any `generate` option as a common setting (`--width`, `--steps`, `--model`, `--lora`...).
It refuses an `--out-dir` inside a git repository unless `--allow-in-repo` is given. Progress goes to stderr; a failed
image does not stop the sweep.

## Available Commands
- `/aikido-init-design` – Create the project design charter (palette, typography, render style) in `prompts/gen/concepts/design/`
- `/aikido-design-charter` – Read, check, update and annotate the charter; generate images under its identity
- `/aikido-design-audit` – Check images or a folder against the charter palette and report the drift
- `/aikido-design-uikit` – Create and maintain the UI kit (tokens, components, icons, button and zone images) from the brand colours
- `/aikido-design-brief` – Write and validate the structured client brief (questions, project scan, `brief check`)
- `/aikido-design-moodboard` – Build the client mood board (3 directions, optional real-subject trials) and record the client's decision
- `/aikido-design-render` – Generate images: draft, tuning sweeps, final render behind the validation lock
- `/aikido-design-style` – Choose, compare, compose and create render styles (recommend, analyze, match, compose, thumbs)

Definitions: [`commands/`](commands/). Agents: [`agents/agent-aikido-art-director.md`](agents/agent-aikido-art-director.md) (chooses and
validates a visual language) and [`agents/agent-aikido-image-analyst.md`](agents/agent-aikido-image-analyst.md) (reads every image: optional local vision model, otherwise the current model, silently).
Install into an AI-KIDO project: [`install-aikido.md`](install-aikido.md) (or `/skill-manage get --skill local-designer`).

## Instructions
1. Run `status`. Note the model and `where` (local/remote). If not local, follow `references/local-and-cloud.md`.
2. **Choose the look first.** Read [`references/art-direction.md`](references/art-direction.md) or load the
   [`agent-aikido-art-director`](agents/agent-aikido-art-director.md) agent. From a brief: `recommend`; from an image: `analyze` / `match`; from a
   project: `project-scan`. For a client project, build a **mood board** (section above) and wait for the validated
   direction; otherwise show the user 3 styles with their thumbnails (`styles/thumbs/`) and wait for a choice.
3. Read [`references/parameters.md`](references/parameters.md) before changing parameters, and
   [`references/prompting-and-styles.md`](references/prompting-and-styles.md) to write the prompt.
4. Always **dry-run or draft first**: `--dry-run`, then `--width 512 --height 512 --steps 8`.
5. To explore looks with the user: `sweep --styles a,b,c` on one subject and one seed, give the user the path of
   `index.html`, and **wait for their choice** before spending time on finals. Then vary one parameter at a time
   (`--vary`). Do not write into the git project: validation images stay in `~/local-designer-lab`.
6. Final generation: blocks until done; start it in the background when your tool has a time limit and poll the output.
7. **Read the result** before using it, with the [`agent-aikido-image-analyst`](agents/agent-aikido-image-analyst.md) method. Models ignore
   constraints (text, hands, faces). **The reader is chosen silently** ([`references/vision.md`](references/vision.md)): the project's optional local
   vision model if one is set, otherwise the current model when it can see images. Do not announce it, test it before each use or ask the user about it.
8. Keep the seed and prompt (`--sidecar`) so an image can be reproduced; publish WebP, keep PNG as original.
9. Return the JSON result and name the produced files.

## Examples

```bash
# which style for this need?
node scripts/local-designer.mjs recommend --brief "proposition commerciale IT, schéma d'architecture cloud"
node scripts/local-designer.mjs project-scan ../my-project

# one image in a render style
node scripts/local-designer.mjs generate --style corporate-workplace --prompt "three colleagues reviewing a roadmap" \
  --out ~/local-designer-lab/team.png --width 1024 --height 768 --seed 7 --sidecar

# restyle an existing picture
node scripts/local-designer.mjs generate --style sumi-e --prompt "mount fuji" \
  --init photo.png --strength 0.65 --out ~/local-designer-lab/fuji.png

# measure an image, find close styles, draft a style from it
node scripts/local-designer.mjs analyze reference.png
node scripts/local-designer.mjs match reference.png
node scripts/local-designer.mjs styles draft reference.png --name my-look --save

# blend two looks, render its thumbnail
node scripts/local-designer.mjs styles compose flat-vector watercolor --name soft-vector --save
node scripts/local-designer.mjs styles thumb soft-vector

# compare styles, then tune guidance and steps on the favourite
node scripts/local-designer.mjs sweep --subject "a lone lighthouse at dawn" --styles cinematic,watercolor,flat-vector --seeds 42 --width 768 --height 512 --steps 16
node scripts/local-designer.mjs sweep --subject "a lone lighthouse at dawn" --styles cinematic --seeds 42 --vary guidance=3,4,6 --vary steps=16,28
```

## Output
```json
{ "status": "ok", "output": "/abs/x.png", "webp": "/abs/x.webp", "sidecar": "/abs/x.json", "bytes": 1234567, "seconds": 288,
  "summary": { "model": "...", "width": 1024, "height": 768, "steps": 24, "guidance_scale": 4, "seed": 7 } }
```
`sweep` returns `{ "status": "ok", "out_dir", "index", "images", "failed", "seconds" }`.
On failure: `{ "status": "error", "error": "..." }` and exit code 1.

## Known limits
- Only PNG files written by Draw Things itself carry metadata. API images do not, hence `--sidecar`.
- Two connectors are written and tested, both for Draw Things. The contract is covered by tests with a stand-in
  engine, which proves another engine can plug in; it does not prove ComfyUI works, since none has been written.
- Former names are still read as a fallback (`~/.drawthing/styles`, `DRAWTHING_STYLES`), at lower priority; `migrate` removes the need.
- The app's data folder (`~/Library/Containers/com.liuliu.draw-things/`) is protected by macOS; the HTTP API has no
  endpoint to list models, samplers or LoRAs. Use the gRPC connector to get the server's real lists, or the exact
  names shown in the app.
- One generation at a time; a sweep runs sequentially (minutes per image at full size, about 2 to 3 minutes at 768x512 with a large model).
- `analyze`, `match` and `recommend` are heuristics (64x64 measurements, keyword scoring): they support a choice, they do not look at the image: reading does.
- Any reader (local model or current model) misses defects and invents some (hands, small text, counting, left/right);
  `ok` means "nothing was found". Verdicts over time are comparable only from the same reader. A local model is optional; tested here against a stand-in
  server, a real one must be tried on images with a known answer before it is pinned ([`references/vision.md`](references/vision.md)).
- ControlNet, inpainting masks and video are exposed by the app but have no dedicated flag here: use `--set`
  and verify with `--dry-run`. Not tested.
- Cloud/offload through the HTTP API is unverified (see `references/local-and-cloud.md`). Through gRPC, a server
  you run yourself is verified (FLUX Schnell, 512 px); Draw Things Cloud Compute (paid, own authentication) is not.

## Resources (level 3)
- [`scripts/local-designer.mjs`](scripts/local-designer.mjs): the CLI (no dependency).
- [`scripts/connectors/index.mjs`](scripts/connectors/index.mjs): connector contract, registry and selection.
- [`scripts/connectors/drawthing.mjs`](scripts/connectors/drawthing.mjs): the Draw Things connector (HTTP API, payload, PNG metadata).
- [`scripts/connectors/drawthing-grpc/`](scripts/connectors/drawthing-grpc/): the gRPC connector (protobuf, FlatBuffers config, tensors, fpzip decoder, TLS transport).
- [`scripts/png.mjs`](scripts/png.mjs): PNG helpers shared by the tool and the connectors.
- [`scripts/migrate.mjs`](scripts/migrate.mjs): move data kept under the former name.
- [`scripts/styles-lib.mjs`](scripts/styles-lib.mjs): load, validate, compose, recommend, gallery.
- [`scripts/design-tools.mjs`](scripts/design-tools.mjs): image analysis, matching, project scan.
- [`scripts/moodboard-lib.mjs`](scripts/moodboard-lib.mjs): brief schema and validation, direction building.
- [`scripts/moodboard-html.mjs`](scripts/moodboard-html.mjs): self-contained client page (fr / en).
- [`scripts/moodboard-state.mjs`](scripts/moodboard-state.mjs): `decision.json`, history, generation lock.
- [`scripts/uikit-cli.mjs`](scripts/uikit-cli.mjs): the `uikit` subcommands; [`uikit-lib.mjs`](scripts/uikit-lib.mjs) (personalities, tokens, contrast check), [`uikit-color.mjs`](scripts/uikit-color.mjs), [`uikit-css.mjs`](scripts/uikit-css.mjs), [`uikit-icons.mjs`](scripts/uikit-icons.mjs), [`uikit-html.mjs`](scripts/uikit-html.mjs), [`uikit-raster.mjs`](scripts/uikit-raster.mjs) and [`uikit-assets.mjs`](scripts/uikit-assets.mjs) (pure JavaScript drawing of the images).
- [`styles/`](styles/): JSON render presets, thumbnails in `styles/thumbs/`, illustrated gallery in [`styles/README.md`](styles/README.md).
- [`agents/agent-aikido-art-director.md`](agents/agent-aikido-art-director.md): senior illustrator / art director agent.
- [`agents/agent-aikido-image-analyst.md`](agents/agent-aikido-image-analyst.md): reads every image, silently: optional local model, otherwise the current model.
- [`scripts/vision-lib.mjs`](scripts/vision-lib.mjs): optional local model, local-only rule, OpenAI-compatible client, review checklist.
- [`references/uikit.md`](references/uikit.md): UI kit cycle, files, accessibility, images, use in a page, limits.
- [`references/vision.md`](references/vision.md): who reads, setting a local model, `checks` / `ask` / `review`, choosing a model, privacy.
- [`references/art-direction.md`](references/art-direction.md): method, 4 entry points, medium by use, prompt checklist.
- [`references/character-design.md`](references/character-design.md): mascot / character consistency: measured proportions in head units, joints, limb order, character sheet.
- [`references/parameters.md`](references/parameters.md): every setting, ranges, failure modes.
- [`references/prompting-and-styles.md`](references/prompting-and-styles.md): prompt anatomy, style table, tuning method.
- [`references/local-and-cloud.md`](references/local-and-cloud.md): local, network, cloud/offload and privacy rules.
- [`references/connectors.md`](references/connectors.md): connector contract, engine selection, how to add one (ComfyUI).
- [`references/grpc.md`](references/grpc.md): the gRPC connector, certificates, shared secret, compressed images, licensing.
