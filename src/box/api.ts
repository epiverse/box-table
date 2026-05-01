// Thin Box Content API client. All endpoints are CORS-enabled (assuming the
// app's origin is whitelisted in the Box developer console).

import { BOX_API_BASE } from '../config';
import { BoxAuthError, getAccessToken, refreshAccessToken } from './auth';

export interface BoxItem {
  id: string;
  type: 'file' | 'folder' | 'web_link';
  name: string;
  extension?: string;
  size?: number;
  modified_at?: string;
}

export interface BoxFolderListing {
  folderId: string;
  folderName: string;
  // Top-down breadcrumb starting at "All Files" (id "0").
  pathCollection: { id: string; name: string }[];
  items: BoxItem[];
  hasMore: boolean;
}

export class BoxApiError extends Error {
  constructor(message: string, public readonly status?: number) {
    super(message);
    this.name = 'BoxApiError';
  }
}

// Issues a Box API request with the current access token; on 401 refreshes
// once and retries. Other errors propagate.
async function authedFetch(input: string, init: RequestInit = {}): Promise<Response> {
  const send = async (token: string): Promise<Response> => {
    const headers = new Headers(init.headers);
    headers.set('Authorization', `Bearer ${token}`);
    return fetch(input, { ...init, headers });
  };

  let token = await getAccessToken();
  let res = await send(token);
  if (res.status !== 401) return res;

  // Retry once after refresh. If refresh fails, the auth layer clears state
  // and rethrows BoxAuthError, which the UI surfaces as "please reconnect".
  try {
    token = await refreshAccessToken();
  } catch (err) {
    throw err instanceof BoxAuthError ? err : new BoxApiError('Authentication expired.', 401);
  }
  res = await send(token);
  return res;
}

const FOLDER_FIELDS = 'id,type,name,extension,size,modified_at,path_collection';
const PAGE_LIMIT = 1000;

export async function listFolder(folderId: string): Promise<BoxFolderListing> {
  // Get folder metadata (name + path) in parallel with the items page.
  const [metaRes, itemsRes] = await Promise.all([
    authedFetch(
      `${BOX_API_BASE}/folders/${encodeURIComponent(folderId)}?fields=name,path_collection`,
    ),
    authedFetch(
      `${BOX_API_BASE}/folders/${encodeURIComponent(folderId)}/items` +
        `?fields=${FOLDER_FIELDS}&limit=${PAGE_LIMIT}&usemarker=false`,
    ),
  ]);

  if (!metaRes.ok) {
    throw new BoxApiError(`Failed to load folder (${metaRes.status})`, metaRes.status);
  }
  if (!itemsRes.ok) {
    throw new BoxApiError(`Failed to list folder items (${itemsRes.status})`, itemsRes.status);
  }

  const meta = (await metaRes.json()) as {
    name: string;
    path_collection?: { entries: { id: string; name: string }[] };
  };
  const items = (await itemsRes.json()) as {
    entries: BoxItem[];
    total_count: number;
  };

  // Box returns the path WITHOUT the current folder; prepend the synthetic
  // "All Files" root if it's missing and append the current folder for full
  // breadcrumb display.
  const path: { id: string; name: string }[] = [];
  for (const entry of meta.path_collection?.entries ?? []) {
    path.push({ id: entry.id, name: entry.name });
  }
  if (folderId !== '0') {
    path.push({ id: folderId, name: meta.name });
  } else if (path.length === 0) {
    path.push({ id: '0', name: 'All Files' });
  }

  return {
    folderId,
    folderName: folderId === '0' ? 'All Files' : meta.name,
    pathCollection: path,
    items: items.entries,
    hasMore: items.entries.length >= PAGE_LIMIT,
  };
}

// Resolves the redirect to dl.boxcloud.com and returns the file bytes plus
// the Box-supplied filename (used for format detection downstream).
export async function downloadFile(
  fileId: string,
  fileName: string,
): Promise<{ bytes: Uint8Array; name: string }> {
  const res = await authedFetch(
    `${BOX_API_BASE}/files/${encodeURIComponent(fileId)}/content`,
    { redirect: 'follow' },
  );
  if (!res.ok) {
    throw new BoxApiError(`Failed to download file (${res.status})`, res.status);
  }
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), name: fileName };
}
