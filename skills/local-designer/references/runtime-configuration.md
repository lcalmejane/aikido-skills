# Local engine configuration

The project knowledge base keeps the engine settings in the existing
`.local-designer.json`, alongside `design_dir` and optional `vision`. Scripts
find the nearest file above the current working directory. Run from the project,
not the skill's source repository.

## Installation and first use

1. Run `node <skill-dir>/scripts/local-designer.mjs discover`.
   It reports OS, architecture, memory and the availability of `cwebp`,
   ImageMagick and `sips`. It probes only known loopback endpoints: gRPC and HTTP
   on 7860, then legacy gRPC on 7859, plus a configured local endpoint.
   No files are written, no application is started, no model is downloaded,
   and no LAN or arbitrary port range is scanned.
2. Confirm the engine/protocol found. Run `setup` to verify and save it:

   ```bash
   node <skill-dir>/scripts/local-designer.mjs setup \
     --connector drawthing-grpc --grpc 127.0.0.1:7860
   ```

   Without a selection, `setup` saves only when exactly one endpoint answers.
   With zero or multiple engines it asks for an explicit choice through an error.
3. If gRPC lists no models, confirm the filename in Draw Things before setting
   `setup --model <file.ckpt>`. Never invent a model from a connection success.
   A listed but unknown model is rejected; an empty list is disclosed.
4. Run `status`. Use `generate --dry-run` before any render.

Example (the tool adds `verified_at`):

```json
{
  "engine": {
    "connector": "drawthing-grpc",
    "grpc": "127.0.0.1:7860",
    "model": "confirmed-model-file.ckpt"
  }
}
```

This is a configuration example, not a model available on every machine.
HTTP uses `connector: "drawthing"` and `url: "http://127.0.0.1:7860"`.
Only one of these protocols listens on that port at a time.

## Exchanges, changes and ordinary use

- When the user supplies a new port, protocol or model, verify it with `setup`
  and persist the successful settings. Do not edit the installed script's
  defaults for each machine, repeatedly ask the user, or leave the answer only
  in chat. Preserve the existing design target, vision configuration and other keys.
- Every engine-consuming command reads the saved settings. Order: explicit CLI
  flags, environment (`LOCAL_DESIGNER_CONNECTOR`, `DRAWTHING_GRPC`,
  `DRAWTHING_URL`, `DRAWTHING_MODEL`), saved engine, then legacy auto-detection
  if no engine has been configured. An explicit `--url` or `--grpc` selects its
  protocol unless a connector has been explicitly selected.
- A configured but unreachable engine fails with its real error. Do not switch
  silently, reset settings, write a guessed endpoint, or render remotely.
  Run `discover` and update with `setup` after the user confirms a new target.
- Discovery is local only. Remote setup needs an explicit endpoint and
  `--allow-remote` after agreement; certificate checks still apply. Follow
  [local and cloud](local-and-cloud.md). Never persist a secret or token in this
  JSON; existing secret-file/environment and certificate options remain per-call.
- Skill updates replace code, not project configuration. Do not copy
  `.local-designer.json` from the source repository into a consumer project.
  Re-run discovery/setup during installation only to initialize missing settings
  or verify a user-requested change, never to overwrite a working configuration.

See [connectors](connectors.md), [gRPC](grpc.md) and
[installation](../install-aikido.md).
