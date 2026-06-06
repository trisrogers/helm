export type Theme = 'assay' | 'politburo' | 'blizzard';

export type ScreenId =
  | 'overview'
  | 'chat'
  | 'talk'
  | 'tasks'
  | 'goals'
  | 'orch'
  | 'editor'
  | 'skills'
  | 'plan';

export const NAV_LABELS: Record<Theme, Record<ScreenId, string>> = {
  assay: {
    overview: 'Engine Room',
    chat: 'Dispatches',
    talk: 'Telegraph',
    tasks: 'Works Orders',
    goals: 'Ventures',
    orch: 'Operations',
    editor: 'Cartography',
    skills: 'Craftsmen',
    plan: 'Build Plan',
  },
  politburo: {
    overview: 'Central Command',
    chat: 'Transmissions',
    talk: 'Broadcast',
    tasks: 'Directives',
    goals: 'Objectives',
    orch: 'Apparatus',
    editor: 'Archives',
    skills: 'Protocols',
    plan: 'Build Plan',
  },
  blizzard: {
    overview: 'Camp Status',
    chat: 'Field Notes',
    talk: 'Signal',
    tasks: 'Objectives',
    goals: 'Expeditions',
    orch: 'Ranger Network',
    editor: 'Field Docs',
    skills: 'Equipment',
    plan: 'Build Plan',
  },
};

export const THEME_META: Record<Theme, { name: string; sub: string }> = {
  assay: { name: 'Assay Office', sub: 'Birmingham Gateway' },
  politburo: { name: 'Politburo', sub: 'State Intelligence Network' },
  blizzard: { name: 'First Blizzard', sub: 'Great Bear Lake Station' },
};

/** Talk-mode TTS voice per theme. `voiceId` is a Kokoro voice; `speed` is the
 *  Kokoro speed multiplier (~0.5–2.0). Forwarded to the gateway's talk.speak,
 *  which routes them to the tts-local-kokoro sidecar.
 *  NOTE: politburo wants a Russian accent, which Kokoro v1.0 can't do — bf_alice
 *  is a stern British stand-in until a Russian-capable engine is wired in. */
export const THEME_VOICE: Record<Theme, { voiceId: string; speed: number }> = {
  blizzard: { voiceId: 'am_onyx', speed: 1.0 },
  assay: { voiceId: 'bm_lewis', speed: 1.15 },
  politburo: { voiceId: 'bf_alice', speed: 1.1 },
};
