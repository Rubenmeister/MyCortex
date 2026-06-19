import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { generateEpisode, listEpisodes, type CoachEpisode } from '../../src/lib/api';

export default function DiarioScreen() {
  const [episodes, setEpisodes] = useState<CoachEpisode[]>([]);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEpisodes(await listEpisodes());
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      await generateEpisode();
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <TouchableOpacity style={styles.primaryBtn} onPress={generate} disabled={busy}>
        {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Generar esta semana</Text>}
      </TouchableOpacity>

      {err && <Text style={styles.error}>{err}</Text>}

      {episodes.length === 0 && !busy && (
        <Text style={styles.muted}>Tu diario está vacío. Generá el episodio de esta semana.</Text>
      )}

      {episodes.map((e) => (
        <View key={e.id} style={styles.card}>
          <Text style={styles.label}>{e.label}</Text>
          <Text style={styles.narrative}>{e.narrative}</Text>
          {e.themes.length > 0 && (
            <View style={styles.chips}>
              {e.themes.map((t, i) => (
                <Text key={i} style={styles.chip}>{t}</Text>
              ))}
            </View>
          )}
          {e.mood ? <Text style={styles.row}><Text style={styles.bold}>Ánimo: </Text>{e.mood}</Text> : null}
          {e.progress ? <Text style={styles.row}><Text style={styles.bold}>Progreso: </Text>{e.progress}</Text> : null}
          {e.loose_threads.length > 0 && (
            <Text style={styles.row}><Text style={styles.bold}>Hilos sueltos: </Text>{e.loose_threads.join(' · ')}</Text>
          )}
        </View>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  primaryBtn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  error: { color: '#ff9b9b', fontSize: 13 },
  muted: { color: '#888', fontSize: 13, textAlign: 'center', marginTop: 12 },
  card: { backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderLeftColor: '#c79bf2', borderLeftWidth: 3, borderRadius: 12, padding: 14, gap: 8 },
  label: { color: '#fff', fontSize: 15, fontWeight: '700' },
  narrative: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  chip: { color: '#c79bf2', fontSize: 11, backgroundColor: '#16131c', borderWidth: 1, borderColor: '#271f30', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2 },
  row: { color: '#aaa', fontSize: 13, lineHeight: 19 },
  bold: { color: '#ccc', fontWeight: '700' },
});
