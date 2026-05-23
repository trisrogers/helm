export type Theme = 'assay' | 'politburo' | 'blizzard';

export type ScreenId =
  | 'overview'
  | 'chat'
  | 'talk'
  | 'design'
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
    design: 'Blueprint',
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
    design: 'Design Bureau',
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
    design: 'Blueprint',
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
