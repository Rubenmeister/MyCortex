'use client';

import { useCallback, useEffect, useRef, useState } from 'react';
import { getChatHistory, sendChat, type ChatMessage } from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const SUGGESTIONS = [
  '¿Cómo vengo esta semana?',
  '¿En qué debería enfocarme hoy?',
  '¿Qué metas tengo abandonadas?',
];

export default function ChatPage() {
  const { current } = useWorkspace();
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);

  const load = useCallback(async () => {
    try {
      setMessages(await getChatHistory());
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ behavior: 'smooth' });
  }, [messages, sending]);

  const send = async (text: string) => {
    const msg = text.trim();
    if (!msg || sending) return;
    setError(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setSending(true);
    try {
      const reply = await sendChat(msg);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (err) {
      setError(String(err));
    } finally {
      setSending(false);
    }
  };

  return (
    <div className="page">
      <header className="head">
        <h1>Hablá con tu coach 🗨️</h1>
        <p className="sub">
          Conversá con memoria: conoce tu perfil, tu diario, tus sugerencias y tus tareas.
        </p>
      </header>

      {error && <div className="err">{error}</div>}

      <div className="thread">
        {messages.length === 0 && !sending && (
          <div className="welcome">
            <div className="welcome-emoji">🗨️</div>
            <p>Preguntame lo que quieras sobre tu vida y tu trabajo. Por ejemplo:</p>
            <div className="suggs">
              {SUGGESTIONS.map((s) => (
                <button key={s} type="button" className="sugg" onClick={() => send(s)}>
                  {s}
                </button>
              ))}
            </div>
          </div>
        )}

        {messages.map((m, i) => (
          <div key={m.id ?? i} className={m.role === 'user' ? 'msg user' : 'msg coach'}>
            <div className="bubble">{m.content}</div>
          </div>
        ))}
        {sending && (
          <div className="msg coach">
            <div className="bubble typing">Pensando…</div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <div className="composer">
        <textarea
          value={input}
          onChange={(e) => setInput(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter' && !e.shiftKey) {
              e.preventDefault();
              void send(input);
            }
          }}
          placeholder="Escribí un mensaje… (Enter para enviar)"
          rows={2}
          disabled={sending || !current}
        />
        <button type="button" className="btn primary" disabled={sending || !input.trim()} onClick={() => send(input)}>
          Enviar
        </button>
      </div>

      <style jsx>{`
        .page { max-width: 760px; margin: 0 auto; padding: 24px 24px 24px; display: flex; flex-direction: column; min-height: calc(100vh - 60px); }
        .head { margin-bottom: 12px; }
        h1 { margin: 0 0 4px; font-size: 22px; }
        .sub { color: #888; font-size: 13px; margin: 0; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 10px; }
        .thread { flex: 1; overflow-y: auto; display: flex; flex-direction: column; gap: 10px; padding: 8px 0 16px; }
        .welcome { color: #888; text-align: center; margin: auto; max-width: 420px; }
        .welcome-emoji { font-size: 34px; margin-bottom: 10px; }
        .welcome p { font-size: 14px; line-height: 1.5; }
        .suggs { display: flex; flex-direction: column; gap: 8px; margin-top: 14px; }
        .sugg { background: #111; border: 1px solid #1f1f2a; color: #ccc; padding: 9px 14px; border-radius: 10px; font-size: 13px; cursor: pointer; }
        .sugg:hover { border-color: #2a2a3a; color: #fff; }
        .msg { display: flex; }
        .msg.user { justify-content: flex-end; }
        .msg.coach { justify-content: flex-start; }
        .bubble { max-width: 80%; padding: 10px 14px; border-radius: 14px; font-size: 14px; line-height: 1.5; white-space: pre-wrap; }
        .msg.user .bubble { background: #fff; color: #000; border-bottom-right-radius: 4px; }
        .msg.coach .bubble { background: #14141c; color: #e6e6e6; border: 1px solid #1f1f2a; border-bottom-left-radius: 4px; }
        .typing { color: #888; font-style: italic; }
        .composer { display: flex; gap: 8px; align-items: flex-end; border-top: 1px solid #1a1a22; padding-top: 12px; }
        textarea { flex: 1; background: #111; border: 1px solid #1f1f2a; color: #eee; padding: 10px 12px; border-radius: 10px; font-size: 14px; resize: none; font-family: inherit; }
        textarea:focus { outline: none; border-color: #2a2a3a; }
        .btn { border: 1px solid #2a2a3a; color: #ccc; background: transparent; padding: 10px 18px; border-radius: 10px; font-size: 14px; cursor: pointer; font-weight: 600; }
        .btn.primary { background: #fff; color: #000; border-color: #fff; }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
      `}</style>
    </div>
  );
}
