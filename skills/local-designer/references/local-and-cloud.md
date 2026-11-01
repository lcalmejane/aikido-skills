# Local, remote and cloud with Draw Things

This skill reaches Draw Things through either an **HTTP endpoint** (`/sdapi/v1/*`, A1111-style, connector
`drawthing`) or **gRPC** (connector `drawthing-grpc`, see [`grpc.md`](grpc.md)). Where the compute happens depends on
the server the connector points at. Verified end to end on this project: local over HTTP, and local over gRPC with
TLS (including the certificate checks for a non-local address). Modes 2 and 3 below describe how the app is documented
to work and must be confirmed by the user before relying on them.

## Mode 1 - Local (verified)

- Draw Things on the same Mac, model loaded, **API Server** on (HTTP, port 7860).
- `node scripts/local-designer.mjs status` -> `"where": "local"`.
- Nothing leaves the machine.

## Mode 2 - Another machine on the network (HTTP API)

Point the script at the machine that runs the app with its API server reachable:

```bash
node scripts/local-designer.mjs status --url http://192.168.1.20:7860
# or: export DRAWTHING_URL=http://192.168.1.20:7860
```

- `status` reports `"where": "remote"` so the agent knows the prompt leaves the local machine.
- The API server has **no authentication** by default: use only on a trusted LAN, or through an SSH tunnel
  (`ssh -L 7860:127.0.0.1:7860 user@host`, then keep the default URL). Never expose it on the internet.
- The script uses plain `http`/`https` URLs only.
- **Over gRPC** the same machine is reached with `--grpc 192.168.1.20:7859 --fingerprint <sha256>`: the traffic is
  encrypted and the server's certificate is pinned, which the HTTP mode cannot offer. Prefer it for anything beyond
  the local Mac. A shared secret can be required by the server and is passed with `--secret-file`.

## Mode 3 - Draw Things Cloud Compute / Server offload (to confirm with the user)

The Draw Things app can offload generation instead of using the local GPU:

- **Cloud Compute** (paid "Draw Things+" feature in the app): jobs run on Draw Things' servers.
- **Server offload / gRPC server**: you run Draw Things' own server (`gRPCServerCLI`, Docker, on a GPU
  machine) and select it in the app (Settings -> Server). The `drawthing-grpc` connector can talk to that
  server directly, without the app in between: point `--grpc` at it.

For Cloud Compute the app stays the front end and whether the **HTTP API** transparently uses the offload target is
app-version dependent and **not verified here**. A server you run yourself over gRPC is verified. Procedure to verify
an HTTP setup, in this order:

1. In the app, enable the cloud/server option and select the model.
2. `local-designer.mjs generate --dry-run ...` to check the request, then a small test
   (`--width 512 --height 512 --steps 8`).
3. Compare timing and the app's own indicator. If the app shows local work, the API is not offloaded: report
   it to the user instead of assuming.
4. Record the result in this file once confirmed.

## Privacy and cost rules for agents

- Before using any non-local mode, say so to the user: prompts (and `--init` images) leave the machine.
- Cloud usage may consume paid credits: ask before launching a **sweep** in cloud mode (many images).
- Never put secrets or personal photos in prompts or init images for a remote or cloud run.

## Choosing a mode

| Need | Mode |
|---|---|
| Free, private, any time | Local |
| Big sizes, many images, slow Mac | Another machine, or cloud (after user approval) |
| Quick draft | Local, `--steps 8` at 512 px |
