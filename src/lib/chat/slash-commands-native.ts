/**
 * Native slash-command registry for Helm.
 *
 * NOT a port of openclaw-src's `slash-commands.ts` + `slash-command-executor.ts`.
 * The upstream registry pulls in ~1.5k LOC of gateway code (`src/auto-reply/
 * commands-registry.shared.ts` + deps) for commands that mostly need additional
 * UI integration to be meaningful (`/steer`, `/redirect`, `/kill`, `/usage`,
 * `/agents`, etc). This file ships the high-value subset directly.
 *
 * To add a new command:
 *   1. Add an entry to BUILTIN_COMMANDS
 *   2. Add a case in executeSlashCommand
 *
 * To switch to the upstream registry later, replace BUILTIN_COMMANDS with
 * `buildBuiltinChatCommands()` from the vendored module and route execution
 * through `executeSlashCommand` from the vendored executor.
 */

export type SlashCommandHandlers = {
  setModel: (qualifiedValue: string) => Promise<void> | void;
  setThinking: (level: string) => Promise<void> | void;
  compact: () => Promise<void> | void;
  reset: () => Promise<void> | void;
  clearLocal: () => void;
  exportChat: () => void;
  newSession: () => Promise<void> | void;
};

export type SlashCommandDef = {
  key: string;
  aliases?: string[];
  description: string;
  args?: string;
};

export const BUILTIN_COMMANDS: readonly SlashCommandDef[] = [
  { key: 'model', args: '<model>', description: 'Set the model for this session. Empty to reset.' },
  { key: 'think', aliases: ['thinking'], args: '<off|minimal|low|medium|high>', description: 'Set thinking level.' },
  { key: 'compact', description: 'Compact the session context.' },
  { key: 'reset', description: 'Reset the session transcript on the gateway.' },
  { key: 'clear', description: 'Clear messages locally (does not touch the gateway).' },
  { key: 'export', description: 'Download the conversation as Markdown.' },
  { key: 'new', description: 'Start a new session with the default agent.' },
  { key: 'help', aliases: ['?'], description: 'List available slash commands.' },
];

const ALIAS_MAP = new Map<string, string>();
for (const cmd of BUILTIN_COMMANDS) {
  ALIAS_MAP.set(cmd.key, cmd.key);
  for (const alias of cmd.aliases ?? []) {
    ALIAS_MAP.set(alias, cmd.key);
  }
}

export function parseSlashInput(input: string): { command: string; args: string } | null {
  if (!input.startsWith('/')) return null;
  const trimmed = input.slice(1).trim();
  if (!trimmed) return null;
  const spaceIdx = trimmed.search(/\s/);
  const head = (spaceIdx === -1 ? trimmed : trimmed.slice(0, spaceIdx)).toLowerCase();
  const args = spaceIdx === -1 ? '' : trimmed.slice(spaceIdx + 1).trim();
  const resolved = ALIAS_MAP.get(head);
  if (!resolved) return null;
  return { command: resolved, args };
}

export function matchSlashCommands(input: string): SlashCommandDef[] {
  if (!input.startsWith('/')) return [];
  const head = input.slice(1).split(/\s/, 1)[0]?.toLowerCase() ?? '';
  if (!head) return [...BUILTIN_COMMANDS];
  return BUILTIN_COMMANDS.filter(c =>
    c.key.startsWith(head) || (c.aliases?.some(a => a.startsWith(head)) ?? false),
  );
}

export type SlashExecuteResult = {
  consumed: boolean;
  message?: string;
};

export async function executeSlashCommand(
  input: string,
  handlers: SlashCommandHandlers,
): Promise<SlashExecuteResult> {
  const parsed = parseSlashInput(input);
  if (!parsed) return { consumed: false };
  const { command, args } = parsed;
  switch (command) {
    case 'model':
      await handlers.setModel(args);
      return { consumed: true, message: args ? `model set to ${args}` : 'model reset to default' };
    case 'think':
      await handlers.setThinking(args);
      return { consumed: true, message: args ? `thinking set to ${args}` : 'thinking reset to default' };
    case 'compact':
      await handlers.compact();
      return { consumed: true, message: 'context compacted' };
    case 'reset':
      await handlers.reset();
      return { consumed: true, message: 'session reset' };
    case 'clear':
      handlers.clearLocal();
      return { consumed: true, message: 'cleared locally' };
    case 'export':
      handlers.exportChat();
      return { consumed: true };
    case 'new':
      await handlers.newSession();
      return { consumed: true, message: 'new session created' };
    case 'help': {
      const lines = BUILTIN_COMMANDS.map(c => {
        const usage = `/${c.key}${c.args ? ` ${c.args}` : ''}`;
        return `${usage.padEnd(28)} ${c.description}`;
      });
      return { consumed: true, message: lines.join('\n') };
    }
    default:
      return { consumed: false };
  }
}
