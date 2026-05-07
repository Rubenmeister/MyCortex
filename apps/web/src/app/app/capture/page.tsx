'use client';

import { useState } from 'react';
import { VoiceButton } from '../../../components/VoiceButton';
import { ingestAudio, ingestText, type IngestResult } from '../../../lib/api';

const KIND_EMOJI: Record<string, string> = {
  task: '📋',
  idea: '💡',
  reference: '🔗',
  fragment: '✂️',
  note: '📝',
};
const CATEGORY_EMOJI: Record<string, string> = {
  going: '🚐',
  personal: '👤',
  urgent: '⚡',
  unknown: '❓',
};

type State =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'success'; result: IngestResult }
  | { kind: 'error'; message: string };

export default function CapturePage() {
  const [text, setText] = useState('');
  const [state, setState] = useState<State>({ kind: 'idle' });

  const submitText = async () => {
    if (!text.trim()) return;
    setState({ kind: 'sending' });
    try {
      const result = await ingestText(text.trim());
      setState({ kind: 'success', result });
      setText('');
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  };

  const submitAudio = async (audioBase64: string, mimeType: string) => {
    setState({ kind: 'sending' });
    try {
      const result = await ingestAudio(audioBase64, mimeType);
      setState({ kind: 'success', result });
    } catch (err) {
      setState({ kind: 'error', message: String(err) });
    }
  };

  return (
    <div className="page">
      <div className="hero">
        <VoiceButton onRecorded={submitAudio} disabled={state.kind === 'sending'} label="Captura por voz" />
        <p className="hint">Mantén pulsado, habla, suelta. Lo transcribimos, clasificamos y guardamos.</p>
      </div>

      <div className="text-form">
        <textarea
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="…o escribe la nota aquí"
          rows={3}
          disabled={state.kind === 'sending'}
        />
        <button type="button" onClick={submitText} disabled={!text.trim() || state.kind === 'sending'}>
          Enviar
        </button>
      </div>

      {state.kind === 'sending' && <div className="status">⏳ Procesando…</div>}
      {state.kind === 'success' && <SuccessCard result={state.result} />}
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
          align-items: stretch;
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
          margin: 0;
          text-align: center;
        }
        .text-form {
          display: flex;
          gap: 8px;
          align-items: flex-end;
        }
        textarea {
          flex: 1;
          background: #111;
          border: 1px solid #1a1a1a;
          color: #fff;
          padding: 12px 14px;
          border-radius: 10px;
          resize: vertical;
          font-family: inherit;
          font-size: 15px;
          outline: none;
          line-height: 1.4;
        }
        textarea:focus {
          border-color: #444;
        }
        button {
          background: #fff;
          color: #000;
          border: none;
          border-radius: 10px;
          padding: 12px 20px;
          font-weight: 700;
          font-size: 14px;
          cursor: pointer;
        }
        button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .status {
          color: #aaa;
          text-align: center;
          font-size: 14px;
        }
        .error {
          background: #2a1a1a;
          border: 1px solid #4a2a2a;
          color: #ff9b9b;
          padding: 12px 16px;
          border-radius: 10px;
          font-size: 13px;
        }
      `}</style>
    </div>
  );
}

function SuccessCard({ result }: { result: IngestResult }) {
  const ke = KIND_EMOJI[result.classification.kind] ?? '📝';
  const ce = CATEGORY_EMOJI[result.classification.category] ?? '❓';
  const title = result.classification.title ?? result.node.id.slice(0, 8);
  return (
    <div className="success">
      {result.transcript && <div className="transcript">🎙 “{result.transcript}”</div>}
      <div className="title">
        {ke} {title}
      </div>
      <div className="meta">
        {ce} {result.classification.category} · {ke} {result.classification.kind}
      </div>
      <style jsx>{`
        .success {
          background: #122212;
          border: 1px solid #1f3a1f;
          border-radius: 12px;
          padding: 16px;
        }
        .transcript {
          color: #d8d8d8;
          font-style: italic;
          margin-bottom: 8px;
          font-size: 14px;
        }
        .title {
          color: #fff;
          font-weight: 700;
          font-size: 16px;
        }
        .meta {
          color: #9c9;
          font-size: 12px;
          margin-top: 4px;
        }
      `}</style>
    </div>
  );
}
