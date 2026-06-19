import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  RefreshControl,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import { listRecent, runCortex, type RecentNode } from '../../src/lib/api';

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

export default function NodesScreen() {
  const [nodes, setNodes] = useState<RecentNode[] | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [running, setRunning] = useState(false);

  const load = useCallback(async () => {
    setError(null);
    try {
      const list = await listRecent(20);
      setNodes(list);
    } catch (err) {
      setError(String(err));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const onRefresh = async () => {
    setRefreshing(true);
    await load();
    setRefreshing(false);
  };

  const triggerCortex = async () => {
    setRunning(true);
    try {
      const r = await runCortex();
      setError(
        `Run ${r.runId.slice(0, 8)} — ${r.nodesExamined} examinados, ${r.clustersFound} clusters, ${r.actionsCount} sugerencias`,
      );
    } catch (err) {
      setError(String(err));
    } finally {
      setRunning(false);
      await load();
    }
  };

  if (nodes === null) {
    return (
      <View style={styles.center}>
        <ActivityIndicator color="#fff" />
      </View>
    );
  }

  return (
    <View style={styles.root}>
      <View style={styles.header}>
        <TouchableOpacity style={styles.cortexBtn} onPress={triggerCortex} disabled={running}>
          {running ? (
            <ActivityIndicator color="#000" />
          ) : (
            <Text style={styles.cortexBtnText}>🧠 Disparar evolución</Text>
          )}
        </TouchableOpacity>
      </View>

      {error && (
        <View style={styles.banner}>
          <Text style={styles.bannerText}>{error}</Text>
        </View>
      )}

      <FlatList
        data={nodes}
        keyExtractor={(n) => n.id}
        contentContainerStyle={{ padding: 16, gap: 8 }}
        refreshControl={<RefreshControl tintColor="#fff" refreshing={refreshing} onRefresh={onRefresh} />}
        ListEmptyComponent={
          <Text style={styles.empty}>No tienes notas todavía. Captura algo desde la pestaña Capturar.</Text>
        }
        renderItem={({ item }) => <NodeRow node={item} />}
      />
    </View>
  );
}

function NodeRow({ node }: { node: RecentNode }) {
  const ke = KIND_EMOJI[node.kind] ?? '📝';
  const ce = CATEGORY_EMOJI[node.category] ?? '❓';
  const title = node.title ?? node.content.slice(0, 60);
  return (
    <View style={styles.row}>
      <Text style={styles.rowTitle}>
        {ke} {title}
      </Text>
      <Text style={styles.rowMeta}>
        {ce} {node.category} · {ke} {node.kind} · {new Date(node.created_at).toLocaleDateString()}
      </Text>
      <Text style={styles.rowContent} numberOfLines={2}>
        {node.content}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', backgroundColor: '#0a0a0a' },
  header: { padding: 16, paddingBottom: 0 },
  cortexBtn: {
    backgroundColor: '#fff',
    paddingVertical: 12,
    paddingHorizontal: 16,
    borderRadius: 10,
    alignItems: 'center',
  },
  cortexBtnText: { color: '#000', fontWeight: '700', fontSize: 14 },
  banner: { backgroundColor: '#1a1a2a', padding: 12, marginHorizontal: 16, marginTop: 12, borderRadius: 8 },
  bannerText: { color: '#9c9', fontSize: 12 },
  row: { backgroundColor: '#1a1a1a', borderRadius: 12, padding: 14 },
  rowTitle: { color: '#fff', fontSize: 16, fontWeight: '700' },
  rowMeta: { color: '#888', fontSize: 11, marginTop: 4 },
  rowContent: { color: '#bbb', fontSize: 13, marginTop: 8, lineHeight: 18 },
  empty: { color: '#666', textAlign: 'center', marginTop: 80 },
});
