'use client';

import {
  createContext,
  useCallback,
  useContext,
  useEffect,
  useState,
  type ReactNode,
} from 'react';
import {
  listWorkspaces,
  setSelectedWorkspaceId,
  type Workspace,
} from './api';
import { useAuth } from './auth';

const WORKSPACE_STORAGE_KEY = 'mycortex.workspaceId';

type WorkspaceState = {
  workspaces: Workspace[];
  current: Workspace | null;
  loading: boolean;
  error: string | null;
  switchTo: (id: string) => void;
  refresh: () => Promise<void>;
};

const Ctx = createContext<WorkspaceState | undefined>(undefined);

/**
 * Holds the user's list of workspaces and the currently active one.
 * Persists the active workspace id to localStorage and forwards it to
 * the api via the X-MyCortex-Workspace-Id header (handled inside lib/api).
 */
export function WorkspaceProvider({ children }: { children: ReactNode }) {
  const { session } = useAuth();
  const [workspaces, setWorkspaces] = useState<Workspace[]>([]);
  const [currentId, setCurrentId] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    if (!session) return;
    setLoading(true);
    setError(null);
    try {
      const list = await listWorkspaces();
      setWorkspaces(list);
      // Pick stored id if it's still in the list, else the personal one.
      const stored =
        typeof window !== 'undefined' ? window.localStorage.getItem(WORKSPACE_STORAGE_KEY) : null;
      const valid = stored && list.find((w) => w.id === stored);
      const target = valid ? valid.id : list.find((w) => w.is_personal)?.id ?? list[0]?.id ?? null;
      setCurrentId(target);
      setSelectedWorkspaceId(target);
    } catch (err) {
      setError(String(err));
    } finally {
      setLoading(false);
    }
  }, [session]);

  useEffect(() => {
    if (session) void refresh();
    else {
      setWorkspaces([]);
      setCurrentId(null);
      setLoading(false);
    }
  }, [session, refresh]);

  const switchTo = useCallback((id: string) => {
    setCurrentId(id);
    setSelectedWorkspaceId(id);
  }, []);

  const current = workspaces.find((w) => w.id === currentId) ?? null;

  return (
    <Ctx.Provider value={{ workspaces, current, loading, error, switchTo, refresh }}>
      {children}
    </Ctx.Provider>
  );
}

export function useWorkspace(): WorkspaceState {
  const v = useContext(Ctx);
  if (!v) throw new Error('useWorkspace must be used inside WorkspaceProvider');
  return v;
}
