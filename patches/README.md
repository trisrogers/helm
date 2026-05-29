# Patches

## `openclaw-talk-relay.patch`

Makes the OpenClaw gateway's transcription relay honour a provider-declared
audio format instead of hard-coding `g711_ulaw`/8 kHz. Required for Talk mode's
local Whisper path, which streams PCM16/16 kHz.

- **Against:** `openclaw` source tree (`src/gateway/talk-transcription-relay.ts`
  + its test). Generated from a working tree at openclaw `2026.5.25`.
- **Why a patch, not a fork:** the change isn't upstreamed yet. OpenClaw is
  installed globally via npm and **auto-updates wipe the built `dist/`**, so the
  patch has to be re-applied after each version bump.

### Re-applying after an OpenClaw update

The installed package ships a bundled (but un-minified) `dist/` with per-version
chunk filenames. The relay code stays stable across versions, so the durable fix
is to rewrite that function in place rather than rebuild from source:

```bash
node scripts/apply-openclaw-talk-patch.mjs          # patches the live install
systemctl --user restart openclaw-gateway
```

`scripts/apply-openclaw-talk-patch.mjs` locates the relay chunk by content (not
filename), is idempotent (skips an already-patched build), backs up the chunk to
`*.pre-talk-patch`, and aborts loudly if the bundle shape changed. Run it after
every `openclaw` version bump. If it ever aborts, this `.patch` is the source of
truth for what the change should be — rebuild from a synced source checkout as a
fallback.

### Companion change (not in this patch)

The `transcription-local-whisper` plugin declares `encoding: "pcm16"` /
`sampleRate: 16000` via `resolveConfig`. That lives in the
`openclaw-voice-plugins` repo and is installed into
`~/.openclaw/extensions/`, which the OpenClaw npm update does **not** touch.
