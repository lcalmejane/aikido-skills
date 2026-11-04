# Prompting and render styles

## Prompt anatomy

`<medium/style> of <subject>. <composition>. <lighting>. <palette>. <material/detail>.`

- Put the **subject first**, concrete and visual ("a lone lighthouse on a cliff at dawn"), then style words.
- One idea per prompt. A long list of unrelated adjectives dilutes everything.
- Describe what you want, not what you do not want. Use `--negative` for the rest (weak on Flux-like models).
- Text-to-image models draw letters badly: ask for no text and add text in layout tools.
- Modern models (Qwen Image, Flux, SD3) understand full sentences; SD 1.5/SDXL like comma-separated tags.
- Weights such as `(word:1.3)` only work on SD-family models.
- Colours: use names ("navy blue, coral, warm grey"), the model ignores hex codes.
- Generic humans: [people and casting](people-and-casting.md) requires distinct
  faces, positions and actions, with varied casting adapted to the audience.
  Write these details into the prompt; "diverse team" alone is not enough.

## Render styles (presets in `styles/*.json`)

A style = a prompt template with a `{subject}` placeholder + a negative prompt + default params + metadata
(`category`, `tags`, `use_cases`, `look`, `thumb_subject`).
`generate --style watercolor --prompt "a red fox"` inserts the subject in the template.

The illustrated catalogue is [`../styles/README.md`](../styles/README.md) (thumbnails in `styles/thumbs/`).
From the command line: `styles list --category vector`, `styles show <name>`, `recommend --brief "..."`.

| Category | Styles | Typical use |
|---|---|---|
| photo | `photo-realistic`, `cinematic`, `corporate-portrait`, `corporate-workplace`, `product-studio`, `corporate-architecture` | Credible photography, hero images, team and product pages |
| vector | `flat-vector`, `corporate-memphis`, `isometric-flat`, `infographic-flat`, `icon-flat`, `gradient-abstract` | Slides, SaaS, onboarding, icons, backgrounds |
| cartoon | `cartoon-clean`, `cartoon-comic` | Proposals, explainers, storytelling |
| drawing | `line-art`, `sketch-marker`, `doodle-whiteboard` | Concepts, workshops, light illustration |
| technical | `technical-blueprint`, `exploded-view`, `isometric-line` | Manuals, engineering, infrastructure schemas |
| painting | `watercolor`, `sumi-e`, `oil-painting` | Mood, art, calm content |
| editorial | `riso-duotone` | Posters, section openers |
| 3d | `isometric-3d` | Concepts, miniature scenes |
| craft | `paper-cut` | Posters, packaging |
| stylized | `anime`, `pixel-art`, `neon-cyberpunk` | Games, sci-fi, youth content |

Known weak points: hands and small text (photo), complex scenes (flat vector), colour requests (sumi-e),
realism (isometric 3D, paper-cut), fine detail at small sizes (pixel art), text and numbers everywhere.

## Create your own style

Quickest way: `styles compose a b --name my-look --save` (blend two) or `styles draft image.png --name my-look --save`
(from an image), then `styles thumb my-look` to see it. By hand, add `<name>.json` to `~/.local-designer/styles/` or to a
project folder listed in `$LOCAL_DESIGNER_STYLES`:

```json
{
  "name": "my-style",
  "description": "one line",
  "category": "vector",
  "tags": ["flat", "tech"],
  "use_cases": ["slide illustration"],
  "look": "short phrase describing the look, reused when composing",
  "template": "A <medium> of {subject}. <lighting>. <palette>. <detail>.",
  "negative": "things to avoid",
  "params": { "steps": 24, "guidance": 4, "sampler": "Euler A Trailing" },
  "thumb_subject": "a subject that shows the style well"
}
```

`styles validate` checks every style. `params` are defaults; any CLI flag overrides them. A brand/project style
(fixed palette, mood) belongs in the project that owns it, not in this generic skill: keep it there and point
`LOCAL_DESIGNER_STYLES` at that folder.

## Method to tune a style with someone (two-person loop)

1. **Fix the subject** and a seed: `sweep --subject "..." --styles a,b,c --seeds 42 --width 768 --height 512 --steps 16`.
   Output goes to `~/local-designer-lab/...` (outside git) with an `index.html` contact sheet.
2. The user picks the 2-3 best styles.
3. **Vary one thing at a time** on the chosen style:
   - `--vary guidance=3,4,6` (adherence), `--vary steps=12,24,36` (detail), `--vary shift=2,4.7,7`;
   - `--seeds 1,2,3,4` (composition luck).
4. Re-run the winner at final size and steps, then edit the style JSON with the validated values.
5. Only then copy final images into a project (git) - the lab folder is never committed.

## Consistency tips

- Same seed + changed wording = similar composition: good to compare styles.
- `--from ref.png` re-uses the prompt and settings stored in a Draw Things PNG.
- `--init ref.png --strength 0.6` restyles an existing image without losing its layout.
- For a set of images with one look: same style, same model, same steps/guidance, different subject and seed.
- A reference image gives the palette and light: `analyze ref.png`, then name 2-4 of its colours in the prompt.
