import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { getMeetingPrep, getUpcomingEvents, type AgendaEvent, type MeetingPrep } from '../../src/lib/api.js';

function formatWhen(iso: string | null): string {
  if (!iso) return 'sin fecha';
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return iso;
  return d.toLocaleString(undefined, { weekday: 'short', day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit' });
}

export default function AgendaScreen() {
  const [events, setEvents] = useState<AgendaEvent[]>([]);
  const [preps, setPreps] = useState<Record<string, MeetingPrep>>({});
  const [prepBusy, setPrepBusy] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEvents(await getUpcomingEvents(14));
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const prep = async (nodeId: string) => {
    setPrepBusy(nodeId);
    setErr(null);
    try {
      const p = await getMeetingPrep(nodeId);
      setPreps((m) => ({ ...m, [nodeId]: p }));
    } catch (e) {
      setErr(String(e));
    } finally {
      setPrepBusy(null);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      {err && <Text style={styles.error}>{err}</Text>}
      {events.length === 0 && (
        <Text style={styles.muted}>No tenés eventos próximos. Conectá tu Google Calendar en Ajustes.</Text>
      )}
      {events.map((e) => {
        const p = preps[e.nodeId];
        return (
          <View key={e.nodeId} style={styles.card}>
            <Text style={styles.when}>⏰ {formatWhen(e.start)}</Text>
            <Text style={styles.title}>{e.title}</Text>
            {e.location ? <Text style={styles.meta}>📍 {e.location}</Text> : null}
            {e.attendees.length > 0 ? <Text style={styles.meta}>👥 {e.attendees.slice(0, 5).join(', ')}</Text> : null}
            <TouchableOpacity style={styles.prepBtn} onPress={() => prep(e.nodeId)} disabled={prepBusy === e.nodeId}>
              {prepBusy === e.nodeId ? <ActivityIndicator color="#000" /> : <Text style={styles.prepText}>{p ? 'Regenerar' : 'Preparame ✨'}</Text>}
            </TouchableOpacity>
            {p && (
              <View style={styles.brief}>
                <Text style={styles.briefText}>{p.brief}</Text>
              </View>
            )}
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  error: { color: '#ff9b9b', fontSize: 13 },
  muted: { color: '#888', fontSize: 13, textAlign: 'center', marginTop: 12 },
  card: { backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, padding: 14, gap: 6 },
  when: { color: '#8ab4f8', fontSize: 12, fontWeight: '600' },
  title: { color: '#fff', fontSize: 15, fontWeight: '700' },
  meta: { color: '#aaa', fontSize: 13 },
  prepBtn: { backgroundColor: '#fff', borderRadius: 8, paddingVertical: 10, alignItems: 'center', marginTop: 6 },
  prepText: { color: '#000', fontWeight: '700', fontSize: 13 },
  brief: { marginTop: 8, backgroundColor: 'rgba(138,180,248,0.06)', borderWidth: 1, borderColor: '#1f2433', borderRadius: 10, padding: 12 },
  briefText: { color: '#ddd', fontSize: 13, lineHeight: 20 },
});
