import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { markdown } from '@codemirror/lang-markdown';
import { json } from '@codemirror/lang-json';
import { tags as t } from '@lezer/highlight';
import { useGateway } from '../context/GatewayContext';

interface AgentRow {
  id: string;
  name?: string;
  identity?: { name?: string; emoji?: string };
}

interface FileEntry {
  name: string;
  path: string;
  missing: boolean;
  size?: number;
  updatedAtMs?: number;
}

interface FileGetResult {
  agentId: string;
  workspace: string;
  file: FileEntry & { content: string };
}

interface FileSetResult {
  ok: true;
  agentId: string;
  workspace: string;
  file: FileEntry & { content: string };
}

/* ── helpers ──────────────────────────────────────────────────── */

function langForFile(name: string) {
  if (name.endsWith('.json')) return [json()];
  return [markdown()];
}

/** Rough token estimate: characters / 4. Good enough for a preview pane. */
function estimateTokens(content: string | undefined, sizeBytes: number | undefined): number {
  if (typeof content === 'string') return Math.ceil(content.length / 4);
  if (typeof sizeBytes === 'number') return Math.ceil(sizeBytes / 4);
  return 0;
}

/* ── editor theme — tied to CSS vars so it changes per Helm theme ─ */

const helmHighlight = HighlightStyle.define([
  { tag: t.heading1, color: 'var(--acc)', fontWeight: '700' },
  { tag: t.heading2, color: 'var(--acc2)', fontWeight: '600' },
  { tag: [t.heading3, t.heading4, t.heading5, t.heading6], color: 'var(--acc2)' },
  { tag: t.strong, color: 'var(--ok)', fontWeight: '700' },
  { tag: t.emphasis, color: 'var(--blue)', fontStyle: 'italic' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: t.comment, color: 'var(--ink2)', fontStyle: 'italic' },
  { tag: t.keyword, color: 'var(--acc)', fontWeight: '600' },
  { tag: t.atom, color: 'var(--acc)' },
  { tag: t.number, color: 'var(--blue)' },
  { tag: t.propertyName, color: 'var(--acc2)' },
  { tag: t.url, color: 'var(--blue)', textDecoration: 'underline' },
  { tag: t.monospace, color: 'var(--acc)', fontFamily: 'var(--fm)' },
]);

const helmEditorTheme = EditorView.theme({
  '&': {
    height: '100%',
    fontSize: '12px',
    fontFamily: 'var(--fm)',
    color: 'var(--ink)',
    backgroundColor: 'var(--bg)',
  },
  '.cm-scroller': { fontFamily: 'var(--fm)' },
  '.cm-content': { caretColor: 'var(--acc)', padding: '8px 0' },
  '.cm-gutters': {
    backgroundColor: 'var(--surf)',
    color: 'var(--ink2)',
    border: 'none',
    borderRight: '1px solid var(--brd)',
    fontSize: '11px',
  },
  '.cm-activeLine': { backgroundColor: 'transparent' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--glow)', color: 'var(--acc)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--glow) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--acc)' },
  '.cm-matchingBracket': { color: 'var(--acc)', outline: '1px solid var(--acc)' },
});

/* ── Editor ──────────────────────────────────────────────────── */

