'use client';

import { useEffect, useRef, useState } from 'react';

type Props = {
  onRecorded: (audioBase64: string, mimeType: string) => Promise<void> | void;
  disabled?: boolean;
  label?: string;
};

/**
 * Press-and-hold record button. Uses the browser's MediaRecorder API.
 *
 * On Chrome/Edge/Firefox we get audio/webm (Opus codec). Safari produces
 * audio/mp4. Whisper accepts both. The mimeType is forwarded to the api so
 * the server-side call to OpenAI uses the right Content-Type.
 *
 * Push-to-talk works with mouse, touch, and (when focused) the spacebar.
 */
const MIN_RECORDING_MS = 800;

export function VoiceButton({ onRecorded, disabled, label = 'Mantén pulsado para hablar' }: Props) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [supported, setSupported] = useState(true);
  const [hint, setHint] = useState<string | null>(null);
  const recorderRef = useRef<MediaRecorder | null>(null);
  const chunksRef = useRef<Blob[]>([]);
  const streamRef = useRef<MediaStream | null>(null);
  const startedAtRef = useRef<number>(0);

  useEffect(() => {
    setSupported(typeof window !== 'undefined' && !!navigator.mediaDevices?.getUserMedia && !!window.MediaRecorder);
  }, []);

  const start = async () => {
    if (busy || disabled || recording) return;
    setHint(null);
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      streamRef.current = stream;
      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      chunksRef.current = [];
      recorder.ondataavailable = (e) => {
        if (e.data.size > 0) chunksRef.current.push(e.data);
      };
      recorder.onstop = async () => {
        const elapsed = Date.now() - startedAtRef.current;
        const type = recorder.mimeType || 'audio/webm';
        streamRef.current?.getTracks().forEach((t) => t.stop());
        streamRef.current = null;

        if (elapsed < MIN_RECORDING_MS || chunksRef.current.length === 0) {
          setHint('Mantén pulsado más tiempo (habla al menos 1 segundo).');
          setTimeout(() => setHint(null), 4000);
          return;
        }

        const blob = new Blob(chunksRef.current, { type });
        const buffer = await blob.arrayBuffer();
        const base64 = bufferToBase64(buffer);
        setBusy(true);
        try {
          await onRecorded(base64, type);
        } finally {
          setBusy(false);
        }
      };
      startedAtRef.current = Date.now();
      recorder.start();
      recorderRef.current = recorder;
      setRecording(true);
    } catch (err) {
      console.error('mic error', err);
      setRecording(false);
      setHint('No pude acceder al micrófono. Concede el permiso en el navegador.');
    }
  };

  const stop = () => {
    if (!recording) return;
    setRecording(false);
    try {
      recorderRef.current?.stop();
    } catch {
      /* ignore */
    }
  };

  if (!supported) {
    return (
      <div style={{ padding: 16, color: '#999', fontSize: 14 }}>
        Tu navegador no soporta MediaRecorder. Prueba Chrome, Edge o Firefox.
      </div>
    );
  }

  const state: 'idle' | 'recording' | 'processing' = busy ? 'processing' : recording ? 'recording' : 'idle';

  return (
    <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
      <button
        type="button"
        onPointerDown={(e) => {
          e.preventDefault();
          (e.currentTarget as HTMLButtonElement).setPointerCapture(e.pointerId);
          start();
        }}
        onPointerUp={(e) => {
          e.preventDefault();
          stop();
        }}
        onPointerCancel={() => stop()}
        disabled={disabled || busy}
        className={`voice-btn voice-${state}`}
        aria-label={label}
      >
        <span className="voice-glyph">
          {state === 'processing' ? '⏳' : state === 'recording' ? '◼' : '🎙'}
        </span>
        <span className="voice-label">
          {state === 'processing' ? 'Procesando…' : state === 'recording' ? 'Suelta para enviar' : label}
        </span>
      <style jsx>{`
        .voice-btn {
          display: flex;
          flex-direction: column;
          align-items: center;
          justify-content: center;
          gap: 12px;
          width: 220px;
          height: 220px;
          border-radius: 110px;
          border: none;
          cursor: pointer;
          transition: transform 0.1s, background 0.15s;
          user-select: none;
          -webkit-touch-callout: none;
          -webkit-user-select: none;
        }
        .voice-idle {
          background: #1a1a1a;
          color: #fff;
        }
        .voice-idle:hover {
          background: #2a2a2a;
          transform: scale(1.02);
        }
        .voice-recording {
          background: #ff3b30;
          color: #fff;
          transform: scale(1.05);
          box-shadow: 0 0 0 12px rgba(255, 59, 48, 0.2);
          animation: pulse 1s infinite;
        }
        .voice-processing {
          background: #2a2a4a;
          color: #fff;
          cursor: wait;
        }
        .voice-glyph {
          font-size: 56px;
        }
        .voice-label {
          font-size: 14px;
          font-weight: 500;
          opacity: 0.85;
          padding: 0 16px;
          text-align: center;
        }
        @keyframes pulse {
          0%, 100% {
            box-shadow: 0 0 0 12px rgba(255, 59, 48, 0.2);
          }
          50% {
            box-shadow: 0 0 0 24px rgba(255, 59, 48, 0.05);
          }
        }
      `}</style>
      </button>
      {hint && (
        <div
          style={{
            color: '#ffb347',
            fontSize: 13,
            background: '#2a1f10',
            padding: '8px 14px',
            borderRadius: 8,
            border: '1px solid #4a3520',
            maxWidth: 320,
            textAlign: 'center',
          }}
        >
          {hint}
        </div>
      )}
    </div>
  );
}

function pickMimeType(): string | undefined {
  if (typeof MediaRecorder === 'undefined') return undefined;
  // Prefer formats that Whisper accepts and that browsers commonly produce.
  for (const t of ['audio/webm;codecs=opus', 'audio/webm', 'audio/mp4', 'audio/ogg']) {
    if (MediaRecorder.isTypeSupported(t)) return t;
  }
  return undefined;
}

function bufferToBase64(buffer: ArrayBuffer): string {
  const bytes = new Uint8Array(buffer);
  let binary = '';
  const chunk = 0x8000;
  for (let i = 0; i < bytes.length; i += chunk) {
    binary += String.fromCharCode(...bytes.subarray(i, i + chunk));
  }
  return btoa(binary);
}
