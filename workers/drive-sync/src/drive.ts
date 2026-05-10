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

const FileSchema = z.object({
  id: z.string(),
  name: z.string(),
  mimeType: z.string(),
  modifiedTime: z.string().optional(),
  size: z.string().optional(),
  parents: z.array(z.string()).optional(),
  md5Checksum: z.string().optional(),
});
export type DriveFile = z.infer<typeof FileSchema>;

const ListSchema = z.object({
  files: z.array(FileSchema),
  nextPageToken: z.string().optional(),
});

/**
 * List all (non-folder) files inside a folder, recursively. Returns up to
 * `maxFiles` flat. We use a BFS over subfolders since Drive's q syntax
 * doesn't support recursive queries directly.
 */
export async function listFilesInFolder(
  accessToken: string,
  folderId: string,
  opts: { maxFiles?: number } = {},
): Promise<DriveFile[]> {
  const maxFiles = opts.maxFiles ?? 200;
  const queue: string[] = [folderId];
  const seen = new Set<string>();
  const out: DriveFile[] = [];

  while (queue.length > 0 && out.length < maxFiles) {
    const current = queue.shift()!;
    if (seen.has(current)) continue;
    seen.add(current);

    let pageToken: string | undefined;
    do {
      const params = new URLSearchParams({
        q: `'${current}' in parents and trashed=false`,
        fields:
          'files(id,name,mimeType,modifiedTime,size,parents,md5Checksum),nextPageToken',
        pageSize: '100',
      });
      if (pageToken) params.set('pageToken', pageToken);

      const res = await fetch(`https://www.googleapis.com/drive/v3/files?${params}`, {
        headers: { Authorization: `Bearer ${accessToken}` },
      });
      if (!res.ok) {
        throw new Error(`drive_list_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
      }
      const json = ListSchema.parse(await res.json());
      for (const f of json.files) {
        if (f.mimeType === 'application/vnd.google-apps.folder') {
          queue.push(f.id);
        } else if (isSupportedMimeType(f.mimeType)) {
          out.push(f);
          if (out.length >= maxFiles) break;
        }
      }
      pageToken = json.nextPageToken;
    } while (pageToken && out.length < maxFiles);
  }
  return out;
}

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
  'application/vnd.google-apps.document', // Google Docs (export as text/plain)
]);

export function isSupportedMimeType(mimeType: string): boolean {
  return SUPPORTED_MIME.has(mimeType);
}

/**
 * Download file content. For Google Docs we have to use the export endpoint.
 * For binary files (pdf, docx) the download endpoint streams raw bytes.
 */
export async function downloadFile(
  accessToken: string,
  file: DriveFile,
): Promise<{ buffer: Buffer; mimeType: string }> {
  const headers = { Authorization: `Bearer ${accessToken}` };

  if (file.mimeType === 'application/vnd.google-apps.document') {
    const url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=text/plain`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`drive_export_failed: ${res.status}`);
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: 'text/plain' };
  }

  const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`drive_download_failed: ${res.status}`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: file.mimeType };
}
