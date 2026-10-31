# AI-KIDO website visual style (Draw Things)

Settings read from the metadata of the images already published on the site
(`aikido-web/assets/images/generated/*.png`). Reuse them so new images match.

## Parameters

| Setting | Value |
|---|---|
| Model | `qwen_image_2512_bf16_i8x.ckpt` |
| Sampler | Euler A Trailing |
| Steps | 16 |
| Guidance scale | 4.0 |
| Seed mode | Scale Alike |
| Typical sizes | 1408×704 (2:1 banner), 1728×960 (16:9), both multiples of 64 |
| Duration | about 5 minutes per image on the author's Mac |

## Palette

| Role | Colour |
|---|---|
| Background | deep navy `#0f1220` |
| Planes / tiles | `#1c2140` |
| Accent 1 | luminous indigo-blue `#6c8cff` |
| Accent 2 | aqua-teal `#46e0c3` |

## Prompt template

```text
Dark tech-zen illustration, deep navy background (#0f1220) with a very subtle grid,
luminous indigo-blue (#6c8cff) and aqua-teal (#46e0c3) accents, thin glowing lines,
small nodes and connections, soft bloom glow, flat vector look with gentle gradients,
minimalist geometric shapes, hint of Japanese martial-arts / aikido aesthetics
(enso circle, flowing curves, calm balance), premium SaaS website art style, clean
negative space. <SUBJECT>. <COMPOSITION AND SAFE ZONE>.
Constraints: no text, no letters, no numbers, no logo, no watermark, no human face,
not photorealistic, no bright white background, not cluttered.
```

`<SUBJECT>`: concrete, metaphorical, no letters (for example "luminous tiles snapped
together into a harness frame").
`<COMPOSITION AND SAFE ZONE>`: say where the page text will sit, for example
"Keep the central 60 percent dark, calm and low detail for a long website headline;
place the luminous focal points on the far left and right edges; keep generous margins
for mobile crops."

## Practical rules

- Wide banners are cropped with `background-size: cover`: keep important elements inside
  the central 80 percent vertically and away from the extreme edges on mobile.
- The site puts a dark gradient veil over header images; the artwork can stay fairly
  luminous at the edges.
- Always test the prompt at `--width 512 --height 256 --steps 8` first (about a minute).
- Do not ask for text, logos or faces: the model draws garbled letters.
- Publish WebP (`cwebp -q 82`) and keep the PNG as the lossless original.
