# Draw Things parameters reference

Keys marked **(observed)** come from `GET /sdapi/v1/options` on the installed app
(`local-designer.mjs status --full`). Everything else is general diffusion knowledge:
check it against your model before relying on it. Values depend heavily on the model family.

## How a request is built

The script sends **only the keys you override**. Every other setting comes from what is currently
configured in the Draw Things app. So: the app's current model, LoRAs, sampler and so on apply
unless you pass `--plain` (removes LoRAs and ControlNets) or an explicit option.
Sending the whole `GET /options` snapshot back is rejected by the server (`hires_fix_width: 0`,
`tea_cache_end: -1`), hence the "overrides only" design.

Use `--set key=value` (repeatable, value parsed as JSON) for any key without a dedicated flag.

## Core parameters

| Option / key | Role | Practical guidance |
|---|---|---|
| `--model` / `model` **(observed)** | Checkpoint file name as shown in the app (`xxx.ckpt`) | Must already be downloaded in the app; the HTTP API cannot download or list models |
| `--width`, `--height` | Output size | Multiples of 64, 256..4096 enforced by the script. The script also sets `original_*` and `target_*` so they stay consistent |
| `--steps` / `steps` **(observed)** | Denoising iterations | Test 8, final 20-30. Distilled / "turbo" / "lightning" models need 4-8 and low guidance |
| `--guidance` / `guidance_scale` **(observed)** | Prompt adherence (CFG) | SD 1.5/SDXL 5-8; Flux and other guidance-distilled models ~1-4 (the value is then ignored or replaced by `guidance_embed`); Qwen Image 4 |
| `--sampler` / `sampler` **(observed)** | Solver | e.g. `Euler A Trailing`, `DPM++ 2M Karras`, `UniPC`. Use the exact name displayed in the app. Trailing / "Uniform" variants suit few-step models |
| `--shift` / `shift` **(observed)** | Noise schedule shift for flow models (Flux, Qwen, SD3...) | Higher = more global structure first. Leave the app default unless the model card says otherwise. `resolution_dependent_shift` **(observed)** auto-adapts it to the size |
| `--seed` / `seed` **(observed)** | Reproducibility | Same prompt + settings + seed = same image. Keep it in the sidecar |
| `--seed-mode` / `seed_mode` **(observed)** | How noise is derived (`Legacy`, `Torch CPU Compatible`, `Scale Alike`, `NVIDIA GPU Compatible`) | `Scale Alike` keeps the composition when you change the size, handy for draft-then-final |
| `--negative` / `negative_prompt` **(observed)** | What to avoid | Ignored or weak on guidance-distilled models (Flux). Useful on SD/SDXL. Styles ship a sensible one |
| `--clip-skip` / `clip_skip` **(observed)** | CLIP layers skipped | SD 1.5 anime-type models often use 2; leave at 1 otherwise |

## img2img

`--init in.png --strength 0.6` switches to `/sdapi/v1/img2img`.

| strength | Effect |
|---|---|
| 0.2-0.4 | Light retouch, same composition and colours |
| 0.5-0.7 | Restyle while keeping the layout (good default: 0.6-0.7) |
| 0.8-1.0 | Almost a new image, only a loose hint of the source |

The script reuses the init image size when it is a multiple of 64; otherwise pass `--width/--height`.
`strength` also exists in the app settings **(observed: `strength`)** and is 1 for txt2img.

## LoRAs

`--lora file.ckpt:0.6` (repeatable). The file name is the one the app shows for the LoRA, and the LoRA
must be installed in the app and compatible with the loaded base model (SD1.5 LoRA on SDXL fails or is ignored).
Weights: 0.5-0.8 for style LoRAs, 0.8-1.0 for character/concept LoRAs; lower when it overpowers the prompt.
Without `--plain`, LoRAs enabled in the app also apply. The exact request shape is
`{"file": "...", "weight": 0.6}` in the `loras` array **(observed: `loras` is an array)**; if a future
app version changes it, use `--set 'loras=[{"file":"x.ckpt","weight":0.6}]'`.

## Performance and memory keys (all observed)

| Key | Notes |
|---|---|
| `tiled_decoding`, `decoding_tile_width/height/overlap` | Decode the latent by tiles: lowers memory peaks at large sizes |
| `tiled_diffusion`, `diffusion_tile_*` | Tiled denoising for very large images (can show seams) |
| `tea_cache`, `tea_cache_threshold`, `tea_cache_start/end`, `tea_cache_max_skip_steps` | Step-skipping cache that speeds up some models at a small quality cost |
| `speed_up_with_guidance_embed` | Faster inference for guidance-distilled models |
| `hires_fix`, `hires_fix_width/height/strength` | Two-pass generation (small first, then upscale and refine). **Gotcha:** leave `hires_fix_width/height` out unless enabling it: a 0 value is rejected |
| `upscaler`, `upscaler_scale` | Post-upscale model name from the app |
| `sharpness`, `aesthetic_score`, `negative_aesthetic_score` | SDXL-refiner style conditioning |
| `refiner_model`, `refiner_start` | Switch to a refiner model after this fraction of steps |
| `cfg_zero_star`, `cfg_zero_init_steps` | CFG variants for some flow models |
| `fps`, `num_frames`, `motion_scale` | Video models only |

## Time budget (measured on one Apple Silicon Mac, Qwen Image 2512)

About 3 minutes for 512x512 at 24 steps, about 8 minutes for 1664x832. Time grows with the pixel count
and linearly with steps. Always draft small (`--width 512 --height 512 --steps 8`) before a final run.

## Failure modes

| Symptom | Cause / fix |
|---|---|
| `API server not reachable` | Enable API Server (HTTP, port 7860) in the app; keep the app open with a model loaded |
| `HTTP 400/500 ... hires_fix_width` | A zero or negative value was sent for a size/tea-cache key; send fewer keys |
| Timeout | A generation sends nothing until finished: raise `--timeout` (seconds) |
| Image ignores a LoRA | Wrong base model family, wrong file name, or weight too low |
| Garbled text in the picture | Models draw letters poorly: ask for none and add the text afterwards in layout |
