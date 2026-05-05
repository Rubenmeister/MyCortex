// Hand-written until first `pnpm --filter @mycortex/db gen:types` after applying
// the migration to a real Supabase project.

export type NodeKind = 'note' | 'task' | 'idea' | 'reference' | 'fragment';
export type NodeCategory = 'going' | 'personal' | 'urgent' | 'unknown';
export type IngestSource = 'telegram' | 'mobile' | 'web' | 'api';

export type Json = string | number | boolean | null | { [k: string]: Json } | Json[];

export type NodeRow = {
  id: string;
  user_id: string;
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

export type NodeUpdate = Partial<Omit<NodeInsert, 'user_id'>>;

export type EvolutionStatus = 'running' | 'completed' | 'failed';
export type EvolutionAction = 'merge' | 'complement' | 'correct' | 'skip';

export type EvolutionRunRow = {
  id: string;
  user_id: string;
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

export type EvolutionRunUpdate = Partial<Omit<EvolutionRunInsert, 'user_id'>>;

export type EvolutionActionRow = {
  id: string;
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
  Omit<EvolutionActionInsert, 'run_id' | 'user_id' | 'target_node_id'>
>;

export type Database = {
  public: {
    Tables: {
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
          query_user_id: string;
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
    };
    CompositeTypes: Record<string, never>;
  };
};
