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
 * List all (non-folder) files inside a folder, recursively. Returns supported
 * files up to `maxFiles` flat, plus a breakdown of mime types encountered
 * (incl. unsupported ones) so callers can log what got filtered out.
 *
 * BFS walks subfolders since Drive's q syntax doesn't support recursive.
 * Includes Shared Drive items via supportsAllDrives + includeItemsFromAllDrives.
 */
export async function listFilesInFolder(
  accessToken: string,
  folderId: string,
  opts: { maxFiles?: number } = {},
): Promise<{ supported: DriveFile[]; mimeBreakdown: Record<string, number>; totalFiles: number }> {
  const maxFiles = opts.maxFiles ?? 200;
  const queue: string[] = [folderId];
  const seen = new Set<string>();
  const out: DriveFile[] = [];
  const mimeBreakdown: Record<string, number> = {};
  let totalFiles = 0;

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
        supportsAllDrives: 'true',
        includeItemsFromAllDrives: 'true',
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
          continue;
        }
        totalFiles++;
        mimeBreakdown[f.mimeType] = (mimeBreakdown[f.mimeType] ?? 0) + 1;
        if (isSupportedMimeType(f.mimeType)) {
          out.push(f);
          if (out.length >= maxFiles) break;
        }
      }
      pageToken = json.nextPageToken;
    } while (pageToken && out.length < maxFiles);
  }
  return { supported: out, mimeBreakdown, totalFiles };
}

const SUPPORTED_MIME = new Set([
  'application/pdf',
  'application/vnd.openxmlformats-officedocument.wordprocessingml.document', // .docx
  'text/plain',
  'text/markdown',
  'text/csv',
  'application/vnd.google-apps.document', // Google Docs (export as text/plain)
  'application/vnd.google-apps.presentation', // Google Slides (export as text/plain)
  'application/vnd.google-apps.spreadsheet', // Google Sheets (export as text/csv)
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

  // Google-native types must be exported (the file isn't a downloadable blob).
  // We pick the cheapest text representation per type:
  //   Docs/Slides → text/plain (extracts visible text)
  //   Sheets       → text/csv  (first sheet only — this is a Drive limitation)
  const exportMap: Record<string, string> = {
    'application/vnd.google-apps.document': 'text/plain',
    'application/vnd.google-apps.presentation': 'text/plain',
    'application/vnd.google-apps.spreadsheet': 'text/csv',
  };
  const exportMime = exportMap[file.mimeType];
  if (exportMime) {
    const url = `https://www.googleapis.com/drive/v3/files/${file.id}/export?mimeType=${encodeURIComponent(exportMime)}&supportsAllDrives=true`;
    const res = await fetch(url, { headers });
    if (!res.ok) {
      throw new Error(`drive_export_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
    }
    return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: exportMime };
  }

  const url = `https://www.googleapis.com/drive/v3/files/${file.id}?alt=media&supportsAllDrives=true`;
  const res = await fetch(url, { headers });
  if (!res.ok) {
    throw new Error(`drive_download_failed: ${res.status} ${(await res.text()).slice(0, 200)}`);
  }
  return { buffer: Buffer.from(await res.arrayBuffer()), mimeType: file.mimeType };
}
