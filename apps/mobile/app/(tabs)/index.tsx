import { useState } from 'react';
import {
  ActivityIndicator,
  Alert,
  KeyboardAvoidingView,
  Platform,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import * as Haptics from 'expo-haptics';
import { ingestAudio, ingestText, type IngestResult } from '../../src/lib/api';
import {
  ensureAudioReady,
  readAsBase64,
  startRecording,
  stopRecording,
  type RecordingHandle,
} from '../../src/lib/audio';

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

type Status =
  | { kind: 'idle' }
  | { kind: 'sending' }
  | { kind: 'recording'; handle: RecordingHandle }
  | { kind: 'transcribing' }
  | { kind: 'success'; result: IngestResult }
  | { kind: 'error'; message: string };

export default function CaptureScreen() {
  const [text, setText] = useState('');
  const [status, setStatus] = useState<Status>({ kind: 'idle' });

  const submitText = async () => {
    if (!text.trim()) return;
    setStatus({ kind: 'sending' });
    try {
      const result = await ingestText(text.trim());
      setStatus({ kind: 'success', result });
      setText('');
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  };

  const startMic = async () => {
    const ready = await ensureAudioReady();
    if (!ready.ok) {
      Alert.alert('Permiso de micrófono', 'Concede acceso al micrófono en ajustes.');
      return;
    }
    try {
      const handle = await startRecording();
      Haptics.impactAsync(Haptics.ImpactFeedbackStyle.Medium).catch(() => {});
      setStatus({ kind: 'recording', handle });
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  };

  const stopMic = async () => {
    if (status.kind !== 'recording') return;
    setStatus({ kind: 'transcribing' });
    try {
      const { uri, mimeType } = await stopRecording(status.handle);
      const audioBase64 = await readAsBase64(uri);
      const result = await ingestAudio({ audioBase64, mimeType, language: 'es' });
      setStatus({ kind: 'success', result });
      Haptics.notificationAsync(Haptics.NotificationFeedbackType.Success).catch(() => {});
    } catch (err) {
      setStatus({ kind: 'error', message: String(err) });
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
    >
      <View style={styles.body}>
        <TextInput
          style={styles.input}
          value={text}
          onChangeText={setText}
          placeholder="Escribe una nota..."
          placeholderTextColor="#666"
          multiline
          textAlignVertical="top"
          editable={status.kind === 'idle' || status.kind === 'success' || status.kind === 'error'}
        />

        <View style={styles.actions}>
          <TouchableOpacity
            style={[styles.sendBtn, !text.trim() && styles.btnDisabled]}
            onPress={submitText}
            disabled={!text.trim() || status.kind !== 'idle'}
          >
            {status.kind === 'sending' ? (
              <ActivityIndicator color="#000" />
            ) : (
              <Text style={styles.sendBtnText}>Enviar</Text>
            )}
          </TouchableOpacity>

          <TouchableOpacity
            style={[styles.micBtn, status.kind === 'recording' && styles.micRecording]}
            onPressIn={status.kind === 'idle' ? startMic : undefined}
            onPressOut={status.kind === 'recording' ? stopMic : undefined}
            disabled={status.kind === 'sending' || status.kind === 'transcribing'}
          >
            <Text style={styles.micText}>
              {status.kind === 'recording' ? '◼' : status.kind === 'transcribing' ? '...' : '🎙'}
            </Text>
          </TouchableOpacity>
        </View>

        <View style={styles.hint}>
          <Text style={styles.hintText}>
            {status.kind === 'recording'
              ? 'Grabando — suelta para transcribir'
              : status.kind === 'transcribing'
                ? 'Transcribiendo...'
                : 'Mantén pulsado el mic para grabar'}
          </Text>
        </View>

        {status.kind === 'success' && <SuccessCard result={status.result} />}
        {status.kind === 'error' && (
          <View style={styles.errorCard}>
            <Text style={styles.errorText}>{status.message.slice(0, 200)}</Text>
            <TouchableOpacity onPress={() => setStatus({ kind: 'idle' })}>
              <Text style={styles.retryText}>OK</Text>
            </TouchableOpacity>
          </View>
        )}
      </View>
    </KeyboardAvoidingView>
  );
}

function SuccessCard({ result }: { result: IngestResult }) {
  const ke = KIND_EMOJI[result.classification.kind] ?? '📝';
  const ce = CATEGORY_EMOJI[result.classification.category] ?? '❓';
  const title = result.classification.title ?? result.node.id.slice(0, 8);

  return (
    <View style={styles.successCard}>
      {result.transcript && <Text style={styles.transcript}>🎙 “{result.transcript}”</Text>}
      <Text style={styles.successTitle}>
        {ke} {title}
      </Text>
      <Text style={styles.successMeta}>
        {ce} {result.classification.category} · {ke} {result.classification.kind}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { flex: 1, padding: 16, gap: 12 },
  input: {
    backgroundColor: '#1a1a1a',
    color: '#fff',
    padding: 16,
    borderRadius: 12,
    fontSize: 16,
    minHeight: 120,
    maxHeight: 240,
  },
  actions: { flexDirection: 'row', gap: 12 },
  sendBtn: {
    flex: 1,
    backgroundColor: '#fff',
    paddingVertical: 14,
    borderRadius: 10,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendBtnText: { color: '#000', fontWeight: '700', fontSize: 16 },
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
  hint: { paddingTop: 4, paddingBottom: 12 },
  hintText: { color: '#666', fontSize: 12, textAlign: 'center' },
  successCard: {
    backgroundColor: '#1a2a1a',
    borderRadius: 12,
    padding: 16,
    gap: 6,
    borderWidth: 1,
    borderColor: '#2a4a2a',
  },
  transcript: { color: '#ddd', fontSize: 14, fontStyle: 'italic', marginBottom: 4 },
  successTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  successMeta: { color: '#9c9', fontSize: 12 },
  errorCard: {
    backgroundColor: '#2a1a1a',
    borderRadius: 12,
    padding: 16,
    gap: 8,
    borderWidth: 1,
    borderColor: '#4a2a2a',
  },
  errorText: { color: '#ff9b9b', fontSize: 13 },
  retryText: { color: '#fff', fontSize: 13, fontWeight: '600', textAlign: 'right' },
});
