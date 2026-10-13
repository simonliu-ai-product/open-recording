export type Bookmark = {
  id: string;
  atMs: number;
  label: string;
  createdAt: string;
};

export type RecordingSummary = {
  id: string;
  title: string;
  status: 'recording' | 'ready' | 'failed';
  createdAt: string;
  durationMs: number;
  sizeBytes: number;
  tags: string[];
  source: 'agent' | 'studio';
  kind: 'audio' | 'screen';
  transcribed: boolean;
  transcribing: boolean;
  hasNotes: boolean;
  preview: string | null;
};

export type TranscriptHit = {
  id: string;
  title: string;
  createdAt: string;
  start: number;
  text: string;
  speaker?: string;
  starred?: boolean;
};

export type RecordingMeta = RecordingSummary & {
  updatedAt: string;
  mimeType: string;
  bookmarks?: Bookmark[];
  note?: string;
  error?: string;
  transcript?: {
    model: string;
    language: string;
    createdAt: string;
    elapsedMs: number;
    segmentCount: number;
    chars: number;
  };
};

export type TranscriptSegment = {
  start: number;
  end: number;
  text: string;
  speaker?: string;
  starred?: boolean;
};

export type SegmentPatch = {
  text?: string;
  speaker?: string | null;
  starred?: boolean;
};

export type Transcript = {
  model: string;
  language: string;
  createdAt: string;
  elapsedMs: number;
  text: string;
  segments: TranscriptSegment[];
};

export type WhisperEnvironment = {
  bin: string | null;
  model: string | null;
  ffmpeg: string | null;
  modelSearchDirs: string[];
  script: 'traditional' | 'simplified' | 'as-is';
  scriptConverter: boolean;
};

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(path, init);
  const body = (await response.json().catch(() => null)) as T & { error?: string };
  if (!response.ok) throw new Error(body?.error ?? `${response.status} ${response.statusText}`);
  return body;
}

const jsonInit = (body: unknown, method = 'POST'): RequestInit => ({
  method,
  headers: { 'content-type': 'application/json' },
  body: JSON.stringify(body),
});

export const api = {
  listRecordings: () => request<RecordingSummary[]>('/__rec/recordings'),
  search: (query: string) =>
    request<TranscriptHit[]>(`/__rec/search?q=${encodeURIComponent(query)}`),
  readNotes: (id: string) =>
    request<{ text: string }>(`/__rec/recordings/${encodeURIComponent(id)}/notes`),
  writeNotes: (id: string, notes: string) =>
    request<RecordingMeta>(
      `/__rec/recordings/${encodeURIComponent(id)}`,
      jsonInit({ notes }, 'PATCH'),
    ),
  readRecording: (id: string) =>
    request<RecordingMeta>(`/__rec/recordings/${encodeURIComponent(id)}`),
  readTranscript: (id: string) =>
    request<Transcript>(`/__rec/recordings/${encodeURIComponent(id)}/transcript?view=segments`),
  readTranscriptMarkdown: (id: string) =>
    request<{ text: string }>(
      `/__rec/recordings/${encodeURIComponent(id)}/transcript?view=markdown`,
    ),
  editSegment: (id: string, index: number, input: string | SegmentPatch) => {
    const patch = typeof input === 'string' ? { text: input } : input;
    return request<Transcript>(
      `/__rec/recordings/${encodeURIComponent(id)}/transcript`,
      jsonInit({ index, ...patch }, 'PATCH'),
    );
  },
  addBookmark: (id: string, atMs: number, label: string) =>
    request<RecordingMeta>(
      `/__rec/recordings/${encodeURIComponent(id)}/bookmarks`,
      jsonInit({ atMs, label }),
    ),
  deleteBookmark: (id: string, bookmarkId: string) =>
    request<RecordingMeta>(
      `/__rec/recordings/${encodeURIComponent(id)}/bookmarks/${encodeURIComponent(bookmarkId)}`,
      { method: 'DELETE' },
    ),
  transcribe: (
    id: string,
    body: { language?: string; vocabulary?: string[]; force?: boolean } = {},
  ) =>
    request<{ id: string; segmentCount: number; language: string }>(
      `/__rec/recordings/${encodeURIComponent(id)}/transcribe`,
      jsonInit(body),
    ),
  setTags: (id: string, tags: string[]) =>
    request<RecordingMeta>(
      `/__rec/recordings/${encodeURIComponent(id)}`,
      jsonInit({ tags }, 'PATCH'),
    ),
  rename: (id: string, title: string) =>
    request<RecordingMeta>(
      `/__rec/recordings/${encodeURIComponent(id)}`,
      jsonInit({ title }, 'PATCH'),
    ),
  remove: (id: string) =>
    request<{ ok: true }>(`/__rec/recordings/${encodeURIComponent(id)}`, { method: 'DELETE' }),
  start: (body: { title?: string } = {}) => request<RecordingMeta>('/__rec/start', jsonInit(body)),
  pause: () => request<{ status: string }>('/__rec/pause', { method: 'POST' }),
  resume: () => request<{ status: string }>('/__rec/resume', { method: 'POST' }),
  stop: () => request<RecordingMeta>('/__rec/stop', { method: 'POST' }),
  cancel: () => request<{ ok: true }>('/__rec/cancel', { method: 'POST' }),
  markMoment: (label?: string) =>
    request<RecordingMeta>('/__rec/mark', jsonInit(label ? { label } : {})),
  importFile: async (file: File, title?: string) => {
    const params = new URLSearchParams({ filename: file.name });
    if (title) params.set('title', title);
    const buffer = await file.arrayBuffer();
    return request<RecordingMeta>(`/__rec/import?${params.toString()}`, {
      method: 'POST',
      headers: { 'content-type': 'application/octet-stream' },
      body: buffer,
    });
  },
  reportCurrent: (body: { recordingId: string | null; title?: string; currentTimeMs?: number }) =>
    request<{ recordingId: string | null }>('/__rec/current', jsonInit(body)),
  environment: () => request<WhisperEnvironment>('/__rec/environment'),
};

export function formatDuration(ms: number): string {
  const total = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const pad = (n: number) => String(n).padStart(2, '0');
  return h > 0 ? `${h}:${pad(m)}:${pad(s)}` : `${pad(m)}:${pad(s)}`;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}
