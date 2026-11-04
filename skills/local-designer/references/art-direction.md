# Art direction method

How a senior illustrator / art director turns a need into an image with Draw Things. Use it with
`local-designer.mjs recommend | analyze | match | project-scan | styles ...`.

## 1. Understand before drawing

Answer these five questions (ask the user for what you cannot infer; at most 3 questions at a time):

| Question | Why it matters |
|---|---|
| **Message**: what must the viewer understand or feel in 3 seconds? | One idea per image |
| **Audience and context**: who sees it, where (slide, web, print, social)? | Tone, density, format |
| **Format**: ratio, final size, safe area for a title or logo? | Composition and `--width/--height` |
| **Brand constraints**: palette, fonts, existing visuals, forbidden looks? | Consistency |
| **Realism level**: real-looking, illustrated, schematic, playful? | Picks the style category |

## 2. Four ways in

| Entry | Tools | What you do |
|---|---|---|
| **An image to imitate or extend** | `analyze <img>`, `match <img>`, `styles draft <img>`, then read it | Measure palette, light, contrast, flatness; find the closest library styles; draft a new style from it; read the image for medium and mood with the image analyst method ([`vision.md`](vision.md)) |
| **A written brief** | `recommend --brief "..."` | Rank styles (French or English); propose 3 with their thumbnails |
| **A question / answer session** | questions of section 1, then `recommend` | Turn the answers into a brief, then proceed as above |
| **A project folder** | `project-scan <dir>` | Read name, README, keywords, brand colours and fonts; propose a look that fits the project; confirm before generating |

Thumbnails live in `styles/thumbs/<style>.webp` (see `styles/README.md`). Show them next to the user's choice, using the preview order of [`preview.md`](preview.md) (agent CLI first, then IDE browser, then external browser).

## 3. Choose the medium by use

| Need | Start with | Why |
|---|---|---|
| Business presentation, SaaS, onboarding | `corporate-memphis`, `flat-vector`, `isometric-flat`, `infographic-flat`, `gradient-abstract` | Clean, limited palette, room for text |
| Commercial proposal, explainer, training | `cartoon-clean`, `doodle-whiteboard`, `flat-vector` | Friendly, easy to read |
| Corporate photo (team, office, product, building) | `corporate-portrait`, `corporate-workplace`, `product-studio`, `corporate-architecture` | Credible realism |
| Technical document, manual, engineering | `technical-blueprint`, `exploded-view`, `isometric-line`, `line-art` | Precision, no decoration |
| Storytelling, atmosphere | `cinematic`, `watercolor`, `oil-painting`, `sumi-e` | Mood |
| Concept / ideation | `sketch-marker`, `doodle-whiteboard`, `line-art` | Looks unfinished on purpose |
| Posters, editorial | `riso-duotone`, `paper-cut`, `cartoon-comic` | Strong identity |

Mix two looks with `styles compose a b`: the first style gives the structure and parameters, the others the influence.
Always render the composition with `styles thumb <name>` before trusting it.

## 4. Compose the prompt (senior checklist)

1. **Subject first**, concrete and visual. One idea.
2. **Medium** (from the style): do not fight it with contradictory words.
3. **Composition**: point of view, framing, where the empty space is (title, logo, chart).
4. **Light and colour**: name 2-4 colours, ideally the brand palette from `project-scan` or `analyze` (use names, the model ignores hex codes).
5. **Constraints**: "no text" for anything that must carry words (add text in the layout tool), plain or soft background for slides.
6. **People**: synthetic people only. Never name or describe a real person; for photo styles avoid close-up hands.
   Apply [people and casting](people-and-casting.md): distinct humans, varied casting
   adapted to the audience, equally active roles, no accidental clones. Preserve model-sheet characters.
7. **Consistency across a set**: same style, model, steps, guidance, aspect ratio; change only subject and seed.
8. **A recurring character** (mascot, hero): do not describe it from memory. Measure the reference image in head units and write the
   proportions, joints and limbs into a fixed block ([`character-design.md`](character-design.md)).

## 5. Mood board for a client (validate before committing to a direction)

When the person who pays is not the person who drives the tool, do not start from renders. Start from a **brief**, then a **mood board**:

1. **Brief** (`brief template`): message in one sentence, audience, uses, one concrete subject, format ratio, realism level, brand palette,
   forbidden terms, constraints. If an answer is missing, ask; do not invent it.
2. **Three directions from different families** (`moodboard build`): for example technical line art, flat vector and illustrated cartoon.
   Three variations of the same look are not a choice. Each direction states why it fits, what to do, what to avoid and its main risk.
3. **Trials only if useful** (`--trial`): one per direction and per scene, 640 px, 8 steps, same seed. They show the spirit on the client's subject;
   read every one with the image analyst method ([`vision.md`](vision.md)) and redo or drop what is wrong (wrong object, missing item,
   text, odd anatomy) rather than send it.
4. **The client answers**: a letter and remarks. Record it (`moodboard decide`), one validated direction at a time; keep the comments, they feed the prompt.
5. **Then and only then** `generate --moodboard`: the lock refuses otherwise, and uses the validated style, the brief subject, the format and the forbidden list.

Say clearly to the client what the board is: reference thumbnails show a **rendering style on another subject**, not the final image.

## 6. Validate with the user (two-person loop)

1. `sweep --subject "..." --styles a,b,c --seeds 42 --width 768 --height 512 --steps 16` into `~/local-designer-lab` (outside git).
2. User picks one or two. Explain in one sentence why each is or is not right for the use.
3. Tune one thing at a time: `--vary guidance=3,4,6`, then `--vary steps=...`, then `--seeds 1,2,3,4`.
4. Final render at full size; check text, hands, faces, edges. Re-roll the seed rather than over-prompting.
5. Only validated images are copied into a project; keep the PNG as original and publish WebP.

## 7. Know the limits

- Diffusion models draw text and numbers badly: generate visuals, add labels afterwards.
- Pixel measurements (`analyze`, `match`) describe colour and texture, not meaning. They support a decision, they do not replace looking.
- Corporate Memphis and glassmorphism backgrounds are everywhere: pick an unusual palette to stand out.
- A style borrowed from a living artist or a trademarked franchise is a legal risk: describe the technique, not the name.

## Sources of inspiration

Style vocabulary (flat, doodle, sketch, riso, claymorphism, editorial, dithered, vintage) was cross-checked with the
MIT-licensed aikido-design-style catalogue `bergside/awesome-design-skills` (user-interface oriented: translated here into image rendering terms).
