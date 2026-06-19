import { useRouter, type Href } from 'expo-router';
import { ScrollView, StyleSheet, Text, TouchableOpacity } from 'react-native';

const ITEMS: { label: string; route: string }[] = [
  { label: '📓  Diario', route: '/diario' },
  { label: '🕸️  Grafo', route: '/grafo' },
  { label: '📅  Agenda', route: '/agenda' },
  { label: '🚖  Going', route: '/going' },
  { label: '💬  Preguntar', route: '/ask' },
  { label: '☰  Notas', route: '/nodes' },
  { label: '⚙  Ajustes', route: '/settings' },
];

export default function MoreScreen() {
  const router = useRouter();
  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      {ITEMS.map((it) => (
        <TouchableOpacity key={it.route} style={styles.row} onPress={() => router.push(it.route as Href)}>
          <Text style={styles.label}>{it.label}</Text>
          <Text style={styles.chevron}>›</Text>
        </TouchableOpacity>
      ))}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 8, paddingBottom: 40 },
  row: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, paddingHorizontal: 16, paddingVertical: 16 },
  label: { color: '#fff', fontSize: 16 },
  chevron: { color: '#666', fontSize: 22 },
});
