import { useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import type { Audio as AudioNs } from 'expo-av';
import { ask, type AskResult } from '../../src/lib/api.js';
import {
  ensureAudioReady,
  playBase64Audio,
  readAsBase64,
  startRecording,
  stopRecording,
  type RecordingHandle,
} from '../../src/lib/audio.js';

type Status =
  | { kind: 'idle' }
  | { kind: 'recording'; handle: RecordingHandle; startedAt: number }
  | { kind: 'transcribing' }
  | { kind: 'thinking' }
  | { kind: 'answered'; result: AskResult }
  | { kind: 'error'; message: string };

const MIN_RECORDING_MS = 800;

export default function AskScreen() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });
  const soundRef = useRef<AudioNs.Sound | null>(null);

  // Auto-play TTS when an answer with audio arrives.
  useEffect(() => {
    if (status.kind === 'answered' && status.result.audioBase64) {
      soundRef.current?.unloadAsync().catch(() => undefined);
      playBase64Audio(status.result.audioBase64, 'audio/mp3')
        .then((s) => {
          soundRef.current = s;
        })
        .catch((err) => console.warn('audio play failed', err));
    }
  }, [status]);

  // Cleanup on unmount.
  useEffect(() => {
    return () => {
      soundRef.current?.unloadAsync().catch(() => undefined);
    };
  }, []);

  const replay = async () => {
    if (status.kind !== 'answered' || !status.result.audioBase64) return;
    await soundRef.current?.unloadAsync().catch(() => undefined);
    soundRef.current = await playBase64Audio(status.result.audioBase64, 'audio/mp3');
  };

  const submitText = async () => {
    if (!text.trim()) return;
    setStatus({ kind: 'thinking' });
    try {
      const result = await ask({ text: text.trim(), withTTS: true });
      setStatus({ kind: 'answered', result });
      setText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  };

  const startMic = async () => {
    if (status.kind !== 'idle') return;
    const ready = await ensureAudioReady();
    if (!ready.ok) {
      Alert.alert('Permiso de micrófono', 'Concede acceso al micrófono en ajustes.');
      return;
    }
    try {
      const handle = await startRecording();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setStatus({ kind: 'recording', handle, startedAt: Date.now() });
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  };

  const stopMic = async () => {
    if (status.kind !== 'recording') return;
    const elapsed = Date.now() - status.startedAt;
    Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Light).catch(() => {});

    if (elapsed < MIN_RECORDING_MS) {
      // Discard the brief tap; Whisper rejects audio under 100ms anyway.
      try {
        await stopRecording(status.handle);
      } catch {
        /* ignore */
      }
      setStatus({ kind: 'idle' });
      Alert.alert('Muy corto', 'Mantén pulsado al menos 1 segundo.');
      return;
    }

    setStatus({ kind: 'transcribing' });
    try {
      const { uri, mimeType } = await stopRecording(status.handle);
      const audioBase64 = await readAsBase64(uri);
      setStatus({ kind: 'thinking' });
      const result = await ask({ audioBase64, mimeType, withTTS: true });
      setStatus({ kind: 'answered', result });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  };

  const isBusy =
    status.kind === 'transcribing' || status.kind === 'thinking' || status.kind === 'recording';

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <ScrollView
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
      >
        <View style={styles.actions}>
          <TextInput
            style={styles.input}
            value={text}
            onChangeText={setText}
            placeholder="Escribe una pregunta…"
            placeholderTextColor="#666"
            editable={!isBusy}
            returnKeyType="send"
            onSubmitEditing={submitText}
          />
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.btnDisabled]}
            onPress={submitText}
            disabled={!text.trim() || isBusy}
          >
            {status.kind === 'thinking' && !text ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.sendBtnText}>Preguntar</Text>
            )}
          </TouchableOpacity>
          <TouchableOpacity
            style={[
              styles.micBtn,
              status.kind === 'recording' && styles.micRecording,
              isBusy && status.kind !== 'recording' && styles.btnDisabled,
            ]}
            onPressIn={status.kind === 'idle' ? startMic : undefined}
            onPressOut={status.kind === 'recording' ? stopMic : undefined}
            disabled={status.kind === 'transcribing' || status.kind === 'thinking'}
          >
            <Text style={styles.micText}>
              {status.kind === 'recording' ? '◼' : '🎙'}
            </Text>
          </TouchableOpacity>
        </View>

        <Text style={styles.hint}>
          {status.kind === 'recording'
            ? 'Grabando — suelta para enviar'
            : status.kind === 'transcribing'
              ? 'Transcribiendo…'
              : status.kind === 'thinking'
                ? 'Pensando…'
                : 'Mantén pulsado el mic o escribe tu pregunta'}
        </Text>

        {(status.kind === 'transcribing' || status.kind === 'thinking') && (
          <ActivityIndicator color="#888" style={{ marginTop: 24 }} />
        )}

        {status.kind === 'answered' && <Answer result={status.result} onReplay={replay} />}

        {status.kind === 'error' && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{status.message.slice(0, 200)}</Text>
            <TouchableOpacity onPress={() => setStatus({ kind: 'idle' })}>
              <Text style={styles.retryText}>OK</Text>
            </TouchableOpacity>
          </View>
        )}
      </ScrollView>
    </KeyboardAvoidingView>
  );
}

