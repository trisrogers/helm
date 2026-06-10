import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { tags as t } from '@lezer/highlight';
import {
  loadCanvasState,
  saveCanvasState,
  type DesignVersion,
} from '../lib/design-canvas-storage';

/* Storage helpers live in lib/design-canvas-storage (shared with Chat, which
 * reads the current doc for iteration context). The legacy global
 * `helm:design:versions` array is offered for one-time import via the
 * migration banner below. */
const migratedKey = (storageId: string) => `helm:design:canvas:${storageId}:migrated`;
const LEGACY_VERSIONS_KEY = 'helm:design:versions';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_SIZES: Record<Viewport, { w: number | string; h: number | string; label: string }> = {
  desktop: { w: '100%', h: '100%', label: 'Desktop' },
  tablet: { w: 768, h: 1024, label: 'Tablet' },
  mobile: { w: 390, h: 720, label: 'Mobile' },
};

/* ── editor theme ─────────────────────────────────────────────── */

const helmHighlight = HighlightStyle.define([
  { tag: t.tagName, color: 'var(--acc)' },
  { tag: t.attributeName, color: 'var(--acc2)' },
  { tag: t.attributeValue, color: 'var(--ok)' },
  { tag: [t.string, t.special(t.string)], color: 'var(--ok)' },
  { tag: t.comment, color: 'var(--ink2)', fontStyle: 'italic' },
  { tag: t.angleBracket, color: 'var(--ink2)' },
]);

const helmEditorTheme = EditorView.theme({
  '&': { height: '100%', fontSize: '12px', fontFamily: 'var(--fm)', color: 'var(--ink)', backgroundColor: 'var(--bg)' },
  '.cm-content': { caretColor: 'var(--acc)', padding: '8px 0' },
  '.cm-gutters': { backgroundColor: 'var(--surf)', color: 'var(--ink2)', border: 'none', borderRight: '1px solid var(--brd)' },
  '.cm-activeLineGutter': { backgroundColor: 'var(--glow)', color: 'var(--acc)' },
  '.cm-selectionBackground, .cm-content ::selection': { backgroundColor: 'var(--glow) !important' },
  '.cm-cursor': { borderLeftColor: 'var(--acc)' },
});

/* ── helpers ──────────────────────────────────────────────────── */

/** Legacy global versions, for the one-time import offer. */
function loadLegacyVersions(): DesignVersion[] {
  try {
    const raw = localStorage.getItem(LEGACY_VERSIONS_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is DesignVersion =>
      v && typeof v.id === 'string' && typeof v.label === 'string' && typeof v.html === 'string');
  } catch { return []; }
}

/** The one-time legacy import offer for this canvas: surface the old global
 *  versions only if this canvas has never been migrated and has none of its own.
 *  Computed at mount (the component is keyed by storageId, so it remounts when
 *  the canvas changes) rather than synced via an effect. */
function initialLegacyOffer(storageId: string, ownVersions: DesignVersion[]): DesignVersion[] {
  try {
    if (localStorage.getItem(migratedKey(storageId))) return [];
  } catch { return []; }
  if (ownVersions.length > 0) return [];
  return loadLegacyVersions();
}

function slugify(s: string): string {
  return s.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40) || 'design';
}

