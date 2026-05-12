// Hand-written until first `pnpm --filter @mycortex/db gen:types` after applying
// migrations to a real Supabase project.

export type NodeKind = 'note' | 'task' | 'idea' | 'reference' | 'fragment';
export type NodeCategory = 'going' | 'personal' | 'urgent' | 'unknown';
export type IngestSource =
  | 'telegram'
  | 'mobile'
  | 'web'
  | 'api'
  | 'drive'
  | 'gmail'
  | 'calendar'
  | 'notion'
  | 'slack';
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
  external_source: string | null;
  external_id: string | null;
  external_metadata: Json | null;
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
  external_source?: string | null;
  external_id?: string | null;
  external_metadata?: Json | null;
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

// ---- Integrations ------------------------------------------------------

export type IntegrationProvider =
  | 'google_drive'
  | 'gmail'
  | 'google_calendar'
  | 'notion'
  | 'slack';
export type IntegrationStatus = 'active' | 'revoked' | 'error';

export type IntegrationRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  provider: IntegrationProvider;
  status: IntegrationStatus;
  access_token: string;
  refresh_token: string | null;
  token_expires_at: string | null;
  scope: string | null;
  external_account_email: string | null;
  external_account_id: string | null;
  metadata: Json;
  last_error: string | null;
  created_at: string;
  updated_at: string;
};

export type IntegrationInsert = {
  id?: string;
  workspace_id: string;
  user_id: string;
  provider: IntegrationProvider;
  status?: IntegrationStatus;
  access_token: string;
  refresh_token?: string | null;
  token_expires_at?: string | null;
  scope?: string | null;
  external_account_email?: string | null;
  external_account_id?: string | null;
  metadata?: Json;
  last_error?: string | null;
};

export type IntegrationUpdate = Partial<
  Omit<IntegrationInsert, 'workspace_id' | 'user_id' | 'provider'>
>;

export type SyncSourceStatus = 'active' | 'paused' | 'error';

export type SyncSourceRow = {
  id: string;
  integration_id: string;
  workspace_id: string;
  external_id: string;
  display_name: string;
  status: SyncSourceStatus;
  last_synced_at: string | null;
  last_sync_cursor: string | null;
  items_synced: number;
  last_error: string | null;
  metadata: Json;
  created_at: string;
  updated_at: string;
};

export type SyncSourceInsert = {
  id?: string;
  integration_id: string;
  workspace_id: string;
  external_id: string;
  display_name: string;
  status?: SyncSourceStatus;
  last_synced_at?: string | null;
  last_sync_cursor?: string | null;
  items_synced?: number;
  last_error?: string | null;
  metadata?: Json;
};

export type SyncSourceUpdate = Partial<
  Omit<SyncSourceInsert, 'integration_id' | 'workspace_id' | 'external_id'>
>;

// ---- Smart alerts ------------------------------------------------------

export type AlertLevel = 'critical' | 'high' | 'low';

export type SmartAlertRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  node_id: string;
  level: AlertLevel;
  title: string;
  action: string;
  deadline: string | null;
  context: string | null;
  read_at: string | null;
  dismissed_at: string | null;
  acted_on_at: string | null;
  created_at: string;
};

export type SmartAlertInsert = {
  id?: string;
  workspace_id: string;
  user_id: string;
  node_id: string;
  level: AlertLevel;
  title: string;
  action: string;
  deadline?: string | null;
  context?: string | null;
};

export type SmartAlertUpdate = Partial<
  Pick<SmartAlertRow, 'read_at' | 'dismissed_at' | 'acted_on_at'>
>;

// ---- Workspace invitations --------------------------------------------

export type WorkspaceInvitationRole = 'admin' | 'member' | 'viewer';

export type WorkspaceInvitationRow = {
  id: string;
  workspace_id: string;
  email: string;
  role: WorkspaceInvitationRole;
  token: string;
  invited_by: string;
  created_at: string;
  expires_at: string;
  accepted_at: string | null;
  accepted_by: string | null;
  email_sent_at: string | null;
  email_provider_id: string | null;
  email_error: string | null;
};

export type WorkspaceInvitationInsert = {
  id?: string;
  workspace_id: string;
  email: string;
  role: WorkspaceInvitationRole;
  token: string;
  invited_by: string;
  expires_at?: string;
  email_sent_at?: string | null;
  email_provider_id?: string | null;
  email_error?: string | null;
};

export type WorkspaceInvitationUpdate = Partial<
  Pick<
    WorkspaceInvitationRow,
    'accepted_at' | 'accepted_by' | 'email_sent_at' | 'email_provider_id' | 'email_error'
  >
>;

// ---- Daily digests -----------------------------------------------------

/**
 * One row per workspace per day. Filled by the cortex-digest Cloud Run
 * Job each morning. Renders in /app/digest and is the source for the
 * Telegram push.
 */
export type DigestSection = {
  /** Heading shown in the UI ("Tu día", "Mails importantes", "Próximos eventos"...). */
  title: string;
  /** Free-form markdown body (the LLM writes this). */
  body: string;
  /** Optional list of node ids the section references. */
  node_ids?: string[];
};

export type DigestCounts = {
  notes?: number;
  mails?: number;
  drive?: number;
  calendar_today?: number;
  calendar_upcoming?: number;
};

export type DigestKind = 'daily' | 'weekly';

export type DailyDigestRow = {
  id: string;
  workspace_id: string;
  user_id: string;
  for_date: string;
  kind: DigestKind;
  summary: string;
  sections: DigestSection[];
  counts: DigestCounts;
  metadata: Json;
  created_at: string;
};

export type DailyDigestInsert = {
  id?: string;
  workspace_id: string;
  user_id: string;
  for_date: string;
  kind?: DigestKind;
  summary: string;
  sections?: DigestSection[];
  counts?: DigestCounts;
  metadata?: Json;
};

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
      integrations: {
        Row: IntegrationRow;
        Insert: IntegrationInsert;
        Update: IntegrationUpdate;
        Relationships: [];
      };
      sync_sources: {
        Row: SyncSourceRow;
        Insert: SyncSourceInsert;
        Update: SyncSourceUpdate;
        Relationships: [];
      };
      daily_digests: {
        Row: DailyDigestRow;
        Insert: DailyDigestInsert;
        Update: Partial<DailyDigestInsert>;
        Relationships: [];
      };
      workspace_invitations: {
        Row: WorkspaceInvitationRow;
        Insert: WorkspaceInvitationInsert;
        Update: WorkspaceInvitationUpdate;
        Relationships: [];
      };
      smart_alerts: {
        Row: SmartAlertRow;
        Insert: SmartAlertInsert;
        Update: SmartAlertUpdate;
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
      match_nodes_hybrid: {
        Args: {
          query_embedding: number[];
          query_text: string;
          query_workspace_id: string;
          match_count?: number;
          match_threshold?: number;
        };
        Returns: Array<{
          id: string;
          title: string | null;
          content: string;
          category: NodeCategory;
          source: IngestSource;
          external_source: string | null;
          external_id: string | null;
          external_metadata: Json | null;
          created_at: string;
          similarity: number;
          keyword_score: number;
          rrf_score: number;
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