function Answer({ result, onReplay }: { result: AskResult; onReplay: () => void }) {
  const [showSources, setShowSources] = useState(false);
  return (
    <View style={styles.answerCard}>
      <Text style={styles.q}>❓ {result.question}</Text>
      <Text style={styles.a}>{result.answer}</Text>
      {result.audioBase64 && (
        <TouchableOpacity onPress={onReplay} style={styles.replayBtn}>
          <Text style={styles.replayTxt}>🔊 Reproducir</Text>
        </TouchableOpacity>
      )}
      {result.sources.length > 0 && (
        <View style={{ marginTop: 14 }}>
          <TouchableOpacity onPress={() => setShowSources((s) => !s)}>
            <Text style={styles.sourcesToggle}>
              {showSources ? '▾' : '▸'} {result.sources.length} fuentes
            </Text>
          </TouchableOpacity>
          {showSources && (
            <View style={{ marginTop: 8, gap: 10 }}>
              {result.sources.map((s) => (
                <View key={s.id} style={styles.source}>
                  <Text style={styles.sourceMeta}>
                    sim={s.similarity.toFixed(2)} · {s.category}
                  </Text>
                  <Text style={styles.sourceTxt}>{s.content.slice(0, 160)}…</Text>
                </View>
              ))}
            </View>
          )}
        </View>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 12, paddingBottom: 80 },
  actions: { flexDirection: 'row', gap: 8 },
  input: {
    flex: 1,
    backgroundColor: '#1a1a1a',
    color: '#fff',
    paddingHorizontal: 14,
    paddingVertical: 12,
    borderRadius: 10,
    fontSize: 15,
  },
  sendBtn: {
    backgroundColor: '#fff',
    paddingHorizontal: 16,
    paddingVertical: 12,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  btnDisabled: { opacity: 0.4 },
  micBtn: {
    width: 56,
    height: 48,
    backgroundColor: '#1a1a1a',
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  micRecording: { backgroundColor: '#ff3b30' },
  micText: { fontSize: 22 },
  hint: { color: '#666', fontSize: 12, textAlign: 'center', marginTop: 4 },
  answerCard: {
    backgroundColor: '#111',
    borderColor: '#1f1f2f',
    borderWidth: 1,
    borderRadius: 12,
    padding: 18,
    marginTop: 8,
  },
  q: { color: '#888', fontSize: 13, marginBottom: 12 },
  a: { color: '#fff', fontSize: 16, lineHeight: 24 },
  replayBtn: {
    marginTop: 14,
    borderColor: '#333',
    borderWidth: 1,
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 8,
    alignSelf: 'flex-start',
  },
  replayTxt: { color: '#ddd', fontSize: 13 },
  sourcesToggle: { color: '#888', fontSize: 12 },
  source: { borderLeftColor: '#2a2a3a', borderLeftWidth: 2, paddingLeft: 10 },
  sourceMeta: { color: '#666', fontSize: 11, marginBottom: 2 },
  sourceTxt: { color: '#aaa', fontSize: 13, lineHeight: 18 },
  errorCard: {
    backgroundColor: '#2a1a1a',
    borderColor: '#4a2a2a',
    borderWidth: 1,
    borderRadius: 12,
    padding: 16,
    gap: 8,
    marginTop: 12,
  },
  errorText: { color: '#ff9b9b', fontSize: 13 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'right' },
});
