#!/usr/bin/env node
// Re-apply the Talk transcription relay patch to an installed OpenClaw build.
//
// OpenClaw ships a bundled (but un-minified) dist/. npm updates wipe our change
// and rename the chunk that holds the relay code, so we locate the chunk by
// content rather than filename. The edit makes the gateway honour a
// provider-declared audio format (encoding / sampleRate) instead of forcing
// g711_ulaw/8 kHz — required for Talk's local Whisper path (PCM16/16 kHz).
//
// Idempotent: detects an already-patched build and exits 0 without touching it.
//
// Usage:
//   node scripts/apply-openclaw-talk-patch.mjs [openclaw-dist-dir]
// Defaults to ~/.npm-global/lib/node_modules/openclaw/dist.

import fs from "node:fs";
import path from "node:path";
import os from "node:os";

const distDir =
  process.argv[2] ??
  path.join(os.homedir(), ".npm-global/lib/node_modules/openclaw/dist");

const MARKER_ORIGINAL = "function assertRelayInputAudioConfig(";
const MARKER_PATCHED = "function resolveRelayInputAudioConfig(";

function findRelayChunk(dir) {
  for (const name of fs.readdirSync(dir)) {
    if (!name.endsWith(".js")) continue;
    const p = path.join(dir, name);
    const text = fs.readFileSync(p, "utf8");
    if (text.includes(MARKER_PATCHED)) return { p, text, patched: true };
    if (text.includes(MARKER_ORIGINAL)) return { p, text, patched: false };
  }
  return null;
}

const ASSERT_FN =
  "function assertRelayInputAudioConfig(providerConfig) {\n" +
  "\tconst encodingValue = providerConfig.encoding ?? providerConfig.audioFormat ?? providerConfig.audio_format;\n" +
  "\tconst encoding = normalizeRelayInputEncoding(encodingValue);\n" +
  "\tif (encoding && encoding !== RELAY_INPUT_ENCODING) throw new Error(`Gateway transcription relay requires ${RELAY_INPUT_ENCODING}/${RELAY_INPUT_SAMPLE_RATE_HZ} audio`);\n" +
  "\tconst sampleRate = parseFiniteNumber(providerConfig.sampleRate ?? providerConfig.sample_rate) ?? inferSampleRateFromAudioFormat(encodingValue);\n" +
  "\tif (sampleRate && sampleRate !== RELAY_INPUT_SAMPLE_RATE_HZ) throw new Error(`Gateway transcription relay requires ${RELAY_INPUT_ENCODING}/${RELAY_INPUT_SAMPLE_RATE_HZ} audio`);\n" +
  "}";

const RESOLVE_FN =
  "function resolveRelayInputAudioConfig(providerConfig) {\n" +
  "\tconst encodingValue = providerConfig.encoding ?? providerConfig.audioFormat ?? providerConfig.audio_format;\n" +
  "\tconst inputEncoding = normalizeRelayInputEncoding(encodingValue) ?? RELAY_INPUT_ENCODING;\n" +
  "\tconst inputSampleRateHz = parseFiniteNumber(providerConfig.sampleRate ?? providerConfig.sample_rate) ?? inferSampleRateFromAudioFormat(encodingValue) ?? RELAY_INPUT_SAMPLE_RATE_HZ;\n" +
  "\treturn { inputEncoding, inputSampleRateHz };\n" +
  "}";

const CALL_SITE =
  "\tassertRelayInputAudioConfig(params.providerConfig);\n\tconst transcriptionSessionId";
const CALL_SITE_PATCHED =
  "\tconst audioConfig = resolveRelayInputAudioConfig(params.providerConfig);\n\tconst transcriptionSessionId";

const RESPONSE =
  "\t\taudio: {\n\t\t\tinputEncoding: RELAY_INPUT_ENCODING,\n\t\t\tinputSampleRateHz: RELAY_INPUT_SAMPLE_RATE_HZ\n\t\t},";
const RESPONSE_PATCHED = "\t\taudio: audioConfig,";

const found = findRelayChunk(distDir);
if (!found) {
  console.error(`[talk-patch] no relay chunk found in ${distDir} — is this an OpenClaw dist dir?`);
  process.exit(1);
}
if (found.patched) {
  // "Patched" was detected from the function name alone — verify the other two
  // replacements too. An openclaw update could regress the call site / response
  // while leaving the function, and a half-patched bundle breaks Talk silently.
  const fully =
    found.text.includes(CALL_SITE_PATCHED) && found.text.includes(RESPONSE_PATCHED);
  if (!fully) {
    console.error(
      `[talk-patch] HALF-patched bundle: ${path.basename(found.p)} has resolveRelayInputAudioConfig ` +
        "but the call-site/response replacements are missing. Restore the .pre-talk-patch " +
        "backup (or reinstall openclaw) and re-run.",
    );
    process.exit(1);
  }
  console.log(`[talk-patch] already patched: ${path.basename(found.p)} — nothing to do`);
  process.exit(0);
}

let { p, text } = found;
for (const [from, to] of [
  [ASSERT_FN, RESOLVE_FN],
  [CALL_SITE, CALL_SITE_PATCHED],
  [RESPONSE, RESPONSE_PATCHED],
]) {
  if (!text.includes(from)) {
    console.error(
      `[talk-patch] expected fragment not found in ${path.basename(p)} — bundle shape changed, aborting:\n${from.slice(0, 80)}…`,
    );
    process.exit(1);
  }
  text = text.replace(from, to);
}

const backup = `${p}.pre-talk-patch`;
if (!fs.existsSync(backup)) fs.copyFileSync(p, backup);
fs.writeFileSync(p, text);
console.log(`[talk-patch] patched ${path.basename(p)} (backup: ${path.basename(backup)})`);
console.log("[talk-patch] restart the gateway: systemctl --user restart openclaw-gateway");
