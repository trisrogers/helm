/**
 * Minimal chat-related type subset lifted from `openclaw-src/ui/src/ui/types.ts`.
 * Add to this file as more vendored modules need types — do NOT vendor the full
 * 794-line upstream `types.ts` (most of it is channel/integration types Helm doesn't use).
 */

export type ModelCatalogEntry = {
  id: string;
  name: string;
  provider: string;
  alias?: string;
  contextWindow?: number;
  reasoning?: boolean;
  input?: Array<'text' | 'image' | 'document'>;
};

export type GatewayThinkingLevelOption = {
  id: string;
  label: string;
};

/** Subset of a gateway session row used by chat-model-select-state. */
export type SessionRow = {
  key: string;
  model?: string | null;
  modelProvider?: string | null;
  thinkingLevel?: string | null;
};

/** Subset of gateway session defaults used by chat-model-select-state. */
export type SessionsDefaults = {
  model?: string | null;
  modelProvider?: string | null;
  thinkingLevel?: string | null;
};

export type SessionsListResult = {
  sessions: SessionRow[];
  defaults?: SessionsDefaults | null;
};
