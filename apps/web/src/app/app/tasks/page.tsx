'use client';

import { useCallback, useEffect, useState } from 'react';
import {
  createTask,
  deleteTask,
  extractTasks,
  listTasks,
  updateTask,
  type Task,
  type TaskPriority,
  type TaskStatus,
} from '../../../lib/api';
import { useWorkspace } from '../../../lib/workspace';

const COLUMNS: { status: TaskStatus; label: string }[] = [
  { status: 'todo', label: 'Por hacer' },
  { status: 'doing', label: 'Haciendo' },
  { status: 'done', label: 'Hecho' },
];

const PRIORITY_META: Record<TaskPriority, { label: string; color: string }> = {
  alta: { label: 'ALTA', color: '#ff9b9b' },
  media: { label: 'MEDIA', color: '#fb6' },
  baja: { label: 'BAJA', color: '#9bc' },
};

const ORIGIN_LABEL: Record<Task['origin'], string> = {
  manual: 'manual',
  coach: '🎯 coach',
  extracted: '✨ extraída',
  meeting: '📅 reunión',
};

const NEXT: Partial<Record<TaskStatus, TaskStatus>> = { todo: 'doing', doing: 'done' };
const PREV: Partial<Record<TaskStatus, TaskStatus>> = { done: 'doing', doing: 'todo' };

