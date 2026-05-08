// Hand-written until first `pnpm --filter @mycortex/db gen:types` after applying
// migrations to a real Supabase project.

export type NodeKind = 'note' | 'task' | 'idea' | 'reference' | 'fragment';
export type NodeCategory = 'going' | 'personal' | 'urgent' | 'unknown';
export type IngestSource = 'telegram' | 'mobile' | 'web' | 'api';
export type WorkspaceRole = 'owner' | 'admin' | 'member' | 'viewer';

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

// ---- Workspaces ---------------------------------------------------------

export type WorkspaceRow = {
  id: string;
  name: string;
  slug: string | null;
  owner_id: string;
  is_personal: boolean;
  created_at: string;
  updated_at: string;
};

export type WorkspaceInsert = {
  id?: string;
  name: string;
  slug?: string | null;
  owner_id: string;
  is_personal?: boolean;
  created_at?: string;
  updated_at?: string;
};

export type WorkspaceUpdate = Partial<Omit<WorkspaceInsert, 'owner_id'>>;

export type WorkspaceMemberRow = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at: string;
};

export type WorkspaceMemberInsert = {
  workspace_id: string;
  user_id: string;
  role: WorkspaceRole;
  created_at?: string;
};

export type WorkspaceMemberUpdate = Partial<Pick<WorkspaceMemberRow, 'role'>>;

// ---- Nodes (now scoped to a workspace) ----------------------------------

export type NodeRow = {
  id: string;
  workspace_id: string;
  user_id: string; // creator
  kind: NodeKind;
  category: NodeCategory;
  title: string | null;
  content: string;
  source: IngestSource;
  embedding: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type NodeInsert = {
  id?: string;
  workspace_id: string;
  user_id: string;
  kind?: NodeKind;
  category?: NodeCategory;
  title?: string | null;
  content: string;
  source: IngestSource;
  embedding?: number[] | null;
  metadata?: Json;
  created_at?: string;
  updated_at?: string;
};

export type NodeUpdate = Partial<Omit<NodeInsert, 'user_id' | 'workspace_id'>>;

// ---- Evolutions (workspace-scoped) --------------------------------------

export type EvolutionStatus = 'running' | 'completed' | 'failed';
export type EvolutionAction = 'merge' | 'complement' | 'correct' | 'skip';

export type EvolutionRunRow = {
  id: string;
  workspace_id: string;
  user_id: string; // who triggered it (or 'system' for cron)
  started_at: string;
  finished_at: string | null;
  status: EvolutionStatus;
  nodes_examined: number;
  clusters_found: number;
  actions_count: number;
  summary: string | null;
  error: string | null;
};

export type EvolutionRunInsert = {
  id?: string;
  workspace_id: string;
  user_id: string;
  started_at?: string;
  finished_at?: string | null;
  status?: EvolutionStatus;
  nodes_examined?: number;
  clusters_found?: number;
  actions_count?: number;
  summary?: string | null;
  error?: string | null;
};

export type EvolutionRunUpdate = Partial<
  Omit<EvolutionRunInsert, 'user_id' | 'workspace_id'>
>;

export type EvolutionActionRow = {
  id: string;
  workspace_id: string;
  run_id: string;
  user_id: string;
  action: EvolutionAction;
  target_node_id: string;
  source_node_ids: string[];
  reasoning: string | null;
  suggested_content: string | null;
  applied_at: string | null;
  created_at: string;
};

export type EvolutionActionInsert = {
  id?: string;
  workspace_id: string;
  run_id: string;
  user_id: string;
  action: EvolutionAction;
  target_node_id: string;
  source_node_ids?: string[];
  reasoning?: string | null;
  suggested_content?: string | null;
  applied_at?: string | null;
  created_at?: string;
};

export type EvolutionActionUpdate = Partial<
  Omit<EvolutionActionInsert, 'run_id' | 'user_id' | 'target_node_id' | 'workspace_id'>
>;

// ---- Database ----------------------------------------------------------

export type Database = {
  public: {
    Tables: {
      workspaces: {
        Row: WorkspaceRow;
        Insert: WorkspaceInsert;
        Update: WorkspaceUpdate;
        Relationships: [];
      };
      workspace_members: {
        Row: WorkspaceMemberRow;
        Insert: WorkspaceMemberInsert;
        Update: WorkspaceMemberUpdate;
        Relationships: [];
      };
      nodes: {
        Row: NodeRow;
        Insert: NodeInsert;
        Update: NodeUpdate;
        Relationships: [];
      };
      evolution_runs: {
        Row: EvolutionRunRow;
        Insert: EvolutionRunInsert;
        Update: EvolutionRunUpdate;
        Relationships: [];
      };
      evolution_actions: {
        Row: EvolutionActionRow;
        Insert: EvolutionActionInsert;
        Update: EvolutionActionUpdate;
        Relationships: [];
      };
    };
    Views: Record<string, never>;
    Functions: {
      match_nodes: {
        Args: {
          query_embedding: number[];
          query_workspace_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: Array<{
          id: string;
          content: string;
          category: NodeCategory;
          similarity: number;
        }>;
      };
    };
    Enums: {
      node_kind: NodeKind;
      node_category: NodeCategory;
      ingest_source: IngestSource;
      workspace_role: WorkspaceRole;
    };
    CompositeTypes: Record<string, never>;
  };
};
