# Hume EVI spike — the "all-in-one" path

**Question this answers:** can a *single* Hume EVI session be fluid (2), themed
enough for demos (3), **and** integrated with openclaw (1) at the same time — so
that Daily and Demo collapse into one mode instead of a toggle?

Throwaway. Delete with `rm -rf spikes/hume-evi` (and `npm rm @humeai/voice-react`).

## What it does

- Runs EVI in the browser via `@humeai/voice-react` (mic + playback + socket handled by the SDK).
- Uses a themed EVI **config** (persona prompt + Hume voice + supplemental Claude LLM).
- Bridges EVI **tool calls** to the live openclaw gateway by reusing the app's
  `OpenClawClient` (`get_camp_status` → `channels.status`, `list_sessions` → `sessions.list`).
- Shows the transcript + a tool-call log (name, args, result, latency) so you can
  *see* the integration fire while you judge the *feel*.

## The catch it exposes

EVI tool use **requires a supplemental LLM** (Claude/GPT/Gemini). So "fluid + calls
openclaw" is not pure native-S2S — a text LLM decides the tool calls under the hood.
We set that LLM to **Claude**, which makes this the "fast brain + openclaw-as-tools"
hybrid. Judge whether that hybrid is fluid *and* themed enough to be the one mode.

## Run

1. **Create the EVI config** (needs your Hume API key):
   ```bash
   HUME_API_KEY=sk-... node spikes/hume-evi/setup.mjs
   # or: HUME_API_KEY=sk-... THEME=assay node spikes/hume-evi/setup.mjs   (blizzard|assay|politburo)
   ```
2. **Add credentials** to repo-root `.env.local` (gitignored via `*.local`):
   ```
   VITE_HUME_API_KEY=sk-...
   VITE_HUME_CONFIG_ID=<id printed by setup.mjs>
   ```
3. **Make sure** the openclaw gateway is up (ws://localhost:18789).
4. **Start it:**
   ```bash
   npm run spike:evi    # → https://localhost:5273
   ```
   Accept the self-signed cert (needed for mic access). The spike runs on its own
   origin (:5273), so paste your `helm:token` into the field at the top (it won't
   inherit from the main app's localStorage). Then click **Start talking** and try:
   *"What's the camp status?"* / *"List the active sessions."*

## Verdict rubric

| Dimension | Watch for |
|---|---|
| **Fluid (2)** | Latency to first audio, barge-in, does it feel conversational vs the stilted pipeline? |
| **Themed (3)** | Is the voice + persona distinctive enough to wow in a demo? (swap the voice in the Hume portal to taste) |
| **Integrated (1)** | Tool calls land on the live gateway, return fast, and EVI narrates the real data. |

If all three land → drop the Daily/Demo toggle. If themed voice is the weak link →
keep ElevenLabs Demo mode. If fluidity drops too much in tool-use mode → keep the
fast-S2S Daily mode separate.
