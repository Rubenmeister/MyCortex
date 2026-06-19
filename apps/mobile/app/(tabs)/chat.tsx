import { useEffect, useRef, useState } from 'react';
import {
  KeyboardAvoidingView,
  Platform,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import { getChatHistory, sendChat, type ChatMessage } from '../../src/lib/api';

export default function ChatScreen() {
  const [messages, setMessages] = useState<ChatMessage[]>([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const scrollRef = useRef<ScrollView>(null);

  useEffect(() => {
    getChatHistory().then(setMessages).catch(() => {});
  }, []);

  useEffect(() => {
    scrollRef.current?.scrollToEnd({ animated: true });
  }, [messages, sending]);

  const send = async () => {
    const msg = input.trim();
    if (!msg || sending) return;
    setErr(null);
    setInput('');
    setMessages((m) => [...m, { role: 'user', content: msg }]);
    setSending(true);
    try {
      const reply = await sendChat(msg);
      setMessages((m) => [...m, { role: 'assistant', content: reply }]);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSending(false);
    }
  };

  return (
    <KeyboardAvoidingView
      style={styles.root}
      behavior={Platform.OS === 'ios' ? 'padding' : undefined}
      keyboardVerticalOffset={90}
    >
      <ScrollView ref={scrollRef} style={styles.thread} contentContainerStyle={styles.threadBody}>
        {messages.length === 0 && !sending && (
          <Text style={styles.welcome}>
            Hablá con tu coach. Conoce tu perfil, tu diario, tus sugerencias y tus tareas.
            {'\n\n'}Ej: «¿En qué me enfoco esta semana?»
          </Text>
        )}
        {messages.map((m, i) => (
          <View key={m.id ?? i} style={[styles.bubbleRow, m.role === 'user' ? styles.right : styles.left]}>
            <Text style={[styles.bubble, m.role === 'user' ? styles.user : styles.coach]}>{m.content}</Text>
          </View>
        ))}
        {sending && (
          <View style={[styles.bubbleRow, styles.left]}>
            <Text style={[styles.bubble, styles.coach, styles.typing]}>Pensando…</Text>
          </View>
        )}
        {err && <Text style={styles.error}>{err}</Text>}
      </ScrollView>

      <View style={styles.composer}>
        <TextInput
          style={styles.input}
          value={input}
          onChangeText={setInput}
          placeholder="Escribí un mensaje…"
          placeholderTextColor="#666"
          multiline
        />
        <TouchableOpacity style={styles.sendBtn} onPress={send} disabled={sending || !input.trim()}>
          <Text style={styles.sendText}>➤</Text>
        </TouchableOpacity>
      </View>
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  thread: { flex: 1 },
  threadBody: { padding: 16, gap: 10 },
  welcome: { color: '#888', fontSize: 14, textAlign: 'center', marginTop: 40, lineHeight: 20 },
  bubbleRow: { flexDirection: 'row' },
  left: { justifyContent: 'flex-start' },
  right: { justifyContent: 'flex-end' },
  bubble: { maxWidth: '82%', paddingHorizontal: 14, paddingVertical: 10, borderRadius: 16, fontSize: 14, lineHeight: 20, overflow: 'hidden' },
  user: { backgroundColor: '#fff', color: '#000', borderBottomRightRadius: 4 },
  coach: { backgroundColor: '#14141c', color: '#e6e6e6', borderWidth: 1, borderColor: '#1f1f2a', borderBottomLeftRadius: 4 },
  typing: { color: '#888', fontStyle: 'italic' },
  error: { color: '#ff9b9b', fontSize: 13, textAlign: 'center' },
  composer: { flexDirection: 'row', gap: 8, padding: 10, borderTopWidth: 1, borderTopColor: '#1a1a22', alignItems: 'flex-end' },
  input: { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 20, paddingHorizontal: 16, paddingVertical: 10, fontSize: 15, maxHeight: 120 },
  sendBtn: { width: 44, height: 44, backgroundColor: '#fff', borderRadius: 22, alignItems: 'center', justifyContent: 'center' },
  sendText: { color: '#000', fontSize: 18, fontWeight: '700' },
});
