# Vision: who reads the images

Every judgement on the pixels of an image (does it show text? are the hands right? is it the pose asked? which of two
renders is closer to the reference?) goes through the
[`agent-aikido-image-analyst`](../agents/agent-aikido-image-analyst.md) method. The reader is chosen **silently**:
no announcement, no test before each use, no question to the user.

| Order | Reader | When |
|---|---|---|
| 1 | The **optional local vision-language model (VL)** of the project, through `vision ask` / `vision review` | A model is set in `.local-designer.json` (key `vision`) and its server answers |
| 2 | The **current model** of the agent, which opens the image itself | No local model is set, or it does not answer, and the current model can see images |
| 3 | A local VL found on the machine, for the session only (`LOCAL_DESIGNER_VISION_MODEL=<id>`, never written) | The current model cannot see images |
| - | One line saying the images cannot be read, then stop | None of the above exists |

## Why a local model is optional

- It gives a repeatable reader: temperature 0, fixed seed, same model for a whole series, comparable verdicts over time.
- It keeps the images on the machine and costs nothing per call.
- It is a comfort, not a prerequisite: a project works without it, with the current model reading the images.

When verdicts are compared over time (before and after a change), compare them from the same reader. If the reader
changed in between, read the reference image again.

## What the tool does and does not do

| It does | It does not |
|---|---|
| Send 1 to 4 images (PNG copy, longest side 1024 px by default) and a question to the set model | Choose a model by itself and write it in the project |
| Run at temperature 0 with a fixed seed (42), so the same question on the same image gives the same answer as far as the server allows | Guarantee that a model never misses a defect |
| Answer a checklist per image: `pass` / `fail` / `unclear`, defects with a place and a severity | Replace a look at an image that matters |
| Print the checklist of a brief (`vision checks`) so any reader answers the same questions | Read anything but images (no PDF, no video) |
| Refuse a server outside the machine without `--allow-remote` | |

`analyze`, `match` and `charter audit` stay what they were: **measures** on a 64x64 sample (colours, light, contrast). They do
not look at anything. Reading is what looks.

## Servers

Any server that speaks the OpenAI chat API with image inputs: LM Studio (default `http://127.0.0.1:1234/v1`), Ollama
(`http://127.0.0.1:11434/v1`), llama.cpp `llama-server`, vLLM, mlx-vlm. Only LM Studio tells which models read images
(`type: "vlm"` in `vision models`); on another server the type is `unknown`, so check the model card.

## Set a local model (optional, once per project)

The pin is set **only by the user**, in the CLI (`vision pin`), or by an explicit later instruction naming the model. No agent pins,
re-pins or unpins on its own initiative, even after a successful test of a model.

```bash
node scripts/local-designer.mjs vision models          # what the server offers; vlm = reads images
node scripts/local-designer.mjs vision pin --model <id> [--url http://127.0.0.1:1234/v1]
node scripts/local-designer.mjs vision status          # ok | not-pinned | model-missing | not-a-vision-model | unreachable
```

`not-pinned` is a normal state, not an error: the current model reads. `model-missing` and `unreachable` mean the set
model is not available right now: the current model reads instead, without comment.

`pin` refuses a model the server describes as text-only (`--force` if you know better) and one the server does not have.
It writes into the nearest `.local-designer.json` (created next to the current folder when there is none):

```json
{ "design_dir": "design", "vision": { "url": "http://127.0.0.1:1234/v1", "model": "<id>" } }
```

Commit this file. Nothing absolute is written. Environment overrides, for one session only (an empty variable counts as unset):
`LOCAL_DESIGNER_VISION_MODEL`, `LOCAL_DESIGNER_VISION_URL`.

## Ask

```bash
# the checklist of a brief, for any reader (prints the questions, reads nothing)
node scripts/local-designer.mjs vision checks --brief brief.json

# a precise question, one to four images (they are numbered in the order given)
node scripts/local-designer.mjs vision ask render.webp --prompt "Count the fingers of each hand and say which hand."
node scripts/local-designer.mjs vision ask ref.webp new.webp --prompt "Same character? List every difference of outfit, colours and proportions."

# a checklist per image; the brief supplies the subject, the forbidden list and the constraints
node scripts/local-designer.mjs vision review design/moodboards/<board>/trials/*.webp --brief brief.json
node scripts/local-designer.mjs vision review final.png --checks "The robot has no mouth; The belt is cream, not white; One character only"
```

`review` returns, per image, `verdict`: `ok` (every check passes), `to-check` (at least one is `unclear`), `fail`,
or `unparsed` (the model did not answer in JSON; the raw start of its answer is kept). The summary counts them.
It asks the standard checks after the brief's own: no text or logo, right hands, no duplicated or fused part, subject
inside the frame, no melted area. When the current model reads, it answers the same list and gives the same verdicts.

Options: `--max-side 1024` (raise to 1536 for small details), `--max-tokens 4096` (a reasoning model needs room), `--timeout 300`
seconds, `--seed 42`, `--url`, `--allow-remote`.

## Choosing a local model

Prefer, in this order: a model that is already on the machine and reads images well at the sizes used here (640 to 1024
px); a reasoning-free or low-reasoning one (faster, nothing lost in `<think>`); 4-bit or better (2-bit quantisations miss
details). Test on two or three images you know the answer to (a hand with five fingers, a sign with a known text, a
render with a known defect) before pinning, and keep the question and the answer in the commit message.

## Reading the answers

- `unclear` is an answer. Re-ask with a smaller question or a larger `--max-side`; do not round it up to `pass`.
- Left and right, counting above five and small text are the weak points of every reader.
- Defects reported are leads to check on the image, they are not measurements.

## Privacy

The default server is local. A non-local URL is refused unless `--allow-remote` is given, which the agent only does after the
user agreed in this conversation. Images are resized in a temporary folder that is deleted at the end of the call.
Reading with the current model uses the host's own channel, the one the user already chose for this conversation.
