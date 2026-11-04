# Connectors

A **connector** drives one image engine installed on the machine. `local-designer` does the art direction
(brief, mood board, styles, prompt, validation lock, sweeps); the connector only turns a generic request
into the engine's own call and brings the PNG back.

| Connector | Id | Status | Engine |
|---|---|---|---|
| Draw Things (HTTP) | `drawthing` | Available, tested locally | macOS app, A1111-compatible HTTP API (`/sdapi/v1/*`, port 7860) |
| Draw Things (gRPC) | `drawthing-grpc` | Available, tested locally on a real server | Same app or a server offload, port 7860, TLS: see [`grpc.md`](grpc.md) |
| ComfyUI | `comfyui` | Not written | Needs a workflow template: see [Adding a connector](#adding-a-connector) |

## Choosing the engine

1. `--connector <id>` on the command line.
2. `$LOCAL_DESIGNER_CONNECTOR`.
3. Explicit `--grpc` / `--url`, then endpoint environment variables select their protocol.
4. The verified project engine in `.local-designer.json`, initialized/updated with
   `discover` and `setup`: see [local engine configuration](runtime-configuration.md).
5. Otherwise **auto**: with several connectors registered, each one's `detect()` is tried in registration order
   (`drawthing`, then `drawthing-grpc`) and the first that answers wins. If none answers, the default (`drawthing`)
   is used so the user sees its usual "not reachable" hint. A machine with the HTTP server off and the gRPC server
   on therefore lands on gRPC without any option.

`connectors` lists what is registered, what each one supports and which one answers right now.
`status` and every `generate`/`sweep` result name the connector that was used (`"connector": "drawthing"`).
Once configured, an unreachable engine fails rather than silently switching engines.

## What does not depend on the engine

`brief`, `moodboard build|decide|status|html`, `styles` (except `styles thumb`, which renders), `recommend`,
`analyze`, `match`, `project-scan`, `migrate`, `connectors`, and the validation lock itself.
They run on a machine with no image engine at all.

## Contract

A connector is an object exported from `scripts/connectors/<id>.mjs` and registered in
`scripts/connectors/index.mjs`. `validateConnector()` refuses a registration that breaks it.

| Member | Required | Role |
|---|---|---|
| `id`, `label` | yes | `[a-z0-9][a-z0-9-]*` and a display name |
| `supports` | yes | Optional request keys it understands, among `model sampler shift seedMode clipSkip plain lora set initImage strength` |
| `detect(opts)` | no | Cheap probe (about 2 s): is the engine answering? Used by auto selection and `connectors` |
| `connect(opts)` | yes | Reach the engine, read its current settings, return a `session`. Throws an actionable error when it is not running |
| `describe(session, {full})` | yes | What `status` prints: where it runs (`local`/`remote`) and the current settings |
| `plan(session, req)` | yes | Turn the generic request into the native call **without sending it**. Returns `{ mode, summary, shown, negative, sidecar, native }` |
| `render(session, plan, {timeoutMs})` | yes | Send the plan, return the PNG bytes |
| `readMetadata(buf)` | yes | Generation parameters the engine stored in its own PNGs, in the generic shape, or `null` |

The generic request (`req`) holds: `prompt negative width height seed steps guidance sampler shift strength seedMode
clipSkip model plain lora[] set[] initImage`. A key the connector does not list in `supports` makes
the command fail with a clear message instead of being silently dropped (`--lora` on an engine without LoRA,
for example).

`plan()` is what `--dry-run` shows, so a new connector gets dry-run for free and can be checked without the engine.

## Adding a connector

1. Write `scripts/connectors/<id>.mjs` exporting `connector` with the members above.
2. Add `import` and `registerConnector()` in `scripts/connectors/index.mjs`.
3. Add tests that cover `plan()` (the request it builds) and `readMetadata()` with a sample PNG, and run
   `validateConnector()` on it. No engine is needed for these.
4. Document its prerequisites and limits in a section of this file, and flip its status in the table above only
   once a real image has been produced with it.

**ComfyUI** is the next one. Its API takes a workflow graph, not a flat parameter list: `plan()` has to fill a
workflow template (`POST /prompt`, then poll `/history/<id>` and read `/view`), and the template depends on the
installed model and nodes. That is why it cannot be written blindly: it needs the user's ComfyUI install and a
workflow that works there.

## Draw Things connector

- Server: `DRAWTHING_URL` or `--url` (default `http://127.0.0.1:7860`). Enable "API Server" (HTTP, port 7860) in the app.
- `plan()` sends only the overrides: the app's own settings fill the rest (the full `GET /options` snapshot contains
  values the server then rejects on txt2img).
- Metadata: it reads the XMP block the app writes into its PNGs. API-generated images carry none, hence `--sidecar`.
- Remote and cloud: see [`local-and-cloud.md`](local-and-cloud.md).

## Draw Things gRPC connector

Full reference in [`grpc.md`](grpc.md). In short: server `--grpc host:port` (default `127.0.0.1:7860`), the server's
real model and LoRA lists, progress events, TLS with a certificate fingerprint for any non-local host, shared secret
from a file or `DRAWTHING_SECRET`, compressed images decoded on the client side. Its code lives in
`scripts/connectors/drawthing-grpc/`.
