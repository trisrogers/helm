#!/usr/bin/env node
// Spike setup: create the EVI tools + a themed config on Hume via REST.
// Throwaway — exists only to answer "can EVI be fluid + themed + call openclaw at once?".
//
// Usage:
//   HUME_API_KEY=sk-... node spikes/hume-evi/setup.mjs            # default theme: blizzard
//   HUME_API_KEY=sk-... THEME=politburo node spikes/hume-evi/setup.mjs
//
// Prints the configId. Put it (and your key) in repo-root .env.local:
//   VITE_HUME_API_KEY=sk-...
//   VITE_HUME_CONFIG_ID=<printed id>

const API = 'https://api.hume.ai/v0/evi';
const KEY = process.env.HUME_API_KEY;
const THEME = (process.env.THEME || 'assay').toLowerCase();
// Override the theme's voice with a custom voice ID (provider CUSTOM_VOICE).
const VOICE_ID = process.env.HUME_VOICE_ID;
// Tool use needs a supplemental LLM — Claude/GPT/Gemini/Moonshot only. We use Claude
// so this doubles as the "fast brain + openclaw-as-tools" hybrid we want to evaluate.
const MODEL = process.env.HUME_MODEL || 'claude-sonnet-4-20250514';

if (!KEY) { console.error('Set HUME_API_KEY'); process.exit(1); }

// Persona + voice per Helm theme. Voice names are Hume preset voices — swap freely
// in the Hume portal; this just seeds something themed for the demo.
const THEMES = {
  blizzard: {
    name: 'THE VOICE',
    voiceId: '0fbf6394-16d1-45eb-97d9-591680dcad89', // "Russel" custom voice
    voice: 'Aura',
    prompt:
      'You are THE VOICE, the calm guiding intelligence of an expedition base camp ' +
      'in a frozen wilderness. Speak with quiet, measured warmth and economy. You can ' +
      'consult the camp instruments via your tools. Keep replies short and spoken-natural.',
  },
  assay: {
    name: 'DELTRON',
    // "Gazza" custom voice for Assay. Override with HUME_VOICE_ID if you make others.
    voiceId: '8115ee9a-2d6d-4204-b60b-72e67c3d1b3e',
    voice: 'Ito',
    prompt:
      'You are DELTRON, the steward of a gilded assay office and engine room. Speak ' +
      'with precise, slightly ornate authority. Use your tools to read the live ledger ' +
      'of channels and sessions. Keep replies short and spoken-natural.',
  },
  politburo: {
    name: 'UNIT-7',
    voiceId: '1e450352-fff7-40ac-8e3b-2b7ccc8cfaf0', // "Natasha" custom voice
    voice: 'Dacher',
    prompt:
      'You are UNIT-7, the central command apparatus. Speak in clipped, confident, ' +
      'utilitarian cadence. Consult the apparatus via your tools before reporting ' +
      'status. Keep replies short and spoken-natural.',
  },
};
const T = THEMES[THEME];
if (!T) { console.error(`Unknown THEME "${THEME}" (blizzard|assay|politburo)`); process.exit(1); }

// Tool schemas. These mirror the bridge registry in SpikeEvi.tsx — keep names in sync.
const TOOLS = [
  {
    name: 'get_camp_status',
    description: 'Get live OpenClaw gateway status: channels, sessions, agents, approvals.',
    fallback_content: 'The camp instruments are not responding right now.',
    parameters: JSON.stringify({ type: 'object', properties: {}, required: [] }),
  },
  {
    name: 'list_sessions',
    description: 'List the active OpenClaw sessions (agent conversations) currently running.',
    fallback_content: 'Unable to reach the session registry.',
    parameters: JSON.stringify({ type: 'object', properties: {}, required: [] }),
  },
];

async function api(path, body, method = 'POST') {
  const res = await fetch(API + path, {
    method,
    headers: { 'X-Hume-Api-Key': KEY, 'Content-Type': 'application/json' },
    body: body ? JSON.stringify(body) : undefined,
  });
  const text = await res.text();
  if (!res.ok) {
    const err = new Error(`${method} ${path} → ${res.status}: ${text}`);
    err.status = res.status;
    throw err;
  }
  return text ? JSON.parse(text) : {};
}

// Idempotent: create the tool, or reuse the existing one if the name is taken (409).
async function ensureTool(t) {
  try {
    const created = await api('/tools', t);
    return created.id;
  } catch (e) {
    if (e.status !== 409) throw e;
    const list = await api(`/tools?page_number=0&page_size=100`, null, 'GET');
    const tools = list.tools_page || list.tools || [];
    const match = tools.find((x) => x.name === t.name);
    if (!match) throw new Error(`409 on ${t.name} but not found in tool list`);
    return match.id;
  }
}

const main = async () => {
  console.log(`Theme: ${THEME} (${T.name}) · model: ${MODEL}`);

  const toolIds = [];
  for (const t of TOOLS) {
    const id = await ensureTool(t);
    console.log(`  tool ${t.name} → ${id}`);
    toolIds.push({ id });
  }

  // Custom voice → reference by id + CUSTOM_VOICE; otherwise a Voice Library name.
  const voiceId = VOICE_ID || T.voiceId;
  const voice = voiceId
    ? { provider: 'CUSTOM_VOICE', id: voiceId }
    : { provider: 'HUME_AI', name: T.voice };
  console.log(`  voice: ${voiceId ? `custom ${voiceId}` : `HUME_AI ${T.voice}`}`);

  const config = await api('/configs', {
    evi_version: '3',
    name: `Helm Spike — ${T.name}`,
    prompt: { text: T.prompt },
    voice,
    language_model: { model_provider: 'ANTHROPIC', model_resource: MODEL, temperature: 0.7 },
    tools: toolIds,
  });

  console.log('\n✅ Config created.');
  console.log(`\nVITE_HUME_CONFIG_ID=${config.id}`);
  console.log('\nAdd that + VITE_HUME_API_KEY to repo-root .env.local, then: npm run spike:evi');
};

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
