import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { EditorState } from '@codemirror/state';
import { EditorView, keymap, lineNumbers, highlightActiveLine, highlightActiveLineGutter, drawSelection } from '@codemirror/view';
import { defaultKeymap, history, historyKeymap, indentWithTab } from '@codemirror/commands';
import { bracketMatching, indentOnInput, syntaxHighlighting, HighlightStyle } from '@codemirror/language';
import { html } from '@codemirror/lang-html';
import { tags as t } from '@lezer/highlight';
import { consumeHandoff } from '../lib/handoff';

const STORAGE_KEY = 'helm:design:versions';

type Viewport = 'desktop' | 'tablet' | 'mobile';

const VIEWPORT_SIZES: Record<Viewport, { w: number | string; h: number | string; label: string }> = {
  desktop: { w: '100%', h: '100%', label: 'Desktop' },
  tablet: { w: 768, h: 1024, label: 'Tablet' },
  mobile: { w: 390, h: 720, label: 'Mobile' },
};

interface DesignVersion {
  id: string;
  label: string;
  html: string;
  savedAt: number;
}

const DEFAULT_HTML = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8">
  <meta name="viewport" content="width=device-width,initial-scale=1">
  <title>Untitled design</title>
  <style>
    body {
      font-family: -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif;
      margin: 0; padding: 32px;
      background: #f7f8fa; color: #1a1a2a;
    }
    h1 { color: #1a6bbf; margin: 0 0 8px; }
    p { line-height: 1.6; color: #444; }
    .card { background: #fff; padding: 20px; border-radius: 8px; box-shadow: 0 1px 4px rgba(0,0,0,.04); max-width: 480px; }
    button { background: #1a6bbf; color: #fff; border: 0; padding: 8px 16px; border-radius: 6px; cursor: pointer; font-size: 13px; }
  </style>
</head>
<body>
  <div class="card">
    <h1>Hello from the Design Bureau</h1>
    <p>Edit the source on the left, preview on the right. Save a snapshot to keep iterations around.</p>
    <button>A button</button>
  </div>
</body>
</html>`;

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

function loadVersions(): DesignVersion[] {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) return [];
    return parsed.filter((v): v is DesignVersion =>
      v && typeof v.id === 'string' && typeof v.label === 'string' && typeof v.html === 'string',
    );
  } catch { return []; }
}

function saveVersions(versions: DesignVersion[]) {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(versions)); } catch { /* ignore quota */ }
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

/* ── Design ───────────────────────────────────────────────────── */

export default function Design() {
  // Read any pending handoff from Chat before our initial state so the
  // editor mounts with the right HTML on first render.
  const initialHandoff = useMemo(() => consumeHandoff('design'), []);
  const seededHTML = initialHandoff?.html ?? DEFAULT_HTML;

  const [content, setContent] = useState<string>(seededHTML);
  const [previewHTML, setPreviewHTML] = useState<string>(seededHTML);
  const [viewport, setViewport] = useState<Viewport>('desktop');
  const [versions, setVersions] = useState<DesignVersion[]>(() => loadVersions());
  const [activeId, setActiveId] = useState<string | null>(null);
  const [labelDraft, setLabelDraft] = useState('');
  const [autoPreview, setAutoPreview] = useState(true);
  const [statusMsg, setStatusMsg] = useState<string | null>(
    initialHandoff
      ? initialHandoff.html
        ? `Loaded HTML from ${initialHandoff.sourceLabel ?? 'Chat'}`
        : `Arrived from ${initialHandoff.sourceLabel ?? 'Chat'} — no HTML found in latest reply`
      : null,
  );

  const editorParentRef = useRef<HTMLDivElement | null>(null);
  const viewRef = useRef<EditorView | null>(null);
  const contentRef = useRef(content);
  contentRef.current = content;
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // mount editor once
  useEffect(() => {
    if (!editorParentRef.current || viewRef.current) return;
    const view = new EditorView({
      parent: editorParentRef.current,
      state: EditorState.create({
        doc: content,
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
              const next = update.state.doc.toString();
              setContent(next);
            }
          }),
        ],
      }),
    });
    viewRef.current = view;
    return () => { view.destroy(); viewRef.current = null; };
  }, []);

  // debounced preview update
  useEffect(() => {
    if (!autoPreview) return;
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      setPreviewHTML(content);
    }, 350);
    return () => { if (debounceRef.current) clearTimeout(debounceRef.current); };
  }, [content, autoPreview]);

  // persist versions
  useEffect(() => { saveVersions(versions); }, [versions]);

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
    if (activeId === id) setActiveId(null);
  }, [activeId]);

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
    <div id="screen-design" className="screen">
      <div className="design-left">
        <div style={{ padding: '8px 12px', borderBottom: '1px solid var(--brd)', background: 'var(--surf)', display: 'flex', gap: '8px', alignItems: 'center', fontSize: '11px', color: 'var(--ink2)' }}>
          <span>Design session</span>
          <span className={`pill ${autoPreview ? 'pill-ok' : 'pill-idle'}`}>{autoPreview ? 'Live preview' : 'Manual'}</span>
          <span style={{ marginLeft: 'auto', color: showSavePrompt ? 'var(--warn)' : 'var(--ink2)' }}>
            {showSavePrompt ? 'Unsaved changes' : 'Up to date'}
          </span>
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
  );
}