export default function TasksPage() {
  const { current } = useWorkspace();
  const [tasks, setTasks] = useState<Task[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [newTitle, setNewTitle] = useState('');
  const [extractMsg, setExtractMsg] = useState<string | null>(null);
  const [extracting, setExtracting] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setTasks(await listTasks({ limit: 200 }));
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (current) void load();
  }, [current, load]);

  const add = async () => {
    const title = newTitle.trim();
    if (!title) return;
    setBusy('new');
    setError(null);
    try {
      await createTask({ title });
      setNewTitle('');
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const move = async (t: Task, status: TaskStatus) => {
    setBusy(t.id);
    try {
      await updateTask(t.id, { status });
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const remove = async (id: string) => {
    setBusy(id);
    try {
      await deleteTask(id);
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setBusy(null);
    }
  };

  const runExtract = async () => {
    setExtracting(true);
    setExtractMsg(null);
    setError(null);
    try {
      const { created } = await extractTasks();
      setExtractMsg(
        created > 0 ? `Extraje ${created} tarea${created === 1 ? '' : 's'} de tu material.` : 'No encontré tareas nuevas en tu material reciente.',
      );
      await load();
    } catch (err) {
      setError(String(err));
    } finally {
      setExtracting(false);
    }
  };

  const byStatus = (s: TaskStatus) => tasks.filter((t) => t.status === s);

  return (
    <div className="page">
      <header className="head">
        <div>
          <h1>Tareas ✅</h1>
          <p className="sub">Tu tablero. Creá a mano o dejá que extraiga los pendientes de tus notas, mails y reuniones.</p>
        </div>
        <button type="button" className="btn" disabled={extracting} onClick={runExtract}>
          {extracting ? 'Pensando…' : '✨ Extraer de mi material'}
        </button>
      </header>

      {extractMsg && <div className="info">{extractMsg}</div>}
      {error && <div className="err">{error}</div>}
      {loading && <div className="muted">Cargando…</div>}

      {!loading && (
        <div className="board">
          {COLUMNS.map((col) => {
            const items = byStatus(col.status);
            return (
              <section key={col.status} className="col">
                <div className="col-head">
                  {col.label} <span className="count">{items.length}</span>
                </div>

                {col.status === 'todo' && (
                  <div className="new">
                    <input
                      value={newTitle}
                      onChange={(e) => setNewTitle(e.target.value)}
                      onKeyDown={(e) => e.key === 'Enter' && add()}
                      placeholder="+ Nueva tarea"
                      disabled={busy === 'new'}
                    />
                  </div>
                )}

                {items.length === 0 ? (
                  <div className="col-empty">—</div>
                ) : (
                  items.map((t) => {
                    const pm = PRIORITY_META[t.priority];
                    return (
                      <div key={t.id} className="task">
                        <div className="task-top">
                          <span className="prio" style={{ color: pm.color }}>● {pm.label}</span>
                          <span className="origin">{ORIGIN_LABEL[t.origin]}</span>
                        </div>
                        <div className="task-title" style={{ textDecoration: t.status === 'done' ? 'line-through' : 'none' }}>
                          {t.title}
                        </div>
                        {t.detail && <div className="task-detail">{t.detail}</div>}
                        <div className="task-actions">
                          {PREV[t.status] && (
                            <button type="button" className="mini" disabled={busy === t.id} onClick={() => move(t, PREV[t.status]!)}>←</button>
                          )}
                          {NEXT[t.status] && (
                            <button type="button" className="mini" disabled={busy === t.id} onClick={() => move(t, NEXT[t.status]!)}>→</button>
                          )}
                          <button type="button" className="mini del" disabled={busy === t.id} onClick={() => remove(t.id)}>✕</button>
                        </div>
                      </div>
                    );
                  })
                )}
              </section>
            );
          })}
        </div>
      )}

      <style jsx>{`
        .page { max-width: 1000px; margin: 0 auto; padding: 32px 24px 96px; }
        .head { display: flex; justify-content: space-between; align-items: flex-end; gap: 16px; flex-wrap: wrap; margin-bottom: 20px; }
        h1 { margin: 0 0 4px; font-size: 24px; }
        .sub { color: #888; font-size: 14px; margin: 0; max-width: 520px; line-height: 1.5; }
        .info { background: #152030; border: 1px solid #253545; color: #9bc; padding: 9px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .err { background: #2a1a1a; border: 1px solid #4a2a2a; color: #ff9b9b; padding: 10px 14px; border-radius: 8px; font-size: 13px; margin-bottom: 12px; }
        .muted { color: #888; font-size: 13px; padding: 16px 0; }
        .btn { background: transparent; border: 1px solid #2a2a3a; color: #ccc; padding: 8px 14px; border-radius: 8px; font-size: 13px; cursor: pointer; font-weight: 600; }
        .btn:hover { border-color: #4a4a5a; color: #fff; }
        .btn:disabled { opacity: 0.45; cursor: not-allowed; }
        .board { display: grid; grid-template-columns: repeat(3, 1fr); gap: 14px; }
        @media (max-width: 720px) { .board { grid-template-columns: 1fr; } }
        .col { background: #0c0c12; border: 1px solid #16161e; border-radius: 12px; padding: 12px; min-height: 120px; }
        .col-head { color: #ccc; font-size: 13px; font-weight: 700; margin-bottom: 10px; display: flex; align-items: center; gap: 8px; }
        .count { color: #666; font-weight: 600; font-size: 12px; }
        .new input { width: 100%; box-sizing: border-box; background: #111; border: 1px solid #1f1f2a; color: #eee; padding: 8px 10px; border-radius: 8px; font-size: 13px; margin-bottom: 10px; }
        .new input:focus { outline: none; border-color: #2a2a3a; }
        .col-empty { color: #444; font-size: 13px; text-align: center; padding: 12px 0; }
        .task { background: #0f0f16; border: 1px solid #1a1a22; border-radius: 10px; padding: 10px 12px; margin-bottom: 8px; }
        .task-top { display: flex; justify-content: space-between; align-items: center; font-size: 10px; margin-bottom: 6px; }
        .prio { font-weight: 700; letter-spacing: 0.5px; }
        .origin { color: #777; }
        .task-title { color: #fff; font-size: 14px; font-weight: 600; line-height: 1.35; }
        .task-detail { color: #999; font-size: 12px; line-height: 1.45; margin-top: 4px; }
        .task-actions { display: flex; gap: 6px; margin-top: 10px; }
        .mini { background: transparent; border: 1px solid #2a2a3a; color: #bbb; width: 28px; height: 26px; border-radius: 6px; cursor: pointer; font-size: 13px; }
        .mini:hover { border-color: #4a4a5a; color: #fff; }
        .mini:disabled { opacity: 0.4; cursor: not-allowed; }
        .mini.del { margin-left: auto; }
        .mini.del:hover { border-color: #6a3a3a; color: #ff9b9b; }
      `}</style>
    </div>
  );
}
