'use client';

import { useEffect, useRef, useState } from 'react';
import { VoiceButton } from '../../../components/VoiceButton';
import { ask, type AskResult } from '../../../lib/api';

type State =
  | { kind: 'idle' }
  | { kind: 'asking' }
  | { kind: 'answered'; result: AskResult }
  | { kind: 'error'; message: string };

export default function AskPage() {
  const [state, setState] = useState<State>({ kind: 'idle' });
  const [text, setText] = useState('');
  const audioRef = useRef<HTMLAudioElement | null>(null);

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
      setState({ kind: 'answered', result });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  };

  const askText = async () => {
    if (!text.trim()) return;
    setState({ kind: 'asking' });
    try {
      const result = await ask({ text: text.trim(), withTTS: true });
      setState({ kind: 'answered', result });
      setText('');
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
      `}</style>
    </div>
  );
}

function Answer({ result, onReplay }: { result: AskResult; onReplay: () => void }) {
  const totalSources = result.sources.length + result.webSources.length;
  return (
    <div className="ans">
      <div className="q">❓ {result.question}</div>
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
              <div className="src-section">📝 De tus notas</div>
              <ul>
                {result.sources.map((s) => (
                  <li key={s.id}>
                    <span style={{ color: '#666', fontSize: 11 }}>
                      sim={s.similarity.toFixed(2)} · {s.category}
                    </span>
                    <div style={{ marginTop: 2 }}>{s.content.slice(0, 160)}…</div>
                  </li>
                ))}
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
          margin-bottom: 12px;
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
