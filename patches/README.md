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

The installed package ships bundled/minified `dist/` with per-version chunk
filenames, so this `.patch` cannot be applied to `dist/` directly. The durable
path is source-based:

1. In the `openclaw` source checkout, sync to the installed version's tag.
2. `git apply /path/to/openclaw-talk-relay.patch` (or 3-way merge if it drifts).
3. `pnpm install && pnpm run build`.
4. `rsync -a --delete dist/ ~/.npm-global/lib/node_modules/openclaw/dist/`.
5. `systemctl --user restart openclaw-gateway`.

A future `scripts/apply-openclaw-patch.sh` should wrap steps 1–5 and run on each
update. Not built yet — see the Helm-Talk session notes.

### Companion change (not in this patch)

The `transcription-local-whisper` plugin declares `encoding: "pcm16"` /
`sampleRate: 16000` via `resolveConfig`. That lives in the
`openclaw-voice-plugins` repo and is installed into
`~/.openclaw/extensions/`, which the OpenClaw npm update does **not** touch.
