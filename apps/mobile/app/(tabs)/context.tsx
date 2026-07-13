import { useEffect, useState } from 'react';
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
  acceptContextProposal,
  getContext,
  listContextProposals,
  proposeContext,
  rejectContextProposal,
  saveContext,
  type ContextProposal,
} from '../../src/lib/api';

const PLACEHOLDER = `## Metas
- (tus objetivos duraderos)

## Proyectos
- (en qué andas)

## Personas
- (gente clave)

## Reglas y preferencias
- (cómo quieres que te trate)`;

export default function ContextScreen() {
  const [body, setBody] = useState('');
  const [saved, setSaved] = useState('');
  const [proposals, setProposals] = useState<ContextProposal[]>([]);
  const [loading, setLoading] = useState(true);
  const [savingBusy, setSavingBusy] = useState(false);
  const [proposing, setProposing] = useState(false);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [err, setErr] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = async () => {
    setLoading(true);
    try {
      const [ctx, props] = await Promise.all([getContext(), listContextProposals()]);
      setBody(ctx.body);
      setSaved(ctx.body);
      setProposals(props);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    load();
  }, []);

  const dirty = body !== saved;

  const save = async () => {
    setSavingBusy(true);
    setErr(null);
    try {
      const ctx = await saveContext(body);
      setSaved(ctx.body);
      setNotice('Guardado');
      setTimeout(() => setNotice(null), 2000);
    } catch (e) {
      setErr(String(e));
    } finally {
      setSavingBusy(false);
    }
  };

  const propose = async () => {
    setProposing(true);
    setErr(null);
    try {
      const { created } = await proposeContext();
      setNotice(created > 0 ? `${created} propuesta(s) nueva(s)` : 'Sin propuestas nuevas');
      setTimeout(() => setNotice(null), 2500);
      setProposals(await listContextProposals());
    } catch (e) {
      setErr(String(e));
    } finally {
      setProposing(false);
    }
  };

  const accept = async (p: ContextProposal) => {
    setBusyId(p.id);
    setErr(null);
    try {
      const { body: newBody } = await acceptContextProposal(p.id);
      if (typeof newBody === 'string') {
        setBody(newBody);
        setSaved(newBody);
      }
      setProposals((prev) => prev.filter((it) => it.id !== p.id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusyId(null);
    }
  };

  const reject = async (p: ContextProposal) => {
    setBusyId(p.id);
    setErr(null);
    try {
      await rejectContextProposal(p.id);
      setProposals((prev) => prev.filter((it) => it.id !== p.id));
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusyId(null);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <Text style={styles.sub}>
        Tu constitución: lo que declaras sobre tu vida y trabajo. Es la fuente de verdad que MyCortex
        usa en todo lo que razona.
      </Text>

      {err && <Text style={styles.error}>{err}</Text>}
      {notice && <Text style={styles.ok}>{notice}</Text>}

      <View style={styles.rowBetween}>
        <Text style={styles.tag}>📝 Tu constitución</Text>
        <TouchableOpacity
          style={[styles.saveBtn, (!dirty || savingBusy) && styles.disabled]}
          onPress={save}
          disabled={!dirty || savingBusy}
        >
          <Text style={styles.saveBtnText}>{savingBusy ? '…' : dirty ? 'Guardar' : 'Guardado'}</Text>
        </TouchableOpacity>
      </View>

      <TextInput
        style={styles.input}
        value={body}
        onChangeText={setBody}
        placeholder={PLACEHOLDER}
        placeholderTextColor="#555"
        multiline
        editable={!loading}
        textAlignVertical="top"
      />

      <View style={styles.inboxHead}>
        <Text style={styles.tag}>💡 La IA propone fijar</Text>
        {proposals.length > 0 && <Text style={styles.count}>{proposals.length}</Text>}
      </View>
      <TouchableOpacity style={styles.proposeBtn} onPress={propose} disabled={proposing}>
        {proposing ? <ActivityIndicator color="#ccc" /> : <Text style={styles.proposeBtnText}>🔍 Buscar en mi material</Text>}
      </TouchableOpacity>

      {loading && <Text style={styles.muted}>Cargando…</Text>}
      {!loading && proposals.length === 0 && (
        <Text style={styles.muted}>
          Sin propuestas pendientes. Pulsa «Buscar en mi material» o espera el lote automático de cada lunes.
        </Text>
      )}

      {proposals.map((p) => {
        const busy = busyId === p.id;
        return (
          <View key={p.id} style={styles.card}>
            <Text style={styles.section}>{p.section.toUpperCase()}</Text>
            <Text style={styles.cardText}>{p.text}</Text>
            {p.rationale ? <Text style={styles.rationale}>{p.rationale}</Text> : null}
            <View style={styles.cardActions}>
              <TouchableOpacity style={[styles.act, styles.actPrimary]} onPress={() => accept(p)} disabled={busy}>
                <Text style={styles.actPrimaryText}>{busy ? '…' : '✓ Fijar'}</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.act} onPress={() => reject(p)} disabled={busy}>
                <Text style={styles.actText}>✕ Descartar</Text>
              </TouchableOpacity>
            </View>
          </View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#0a0a0a' },
  body: { padding: 16, gap: 12, paddingBottom: 48 },
  sub: { color: '#888', fontSize: 13, lineHeight: 19 },
  error: { color: '#ff9b9b', fontSize: 13 },
  ok: { color: '#7fd6a6', fontSize: 13 },
  rowBetween: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', marginTop: 4 },
  tag: { color: '#c79bf2', fontSize: 12, fontWeight: '700' },
  saveBtn: { backgroundColor: '#fff', borderRadius: 8, paddingHorizontal: 16, paddingVertical: 8 },
  saveBtnText: { color: '#000', fontSize: 13, fontWeight: '700' },
  disabled: { opacity: 0.4 },
  input: { minHeight: 260, backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1f1f2a', borderRadius: 10, color: '#ddd', fontSize: 14, lineHeight: 21, padding: 14, fontFamily: 'monospace' },
  inboxHead: { flexDirection: 'row', alignItems: 'center', gap: 8, marginTop: 8 },
  count: { color: '#9bd0e0', fontSize: 11, fontWeight: '700', backgroundColor: '#14141c', borderWidth: 1, borderColor: '#1f2a30', borderRadius: 99, paddingHorizontal: 8, paddingVertical: 1, overflow: 'hidden' },
  proposeBtn: { borderWidth: 1, borderColor: '#2a2a3a', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  proposeBtnText: { color: '#ccc', fontSize: 13, fontWeight: '600' },
  muted: { color: '#888', fontSize: 13, lineHeight: 19 },
  card: { backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 12, padding: 14, gap: 6 },
  section: { color: '#f7d774', fontSize: 10, fontWeight: '700', letterSpacing: 0.4 },
  cardText: { color: '#fff', fontSize: 15, lineHeight: 21 },
  rationale: { color: '#999', fontSize: 13, lineHeight: 19 },
  cardActions: { flexDirection: 'row', gap: 8, marginTop: 6 },
  act: { borderWidth: 1, borderColor: '#2a2a3a', borderRadius: 8, paddingHorizontal: 14, paddingVertical: 7 },
  actText: { color: '#888', fontSize: 12, fontWeight: '600' },
  actPrimary: { backgroundColor: '#7fd6a6', borderColor: '#7fd6a6' },
  actPrimaryText: { color: '#0a0a0a', fontSize: 12, fontWeight: '700' },
});
