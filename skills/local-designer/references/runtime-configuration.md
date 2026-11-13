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
5. Run `/aikido-design-config` to describe every server and the batch pacing
   (see [Engine pool](#engine-pool-several-servers-and-batches)). It can be run again at any time.

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

## Engine pool: several servers and batches

`/aikido-design-config` fills the `engines` key from
[`templates/engines.template.json`](../templates/engines.template.json):

- `servers[]`: `id`, `type` (`drawthing`; `comfyui` planned, kept `enabled: false`), `host`, `port`,
  `protocol` (`grpc` or `http`), `tls`, `remote` (explicit consent for a non-loopback host), `model_policy`
  (`http`: `server` or `pinned`; `grpc`: `auto` or `pinned`), `model` when pinned, `max_concurrent`,
  `priority` (1 first), `weight`, `enabled` and `roles` (`draft`, `sweep`, `moodboard`, `final`).
- `scheduling`: `strategy` (`priority`, `round-robin`, `weighted`), `max_parallel_total`, `batch_size`,
  `pause_between_batches_s`, `queue_order` (`priority` or `fifo`), `job_priority` per role, `timeout_s`,
  `retry` (`max_attempts`, `backoff_s`) and `on_server_failure` (`next-server` or `stop`).

Commands: `config template [--out f]`, `config show`, `config check [--file f]`,
`config apply --file f [--verify] [--dry-run]` and `config plan --jobs n [--role r]`.

**Rendering on the pool.** `sweep` (role `sweep`, or `--role`), `styles thumb` (role `draft`) and
`moodboard trial` (role `moodboard`) dispatch their jobs over the enabled servers: batches and pauses,
`max_concurrent` per server and `max_parallel_total`, `timeout_s`, retries with `backoff_s`, and
`on_server_failure` (`next-server` moves the job to the next eligible server; a server whose connection
fails is skipped for the rest of the run). Each server applies its own model policy; an explicit `--model`
still wins. `--no-pool`, `--connector`, `--url`, `--grpc` or the engine environment variables bypass the pool
and use one engine, as before. `generate` (one image) uses the primary server. Sweep results record the
`server` of each image.

**TLS.** `tls` (gRPC: on by default, as Draw Things), optional `tls_fingerprint` for a remote server. A remote
server without TLS is refused unless `allow_clear_text: true` was agreed with the user.

**Secrets.** A server never holds a secret value, only a `secret` reference (gRPC shared secret today):

| `source` | Fields | Resolution |
|---|---|---|
| `env` | `name` | that environment variable of the run |
| `file` | `path` | a file outside git, `chmod 600` (refused when readable by others) |
| `vault` | `path`, optional `field` (`secret`) | the `secrets.vault_hook` command, or host injection |

Whatever the source, `LOCAL_DESIGNER_SECRET_<ID>` (server id upper-cased, `-` → `_`) set for the run takes
precedence: a host exposing a **Vault MCP** reads the secret through that MCP and injects it there for one
run. Without it, `secrets.vault_hook.command` (program and arguments, optional `timeout_s`) receives
`{"server","path","field"}` on stdin and prints only the value; the bundled
[`scripts/hooks/vault-kv.mjs`](../scripts/hooks/vault-kv.mjs) reads HashiCorp Vault/OpenBao KV v1/v2 with
`VAULT_ADDR` and `VAULT_TOKEN` from the environment. Values are resolved in memory, passed to the connector
under a non-serialisable key, and never written, logged or put on a command line. Saving keeps the other
keys and writes the primary server (enabled, lowest priority) to `engine`, so every existing command keeps
working. `config plan` is a pure dispatch plan (batches, waves, server per job); it starts no scheduler.

See [connectors](connectors.md), [gRPC](grpc.md) and
[installation](../install-aikido.md).
