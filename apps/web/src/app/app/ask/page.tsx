'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { VoiceButton } from '../../../components/VoiceButton';
import { ask, type AskResult } from '../../../lib/api';

type State =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'answered'; result: AskResult }
  | { kind: 'error'; message: string };

/**
 * History is stored in localStorage so users keep their "thinking trail"
 * across sessions. We only keep the last 10 entries to bound the size
 * and we strip the audio blob (TTS base64) since it'd blow up storage —
 * users can re-trigger TTS by asking again if they need it.
 */
const HISTORY_KEY = 'mycortex.askHistory';
const HISTORY_MAX = 10;

type HistoryEntry = Omit<AskResult, 'audioBase64'> & { askedAt: string };

function loadHistory(): HistoryEntry[] {
  if (typeof window === 'undefined') return [];
  try {
    const raw = window.localStorage.getItem(HISTORY_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(parsed) ? parsed.slice(0, HISTORY_MAX) : [];
  } catch {
    return [];
  }
}

function saveHistory(entries: HistoryEntry[]): void {
  if (typeof window === 'undefined') return;
  try {
    window.localStorage.setItem(HISTORY_KEY, JSON.stringify(entries.slice(0, HISTORY_MAX)));
  } catch {
    /* quota exceeded etc. — silent */
  }
}

export default function AskPage() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [text, setText] = useState('');
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const audioRef = useRef<HTMLAudioElement | null>(null);
  const inputRef = useRef<HTMLInputElement | null>(null);

  // Restore history on mount + focus input.
  useEffect(() => {
    setHistory(loadHistory());
    inputRef.current?.focus();
  }, []);

  useEffect(() => {
    if (state.kind === 'answered' && state.result.audioBase64) {
      const audio = new Audio(`data:audio/mp3;base64,${state.result.audioBase64}`);
      audioRef.current = audio;
      audio.play().catch(() => {
        /* user gesture required on some browsers — they can hit replay */
      });
      return () => {
        audio.pause();
      };
    }
  }, [state]);

  const recordAnswer = useCallback((result: AskResult) => {
    setState({ kind: 'answered', result });
    // Push to history without audio. Most recent first.
    const { audioBase64: _audio, ...rest } = result;
    const entry: HistoryEntry = { ...rest, askedAt: new Date().toISOString() };
    setHistory((prev) => {
      // De-dupe consecutive identical questions (rare but possible).
      const next = prev[0]?.question === entry.question ? prev : [entry, ...prev];
      const capped = next.slice(0, HISTORY_MAX);
      saveHistory(capped);
      return capped;
    });
  }, []);

  const clearHistory = () => {
    if (!confirm('¿Borrar el historial de preguntas?')) return;
    setHistory([]);
    saveHistory([]);
  };

  const replay = () => {
    if (audioRef.current) {
      audioRef.current.currentTime = 0;
      audioRef.current.play().catch(() => {});
    }
  };

  const askVoice = async (audioBase64: string, mimeType: string) => {
    setState({ kind: 'asking' });
    try {
      const result = await ask({ audioBase64, mimeType, withTTS: true });
      recordAnswer(result);
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  };

  const askText = async () => {
    if (!text.trim()) return;
    setState({ kind: 'asking' });
    try {
      const result = await ask({ text: text.trim(), withTTS: true });
      recordAnswer(result);
      setText('');
      // Re-focus for the next question.
      inputRef.current?.focus();
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  };

  return (
    <div className="page">
      <div className="hero">
        <VoiceButton
          onRecorded={askVoice}
          disabled={state.kind === 'asking'}
          label="Pregúntale a CORTEX"
        />
        <p className="hint">Habla tu pregunta. Busco en tus notas y te respondo en voz.</p>
      </div>

      <div className="text-form">
        <input
          ref={inputRef}
          type="text"
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => e.key === 'Enter' && askText()}
          placeholder="…o escribe tu pregunta"
          disabled={state.kind === 'asking'}
        />
        <button type="button" onClick={askText} disabled={!text.trim() || state.kind === 'asking'}>
          Preguntar
        </button>
      </div>

      {state.kind === 'asking' && <div className="status">🧠 Pensando…</div>}
      {state.kind === 'answered' && <Answer result={state.result} onReplay={replay} />}
      {state.kind === 'error' && (
        <div className="error">
          {state.message.slice(0, 240)}
          <button type="button" onClick={() => setState({ kind: 'idle' })} style={{ marginLeft: 12 }}>
            OK
          </button>
        </div>
      )}

      {history.length > 0 && (
        <section className="history">
          <div className="history-head">
            <h3>Preguntas anteriores ({history.length})</h3>
            <button type="button" className="clear-btn" onClick={clearHistory}>
              Borrar historial
            </button>
          </div>
          <ul className="history-list">
            {history
              // If we just answered, skip the first entry (already shown above).
              .slice(state.kind === 'answered' ? 1 : 0)
              .map((h, idx) => (
                <HistoryItem key={`${h.askedAt}-${idx}`} entry={h} />
              ))}
          </ul>
        </section>
      )}

      <style jsx>{`
        .page {
          max-width: 720px;
          margin: 0 auto;
          padding: 48px 24px 96px;
          display: flex;
          flex-direction: column;
          gap: 32px;
        }
        .hero {
          display: flex;
          flex-direction: column;
          align-items: center;
          gap: 16px;
        }
        .hint {
          color: #777;
          font-size: 13px;
          text-align: center;
          margin: 0;
        }
        .text-form {
          display: flex;
          gap: 8px;
        }
        input {
          flex: 1;
          background: #111;
          border: 1px solid #1a1a1a;
          color: #fff;
          padding: 12px 14px;
          border-radius: 10px;
          font-family: inherit;
          font-size: 15px;
          outline: none;
        }
        input:focus {
          border-color: #444;
        }
        button {
          background: #fff;
          color: #000;
          border: none;
          border-radius: 10px;
          padding: 12px 20px;
          font-weight: 700;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .status {
          color: #aaa;
          text-align: center;
        }
        .error {
          background: #2a1a1a;
          border: 1px solid #4a2a2a;
          color: #ff9b9b;
          padding: 12px 16px;
          border-radius: 10px;
        }
        .history {
          margin-top: 16px;
        }
        .history-head {
          display: flex;
          justify-content: space-between;
          align-items: center;
          margin-bottom: 10px;
        }
        .history h3 {
          margin: 0;
          color: #888;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.6px;
          font-weight: 700;
        }
        .clear-btn {
          background: transparent;
          border: 1px solid #2a2a3a;
          color: #888;
          padding: 4px 10px;
          border-radius: 6px;
          font-size: 11px;
          cursor: pointer;
        }
        .clear-btn:hover {
          color: #fff;
          border-color: #4a4a5a;
        }
        .history-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
      `}</style>
    </div>
  );
}

function Answer({ result, onReplay }: { result: AskResult; onReplay: () => void }) {
  const totalSources = result.sources.length + result.webSources.length;
  return (
    <div className="ans">
      <div className="q">❓ {result.question}</div>
      {result.queryRewritten && result.searchQuery && (
        <div className="rewritten" title="Query reescrita por el optimizador de búsqueda">
          🔎 búsqueda: <code>{result.searchQuery}</code>
        </div>
      )}
      <div className="a">{result.answer}</div>

      <div className="actions">
        {result.audioBase64 && (
          <button type="button" className="replay" onClick={onReplay}>
            🔊 Reproducir respuesta
          </button>
        )}
        {result.webSearched && (
          <span className="web-badge" title={result.webSearchedReason ?? ''}>
            🌐 web consultada
          </span>
        )}
        {result.rerankApplied && (
          <span
            className="web-badge"
            style={{ background: '#1a3a1a', color: '#9c9', borderColor: '#2a4a2a' }}
            title={`${result.candidatesEvaluated ?? 0} candidatos rerankeados${result.rerankMs ? ` · ${result.rerankMs}ms` : ''}`}
          >
            🎯 reranked
          </span>
        )}
      </div>

      {totalSources > 0 && (
        <details className="sources">
          <summary>
            {totalSources} fuente{totalSources === 1 ? '' : 's'} consultada{totalSources === 1 ? '' : 's'}
            {result.sources.length > 0 && result.webSources.length > 0 &&
              ` (${result.sources.length} notas + ${result.webSources.length} web)`}
          </summary>

          {result.sources.length > 0 && (
            <>
              <div className="src-section">🧠 De tu segundo cerebro</div>
              <ul>
                {result.sources.map((s) => {
                  const icon =
                    s.origin === 'drive' ? '📁' : s.origin === 'gmail' ? '📧' : '📝';
                  const m = s.externalMetadata ?? {};
                  const dateRaw =
                    (m.date as string | undefined) ??
                    (m.modifiedTime as string | undefined) ??
                    s.createdAt;
                  const date = dateRaw ? new Date(dateRaw).toLocaleDateString() : null;
                  return (
                    <li key={s.id}>
                      <div className="src-head">
                        <span className="src-icon">{icon}</span>
                        <span className="src-title">{s.attribution}</span>
                      </div>
                      <div className="src-meta">
                        {s.rerankScore !== null && (
                          <>rerank={s.rerankScore.toFixed(2)} · </>
                        )}
                        sim={s.similarity.toFixed(2)} · rrf={s.rrfScore.toFixed(3)}
                        {date && ` · ${date}`}
                        {' · '}{s.category}
                      </div>
                      <div className="src-content">{s.content.slice(0, 260)}…</div>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          {result.webSources.length > 0 && (
            <>
              <div className="src-section src-web">🌐 De la web</div>
              <ul>
                {result.webSources.map((w) => (
                  <li key={w.url} className="web-li">
                    <a href={w.url} target="_blank" rel="noopener noreferrer" className="web-title">
                      {w.title}
                    </a>
                    <div className="web-domain">{new URL(w.url).hostname}</div>
                    <div style={{ marginTop: 2 }}>{w.snippet}</div>
                  </li>
                ))}
              </ul>
            </>
          )}
        </details>
      )}

      <style jsx>{`
        .ans {
          background: #111;
          border: 1px solid #1f1f2f;
          border-radius: 12px;
          padding: 20px;
        }
        .q {
          color: #888;
          font-size: 13px;
          margin-bottom: 8px;
        }
        .rewritten {
          color: #6a7a8a;
          font-size: 11px;
          margin-bottom: 12px;
          font-family: monospace;
        }
        .rewritten code {
          background: #1a1a2a;
          color: #aac;
          padding: 1px 6px;
          border-radius: 3px;
          font-size: 11px;
        }
        .a {
          color: #fff;
          font-size: 17px;
          line-height: 1.5;
        }
        .replay {
          margin-top: 16px;
          background: transparent;
          border: 1px solid #333;
          color: #ddd;
          padding: 8px 14px;
          border-radius: 8px;
          font-size: 13px;
          cursor: pointer;
        }
        .replay:hover {
          border-color: #555;
        }
        .sources {
          margin-top: 16px;
          color: #888;
          font-size: 12px;
        }
        .sources summary {
          cursor: pointer;
          padding: 6px 0;
        }
        .sources ul {
          list-style: none;
          padding: 0;
          margin: 8px 0 0;
          display: flex;
          flex-direction: column;
          gap: 12px;
        }
        .sources li {
          color: #aaa;
          font-size: 13px;
          line-height: 1.4;
          padding: 8px 12px;
          border-left: 2px solid #2a2a3a;
        }
        .src-head {
          display: flex;
          gap: 8px;
          align-items: baseline;
          margin-bottom: 2px;
        }
        .src-icon {
          font-size: 14px;
        }
        .src-title {
          color: #d8d8e8;
          font-weight: 600;
          font-size: 13px;
        }
        .src-meta {
          color: #666;
          font-size: 11px;
        }
        .src-content {
          margin-top: 4px;
          color: #aaa;
          font-size: 12px;
        }
        .actions {
          display: flex;
          gap: 12px;
          align-items: center;
          margin-top: 16px;
        }
        .web-badge {
          display: inline-block;
          background: #1a2a3a;
          color: #88c;
          font-size: 11px;
          padding: 4px 10px;
          border-radius: 99px;
          border: 1px solid #2a3a4a;
        }
        .src-section {
          color: #888;
          font-size: 11px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
          margin-top: 12px;
          margin-bottom: 4px;
        }
        .src-web {
          color: #88c;
        }
        .web-li {
          border-left-color: #2a3a5a !important;
        }
        .web-title {
          color: #aac;
          font-weight: 600;
          text-decoration: none;
          font-size: 13px;
        }
        .web-title:hover {
          text-decoration: underline;
        }
        .web-domain {
          color: #666;
          font-size: 11px;
          margin-top: 1px;
        }
      `}</style>
    </div>
  );
}

function HistoryItem({ entry }: { entry: HistoryEntry }) {
  const [expanded, setExpanded] = useState(false);
  const when = new Date(entry.askedAt);
  const ago = humanAgo(when);
  return (
    <li className="hi">
      <button
        type="button"
        className="hi-toggle"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <span className="hi-q">❓ {entry.question}</span>
        <span className="hi-when">{ago}</span>
      </button>
      {expanded && (
        <div className="hi-body">
          {entry.queryRewritten && entry.searchQuery && (
            <div className="hi-rewritten">
              🔎 búsqueda: <code>{entry.searchQuery}</code>
            </div>
          )}
          <div className="hi-a">{entry.answer}</div>
          <div className="hi-meta">
            {entry.sources.length} fuente{entry.sources.length === 1 ? '' : 's'}
            {entry.webSearched && ` · 🌐 web`}
            {entry.rerankApplied && ` · 🎯 reranked`}
          </div>
        </div>
      )}
      <style jsx>{`
        .hi {
          background: #0c0c12;
          border: 1px solid #15151c;
          border-radius: 10px;
          overflow: hidden;
        }
        .hi-toggle {
          display: flex;
          width: 100%;
          gap: 12px;
          align-items: center;
          padding: 10px 14px;
          background: transparent;
          border: none;
          cursor: pointer;
          color: inherit;
          text-align: left;
          font-family: inherit;
          font-size: 13px;
        }
        .hi-toggle:hover {
          background: #14141c;
        }
        .hi-q {
          flex: 1;
          color: #ddd;
          overflow: hidden;
          text-overflow: ellipsis;
          white-space: nowrap;
        }
        .hi-when {
          color: #666;
          font-size: 11px;
          white-space: nowrap;
        }
        .hi-body {
          padding: 0 14px 14px;
          border-top: 1px solid #15151c;
        }
        .hi-rewritten {
          color: #6a7a8a;
          font-size: 11px;
          margin: 8px 0;
          font-family: monospace;
        }
        .hi-rewritten code {
          background: #1a1a2a;
          color: #aac;
          padding: 1px 6px;
          border-radius: 3px;
        }
        .hi-a {
          color: #ddd;
          font-size: 14px;
          line-height: 1.55;
          margin-top: 8px;
          white-space: pre-wrap;
        }
        .hi-meta {
          color: #666;
          font-size: 11px;
          margin-top: 10px;
        }
      `}</style>
    </li>
  );
}

function humanAgo(d: Date): string {
  const diffMs = Date.now() - d.getTime();
  const min = Math.floor(diffMs / 60000);
  if (min < 1) return 'ahora';
  if (min < 60) return `${min}m`;
  const h = Math.floor(min / 60);
  if (h < 24) return `${h}h`;
  const days = Math.floor(h / 24);
  if (days < 30) return `${days}d`;
  return d.toLocaleDateString();
}
