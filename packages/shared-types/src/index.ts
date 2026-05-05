import { z } from 'zod';

export const NodeKindSchema = z.enum(['note', 'task', 'idea', 'reference', 'fragment']);
export type NodeKind = z.infer<typeof NodeKindSchema>;

export const NodeCategorySchema = z.enum(['going', 'personal', 'urgent', 'unknown']);
export type NodeCategory = z.infer<typeof NodeCategorySchema>;

export const IngestSourceSchema = z.enum(['telegram', 'mobile', 'web', 'api']);
export type IngestSource = z.infer<typeof IngestSourceSchema>;

export const NodeSchema = z.object({
  id: z.string().uuid(),
  userId: z.string().uuid(),
  kind: NodeKindSchema,
  category: NodeCategorySchema,
  title: z.string().nullable(),
  content: z.string(),
  source: IngestSourceSchema,
  embedding: z.array(z.number()).nullable(),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime(),
});
export type Node = z.infer<typeof NodeSchema>;

export const IngestPayloadSchema = z.object({
  userId: z.string().uuid(),
  source: IngestSourceSchema,
  text: z.string().optional(),
  audioUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
});
export type IngestPayload = z.infer<typeof IngestPayloadSchema>;
