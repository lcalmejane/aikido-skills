# Draw Things over gRPC

The `drawthing-grpc` connector talks to the transport the Draw Things app uses itself for "server offload" and
"Cloud Compute". It reaches a server on the same Mac, on another machine, or on a GPU box, and it knows what the
server really holds.

## Why it exists next to the HTTP connector

| | `drawthing` (HTTP) | `drawthing-grpc` |
|---|---|---|
| Default port | 7860 | 7860 |
| App setting | API Server, protocol HTTP | API Server, protocol gRPC |
| Models, LoRA, ControlNets | Not listed: use the names shown in the app | **Listed by the server** (file, name, family, default size) |
| Model chosen per request | Only what is loaded in the app | Any model the server has |
| Progress | None | Stage events (text encoded, sampling, decoded) |
| Cancel | Not handled by this connector | The request stream is closed when the caller aborts; whether the server then stops computing is not verified |
| Encryption | None | TLS, self-signed certificate |
| Authentication | None | Optional shared secret |

Prefer gRPC whenever it is available. With both enabled, `auto` selection tries HTTP first, then gRPC; force one
with `--connector drawthing-grpc`.

## Prerequisite

In Draw Things, advanced settings: enable **API Server**, protocol **gRPC**, port **7860**. Keep the app open.
HTTP and gRPC are alternative protocols on the configured port, not simultaneous
listeners on the same address. Override `--grpc host:port` for another setup,
including an existing server on port 7859.

```bash
node scripts/local-designer.mjs status --connector drawthing-grpc
```

The answer lists the server's models and LoRA, so a model name never has to be guessed:

```bash
node scripts/local-designer.mjs status --connector drawthing-grpc --full   # every model, LoRA and ControlNet
```

## Options

| Option | Env | Role |
|---|---|---|
| `--grpc host:port` | `DRAWTHING_GRPC` | Server address. Default `127.0.0.1:7860`. A `grpcs://` prefix and `[::1]:port` are accepted |
| `--fingerprint AA:BB:..` | `DRAWTHING_FINGERPRINT` | SHA-256 of the server certificate you trust |
| `--insecure-tls` | | Accept any certificate. Last resort, says so in the result |
| `--no-tls` | | Clear text. Allowed on loopback only, unless `--insecure-tls` is also given |
| `--secret-file path` | `DRAWTHING_SECRET` | Shared secret, if the server was started with one. Never printed, never stored in a result |
| `--model file` | `DRAWTHING_MODEL` | Model file as the server lists it, or a fragment of its name |

The shared secret is read from a file or the environment on purpose: a command line is visible to every process
on the machine and ends up in shell history.

## Certificates

The server presents a self-signed certificate. The rule:

- **Loopback** (`127.0.0.1`, `::1`, `localhost`): accepted, the traffic never leaves the machine.
- **Any other host**: refused unless `--fingerprint` matches or `--insecure-tls` is given. The refusal message prints
  the fingerprint that was presented, so the first connection is a two-step: read it, check it against what the
  server's owner sees, then pass it back.
- A fingerprint that is given and does not match is always refused: `--insecure-tls` only applies when no fingerprint is given.

Verified on a real server: remote address without fingerprint refused, wrong fingerprint refused, right fingerprint
accepted.

## Where generation happens

The connector sends the job to whichever server it points at. For the app running on the same Mac that is the local
GPU. For a remote address, **the prompt and any `--init` image leave the machine**: `status` reports
`"where": "remote"`. Follow the privacy rules in [`local-and-cloud.md`](local-and-cloud.md) before using it.

## Image format on the wire

The server returns images as tensors, either raw or compressed with **fpzip** when its "response compression"
setting is on. The request has no field to refuse compression, so the connector decodes it: no setting needs to be
changed on the server. The decoder is `scripts/connectors/drawthing-grpc/fpzip.mjs`, a JavaScript port of the
decompression path of the fpzip library. It was checked bit for bit against the reference library on six arrays
(16, 19 and 32 bit precision, several fields) and against a tensor taken from a real server. Any other codec is not
decoded and gives an explicit error naming the setting to change on the server.

## Configuration

The configuration is a FlatBuffer. The field table lives in `config-schema.mjs`; a value given with `--set key=value`
is checked against it before anything is sent: unknown field, wrong type, out of range, unknown sampler name.

- Sampler names are accepted in any spelling: `Euler A Trailing`, `euler-a-trailing` and `EulerATrailing` are the same.
- Sizes are sent in blocks of 64 px; the connector converts, so `--width 1024` is `start_width` 16.
- `--dry-run` prints the request, the resolved model and why it was chosen. It still connects to the server, to read
  its model list, but generates nothing.
- With no model given, a model from the server's list is picked (a fast, consistency-distilled one when there is one)
  and the result says it was a default.

## Starting points per family

Used when a setting is not given. They are starting points, not rules; tune with
[`parameters.md`](parameters.md).

| Family | Size | Steps | Guidance | Sampler |
|---|---|---|---|---|
| SDXL | 1024 | 20 | 7 | DPM++ 2M Karras |
| Any distilled ("fast", consistency) model | model's own size | 4 | 1 | Euler A Trailing |
| FLUX 2 | model's own size | 4 | 1 | Euler A Trailing |
| FLUX 1, full | model's own size | 20 | 1 | Euler A Trailing |
| Qwen Image | model's own size | 30 | 4 | Euler A Trailing |
| Other (SD 1.5, SDXL...) | model's own size | 20 | 7 | DPM++ 2M Karras |

The size comes from the model's declared default (in blocks of 64 px), not from a fixed 1024.

## Protocol notes for maintainers

The wire format was worked out for interoperability by reading the server's protocol definition (`imageService.proto`)
and the server source, then validated by round trips and against a real server. Draw Things is GPL-3.0 and this skill
is not, so the rules are:

- No Draw Things source file or function body was copied. `protobuf.mjs`, `flatbuffers.mjs`, `transport.mjs`,
  `tensor.mjs` and the connector are written from scratch.
- `config-schema.mjs` holds facts about the interface (field names, positions, types, enum order), which a client
  needs to talk to the server. Keep it as a plain table; do not paste code next to it.
- The one third-party algorithm, fpzip, is BSD 3-Clause (Lawrence Livermore National Security). `fpzip.mjs` is a port
  of its decompression path; the license is kept in `scripts/connectors/drawthing-grpc/LICENSE-fpzip.txt` and must
  stay next to it.
- Anyone who wants a stricter position than this should have the legal side review it before redistributing the skill.

Verified on a real server: FLUX Schnell, 512 px, 4 steps, about 17 s, image decoded and checked by eye.
Not verified: Draw Things Cloud Compute (a paid service with its own authentication), and ControlNet or inpainting
requests, which the connector does not send.
