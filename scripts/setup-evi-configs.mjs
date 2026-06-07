#!/usr/bin/env node
// Create/refresh the three per-theme Hume EVI configs used by Talk "Cloud" mode.
//
// Each config = a custom voice + persona prompt + supplemental Claude LLM + the
// four bridged tools (3 fast reads + the ask_openclaw passthrough). Tools are
// shared across configs and created idempotently (reused on 409).
//
// Usage:
//   HUME_API_KEY=sk-... node scripts/setup-evi-configs.mjs
//
// Prints VITE_HUME_CONFIG_<THEME> lines — paste them into repo-root .env.local.
// (Config IDs are not secret; the API/secret keys never appear in the bundle.)

const API = 'https://api.hume.ai/v0/evi';
const KEY = process.env.HUME_API_KEY;
// Tool use requires a supplemental LLM (Claude/GPT/Gemini). Claude makes this the
// "fast themed mouth + openclaw deep brain" hybrid. Bump if Hume discontinues it.
const MODEL = process.env.HUME_MODEL || 'claude-sonnet-4-20250514';

if (!KEY) { console.error('Set HUME_API_KEY'); process.exit(1); }

// Appended to every persona prompt. ask_openclaw runs a full agent turn (often
// several seconds), so EVI must speak a short "here's what I'm doing" line BEFORE
// calling it — EVI voices assistant text that precedes a tool call, which fills
// the otherwise-silent pause. Mirrors the local pipeline's pre-tool acknowledgment.
const ACK =
  ' IMPORTANT: ask_openclaw can take several seconds. Whenever you use it, FIRST ' +
  'say one short spoken sentence telling the user what you are about to do — naming ' +
  'the thing, e.g. "Let me pull up your recent emails" or "One moment, checking your ' +
  'open tasks" — and THEN call the tool. Never call ask_openclaw without speaking first.';

// agentName = how EVI refers to itself (matches AGENT_NAME in Talk.tsx).
// voiceId = the user's custom Hume voice for that theme.
const THEMES = {
  assay: {
    key: 'ASSAY',
    agentName: 'DELTRON',
    voiceId: '8115ee9a-2d6d-4204-b60b-72e67c3d1b3e', // Gazza
    prompt:
      'You are DELTRON, steward of a gilded assay office and engine room. Speak with ' +
      'precise, slightly ornate authority, in brief natural spoken sentences (no lists, ' +
      'no markdown). For a quick read of the gateway use get_camp_status / list_sessions / ' +
      'get_usage. For anything else — email, files, tasks, web, memory, multi-step work — ' +
      'delegate to the OpenClaw agent via ask_openclaw and relay its answer in your own voice.',
  },
  politburo: {
    key: 'POLITBURO',
    agentName: 'UNIT-7',
    voiceId: '1e450352-fff7-40ac-8e3b-2b7ccc8cfaf0', // Natasha
    prompt:
      'You are UNIT-7, the central command apparatus. Speak in clipped, confident, ' +
      'utilitarian cadence, in brief spoken sentences (no lists, no markdown). For a quick ' +
      'read of the apparatus use get_camp_status / list_sessions / get_usage. For anything ' +
      'else — email, files, directives, web, memory, multi-step work — delegate to the ' +
      'OpenClaw agent via ask_openclaw and report its answer.',
  },
  blizzard: {
    key: 'BLIZZARD',
    agentName: 'THE VOICE',
    voiceId: '0fbf6394-16d1-45eb-97d9-591680dcad89', // Russel
    prompt:
      'You are THE VOICE, the calm guiding intelligence of an expedition base camp in a ' +
      'frozen wilderness. Speak with quiet, measured warmth and economy, in brief spoken ' +
      'sentences (no lists, no markdown). For a quick read of the camp instruments use ' +
      'get_camp_status / list_sessions / get_usage. For anything else — email, field docs, ' +
      'expeditions, web, memory, multi-step work — delegate to the OpenClaw agent via ' +
      'ask_openclaw and relay its answer.',
  },
};

// Tool schemas. Names MUST match the bridge registry in src/lib/talk-evi.ts.
const TOOLS = [
  {
    name: 'get_camp_status',
    description: 'Live OpenClaw gateway status: channels, sessions, agents, approvals.',
    fallback_content: 'The gateway instruments are not responding.',
    parameters: JSON.stringify({ type: 'object', properties: {}, required: [] }),
  },
  {
    name: 'list_sessions',
    description: 'List the active OpenClaw sessions (agent conversations) currently running.',
    fallback_content: 'Unable to reach the session registry.',
    parameters: JSON.stringify({ type: 'object', properties: {}, required: [] }),
  },
  {
    name: 'get_usage',
    description: 'Current OpenClaw usage / quota status.',
    fallback_content: 'Usage data is unavailable.',
    parameters: JSON.stringify({ type: 'object', properties: {}, required: [] }),
  },
  {
    name: 'ask_openclaw',
    description:
      'Delegate a request to the OpenClaw agent, which has full access to tools, memory, ' +
      'files, email, web, and multi-step workflows. Use this for anything beyond a quick ' +
      'status read. Returns the agent\'s answer for you to relay aloud.',
    fallback_content: 'The OpenClaw agent could not complete that request.',
    parameters: JSON.stringify({
      type: 'object',
      properties: {
        request: { type: 'string', description: "The user's request, in plain language." },
      },
      required: ['request'],
    }),
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
    return (await api('/tools', t)).id;
  } catch (e) {
    if (e.status !== 409) throw e;
    const list = await api('/tools?page_number=0&page_size=100', null, 'GET');
    const match = (list.tools_page || list.tools || []).find((x) => x.name === t.name);
    if (!match) throw new Error(`409 on ${t.name} but not found in tool list`);
    return match.id;
  }
}

const main = async () => {
  console.log(`model: ${MODEL}`);
  const toolIds = [];
  for (const t of TOOLS) {
    const id = await ensureTool(t);
    console.log(`  tool ${t.name} → ${id}`);
    toolIds.push({ id });
  }

  const envLines = [];
  let updatedInPlace = 0;
  for (const [theme, T] of Object.entries(THEMES)) {
    const body = {
      evi_version: '3',
      name: `Helm — ${T.agentName} (${theme})`,
      prompt: { text: T.prompt + ACK },
      voice: { provider: 'CUSTOM_VOICE', id: T.voiceId },
      language_model: { model_provider: 'ANTHROPIC', model_resource: MODEL, temperature: 0.7 },
      tools: toolIds,
    };
    // If the config ID is already known (passed via env), create a new VERSION of
    // it in place — stable ID, EVI uses the latest version, so no .env.local change
    // or prod restart. Otherwise create a fresh config.
    const existing = process.env[`VITE_HUME_CONFIG_${T.key}`];
    if (existing) {
      const config = await api(`/configs/${existing}`, body); // createConfigVersion
      console.log(`  updated ${theme} (${T.agentName}) → ${config.id} v${config.version}`);
      updatedInPlace++;
    } else {
      const config = await api('/configs', body);
      console.log(`  created ${theme} (${T.agentName}) → ${config.id}`);
      envLines.push(`VITE_HUME_CONFIG_${T.key}=${config.id}`);
    }
  }

  if (envLines.length) {
    console.log('\n✅ New configs created. Add to repo-root .env.local:\n');
    console.log(envLines.join('\n'));
  } else {
    console.log(`\n✅ Updated ${updatedInPlace} configs in place (new versions). Just reconnect — no env change or restart needed.`);
  }
};

main().catch((e) => { console.error('\n❌', e.message); process.exit(1); });
