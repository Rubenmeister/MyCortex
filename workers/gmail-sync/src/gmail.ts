import { z } from 'zod';

const env = {
  GOOGLE_OAUTH_CLIENT_ID: process.env.GOOGLE_OAUTH_CLIENT_ID ?? '',
  GOOGLE_OAUTH_CLIENT_SECRET: process.env.GOOGLE_OAUTH_CLIENT_SECRET ?? '',
};

const RefreshSchema = z.object({
  access_token: z.string(),
  expires_in: z.number(),
  scope: z.string(),
  token_type: z.string().optional(),
});

export async function refreshAccessToken(refreshToken: string): Promise<{
  access_token: string;
  expires_in: number;
  scope: string;
}> {
  const body = new URLSearchParams({
    refresh_token: refreshToken,
    client_id: env.GOOGLE_OAUTH_CLIENT_ID,
    client_secret: env.GOOGLE_OAUTH_CLIENT_SECRET,
    grant_type: 'refresh_token',
  });
  const res = await fetch('https://oauth2.googleapis.com/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body,
  });
  if (!res.ok) {
    throw new Error(`google_refresh_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return RefreshSchema.parse(await res.json());
}

// ---- Gmail listing ---------------------------------------------------------

const MessageRefSchema = z.object({
  id: z.string(),
  threadId: z.string().optional(),
});

const ListMessagesSchema = z.object({
  messages: z.array(MessageRefSchema).optional(),
  nextPageToken: z.string().optional(),
  resultSizeEstimate: z.number().optional(),
});

/**
 * List message IDs that match a label and recency filter. We page through
 * results until either we hit `maxMessages` or the API runs out. The `q`
 * supports Gmail's search syntax: `newer_than:90d` is the cheapest way to
 * scope to the recent window.
 */
export async function listMessageIds(
  accessToken: string,
  args: { labelId: string; maxMessages: number; newerThanDays: number },
): Promise<string[]> {
  const out: string[] = [];
  let pageToken: string | undefined;
  do {
    const params = new URLSearchParams({
      labelIds: args.labelId,
      q: `newer_than:${args.newerThanDays}d`,
      maxResults: '100',
    });
    if (pageToken) params.set('pageToken', pageToken);

    const res = await fetch(
      `https://gmail.googleapis.com/gmail/v1/users/me/messages?${params}`,
      { headers: { Authorization: `Bearer ${accessToken}` } },
    );
    if (!res.ok) {
      throw new Error(
        `gmail_list_messages_failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
      );
    }
    const json = ListMessagesSchema.parse(await res.json());
    for (const m of json.messages ?? []) {
      out.push(m.id);
      if (out.length >= args.maxMessages) return out;
    }
    pageToken = json.nextPageToken;
  } while (pageToken && out.length < args.maxMessages);
  return out;
}

// ---- Message detail --------------------------------------------------------

const HeaderSchema = z.object({ name: z.string(), value: z.string() });

const PayloadSchema: z.ZodType<MessagePayload> = z.lazy(() =>
  z.object({
    mimeType: z.string().optional(),
    headers: z.array(HeaderSchema).optional(),
    body: z
      .object({ size: z.number().optional(), data: z.string().optional() })
      .optional(),
    parts: z.array(PayloadSchema).optional(),
  }),
);
type MessagePayload = {
  mimeType?: string;
  headers?: { name: string; value: string }[];
  body?: { size?: number; data?: string };
  parts?: MessagePayload[];
};

const MessageSchema = z.object({
  id: z.string(),
  threadId: z.string(),
  labelIds: z.array(z.string()).optional(),
  snippet: z.string().optional(),
  internalDate: z.string().optional(),
  payload: PayloadSchema.optional(),
  sizeEstimate: z.number().optional(),
});
export type GmailMessage = z.infer<typeof MessageSchema>;

export async function getMessage(
  accessToken: string,
  messageId: string,
): Promise<GmailMessage> {
  // format=full gives the full payload incl. body data (base64url-encoded).
  const res = await fetch(
    `https://gmail.googleapis.com/gmail/v1/users/me/messages/${messageId}?format=full`,
    { headers: { Authorization: `Bearer ${accessToken}` } },
  );
  if (!res.ok) {
    throw new Error(
      `gmail_get_message_failed: ${res.status} ${(await res.text()).slice(0, 200)}`,
    );
  }
  return MessageSchema.parse(await res.json());
}

// ---- Helpers ---------------------------------------------------------------

export function getHeader(msg: GmailMessage, name: string): string | undefined {
  const lower = name.toLowerCase();
  return msg.payload?.headers?.find((h) => h.name.toLowerCase() === lower)?.value;
}

/**
 * Walk the (possibly multipart) payload tree and collect text. Prefers
 * text/plain parts; falls back to text/html when no plain part exists.
 * Body data is base64url-encoded.
 */
export function collectBody(payload: MessagePayload | undefined): {
  plain: string;
  html: string;
} {
  const plainBuf: string[] = [];
  const htmlBuf: string[] = [];
  function walk(p: MessagePayload | undefined): void {
    if (!p) return;
    const data = p.body?.data;
    const mt = p.mimeType ?? '';
    if (data) {
      const decoded = Buffer.from(data, 'base64url').toString('utf8');
      if (mt.startsWith('text/plain')) plainBuf.push(decoded);
      else if (mt.startsWith('text/html')) htmlBuf.push(decoded);
    }
    if (p.parts) for (const c of p.parts) walk(c);
  }
  walk(payload);
  return { plain: plainBuf.join('\n\n'), html: htmlBuf.join('\n\n') };
}
