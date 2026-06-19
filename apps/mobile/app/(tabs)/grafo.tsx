import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, ScrollView, StyleSheet, Text, TouchableOpacity, View } from 'react-native';
import { extractEntities, getEntity, listEntities, type Entity, type EntityDetail } from '../../src/lib/api';

const TYPE_EMOJI: Record<string, string> = {
  persona: '👤', proyecto: '🚀', organizacion: '🏢', lugar: '📍', tema: '🏷️', otro: '•',
};

export default function GrafoScreen() {
  const [entities, setEntities] = useState<Entity[]>([]);
  const [detail, setDetail] = useState<EntityDetail | null>(null);
  const [busy, setBusy] = useState(false);
  const [detailBusy, setDetailBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setEntities(await listEntities());
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const open = async (id: string) => {
    setDetailBusy(true);
    setErr(null);
    try {
      setDetail(await getEntity(id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setDetailBusy(false);
    }
  };

  const build = async () => {
    setBusy(true);
    setErr(null);
    try {
      await extractEntities();
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  if (detail) {
    return (
      <ScrollView style={styles.root} contentContainerStyle={styles.body}>
        <TouchableOpacity onPress={() => setDetail(null)}>
          <Text style={styles.back}>← Volver</Text>
        </TouchableOpacity>
        <Text style={styles.h2}>{TYPE_EMOJI[detail.entity.type] ?? '•'} {detail.entity.name}</Text>
        {detail.entity.summary ? <Text style={styles.summary}>{detail.entity.summary}</Text> : null}
        {detail.related.length > 0 && (
          <View style={styles.chips}>
            {detail.related.map((r) => (
              <TouchableOpacity key={r.id} onPress={() => open(r.id)}>
                <Text style={styles.relChip}>{TYPE_EMOJI[r.type] ?? '•'} {r.name} ×{r.count}</Text>
              </TouchableOpacity>
            ))}
          </View>
        )}
        <Text style={styles.muted}>{detail.nodes.length} menciones</Text>
        {detail.nodes.map((n) => (
          <View key={n.id} style={styles.node}>
            {n.title ? <Text style={styles.nodeTitle}>{n.title}</Text> : null}
            <Text style={styles.nodeBody}>{n.content.slice(0, 200)}</Text>
          </View>
        ))}
      </ScrollView>
    );
  }

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <TouchableOpacity style={styles.primaryBtn} onPress={build} disabled={busy}>
        {busy ? <ActivityIndicator color="#000" /> : <Text style={styles.primaryBtnText}>Construir grafo</Text>}
      </TouchableOpacity>
      {err && <Text style={styles.error}>{err}</Text>}
      {detailBusy && <Text style={styles.muted}>Cargando…</Text>}
      {entities.length === 0 && !busy && (
        <Text style={styles.muted}>Construí el grafo y aparecen las personas, proyectos y temas de tu material.</Text>
      )}
      {entities.map((e) => (
        <TouchableOpacity key={e.id} style={styles.entRow} onPress={() => open(e.id)}>
          <Text style={styles.entName}>{TYPE_EMOJI[e.type] ?? '•'} {e.name}</Text>
          <Text style={styles.entCount}>{e.mention_count}</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 10, paddingBottom: 40 },
  primaryBtn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, alignItems: 'center' },
  primaryBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  error: { color: '#ff9b9b', fontSize: 13 },
  muted: { color: '#888', fontSize: 13 },
  entRow: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 10, padding: 12 },
  entName: { color: '#ddd', fontSize: 14 },
  entCount: { color: '#666', fontSize: 12 },
  back: { color: '#8ab4f8', fontSize: 14, marginBottom: 4 },
  h2: { color: '#fff', fontSize: 18, fontWeight: '700' },
  summary: { color: '#bbb', fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6 },
  relChip: { color: '#c79bf2', fontSize: 11, backgroundColor: '#16131c', borderWidth: 1, borderColor: '#271f30', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 3 },
  node: { backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 10, padding: 12, gap: 2 },
  nodeTitle: { color: '#fff', fontSize: 13, fontWeight: '600' },
  nodeBody: { color: '#999', fontSize: 12, lineHeight: 18 },
});
