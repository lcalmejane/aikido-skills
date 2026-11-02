# Character design: proportions, joints, limbs

For a mascot or any character that must look the same in every image. A word like "chibi", "cute" or "small" gives
the model no measure: it draws a different body each time. Numbers, an order of description and a reference image do.

## 1. Measure the reference, do not estimate

If the user gives a reference image, measure it before writing anything. Looking at it and writing "the head is half
of the height" is the usual mistake: on the Kido reference the measured head was 28 percent, not 50.

1. Open the image at its real size. Crop and enlarge three zones (head, torso with arms, legs with feet) and have the image analyst read each
   one (`vision ask zone.png --prompt "..."`, one precise question per zone: [`vision.md`](vision.md)). The measures below stay yours; the reading of the pixels is not.
2. Overlay a grid every 32 px (a PNG helper is in `scripts/png.mjs`: `decodePng`, `encodePng`) and read the rows on the image.
3. Take the head height as the unit. Write down, in head units:
   - total height (for example 3.5 heads);
   - head height as a percent of the total, and head width against head height;
   - chin to waist, waist to hem of the trousers or skirt, feet;
   - width of the widest garment, shoulders, forearm, hand;
   - where the arms end (hip, thigh, knee).
4. Precision is about 5 percent on a flat image and worse with perspective. Say so; do not write three decimals.
5. Sample colours on flat areas only, away from highlights. Warm light shifts every value: keep the **role**
   (pearl-white dome, cream cloth, black joints), not the raw hex, and never put hex codes in a prompt (the model ignores them).

## 2. Write the proportions into the prompt, first

Put one `PROPORTIONS:` sentence at the start of the fixed block, in numbers:

> the whole body is 3.5 heads tall; the head is about 28 percent of the full height and slightly wider than tall; from the chin to the belt is 0.7 head; ...

Rules that worked in tests (Qwen Image 2512, Draw Things):

- **Numbers beat adjectives.** "3.5 heads tall" is followed; "chibi" and "small" are not.
- **Order of description matters.** Describe each limb from the root to the tip (shoulder, elbow, forearm, wrist, hand).
  Without the order, the forearm and the hand merge into one oversized mitten.