function downloadHTML(content: string, filename: string) {
  const blob = new Blob([content], { type: 'text/html' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  a.download = filename;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}

function buildArtifactMeta(label: string): string {
  return JSON.stringify({
    title: label,
    project: 'helm',
    description: `Design Bureau export from The Helm.`,
    createdAt: new Date().toISOString(),
    tags: ['helm', 'design-bureau'],
  }, null, 2);
}

/* ── DesignCanvas ─────────────────────────────────────────────── */

export interface DesignCanvasProps {
  /** localStorage bucket id. Each chat session passes its session key; the
   *  standalone scratchpad uses a fixed sentinel. */
  storageId: string;
  /** One-shot HTML to seed the editor with (e.g. extracted from the latest
   *  assistant reply). Applied when it changes to a new non-null value. */
  seedHTML?: string | null;
  /** Where the seed came from, shown in the status line. */
  seedLabel?: string;
  /** Rendered as a close button in the header when provided. */
  onClose?: () => void;
  /** Stack editor above preview instead of side-by-side (narrow panel). */
  compact?: boolean;
}

export default function DesignCanvas({ storageId, seedHTML, seedLabel, onClose, compact }: DesignCanvasProps) {
  const initial = useMemo(() => loadCanvasState(storageId), [storageId]);

  const [content, setContent] = useState<string>(initial.content);
  const [previewHTML, setPreviewHTML] = useState<string>(initial.content);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [versions, setVersions] = useState<DesignVersion[]>(initial.versions);
  const [activeId, setActiveId] = useState<string | null>(initial.activeId);
  const [labelDraft, setLabelDraft] = useState('');
  const [autoPreview, setAutoPreview] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(null);
  const [legacyOffer, setLegacyOffer] = useState<DesignVersion[]>(
    () => initialLegacyOffer(storageId, initial.versions),
  );

  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef(content);
  useEffect(() => { contentRef.current = content; });
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const appliedSeedRef = useRef<string | null>(null);

  // mount editor once
  useEffect(() => {
    if (!editorParentRef.current || viewRef.current) return;
    const view = new EditorView({
      parent: editorParentRef.current,
      state: EditorState.create({
        doc: contentRef.current,
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
          html(),
          EditorView.updateListener.of((update) => {
            if (update.docChanged) {
              setContent(update.state.doc.toString());
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  // Seed the editor from an external HTML payload (e.g. assistant reply).
  // Tracks the last applied value so re-renders don't clobber user edits.
  useEffect(() => {
    if (!seedHTML) return;
    if (appliedSeedRef.current === seedHTML) return;
    appliedSeedRef.current = seedHTML;
    const view = viewRef.current;
    if (view) {
      view.dispatch({ changes: { from: 0, to: view.state.doc.length, insert: seedHTML } });
    }
    setContent(seedHTML);
    setPreviewHTML(seedHTML);
    setStatusMsg(seedLabel ? `Loaded HTML from ${seedLabel}` : 'Loaded HTML');
  }, [seedHTML, seedLabel]);

  // debounced preview update
  useEffect(() => {
    if (!autoPreview) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewHTML(content);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [content, autoPreview]);

  // persist whole canvas state (content + versions + activeId), debounced so
  // every keystroke doesn't hit localStorage. persistRef holds the latest
  // snapshot so pending edits flush (rather than drop) on unmount or when the
  // canvas switches storageId mid-debounce.
  const persistRef = useRef({ storageId, content, versions, activeId });
  useEffect(() => {
    if (persistRef.current.storageId !== storageId) {
      const p = persistRef.current;
      saveCanvasState(p.storageId, { content: p.content, versions: p.versions, activeId: p.activeId });
    }
    persistRef.current = { storageId, content, versions, activeId };
    const id = setTimeout(() => {
      saveCanvasState(storageId, { content, versions, activeId });
    }, 400);
    return () => clearTimeout(id);
  }, [storageId, content, versions, activeId]);
  useEffect(() => () => {
    const p = persistRef.current;
    saveCanvasState(p.storageId, { content: p.content, versions: p.versions, activeId: p.activeId });
  }, []);

  const dismissLegacy = useCallback(() => {
    try { localStorage.setItem(migratedKey(storageId), '1'); } catch { /* quota */ }
    setLegacyOffer([]);
  }, [storageId]);

  const importLegacy = useCallback(() => {
    setVersions(prev => [...prev, ...legacyOffer]);
    setStatusMsg(`Imported ${legacyOffer.length} saved version${legacyOffer.length === 1 ? '' : 's'}`);
    dismissLegacy();
  }, [legacyOffer, dismissLegacy]);

  const handleSaveVersion = useCallback(() => {
    const label = labelDraft.trim() || `v${versions.length + 1}`;
    const v: DesignVersion = {
      id: `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 6)}`,
      label,
      html: contentRef.current,
      savedAt: Date.now(),
    };
    setVersions(prev => [...prev, v]);
    setActiveId(v.id);
    setLabelDraft('');
    setStatusMsg(`Saved ${label}`);
  }, [labelDraft, versions.length]);

  const handleLoadVersion = useCallback((id: string) => {
    const v = versions.find(x => x.id === id);
    if (!v || !viewRef.current) return;
    viewRef.current.dispatch({
      changes: { from: 0, to: viewRef.current.state.doc.length, insert: v.html },
    });
    setActiveId(id);
    setPreviewHTML(v.html);
    setStatusMsg(`Loaded ${v.label}`);
  }, [versions]);

  const handleDeleteVersion = useCallback((id: string) => {
    setVersions(prev => prev.filter(v => v.id !== id));
    setActiveId(prev => (prev === id ? null : prev));
  }, []);

  const handleRefreshPreview = () => setPreviewHTML(content);

  const handleExport = () => {
    const slug = `${new Date().toISOString().slice(0, 10)}-${slugify(labelDraft || 'design')}`;
    downloadHTML(content, `${slug}.html`);
    // also drop a meta.json next to it so the user can dump them into ~/artifacts/<slug>/
    downloadHTML(buildArtifactMeta(labelDraft || 'Untitled design'), `${slug}.meta.json`);
    setStatusMsg(`Exported ${slug}.html + meta`);
  };

  const vp = VIEWPORT_SIZES[viewport];
  const showSavePrompt = useMemo(() => {
    if (versions.length === 0) return true;
    const last = versions[versions.length - 1];
    return last.html !== content;
  }, [versions, content]);

  return (
    <div className={`design-canvas ${compact ? 'compact' : ''}`}>
      {legacyOffer.length > 0 && (
        <div className="design-canvas-migrate">
          <span>
            Import {legacyOffer.length} saved version{legacyOffer.length === 1 ? '' : 's'} from the old Design screen?
          </span>
          <span style={{ marginLeft: 'auto', display: 'flex', gap: '6px' }}>
            <button className="btn" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={importLegacy}>Import</button>
            <button className="btn btn-ghost" style={{ padding: '2px 8px', fontSize: '10px' }} onClick={dismissLegacy}>Dismiss</button>
          </span>
        </div>
      )}
      <div className="design-canvas-body">
        <div className="design-left">
          <div className="design-canvas-head">
            <span>Design session</span>
            <span className={`pill ${autoPreview ? 'pill-ok' : 'pill-idle'}`}>{autoPreview ? 'Live preview' : 'Manual'}</span>
            <span style={{ marginLeft: 'auto', color: showSavePrompt ? 'var(--warn)' : 'var(--ink2)' }}>
              {showSavePrompt ? 'Unsaved changes' : 'Up to date'}
            </span>
            {onClose && (
              <button
                className="btn btn-ghost"
                style={{ padding: '2px 7px', fontSize: '11px', marginLeft: '8px' }}
                onClick={onClose}
                title="Close the canvas"
              >✕</button>
            )}
          </div>
          <div style={{ flex: 1, minHeight: 0, display: 'flex', flexDirection: 'column' }}>
            <div ref={editorParentRef} style={{ flex: 1, minHeight: 0, overflow: 'hidden' }} />
          </div>
          <div className="version-list">
            <span style={{ fontSize: '10px', color: 'var(--ink2)', flexShrink: 0 }}>Versions:</span>
            {versions.length === 0 && (
              <span style={{ fontSize: '10px', color: 'var(--ink2)' }}>None yet — save a snapshot below.</span>
            )}
            {versions.map(v => (
              <div
                key={v.id}
                className={`version-chip ${v.id === activeId ? 'active' : ''}`}
                onClick={() => handleLoadVersion(v.id)}
                onContextMenu={(e) => { e.preventDefault(); handleDeleteVersion(v.id); }}
                title={`${v.label} — saved ${new Date(v.savedAt).toLocaleString('en-GB')} (right-click to delete)`}
              >{v.label}</div>
            ))}
          </div>
          <div className="composer" style={{ padding: '10px' }}>
            <div className="composer-row" style={{ gap: '6px' }}>
              <input
                placeholder="Version label (optional)…"
                value={labelDraft}
                onChange={e => setLabelDraft(e.target.value)}
                onKeyDown={e => { if (e.key === 'Enter') { e.preventDefault(); handleSaveVersion(); } }}
                style={{ flex: 1, fontSize: '12px', padding: '7px 10px' }}
              />
              <button className="btn" style={{ alignSelf: 'flex-end', padding: '7px 12px' }} onClick={handleSaveVersion}>
                Save ↓
              </button>
            </div>
            {statusMsg && (
              <div style={{ fontSize: '10px', color: 'var(--acc)', marginTop: '4px' }}>{statusMsg}</div>
            )}
          </div>
        </div>

        <div className="design-right">
          <div className="viewport-bar">
            <span style={{ color: 'var(--ink2)', marginRight: '4px' }}>Viewport:</span>
            {(Object.keys(VIEWPORT_SIZES) as Viewport[]).map(v => (
              <button
                key={v}
                className={`viewport-btn ${viewport === v ? 'active' : ''}`}
                onClick={() => setViewport(v)}
              >{VIEWPORT_SIZES[v].label}</button>
            ))}
            <span style={{ flex: 1 }} />
            <label style={{ fontSize: '10px', color: 'var(--ink2)', display: 'inline-flex', alignItems: 'center', gap: '4px' }}>
              <input
                type="checkbox"
                checked={autoPreview}
                onChange={e => setAutoPreview(e.target.checked)}
              /> auto
            </label>
            <button className="btn btn-ghost" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={handleRefreshPreview}>
              ↻ Refresh
            </button>
            <button className="btn btn-ghost" style={{ fontSize: '10px', padding: '3px 8px' }} onClick={handleExport}>
              ⬇ Export
            </button>
          </div>
          <div className="iframe-wrap" style={{ alignItems: 'center', justifyContent: 'center' }}>
            <div
              className="iframe-frame"
              style={{
                width: typeof vp.w === 'number' ? `${vp.w}px` : vp.w,
                height: typeof vp.h === 'number' ? `${vp.h}px` : vp.h,
                maxWidth: '100%',
                maxHeight: '100%',
                alignSelf: 'center',
              }}
            >
              <iframe
                title="design preview"
                srcDoc={previewHTML}
                sandbox="allow-scripts allow-forms"
                style={{ width: '100%', height: '100%', border: 0, background: '#fff' }}
              />
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}