export default function Editor() {
  const { client, status } = useGateway();
  const [agents, setAgents] = useState<AgentRow[]>([]);
  const [agentId, setAgentId] = useState<string | null>(null);
  const [files, setFiles] = useState<FileEntry[] | null>(null);
  const [workspace, setWorkspace] = useState<string | null>(null);
  const [activeFile, setActiveFile] = useState<string | null>(null);
  const [loadedContent, setLoadedContent] = useState<string>('');
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [savedAtMs, setSavedAtMs] = useState<number | null>(null);
  const [tokenEstimates, setTokenEstimates] = useState<Record<string, number>>({});

  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const dirtyRef = useRef(false);

  /* fetch agents */
  useEffect(() => {
    if (!client || status !== 'connected') return;
    client.call<{ agents: AgentRow[] }>('agents.list')
      .then(r => {
        const list = r.agents ?? [];
        setAgents(list);
        setAgentId(prev => prev ?? list[0]?.id ?? null);
      })
      .catch(e => console.warn('[editor] agents.list failed', e));
  }, [client, status]);

  /* fetch file list when agent changes */
  const refreshFiles = useCallback(async () => {
    if (!client || status !== 'connected' || !agentId) return;
    try {
      const r = await client.call<{ agentId: string; workspace: string; files: FileEntry[] }>(
        'agents.files.list',
        { agentId },
      );
      setFiles(r.files);
      setWorkspace(r.workspace);
      setActiveFile(prev => {
        if (prev && r.files.some(f => f.name === prev)) return prev;
        const first = r.files.find(f => !f.missing) ?? r.files[0];
        return first?.name ?? null;
      });
    } catch (e) {
      console.warn('[editor] agents.files.list failed', e);
    }
  }, [client, status, agentId]);

  useEffect(() => { refreshFiles(); }, [refreshFiles]);

  /* fetch content when the active file (or its existence) changes. Deliberately
     NOT keyed on the whole `files` array: list refreshes/saves update metadata,
     and refetching then would clobber a dirty editor buffer. */
  const activeIsMissing = files?.find(f => f.name === activeFile)?.missing ?? false;
  useEffect(() => {
    if (!client || status !== 'connected' || !agentId || !activeFile) {
      setLoadedContent('');
      return;
    }
    if (activeIsMissing) {
      setLoadedContent('');
      setDirty(false);
      dirtyRef.current = false;
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const r = await client.call<FileGetResult>('agents.files.get', { agentId, name: activeFile });
        if (cancelled) return;
        setLoadedContent(r.file.content);
        setDirty(false);
        dirtyRef.current = false;
        setSaveError(null);
        setSavedAtMs(r.file.updatedAtMs ?? null);
        setTokenEstimates(prev => ({ ...prev, [r.file.name]: estimateTokens(r.file.content, r.file.size) }));
      } catch (e) {
        if (!cancelled) {
          setLoadedContent('');
          setSaveError(e instanceof Error ? e.message : 'load failed');
        }
      }
    })();
    return () => { cancelled = true; };
  }, [client, status, agentId, activeFile, activeIsMissing]);

  /* mount CodeMirror once */
  useEffect(() => {
    if (!editorParentRef.current || viewRef.current) return;
    const view = new EditorView({
      parent: editorParentRef.current,
      state: EditorState.create({
        doc: '',
        extensions: [
          lineNumbers(),
          highlightActiveLineGutter(),
          highlightActiveLine(),
          drawSelection(),
          history(),
          bracketMatching(),
          indentOnInput(),
          syntaxHighlighting(helmHighlight),
          helmEditorTheme,
          keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
          EditorView.lineWrapping,
          markdown(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged && !dirtyRef.current) {
              dirtyRef.current = true;
              setDirty(true);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => {
      view.destroy();
      viewRef.current = null;
    };
  }, []);

  /* swap doc + language whenever activeFile content arrives */
  useEffect(() => {
    const view = viewRef.current;
    if (!view) return;
    const ext = activeFile ? langForFile(activeFile) : [markdown()];
    view.setState(EditorState.create({
      doc: loadedContent,
      extensions: [
        lineNumbers(),
        highlightActiveLineGutter(),
        highlightActiveLine(),
        drawSelection(),
        history(),
        bracketMatching(),
        indentOnInput(),
        syntaxHighlighting(helmHighlight),
        helmEditorTheme,
        keymap.of([...defaultKeymap, ...historyKeymap, indentWithTab]),
        EditorView.lineWrapping,
        ...ext,
        EditorView.updateListener.of((update) => {
          if (update.docChanged && !dirtyRef.current) {
            dirtyRef.current = true;
            setDirty(true);
          }
        }),
      ],
    }));
    dirtyRef.current = false;
    setDirty(false);
  }, [loadedContent, activeFile]);

  /* save */
  const handleSave = useCallback(async () => {
    if (!client || !agentId || !activeFile || !viewRef.current) return;
    const content = viewRef.current.state.doc.toString();
    setSaving(true);
    setSaveError(null);
    try {
      const r = await client.call<FileSetResult>('agents.files.set', {
        agentId,
        name: activeFile,
        content,
      });
      setDirty(false);
      dirtyRef.current = false;
      setSavedAtMs(r.file.updatedAtMs ?? Date.now());
      setTokenEstimates(prev => ({ ...prev, [activeFile]: estimateTokens(content, content.length) }));
      // refresh size in the list
      setFiles(prev => prev?.map(f => f.name === activeFile
        ? { ...f, missing: false, size: content.length, updatedAtMs: r.file.updatedAtMs }
        : f) ?? prev);
    } catch (e) {
      setSaveError(e instanceof Error ? e.message : 'save failed');
    } finally {
      setSaving(false);
    }
  }, [client, agentId, activeFile]);

  const handleRevert = () => {
    const view = viewRef.current;
    if (!view) return;
    view.dispatch({
      changes: { from: 0, to: view.state.doc.length, insert: loadedContent },
    });
    dirtyRef.current = false;
    setDirty(false);
  };

  /* keyboard: Ctrl/Cmd+S to save */
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if ((e.metaKey || e.ctrlKey) && e.key === 's') {
        e.preventDefault();
        if (dirty && !saving) handleSave();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [dirty, saving, handleSave]);

  /* context preview values */
  const contextSection = useMemo(() => {
    if (!files) return null;
    const present = files.filter(f => !f.missing);
    const withTokens = present.map(f => ({
      name: f.name,
      tokens: tokenEstimates[f.name] ?? estimateTokens(undefined, f.size),
    }));
    const total = withTokens.reduce((n, f) => n + f.tokens, 0);
    return { entries: withTokens, total };
  }, [files, tokenEstimates]);

  const selectedAgent = agents.find(a => a.id === agentId);
  const savedLabel = savedAtMs ? new Date(savedAtMs).toLocaleTimeString('en-GB') : null;
  const fileStatusPill = dirty
    ? { cls: 'pill-idle', text: 'Modified' }
    : saving
    ? { cls: 'pill-idle', text: 'Saving…' }
    : { cls: 'pill-ok', text: savedLabel ? `Saved ${savedLabel}` : 'Saved' };

  return (
    <div id="screen-editor" className="screen">
      <div className="editor-tree">
        {status !== 'connected' && (
          <div style={{ padding: '12px', fontSize: '11px', color: 'var(--ink2)' }}>
            {status === 'connecting' ? 'Connecting…' : 'Not connected'}
          </div>
        )}
        {status === 'connected' && agents.length > 0 && (
          <div style={{ padding: '8px 12px 8px' }}>
            <div className="tree-section" style={{ padding: '0 0 4px' }}>Agent</div>
            <select
              value={agentId ?? ''}
              onChange={e => setAgentId(e.target.value || null)}
              style={{ width: '100%', fontSize: '11px', padding: '4px 6px' }}
            >
              {agents.map(a => (
                <option key={a.id} value={a.id}>
                  {a.identity?.emoji ? `${a.identity.emoji} ` : ''}
                  {a.name ?? a.identity?.name ?? a.id}
                </option>
              ))}
            </select>
          </div>
        )}
        <div className="tree-section">Agent Files</div>
        {files == null && status === 'connected' && (
          <div style={{ padding: '8px 12px', fontSize: '11px', color: 'var(--ink2)' }}>Loading…</div>
        )}
        {files?.map(f => {
          const isActive = f.name === activeFile;
          const isModified = isActive && dirty;
          return (
            <div
              key={f.name}
              className={`tree-item ${isActive ? 'active' : ''} ${isModified ? 'modified' : ''}`}
              style={{ opacity: f.missing ? 0.5 : 1 }}
              onClick={() => setActiveFile(f.name)}
              title={f.missing ? `${f.name} (not created)` : f.path}
            >
              📄 {f.name}
            </div>
          );
        })}
      </div>

      <div className="editor-main">
        <div className="editor-toolbar">
          <span className="editor-file">{activeFile ?? '—'}</span>
          <span className={`pill ${fileStatusPill.cls}`}>{fileStatusPill.text}</span>
          {saveError && <span style={{ color: 'var(--err)', fontSize: '10px' }}>{saveError}</span>}
          <button
            className="btn"
            style={{ fontSize: '10px', padding: '3px 8px' }}
            onClick={handleSave}
            disabled={!dirty || saving || !activeFile}
          >Save</button>
          <button
            className="btn btn-ghost"
            style={{ fontSize: '10px', padding: '3px 8px' }}
            onClick={handleRevert}
            disabled={!dirty || !activeFile}
          >Revert</button>
        </div>
        <div className="editor-body">
          <div ref={editorParentRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
        </div>
      </div>

      <div className="editor-ctx">
        <div className="ctx-head">Context Assembly Preview</div>
        <div className="ctx-section">
          <div style={{ fontSize: '10px', color: 'var(--ink2)', marginBottom: '6px' }}>
            {selectedAgent
              ? `Files for ${selectedAgent.name ?? selectedAgent.id}:`
              : 'Files injected at session start:'}
          </div>
          {contextSection?.entries.length === 0 && (
            <div style={{ fontSize: '10px', color: 'var(--ink2)' }}>No files present yet.</div>
          )}
          {contextSection?.entries.map(f => (
            <div key={f.name} className="ctx-file">
              <span className="ctx-file-name">{f.name}</span>
              <span className="ctx-file-tokens">{f.tokens.toLocaleString()} tokens</span>
            </div>
          ))}
        </div>
        <div className="ctx-total">
          <span style={{ color: 'var(--ink2)' }}>Total estimate</span>
          <span style={{ color: 'var(--acc)', fontFamily: 'var(--fm)' }}>
            {(contextSection?.total ?? 0).toLocaleString()} tokens
          </span>
        </div>
        {workspace && (
          <div style={{ padding: '8px 12px', borderTop: '1px solid var(--brd)', fontSize: '10px', color: 'var(--ink2)', wordBreak: 'break-all' }}>
            <div style={{ marginBottom: '4px', color: 'var(--ink2)' }}>Workspace</div>
            <div style={{ fontFamily: 'var(--fm)', color: 'var(--ink)' }}>{workspace}</div>
          </div>
        )}
      </div>
    </div>
  );
}
