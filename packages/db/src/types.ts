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

export type Database = {
  public: {
    Tables: {
      nodes: {
        Row: NodeRow;
        Insert: NodeInsert;
        Update: NodeUpdate;
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
