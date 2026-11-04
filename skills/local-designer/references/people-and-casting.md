# People and casting

Use this rule before every trial, final render and image review containing humans.
It applies to generic synthetic people, not a mascot or a recurring character
with an approved model sheet. See [art direction](art-direction.md),
[prompting](prompting-and-styles.md) and [character design](character-design.md).

## Defaults

- Every generic human in a group has a visibly different face, silhouette and
  hairstyle. A shared uniform or style must not turn a team into copies.
- For a general audience, vary gender presentation, adult age, skin tone,
  hair, build and role naturally within groups and across a series. Do not
  require every variation in a single image or change a lone subject into a group.
- Give people equally active, credible roles. Do not encode competence,
  hierarchy or personality through gender, skin tone, age or disability.
- Never infer someone's actual gender, ethnicity or other identity from pixels;
  review visible differences and the specified casting, not supposed identities.
- A model sheet preserves its character's identity. Distinct extras still follow
  these defaults. Repeated views of that character on a model sheet are allowed.
- Clones, twins or intentional repetition are exceptions only when explicitly
  requested. Record the concept and its scope; do not invent that exception to
  excuse a failed render. The exception does not waive anatomy or framing checks.

## Configure for the audience, without adding CLI flags

Use the existing brief fields: `audience` defines who the image addresses,
`constraints` records the casting policy, and each `scenes[].subject` describes
the actual people, positions and actions. Put enduring policy in the charter's
`constraints`. These are agent instructions, not automatic demographic detection
or new generator options: explicitly include the cast in every final `--prompt`.

For example:

```json
{
  "audience": "Adult software teams, general international audience",
  "constraints": [
    "Generic humans have distinct faces, hair and silhouettes; no clones.",
    "Show women and men in equally active roles across the series.",
    "Vary adult ages and skin tones naturally; no fixed demographic quotas.",
    "Keep approved character model sheets unchanged."
  ]
}
```

An audience-specific request can set a different gender mix, adult age range,
number of people or continuity between scenes. Record it explicitly rather than
silently overriding it. A continuing character across different images is not
permission to duplicate that person within a group.

## Prompt and acceptance

1. State the number of people. Assign each a position, distinct visible features
   and an action serving the nearby text. "Diverse team" alone is insufficient.
2. Keep the approved palette, medium and wardrobe. For example: "On the left,
   an adult woman with short curly hair selects one glowing document; on the
   right, an older adult man with silver hair consults his laptop. Their faces
   and silhouettes are clearly different."
3. Use positive descriptions first. If supported, add `cloned faces, identical
   people, duplicated person` to the negative prompt. Negatives and a new seed
   are not substitutes for explicit casting or visual review.
4. Review the rendered group and compare neighbouring images as a set: faces,
   hair, silhouettes, gender presentation, adult age variation and active roles.
   The standard vision checklist includes distinctness and casting; the brief's
   constraints refine it.
5. Accidental clones are a **fail**: correct the prompt or seed and render again.
   A face too small to judge is **unclear**, never pass. Do not publish a failed
   or unresolved image, and never describe prompt compliance as pixel evidence.