- **Name every joint and its material** ("glossy black metal plates stacked in rings with small round silver bolts, at the
  shoulders, elbows, wrists and ankles"). A joint left unnamed is invented, and differently each time.
- **Pick words for the real material, because the model takes words literally.** "Ribbed" produced knitted cotton cuffs and
  "mitten-like" produced rounded blob hands on a robot meant to be mechanical. Say "stacked metal plates, silver bolts" and
  "rigid palm with three separate capsule-shaped fingers". Put the wrong material in the negative prompt ("fabric cuffs,
  knitted cuffs, mittens, rounded blob hands").
- **Give a size for the hand and the foot relative to something else** ("a hand about half the size of the forearm block").
- **No negation in the fixed block.** "No antenna" draws an antenna. Describe what is there ("a clean bare sphere on top").
  Put the unwanted things in the negative prompt, and only on engines that read it (Qwen yes, FLUX schnell no).
- **Face is described once.** If the block describes a face, "seen from behind" is overruled and the character turns round.
  For a back view or a profile, replace only the face sentence and keep the rest of the block, proportions included.
- **Close-ups come from cropping.** Asking for a close-up makes the model enlarge the head and keep the body small, or fall back to a full body.
  Generate the front view and crop the head 1:1 (no enlargement, no img2img): nothing is reinterpreted.
- **Generate at the final size, small and square.** Do not render large to shrink afterwards, nor small to enlarge: the render
  changes at every resize and mechanical detail (bolts, fingers) is lost. 512 x 512 is enough for a sheet and is 3 to 4 times faster than 1024.

## 3. Build a character sheet

A sheet is the proof that the block holds. Generate, with the same seed and the same block:
`front`, `three-quarter`, `side`, `back`, `face` (cropped from front), then two or three scene poses. Each image keeps its `.json` sidecar (exact prompt and parameters).

Then **crop and compare** hands, elbows and feet with the same zones of the reference. An overall look is not a check: in tests it let
cotton cuffs and rounded hands pass as "metal joints" and "mechanical hands". Redo what is wrong; change the block only if several images fail the same way.

## 4. Check each generation

| Check | Failure seen in tests |
|---|---|
| Head size against body | Head too large after a "close-up" request |
| Eyes | Rings instead of solid discs; red or green instead of the defined colour |
| Top of the head | Antenna or horns invented from a negation in the prompt |
| Joints | Cloth or knit instead of metal; grey, smooth or missing |
| Forearm and hand | Forearm and hand merged; rounded hands instead of mechanical; wrong finger count (4 or 5 instead of 3) |
| Pose asked | A bow drawn as a squat facing the camera |
| Feet and ankles | Shoes without the defined cuff or strap |
| Back or profile view | The character still faces the camera |

## 5. Model sheet: draw the body, then generate on it

Text alone gives a different body each time (tested: the same block gave a figure 1.63 heads wide at the shoulders on one
view and 2.0 on another). The standard of animation studios is a **model sheet**: the character drawn once with measured
proportions, in a fixed unit (the head), that every later image is checked against. This skill does the same in three steps.

**The sheet** (`model-sheet.json`) lists simple shapes (`ellipse`, `rrect`, `capsule`) placed in head units: `cx`, `cy`
from the axis and the top of the head, `w`, `h` in heads, `mirror: true` for left/right pairs. A part has no `view` = front and
back; `view: "side"` = profile only; `view: "all"` = every view. Set `background` to a mid tone (white parts on a white
background cannot be measured). `zones` may be given; by default: head, shoulders-arms, trousers, feet (feet are reported, not counted:
white shoes on a light background and the cast shadow make their width unreliable).

**The human process** (do not skip it, the numbers come from a person looking):

1. `character grid <reference.png> --step 32` writes the reference with a numbered grid. Read it: top of the head, bottom of the visor,
   belt, hem, sole, and the widest point of the head, the trousers and the forearms.
2. Write those pixels in a `landmarks.json` and run `character measure`: it gives every landmark in head units.
3. Write or adjust `model-sheet.json` from those numbers. Run `character plan <sheet> --out plan.png [--view side] [--guides]`,
   open the plan next to the reference and correct the sheet until the silhouette matches. Repeat: this is the sketch-and-correct loop of
   a designer, and the plan is cheap (no engine needed).
4. `character check` must return no error. Keep the reference images in the project: they win over any written description.

**Generation**: `generate --init plan-<view>.png --strength 0.75 --width 512 --height 512 --seed N` with the same prompt block for every view.
The engine accepts one input image: the plan, which fixes the silhouette of the wanted view. Strength is the only knob that matters:

| Strength | Result (tested, 512 x 512) |
|---|---|
| 0.55 | Stays a flat drawing, too close to the plan |
| 0.75 | A real 3D render that keeps the plan silhouette; thin joints, thick forearm blocks |
| 0.9 and more | Not tested; expect the plan to be lost |

In the prompt, say how thin the joints are ("a narrow black band about the width of a finger with one tiny silver bolt"): "stacked rings"
produced thick tyre-like joints. For a back view or a profile, write the view first and say what is absent on a back ("plain smooth dome, no visor, no eyes").
An unfinished prompt lets the model add an eye on a back view.

**Audit** every image: `character audit <sheet> <image.png> --view front|back|side [--tolerance 0.15] [--rows]`. It compares the widest
point of each zone with the sheet, in head units, and answers `on-model` or `off-model` with `too-wide` / `too-narrow` per zone.
Measured on Kido: the plan and the three plan-based renders are on-model; the text-only front and back views are off-model
(shoulders 1.63 for 1.99 expected). The audit checks size and thickness, not details: still crop and compare hands, elbows and feet by eye (section 3).
It needs a plain background and a figure that does not touch the edges. The three-quarter view has no plan: do not audit it against the front.

**Stabilise the next image**: the engine takes one input image, so the reference cannot be added to the plan. The reference is used to
measure (step 1), the plan carries the shape, and the first validated render is audited, then used as the target of the following renders of the same view.

## 6. Limits

- Text-only consistency is good on proportions and silhouette and weaker on fine detail (ribbing, folds, seams).
- One input image per generation (`--init`). The only conditioning model in the engine is a face adapter for SD 1.x, which does not
  apply to a robot. A second reference image or a LoRA is a separate, untested step.
- A flat plan fixes the silhouette, not the details inside it: hands, bolts and folds still come from the prompt.
- A trained LoRA is the only way to lock a face across very different scenes. Say so to the client rather than over-promising.
