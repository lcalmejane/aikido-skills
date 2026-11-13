---
name: aikido-design-config
description: Configure Local Designer image servers (type, count, address, port, protocol, model policy, concurrency) and how batches of renders are prioritised and paced, through a guided questionnaire filling the engines template
category: local-designer
---

# Command: /aikido-design-config

## Description

Guided workflow that asks the user everything needed to fill the **engine pool** of the project, from the template
`templates/engines.template.json`, then validates, optionally verifies against the servers, and saves it in the
`engines` key of the nearest `.local-designer.json`. Other keys (`design_dir`, `vision`, ...) are kept. The primary
server (enabled, lowest `priority`) is also written to `engine`, the entry every existing command already reads.

Run it **after installing** the skill, later to **review**, or whenever the user wants to **change** a server, a
model or the pacing. The agent then reads the pool (`config show`) and plans batches (`config plan`) instead of
asking the same questions again.

## Usage

```
/aikido-design-config              review the current pool (or start from the template) and ask what to change
/aikido-design-config --new        start again from the template; the current pool is shown first, never lost silently
/aikido-design-config --server <id>  change one server only
/aikido-design-config --scheduling   change the batch prioritisation and pacing only
```

`<skill-dir>` is the folder holding `SKILL.md`. Every step uses
`node <skill-dir>/scripts/local-designer.mjs config <sub>` (`template`, `show`, `check`, `apply`, `plan`).

## Behavior

### 1. Look first

1. `config show`. If `engines` exists, summarise it in a short table (id, type, protocol, host:port, model policy,
   max concurrent, priority, enabled, roles) and ask what to change. Without a pool, `show` returns `suggested`:
   a pool pre-filled from the legacy `engine` entry, or the template.
2. `discover` lists the local engines that answer (loopback only). Offer what it found as defaults; never scan the
   network.

### 2. Ask, one block at a time

Ask with the host's question tool when it exists (2-4 options, recommended first), otherwise in plain text. Group the
questions per block; do not ask what is already known or answered by discovery. Show the defaults.

**A. Servers**
- How many image servers? (1 by default; more to share batches or keep a backup.)
- For each server:
  - `id`: short name (`local`, `studio-mac`, `gpu-lan`).
  - `type`: `drawthing` (available) or `comfyui` (planned: it can be recorded now but stays `enabled: false`).
  - `host`: IP or name, no scheme. A non-loopback host needs the user's explicit agreement to send prompts and
    images to that machine: then `remote: true`. Follow [local and cloud](../references/local-and-cloud.md).
  - `port`: Draw Things 7860 (gRPC or HTTP, one at a time) or legacy gRPC 7859; ComfyUI 8188.
  - `protocol`: `grpc` (recommended: lists the real models, progress, TLS with fingerprint) or `http`.
  - `tls` (gRPC default true), `tls_fingerprint` for a remote server; a remote server without TLS needs
    `allow_clear_text: true`, only after the user accepts clear-text traffic.
  - `secret` (gRPC shared secret, when the server requires one): ask **where it lives**, never its value.
    `{ "source": "env", "name": "DT_SECRET" }`, `{ "source": "file", "path": "~/.config/local-designer/gpu.secret" }`
    (`chmod 600`, outside git) or `{ "source": "vault", "path": "secret/data/local-designer/gpu", "field": "secret" }`.
    For `vault`: if the host exposes a Vault MCP, read the secret through it at run time and set
    `LOCAL_DESIGNER_SECRET_<ID>` for that run only; otherwise configure `secrets.vault_hook`
    (e.g. `["node", "<skill-dir>/scripts/hooks/vault-kv.mjs"]` with `VAULT_ADDR`/`VAULT_TOKEN` in the environment).
    If the user pastes a secret value, do not write it anywhere; propose a reference instead.
- `roles`: which jobs it accepts among `draft`, `sweep`, `moodboard`, `final` (e.g. a slow, high-quality machine
  only for `final`).
- `enabled`: keep a server declared but off.

**B. Model, depending on the protocol**

| Protocol | Allowed `model_policy` | Meaning |
|---|---|---|
| `http` | `server` | The model loaded in the Draw Things app is used; the app chooses |
| `http` | `pinned` | The request always names `model` |
| `grpc` | `auto` | The gRPC server has no current model: the tool picks a listed one, preferring a fast one |
| `grpc` | `pinned` | Always the `model` file named here |

With `pinned`, ask for the exact file name as shown in the app (gRPC: offer the list returned by `status`).
Never invent a model from a connection success.

**C. Capacity and order**
- `max_concurrent` per server: renders it runs at once (1 for a single GPU/Apple Silicon machine; more only if the
  user confirms the server queues or runs them in parallel).
- `priority` per server (1 = first choice) and `weight` (share under the `weighted` strategy).

**D. Batches (when several images are requested)**
- `strategy`: `priority` (fill the first server, overflow to the next), `round-robin` (alternate) or `weighted`
  (share by `weight`).
- `max_parallel_total`: renders in flight across all servers (capped by the sum of `max_concurrent`).
- `batch_size`: jobs per batch; `pause_between_batches_s`: rest between batches (heat, shared machine, review).
- `queue_order`: `priority` (by `job_priority`) or `fifo` (request order); `job_priority`: 1 = first, default
  `final` 1, `moodboard` 2, `draft` 3, `sweep` 4.
- `timeout_s` per render, `retry.max_attempts` and `retry.backoff_s`, `on_server_failure`: `next-server` (try
  another eligible server) or `stop`.

### 3. Write, check, verify, save

1. Write the answers to a working file outside git (e.g. `~/local-designer-lab/engines.json`), starting from
   `config template --out <file>` or the `suggested`/current pool.
2. `config check --file <file>`: fix every error with the user; read the warnings back (clear-text remote HTTP,
   role without server, capacity lower than `max_parallel_total`).
3. Ask whether to verify the enabled servers now (recommended). `config apply --file <file> --verify` probes each one
   with its connector and checks pinned/auto models against the server list. Nothing is saved if one fails: fix,
   disable it, or apply without `--verify` only if the user says the server is off for now.
4. Show the result: file, primary server, warnings. Then `config plan --jobs 8 --role draft` as an example of how a
   batch would be spread, so the user sees the effect of the settings.

## Rules

- Never store a token, password or certificate in the pool, only `secret` references; never mark a remote host
  `remote: true` or `allow_clear_text: true` without consent.
- Never enable a planned type (`comfyui`) until its connector exists.
- Do not overwrite a working pool without showing it first; change only what the user asked.
- `sweep`, `styles thumb` and `moodboard trial` render on the pool; the pool starts no scheduler or daemon:
  batches run only while that command runs.

See [runtime configuration](../references/runtime-configuration.md) and [connectors](../references/connectors.md).
