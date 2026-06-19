import { useEffect, useState } from 'react';
import {
  ActivityIndicator,
  ScrollView,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from 'react-native';
import {
  generateCoach,
  getCoachProfile,
  refreshCoachProfile,
  type CoachGeneration,
  type CoachProfile,
  type CoachSuggestion,
} from '../../src/lib/api.js';

const DOMAIN_EMOJI: Record<string, string> = {
  salud: '🩺', ejercicio: '💪', proyectos: '🚀', productividad: '⚡',
  aprendizaje: '📚', finanzas: '💰', relaciones: '🤝', bienestar: '🧘', otro: '•',
};
const PRIORITY_COLOR: Record<string, string> = { alta: '#ff9b9b', media: '#fb6', baja: '#9bc' };
const RANK: Record<string, number> = { alta: 0, media: 1, baja: 2 };

export default function CoachScreen() {
  const [profile, setProfile] = useState<CoachProfile | null>(null);
  const [data, setData] = useState<CoachGeneration | null>(null);
  const [profileBusy, setProfileBusy] = useState(false);
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState<string | null>(null);

  useEffect(() => {
    getCoachProfile().then(setProfile).catch(() => {});
  }, []);

  const buildProfile = async () => {
    setProfileBusy(true);
    setErr(null);
    try {
      setProfile(await refreshCoachProfile());
    } catch (e) {
      setErr(String(e));
    } finally {
      setProfileBusy(false);
    }
  };

  const generate = async () => {
    setBusy(true);
    setErr(null);
    try {
      setData(await generateCoach());
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const suggestions: CoachSuggestion[] = data
    ? [...data.result.suggestions].sort((a, b) => RANK[a.priority] - RANK[b.priority])
    : [];

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <View style={styles.profileCard}>
        <View style={styles.rowBetween}>
          <Text style={styles.profileTag}>🧠 Lo que sé de vos</Text>
          <TouchableOpacity style={styles.smallBtn} onPress={buildProfile} disabled={profileBusy}>
            <Text style={styles.smallBtnText}>
              {profileBusy ? '…' : profile?.summary ? 'Actualizar' : 'Construir'}
            </Text>
          </TouchableOpacity>
        </View>
        {profile?.summary ? (
          <>
            <Text style={styles.profileText}>{profile.summary}</Text>
            {profile.focus_areas?.length > 0 && (
              <View style={styles.chips}>
                {profile.focus_areas.map((f, i) => (
                  <Text key={i} style={styles.chip}>{f}</Text>
                ))}
              </View>
            )}
          </>
        ) : (
          <Text style={styles.muted}>
            Apretá «Construir» y armo tu perfil leyendo tu material.
          </Text>
        )}
      </View>

      <TouchableOpacity style={styles.primaryBtn} onPress={generate} disabled={busy}>
        {busy ? (
          <ActivityIndicator color="#000" />
        ) : (
          <Text style={styles.primaryBtnText}>{data ? 'Regenerar sugerencias' : 'Generar mis sugerencias'}</Text>
        )}
      </TouchableOpacity>

      {err && <Text style={styles.error}>{err}</Text>}

      {busy && <Text style={styles.muted}>Analizando tu material…</Text>}

      {data && (
        <>
          <View style={styles.focusCard}>
            <Text style={styles.focusTag}>⭐ Tu foco de la semana</Text>
            <Text style={styles.focusText}>{data.result.focus}</Text>
          </View>

          {suggestions.map((s, i) => (
            <View key={i} style={styles.card}>
              <View style={styles.cardHead}>
                <Text style={styles.domain}>{DOMAIN_EMOJI[s.domain] ?? '•'} {s.domain}</Text>
                <Text style={[styles.prio, { color: PRIORITY_COLOR[s.priority] }]}>● {s.priority.toUpperCase()}</Text>
              </View>
              <Text style={styles.cardTitle}>{s.title}</Text>
              <Text style={styles.insight}>{s.insight}</Text>
              <Text style={styles.action}>→ {s.action}</Text>
            </View>
          ))}

          <Text style={styles.meta}>
            Analicé {data.meta.nodesAnalyzed} ítems de los últimos {data.meta.lookbackDays} días.
          </Text>
        </>
      )}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 12, paddingBottom: 40 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center' },
  profileCard: { backgroundColor: '#0e0e14', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, padding: 16, gap: 8 },
  profileTag: { color: '#c79bf2', fontSize: 12, fontWeight: '700' },
  profileText: { color: '#ddd', fontSize: 14, lineHeight: 20 },
  chips: { flexDirection: 'row', flexWrap: 'wrap', gap: 6, marginTop: 4 },
  chip: { color: '#9bd0e0', fontSize: 11, backgroundColor: '#14141c', borderWidth: 1, borderColor: '#1f2a30', borderRadius: 99, paddingHorizontal: 10, paddingVertical: 2 },
  smallBtn: { borderWidth: 1, borderColor: '#2a2a3a', borderRadius: 8, paddingHorizontal: 12, paddingVertical: 6 },
  smallBtnText: { color: '#ccc', fontSize: 12, fontWeight: '600' },
  primaryBtn: { backgroundColor: '#fff', borderRadius: 10, paddingVertical: 14, alignItems: 'center', justifyContent: 'center' },
  primaryBtnText: { color: '#000', fontWeight: '700', fontSize: 15 },
  error: { color: '#ff9b9b', fontSize: 13 },
  muted: { color: '#888', fontSize: 13 },
  focusCard: { backgroundColor: '#161620', borderWidth: 1, borderColor: '#2a2a3a', borderRadius: 12, padding: 16 },
  focusTag: { color: '#f7d774', fontSize: 12, fontWeight: '700', marginBottom: 6 },
  focusText: { color: '#fff', fontSize: 16, fontWeight: '600', lineHeight: 22 },
  card: { backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, padding: 14, gap: 6 },
  cardHead: { flexDirection: 'row', justifyContent: 'space-between' },
  domain: { color: '#aaa', fontSize: 11, fontWeight: '700' },
  prio: { fontSize: 10, fontWeight: '700' },
  cardTitle: { color: '#fff', fontSize: 15, fontWeight: '700' },
  insight: { color: '#bbb', fontSize: 13, lineHeight: 19 },
  action: { color: '#e6e6e6', fontSize: 13, lineHeight: 19, backgroundColor: 'rgba(255,255,255,0.04)', borderRadius: 8, padding: 10, overflow: 'hidden' },
  meta: { color: '#555', fontSize: 11, textAlign: 'center', marginTop: 8 },
});
