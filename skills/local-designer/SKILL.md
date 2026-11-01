---
name: local-designer
description: Local image design for agents: art direction, client brief and mood board with a validation lock before generation, 29 reusable render styles with thumbnails, style recommendation from a brief, an image or a project folder, sweeps with a contact sheet kept outside git, and a parameter knowledge base. Generation goes through a connector; two are available for Draw Things (macOS app): the HTTP API and gRPC, which lists the server's real models and reaches a local, remote or offload server.
---

# Local Designer Skill

## Description
An art director for agents: choose a visual language, validate it with the client, then create and tune
images with the user (drafts, final art, style exploration, parameter tuning). The skill holds the
**tools** (`scripts/`), 29 render presets with thumbnails (`styles/`), an art-director agent (`agents/`),
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
- **Version**: 4.3.0
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
| `moodboard build --brief f.json` | Build the client mood board (`moodboard.html`, `board.json`, `decision.json`) **outside git**; `--trial` adds small renders of the real subject |
| `moodboard decide <dir> --track A --state validated` | Record the client's answer (`selected`, `rejected`, `validated`, `--comment`, `--by`) |
| `moodboard trial|status|html <dir>` | Render trials (`--track A,B --size 512 --steps 8 --resume`), show the state, rebuild the page |
| `generate --moodboard <dir>` | **Lock**: refuses to run until a direction is validated, then uses its style, the brief subject, format and forbidden list |
| `charter init\|show\|check\|render\|activate\|note` | Project design charter stored in the Memory Bank (`prompts/gen/concepts/design/design-charter.md`) |
| `charter audit <image\|folder>...` | Compare the dominant colours of images with the charter palette (verdict per image + summary) |
| `generate --charter --prompt "subject"` | **Lock**: refuses to run until the charter is active, then uses its style, negative prompt and format ratio |

### Design charter (the project's identity, kept in the Memory Bank)
A mood board is for one client proposal and stays outside git. The charter is the **durable result**: palette with roles,
typography, validated render style, forbidden terms, constraints and a dated decision log, in
`prompts/gen/concepts/design/design-charter.md` (text and hex colours only: no image, no absolute path, safe to commit).
1. `charter init` from a validated mood board (`--moodboard <dir>`), a brief (`--brief f.json`) and/or a project scan (`--scan`).
   Brief or scan alone give a **draft** (3 style candidates); a validated direction gives an **active** charter.
2. `charter activate --style NAME --by "<who>"` validates a style directly. The validator's name is mandatory.
3. `generate --charter --prompt "<subject>" --out f.png`: only once active. `--charter` and `--moodboard` are two different locks.
4. `charter note "..." --by who` logs a client remark; `charter audit <images>` measures colour drift against the palette.
5. The JSON block between the markers is the source of truth; `charter render` rewrites the text from it. Notes written
   after the end marker are never touched. Run from the project, or pass `--root <project>` / `--dir <folder>`.
Commands: `/init-design`, `/design-charter`, `/design-audit`.

### Mood board (validate a direction with the client before generating)
1. `brief template`, fill it (message, audience, uses, subject, format ratio, realism, brand palette and forbidden terms), `brief check`.
2. `moodboard build --brief brief.json [--styles a,b,c] [--count 3] [--trial]`: directions A, B, C taken from different families, each with
   reference thumbnail, palette (brand colours first), keywords, do / avoid, risks, sample subject (and a trial render with `--trial`).
3. Send `moodboard.html` (one file, images embedded, no script, no link) to the client and wait for the answer.
4. `moodboard decide <dir> --track B --state validated --by "Name"`: one validated direction at a time; the page is rebuilt with the state and comments.
5. `generate --moodboard <dir> --out final.png`: only now. History is kept in `decision.json`.
The folder defaults to `~/local-designer-lab/<date>-moodboard-<project>` and the CLI refuses a folder inside a git repository.

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
- `/init-design` – Create the project design charter (palette, typography, render style) in `prompts/gen/concepts/design/`
- `/design-charter` – Read, check, update and annotate the charter; generate images under its identity
- `/design-audit` – Check images or a folder against the charter palette and report the drift
- `/design-brief` – Write and validate the structured client brief (questions, project scan, `brief check`)
- `/design-moodboard` – Build the client mood board (3 directions, optional real-subject trials) and record the client's decision
- `/design-render` – Generate images: draft, tuning sweeps, final render behind the validation lock
- `/design-style` – Choose, compare, compose and create render styles (recommend, analyze, match, compose, thumbs)

Definitions: [`commands/`](commands/). Agent: [`agents/art-director.md`](agents/art-director.md).
Install into an AI-KIDO project: [`install-aikido.md`](install-aikido.md) (or `/skill-manage get --skill local-designer`).

## Instructions
1. Run `status`. Note the model and `where` (local/remote). If not local, follow `references/local-and-cloud.md`.
2. **Choose the look first.** Read [`references/art-direction.md`](references/art-direction.md) or load the
   [`art-director`](agents/art-director.md) agent. From a brief: `recommend`; from an image: `analyze` / `match`; from a
   project: `project-scan`. For a client project, build a **mood board** (section above) and wait for the validated
   direction; otherwise show the user 3 styles with their thumbnails (`styles/thumbs/`) and wait for a choice.
3. Read [`references/parameters.md`](references/parameters.md) before changing parameters, and
   [`references/prompting-and-styles.md`](references/prompting-and-styles.md) to write the prompt.
4. Always **dry-run or draft first**: `--dry-run`, then `--width 512 --height 512 --steps 8`.
5. To explore looks with the user: `sweep --styles a,b,c` on one subject and one seed, give the user the path of
   `index.html`, and **wait for their choice** before spending time on finals. Then vary one parameter at a time
   (`--vary`). Do not write into the git project: validation images stay in `~/local-designer-lab`.
6. Final generation: blocks until done; start it in the background when your tool has a time limit and poll the output.
7. **Look at the result** before using it. Models ignore constraints (text, hands, faces).
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
- `analyze`, `match` and `recommend` are heuristics (64x64 measurements, keyword scoring): they support a choice, they do not replace looking at the image.
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
- [`styles/`](styles/): JSON render presets, thumbnails in `styles/thumbs/`, illustrated gallery in [`styles/README.md`](styles/README.md).
- [`agents/art-director.md`](agents/art-director.md): senior illustrator / art director agent.
- [`references/art-direction.md`](references/art-direction.md): method, 4 entry points, medium by use, prompt checklist.
- [`references/parameters.md`](references/parameters.md): every setting, ranges, failure modes.
- [`references/prompting-and-styles.md`](references/prompting-and-styles.md): prompt anatomy, style table, tuning method.
- [`references/local-and-cloud.md`](references/local-and-cloud.md): local, network, cloud/offload and privacy rules.
- [`references/connectors.md`](references/connectors.md): connector contract, engine selection, how to add one (ComfyUI).
- [`references/grpc.md`](references/grpc.md): the gRPC connector, certificates, shared secret, compressed images, licensing.
