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
  createTask,
  extractTasks,
  listTasks,
  updateTaskStatus,
  type Task,
  type TaskStatus,
} from '../../src/lib/api';

const PRIORITY_COLOR: Record<string, string> = { alta: '#ff9b9b', media: '#fb6', baja: '#9bc' };
const NEXT: Partial<Record<TaskStatus, TaskStatus>> = { todo: 'doing', doing: 'done' };
const SECTIONS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Por hacer' },
  { status: 'doing', label: 'Haciendo' },
  { status: 'done', label: 'Hecho' },
];

export default function TasksScreen() {
  const [tasks, setTasks] = useState<Task[]>([]);
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [extracting, setExtracting] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [msg, setMsg] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setTasks(await listTasks());
    } catch (e) {
      setErr(String(e));
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const add = async () => {
    if (!title.trim()) return;
    setBusy(true);
    setErr(null);
    try {
      await createTask(title.trim());
      setTitle('');
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setBusy(false);
    }
  };

  const advance = async (t: Task) => {
    const next = NEXT[t.status];
    if (!next) return;
    try {
      await updateTaskStatus(t.id, next);
      await load();
    } catch (e) {
      setErr(String(e));
    }
  };

  const runExtract = async () => {
    setExtracting(true);
    setMsg(null);
    setErr(null);
    try {
      const { created } = await extractTasks();
      setMsg(created > 0 ? `Extraje ${created} tarea(s) de tu material.` : 'No encontré tareas nuevas.');
      await load();
    } catch (e) {
      setErr(String(e));
    } finally {
      setExtracting(false);
    }
  };

  return (
    <ScrollView style={styles.root} contentContainerStyle={styles.body}>
      <View style={styles.addRow}>
        <TextInput
          style={styles.input}
          value={title}
          onChangeText={setTitle}
          placeholder="Nueva tarea…"
          placeholderTextColor="#666"
          onSubmitEditing={add}
        />
        <TouchableOpacity style={styles.addBtn} onPress={add} disabled={busy || !title.trim()}>
          <Text style={styles.addBtnText}>+</Text>
        </TouchableOpacity>
      </View>

      <TouchableOpacity style={styles.extractBtn} onPress={runExtract} disabled={extracting}>
        {extracting ? <ActivityIndicator color="#ccc" /> : <Text style={styles.extractText}>✨ Extraer de mi material</Text>}
      </TouchableOpacity>

      {msg && <Text style={styles.info}>{msg}</Text>}
      {err && <Text style={styles.error}>{err}</Text>}

      {SECTIONS.map((sec) => {
        const items = tasks.filter((t) => t.status === sec.status);
        return (
          <View key={sec.status} style={styles.section}>
            <Text style={styles.sectionHead}>{sec.label} · {items.length}</Text>
            {items.length === 0 ? (
              <Text style={styles.empty}>—</Text>
            ) : (
              items.map((t) => (
                <View key={t.id} style={styles.task}>
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.taskTitle, t.status === 'done' && styles.done]}>{t.title}</Text>
                    <Text style={[styles.prio, { color: PRIORITY_COLOR[t.priority] }]}>● {t.priority}</Text>
                  </View>
                  {NEXT[t.status] && (
                    <TouchableOpacity style={styles.moveBtn} onPress={() => advance(t)}>
                      <Text style={styles.moveText}>→</Text>
                    </TouchableOpacity>
                  )}
                </View>
              ))
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
  addRow: { flexDirection: 'row', gap: 8 },
  input: { flex: 1, backgroundColor: '#1a1a1a', color: '#fff', borderRadius: 10, paddingHorizontal: 14, paddingVertical: 12, fontSize: 15 },
  addBtn: { width: 48, backgroundColor: '#fff', borderRadius: 10, alignItems: 'center', justifyContent: 'center' },
  addBtnText: { color: '#000', fontSize: 24, fontWeight: '700' },
  extractBtn: { borderWidth: 1, borderColor: '#2a2a3a', borderRadius: 10, paddingVertical: 12, alignItems: 'center' },
  extractText: { color: '#ccc', fontSize: 13, fontWeight: '600' },
  info: { color: '#9bc', fontSize: 13 },
  error: { color: '#ff9b9b', fontSize: 13 },
  section: { gap: 6 },
  sectionHead: { color: '#ccc', fontSize: 13, fontWeight: '700', marginTop: 6 },
  empty: { color: '#444', fontSize: 13, textAlign: 'center', paddingVertical: 6 },
  task: { flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: '#0f0f16', borderWidth: 1, borderColor: '#1a1a22', borderRadius: 10, padding: 12 },
  taskTitle: { color: '#fff', fontSize: 14, fontWeight: '600' },
  done: { textDecorationLine: 'line-through', color: '#888' },
  prio: { fontSize: 10, fontWeight: '700', marginTop: 3 },
  moveBtn: { width: 36, height: 32, borderWidth: 1, borderColor: '#2a2a3a', borderRadius: 8, alignItems: 'center', justifyContent: 'center' },
  moveText: { color: '#bbb', fontSize: 16 },
});
