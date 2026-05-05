import { z } from 'zod';

export const IngestRequestSchema = z.object({
  source: z.enum(['telegram', 'mobile', 'web', 'api']),
  text: z.string().trim().min(1).optional(),
  audioUrl: z.string().url().optional(),
  imageUrl: z.string().url().optional(),
  title: z.string().trim().min(1).optional(),
}).refine((v) => Boolean(v.text || v.audioUrl || v.imageUrl), {
  message: 'At least one of text/audioUrl/imageUrl is required',
});

export type IngestRequest = z.infer<typeof IngestRequestSchema>;

export const ClassificationSchema = z.object({
  kind: z.enum(['note', 'task', 'idea', 'reference', 'fragment']),
  category: z.enum(['going', 'personal', 'urgent', 'unknown']),
  title: z.string().trim().max(120).nullable(),
});

export type Classification = z.infer<typeof ClassificationSchema>;
