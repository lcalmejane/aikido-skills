---
name: drawthing
description: Generate images locally with the Draw Things macOS app through its HTTP API (txt2img, reuse a prompt from an existing image, WebP export), with the AI-KIDO website visual style.
---

# Draw Things – AI-KIDO Skill

## Description
Drives the **Draw Things** app (macOS) from the command line so an agent can create
illustrations, banners and backgrounds without leaving the project. Generation runs
entirely on the user's machine through the app's local HTTP API (A1111-compatible
`/sdapi/v1/*` endpoints). Nothing is sent to a cloud service.

Typical uses: page header backgrounds, social share images, section illustrations,
regenerating an existing image with new settings.

## Metadata
- **Name**: drawthing
- **Version**: 1.0.0
- **Author**: AI-KIDO Team
- **Category**: generation
- **Requires**: macOS, Draw Things with the API server enabled, Node.js 18+, `cwebp` (optional, WebP export)

## Prerequisite (user action, once per session)
In Draw Things, open the advanced settings, enable **API Server**, protocol **HTTP**,
port **7860**. Keep the app open with a model loaded. Check it with:

```bash
node skills/drawthing/scripts/drawthing.mjs status
```

If it fails, the JSON error explains what to enable. Do not try other ports blindly:
the app also opens an unrelated internal port that does not answer HTTP.

## Instructions
1. Run `status`. Note the loaded model and the settings the app currently uses.
2. Write the prompt (see [`references/style-aikido.md`](references/style-aikido.md) for the
   website style and prompt template). State where the text will sit so the artwork keeps
   that area dark and low-detail. Always end with the "no text, no letters, no logo" constraints.
3. Choose a size that is a **multiple of 64** (for example 1664×832 for a 2:1 banner,
   1728×960 for 16:9). Generation time grows with the area (about 5 minutes at 1664×832
   with the Qwen Image model).
4. Do a cheap test first when the prompt is new: `--width 512 --height 256 --steps 8`.
5. Run the real generation. It blocks until the image is ready, so start it in the
   background and poll when your tool has a time limit:

   ```bash
   node skills/drawthing/scripts/drawthing.mjs generate \
     --prompt-file prompt.txt --out aikido-web/assets/images/generated/H5.png \
     --width 1664 --height 832 --seed 20261031 --webp --sidecar
   ```
6. **Look at the result** (open the PNG, or ask the user for a screenshot of the page) before
   wiring it in. The model can ignore constraints (text, faces, bright centre).
7. Keep the lossless PNG next to the site's other originals and publish the `.webp`. Keep
   the seed and the prompt (`--sidecar`) so the image can be reproduced.
8. Return the JSON result below and say which file was produced.

## Commands

| Command | Purpose |
|---|---|
| `status` | Check the server and show the model and settings the app currently uses |
| `generate` | Create an image: `--out` (required, `.png`), and `--prompt`, `--prompt-file` or `--from` |
| `inspect <png>` | Print the prompt, seed, model and steps stored in a Draw Things PNG |

`generate` options: `--width`, `--height`, `--seed`, `--steps`, `--guidance`, `--sampler`, `--shift`,
`--model`, `--negative`, `--plain`, `--webp`, `--quality`, `--sidecar`, `--dry-run`, `--timeout` (seconds, default 900).

- `--from ref.png` reuses the prompt, seed, model, size, steps, guidance, sampler and shift of an
  existing Draw Things PNG. Any other flag overrides it. This is how to regenerate a site image at
  a new size, or to make a new image in the exact style of a reference (pass a new `--prompt` and
  `--seed`; the size and settings come from the reference, e.g. `--from C1.png` gives 512x512 icons).
- `--dry-run` builds the request and prints it without generating.
- `--plain` removes the app's LoRAs and ControlNets. Without it, the app's current settings are
  the base of every request, so a LoRA enabled in the app will be applied.

## Output
```json
{
  "status": "ok",
  "output": "/abs/path/H5.png",
  "webp": "/abs/path/H5.webp",
  "bytes": 1234567,
  "seconds": 288,
  "summary": { "model": "...", "width": 1664, "height": 832, "steps": 16, "guidance_scale": 4, "seed": 20261031 }
}
```
On failure: `{ "status": "error", "error": "..." }` and exit code 1.

## Known limits
- Only PNG files written by Draw Things itself carry metadata. Images produced through the API
  do not, hence `--sidecar`. WebP and JPEG copies never carry it.
- The app's data folder (`~/Library/Containers/com.liuliu.draw-things/`) is protected by macOS;
  the installed models cannot be listed from the shell. Use `status` to see the loaded one.
- One generation at a time: the app is single-threaded for diffusion.
- The request format follows the A1111 convention used by Draw Things. If a future app version
  changes it, run `status` and compare with the keys it returns.

## Resources (level 3)
- [`scripts/drawthing.mjs`](scripts/drawthing.mjs): the client (no dependency).
- [`references/style-aikido.md`](references/style-aikido.md): palette, prompt template, parameters used for the website.

## Available commands

None. The skill is driven through the script above.
