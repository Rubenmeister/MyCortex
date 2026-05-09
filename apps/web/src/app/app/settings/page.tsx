'use client';

import { useCallback, useEffect, useState, type FormEvent } from 'react';
import { useWorkspace } from '../../../lib/workspace';
import {
  changeMemberRole,
  createWorkspace,
  inviteMember,
  listMembers,
  removeMember,
  type WorkspaceMember,
  type WorkspaceRole,
} from '../../../lib/api';

export default function SettingsPage() {
  const { workspaces, current, refresh, switchTo } = useWorkspace();
  const [members, setMembers] = useState<WorkspaceMember[] | null>(null);
  const [loadingMembers, setLoadingMembers] = useState(false);
  const [err, setErr] = useState<string | null>(null);
  const [info, setInfo] = useState<string | null>(null);

  const [inviteEmail, setInviteEmail] = useState('');
  const [inviteRole, setInviteRole] = useState<'admin' | 'member' | 'viewer'>('member');
  const [inviting, setInviting] = useState(false);

  const [newWsName, setNewWsName] = useState('');
  const [creating, setCreating] = useState(false);

  const loadMembers = useCallback(async () => {
    if (!current) return;
    setLoadingMembers(true);
    setErr(null);
    try {
      const list = await listMembers(current.id);
      setMembers(list);
    } catch (e) {
      setErr(String(e));
    } finally {
      setLoadingMembers(false);
    }
  }, [current]);

  useEffect(() => {
    void loadMembers();
  }, [loadMembers]);

  const isOwner = current?.role === 'owner';
  const isAdmin = current?.role === 'admin' || isOwner;

  const onCreate = async (e: FormEvent) => {
    e.preventDefault();
    if (!newWsName.trim()) return;
    setCreating(true);
    setErr(null);
    setInfo(null);
    try {
      const ws = await createWorkspace(newWsName.trim());
      setNewWsName('');
      await refresh();
      switchTo(ws.id);
      setInfo(`Workspace "${ws.name}" creado. Cambia el contexto recargando la página.`);
      // Reload to scope queries to the new workspace
      setTimeout(() => window.location.reload(), 600);
    } catch (e) {
      setErr(String(e));
    } finally {
      setCreating(false);
    }
  };

  const onInvite = async (e: FormEvent) => {
    e.preventDefault();
    if (!current || !inviteEmail.trim()) return;
    setInviting(true);
    setErr(null);
    setInfo(null);
    try {
      const r = await inviteMember(current.id, inviteEmail.trim(), inviteRole);
      setInviteEmail('');
      setInfo(
        r.alreadyMember
          ? `${r.member.email} ya era miembro (rol: ${r.member.role})`
          : `${r.member.email} agregado como ${r.member.role}`,
      );
      await loadMembers();
    } catch (e) {
      const msg = String(e);
      if (msg.includes('user_not_found')) {
        setErr('Ese email no tiene una cuenta. El usuario debe registrarse primero.');
      } else {
        setErr(msg);
      }
    } finally {
      setInviting(false);
    }
  };

  const onChangeRole = async (userId: string, role: WorkspaceRole) => {
    if (!current) return;
    try {
      await changeMemberRole(current.id, userId, role);
      await loadMembers();
      setInfo('Rol actualizado');
    } catch (e) {
      setErr(String(e));
    }
  };

  const onRemove = async (userId: string, email: string | null) => {
    if (!current) return;
    if (!confirm(`Quitar a ${email ?? userId.slice(0, 8)} del workspace?`)) return;
    try {
      await removeMember(current.id, userId);
      await loadMembers();
      setInfo('Miembro removido');
    } catch (e) {
      setErr(String(e));
    }
  };

  if (!current) {
    return <div className="page"><div className="empty">Cargando workspace…</div></div>;
  }

  return (
    <div className="page">
      <header className="head">
        <h1>Ajustes</h1>
      </header>

      {err && <div className="banner err">{err}</div>}
      {info && <div className="banner ok">{info}</div>}

      <section className="card">
        <h2>Workspace actual</h2>
        <div className="kv">
          <label>Nombre</label>
          <span>{current.name}</span>
        </div>
        <div className="kv">
          <label>Tipo</label>
          <span>{current.is_personal ? 'Personal' : 'Equipo'}</span>
        </div>
        <div className="kv">
          <label>Tu rol</label>
          <span>{current.role}</span>
        </div>
        <div className="kv">
          <label>Slug</label>
          <span style={{ fontFamily: 'monospace', fontSize: 12 }}>{current.slug ?? '—'}</span>
        </div>
      </section>

      <section className="card">
        <h2>Miembros ({members?.length ?? '…'})</h2>
        {loadingMembers && !members ? (
          <div className="empty">Cargando…</div>
        ) : (
          <ul className="members">
            {(members ?? []).map((m) => (
              <li key={m.user_id}>
                <div className="m-email">{m.email ?? m.user_id.slice(0, 8)}</div>
                {isOwner && m.role !== 'owner' ? (
                  <select
                    value={m.role}
                    onChange={(e) => onChangeRole(m.user_id, e.target.value as WorkspaceRole)}
                  >
                    <option value="admin">admin</option>
                    <option value="member">member</option>
                    <option value="viewer">viewer</option>
                  </select>
                ) : (
                  <span className="m-role">{m.role}</span>
                )}
                {!current.is_personal && m.role !== 'owner' && (isOwner || m.user_id === current.owner_id) && (
                  <button type="button" className="btn-ghost" onClick={() => onRemove(m.user_id, m.email)}>
                    Quitar
                  </button>
                )}
              </li>
            ))}
          </ul>
        )}

        {isAdmin && !current.is_personal && (
          <form onSubmit={onInvite} className="invite-form">
            <input
              type="email"
              placeholder="Invitar por email…"
              value={inviteEmail}
              onChange={(e) => setInviteEmail(e.target.value)}
              required
              disabled={inviting}
            />
            <select
              value={inviteRole}
              onChange={(e) => setInviteRole(e.target.value as 'admin' | 'member' | 'viewer')}
              disabled={inviting}
            >
              <option value="admin">admin</option>
              <option value="member">member</option>
              <option value="viewer">viewer</option>
            </select>
            <button type="submit" disabled={inviting || !inviteEmail.trim()}>
              {inviting ? '…' : 'Invitar'}
            </button>
          </form>
        )}

        {current.is_personal && (
          <p className="hint">
            En un workspace personal solo estás tú. Crea un workspace de equipo abajo para invitar a otros.
          </p>
        )}
      </section>

      <section className="card">
        <h2>Crear workspace de equipo</h2>
        <form onSubmit={onCreate} className="invite-form">
          <input
            type="text"
            placeholder="Nombre del equipo (ej. Going Ops)"
            value={newWsName}
            onChange={(e) => setNewWsName(e.target.value)}
            required
            disabled={creating}
            maxLength={80}
          />
          <button type="submit" disabled={creating || !newWsName.trim()}>
            {creating ? '…' : 'Crear'}
          </button>
        </form>
      </section>

      <section className="card">
        <h2>Tus workspaces</h2>
        <ul className="ws-list">
          {workspaces.map((w) => (
            <li key={w.id} className={w.id === current.id ? 'ws-item ws-current' : 'ws-item'}>
              <span>{w.is_personal ? '👤' : '🏢'}</span>
              <span style={{ flex: 1 }}>{w.name}</span>
              <span className="m-role">{w.role}</span>
              {w.id !== current.id && (
                <button
                  type="button"
                  className="btn-ghost"
                  onClick={() => {
                    switchTo(w.id);
                    window.location.reload();
                  }}
                >
                  Cambiar
                </button>
              )}
            </li>
          ))}
        </ul>
      </section>

      <style jsx>{`
        .page {
          max-width: 760px;
          margin: 0 auto;
          padding: 32px 24px 96px;
          display: flex;
          flex-direction: column;
          gap: 20px;
        }
        .head h1 {
          font-size: 24px;
          margin: 0;
        }
        .banner {
          padding: 10px 14px;
          border-radius: 8px;
          font-size: 13px;
        }
        .banner.err {
          background: #2a1a1a;
          color: #ff9b9b;
          border: 1px solid #4a2a2a;
        }
        .banner.ok {
          background: #122212;
          color: #9c9;
          border: 1px solid #1f3a1f;
        }
        .card {
          background: #111;
          border: 1px solid #1a1a1a;
          border-radius: 12px;
          padding: 20px;
        }
        h2 {
          font-size: 14px;
          color: #aaa;
          font-weight: 600;
          margin: 0 0 14px;
          text-transform: uppercase;
          letter-spacing: 0.5px;
        }
        .kv {
          display: flex;
          padding: 8px 0;
          border-bottom: 1px solid #1a1a1a;
          font-size: 14px;
        }
        .kv:last-child {
          border-bottom: none;
        }
        .kv label {
          color: #888;
          width: 120px;
        }
        .members,
        .ws-list {
          list-style: none;
          padding: 0;
          margin: 0;
          display: flex;
          flex-direction: column;
          gap: 6px;
        }
        .members li,
        .ws-item {
          display: flex;
          gap: 10px;
          align-items: center;
          padding: 10px 12px;
          background: #1a1a1a;
          border-radius: 8px;
          font-size: 14px;
        }
        .ws-current {
          background: #1f1f2f;
          border: 1px solid #2a2a3a;
        }
        .m-email {
          flex: 1;
          color: #eee;
        }
        .m-role {
          font-size: 12px;
          color: #888;
          text-transform: uppercase;
          letter-spacing: 0.4px;
        }
        select {
          background: #0a0a0a;
          color: #fff;
          border: 1px solid #2a2a2a;
          padding: 5px 10px;
          border-radius: 6px;
          font-size: 12px;
        }
        .btn-ghost {
          background: transparent;
          color: #ff8888;
          border: 1px solid #3a2a2a;
          padding: 5px 12px;
          border-radius: 6px;
          font-size: 12px;
          cursor: pointer;
        }
        .btn-ghost:hover {
          background: #2a1a1a;
        }
        .invite-form {
          display: flex;
          gap: 8px;
          margin-top: 14px;
        }
        .invite-form input,
        .invite-form select {
          background: #0a0a0a;
          border: 1px solid #2a2a2a;
          color: #fff;
          padding: 8px 12px;
          border-radius: 8px;
          font-size: 14px;
          font-family: inherit;
          flex: 1;
        }
        .invite-form select {
          flex: 0 0 110px;
        }
        .invite-form button {
          background: #fff;
          color: #000;
          border: none;
          border-radius: 8px;
          padding: 8px 18px;
          font-weight: 700;
          font-size: 13px;
          cursor: pointer;
        }
        .invite-form button:disabled {
          opacity: 0.4;
          cursor: not-allowed;
        }
        .hint {
          color: #777;
          font-size: 13px;
          margin: 14px 0 0;
        }
        .empty {
          color: #888;
          text-align: center;
          padding: 24px 0;
        }
      `}</style>
    </div>
  );
}
