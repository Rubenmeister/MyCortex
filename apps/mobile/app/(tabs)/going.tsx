import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  addBridgeSource,
  generateBriefing,
  getBriefing,
  listBridgeSources,
  type BridgeSource,
  type ExecutiveBriefing,
} from '../../src/lib/api';

export default function GoingScreen() {
  const [briefing, setBriefing] = useState<ExecutiveBriefing | null>(null);
  const [sources, setSources] = useState<BridgeSource[]>([]);
  const [repo, setRepo] = useState('');
  const [busy, setBusy] = useState(false);
  const [srcBusy, setSrcBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [b, s] = await Promise.all([getBriefing(), listBridgeSources()]);
      setBriefing(b);
      setSources(s);
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const regen = async () => {
    setBusy(true);
    setErr(null);
    try {
      await generateBriefing();
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const addSrc = async () => {
    if (!repo.trim()) return;
    setSrcBusy(true);
    setErr(null);
    try {
      await addBridgeSource(repo.trim());
      setRepo('');
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setSrcBusy(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <View style={styles.srcs}>
        <Text style={styles.srcsHead}>🔗 Fuentes conectadas</Text>
        {sources.map((s) => (
          <Text key={s.id} style={styles.srcRow}>
            {s.repo} <Text style={styles.srcTag}>{s.has_token ? '🔑' : '·público'}</Text>
          </Text>
        ))}
        <View style={styles.addRow}>
          <TextInput style={styles.input} value={repo} onChangeText={setRepo} placeholder="owner/repo" placeholderTextColor="#666" autoCapitalize="none" />
          <TouchableOpacity style={styles.addBtn} onPress={addSrc} disabled={srcBusy || !repo.trim()}>
            <Text style={styles.addBtnText}>+</Text>
          </TouchableOpacity>
        </View>
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={regen} disabled={busy}>
        {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Actualizar briefing</Text>}
      </TouchableOpacity>

      {err && <Text style={styles.error}>{err}</Text>}

      {!briefing && <Text style={styles.muted}>Conecta un repo y el puente trae sus señales (cada 6h).</Text>}

      {briefing && (
        <View style={styles.card}>
          <Text style={styles.summary}>{briefing.summary}</Text>
          {briefing.health ? <Text style={styles.block}><Text style={styles.bold}>🩺 Salud: </Text>{briefing.health}</Text> : null}
          {briefing.priorities.length > 0 && (
            <Text style={styles.block}><Text style={styles.bold}>⭐ Prioridades: </Text>{briefing.priorities.join(' · ')}</Text>
          )}
          {briefing.risks.length > 0 && (
            <Text style={styles.risk}><Text style={styles.bold}>⚠️ Riesgos: </Text>{briefing.risks.join(' · ')}</Text>
          )}
          <Text style={styles.meta}>{briefing.signals_analyzed} señales</Text>
        </View>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  srcs: { backgroundColor: '#0e0e14', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, padding: 14, gap: 8 },
  srcsHead: { color: '#8ab4f8', fontSize: 12, fontWeight: '700' },
  srcRow: { color: '#fff', fontSize: 14 },
  srcTag: { color: '#888', fontSize: 11 },
  addRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: '#111', color: '#eee', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 8, fontSize: 14 },
  addBtn: { width: 40, backgroundColor: '#fff', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#000', fontSize: 22, fontWeight: '700' },
  primaryBtn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  error: { color: '#ff9b9b', fontSize: 13 },
  muted: { color: '#888', fontSize: 13, textAlign: 'center' },
  card: { backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, padding: 14, gap: 10 },
  summary: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  block: { color: '#ccc', fontSize: 13, lineHeight: 19 },
  risk: { color: '#f3b0b0', fontSize: 13, lineHeight: 19 },
  bold: { fontWeight: '700', color: '#fff' },
  meta: { color: '#555', fontSize: 11 },
});
