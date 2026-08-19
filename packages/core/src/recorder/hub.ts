export type RecorderStatus = 'idle' | 'arming' | 'recording' | 'paused' | 'stopping';

export type RecorderState = {
  status: RecorderStatus;
  sessionId: string | null;
  recordingId: string | null;
  title: string | null;
  startedAt: string | null;
  durationMs: number;
  bytes: number;
  /** Studio pages currently listening. Zero means nothing can hold a microphone. */
  studios: number;
  /** Set when the last session failed; cleared by the next start. */
  error: string | null;
};

export type StartCommand = {
  type: 'start';
  sessionId: string;
  recordingId: string;
  title: string;
  chunkMs: number;
  maxDurationMs: number;
};

export type StudioCommand =
  | StartCommand
  | { type: 'pause'; sessionId: string }
  | { type: 'resume'; sessionId: string }
  | { type: 'stop'; sessionId: string }
  | { type: 'cancel'; sessionId: string }
  | { type: 'state'; state: RecorderState };

type Send = (command: StudioCommand) => void;

const IDLE: RecorderState = {
  status: 'idle',
  sessionId: null,
  recordingId: null,
  title: null,
  startedAt: null,
  durationMs: 0,
  bytes: 0,
  studios: 0,
  error: null,
};

/**
 * The recorder is one state machine per workspace, shared by everything that
 * can move it: the studio page over SSE, the dev API, and the MCP tools. It
 * holds no audio — bytes go straight to disk — only the fact that a session is
 * open and who acknowledged it.
 */
export class RecorderHub {
  private state: RecorderState = { ...IDLE };
  private studios = new Map<number, Send>();
  private watchers = new Set<(state: RecorderState) => void>();
  private counter = 0;
  private studioSeq = 0;
  /**
   * The one studio a session belongs to. Slices are appended to a single file
   * in arrival order, so a second page recording the same session would
   * interleave a second WebM stream into it. Only the owner is told to record.
   */
  private owner: number | null = null;

  snapshot(): RecorderState {
    return { ...this.state, studios: this.studios.size };
  }

  attachStudio(send: Send): () => void {
    this.studioSeq += 1;
    const id = this.studioSeq;
    this.studios.set(id, send);
    send({ type: 'state', state: this.snapshot() });
    this.publish();
    return () => {
      this.studios.delete(id);
      // A studio that vanishes mid-session takes the microphone with it: nothing
      // is being captured any more and no command can reach it. Leaving the
      // recorder "recording" would wedge the workspace — every later start
      // refused as busy, with no page left to stop it — so the session ends here
      // and whatever reached the disk is finalized by the caller that reaps it.
      if (this.owner === id && this.state.sessionId) {
        this.finish(this.state.sessionId, { error: 'the studio holding the microphone went away' });
      }
      this.publish();
    };
  }

  /** Sends to the studio that owns the open session, and to nobody else. */
  private toOwner(command: StudioCommand): void {
    if (this.owner === null) return;
    this.studios.get(this.owner)?.(command);
  }

  studioCount(): number {
    return this.studios.size;
  }

  nextSessionId(now: Date): string {
    this.counter += 1;
    return `s${now.getTime().toString(36)}${this.counter.toString(36)}`;
  }

  private publish(): void {
    const snapshot = this.snapshot();
    for (const watcher of this.watchers) watcher(snapshot);
    // State goes to every page — they all show the same recorder — while the
    // commands that hold a microphone go only to the owner.
    for (const send of this.studios.values()) send({ type: 'state', state: snapshot });
  }

  private set(patch: Partial<RecorderState>): void {
    this.state = { ...this.state, ...patch };
    this.publish();
  }

  /** Moves to `arming` and asks one studio — the longest-connected — to open a microphone. */
  arm(command: Omit<StartCommand, 'type'>): void {
    this.state = {
      ...IDLE,
      status: 'arming',
      sessionId: command.sessionId,
      recordingId: command.recordingId,
      title: command.title,
      startedAt: new Date().toISOString(),
    };
    this.owner = this.studios.keys().next().value ?? null;
    this.toOwner({ type: 'start', ...command });
    this.publish();
  }

  /**
   * Pause and resume are a real `MediaRecorder.pause()`, not a stop followed by
   * a new session: one recording, one file, with the paused span simply absent
   * from it. Splitting a meeting in two because someone stepped out is exactly
   * what a recorder should not make somebody deal with afterwards.
   */
  requestPause(): void {
    if (this.state.status !== 'recording') return;
    const sessionId = this.state.sessionId;
    if (sessionId) this.toOwner({ type: 'pause', sessionId });
  }

  requestResume(): void {
    if (this.state.status !== 'paused') return;
    const sessionId = this.state.sessionId;
    if (sessionId) this.toOwner({ type: 'resume', sessionId });
  }

  /** The studio confirms it actually paused; until then nothing claims it did. */
  ackPaused(sessionId: string): boolean {
    if (this.state.sessionId !== sessionId || this.state.status !== 'recording') return false;
    this.set({ status: 'paused' });
    return true;
  }

  ackResumed(sessionId: string): boolean {
    if (this.state.sessionId !== sessionId || this.state.status !== 'paused') return false;
    this.set({ status: 'recording' });
    return true;
  }

  requestStop(): void {
    if (this.state.status === 'idle') return;
    const sessionId = this.state.sessionId;
    this.set({ status: 'stopping' });
    if (sessionId) this.toOwner({ type: 'stop', sessionId });
  }

  requestCancel(): void {
    if (this.state.status === 'idle') return;
    const sessionId = this.state.sessionId;
    this.set({ status: 'stopping' });
    if (sessionId) this.toOwner({ type: 'cancel', sessionId });
  }

  /** The studio confirms its MediaRecorder is running. */
  ackRecording(sessionId: string): boolean {
    if (this.state.sessionId !== sessionId) return false;
    if (this.state.status !== 'arming') return false;
    this.set({ status: 'recording', startedAt: new Date().toISOString() });
    return true;
  }

  /** `durationMs` is the audio actually captured, so it does not advance while paused. */
  noteProgress(sessionId: string, patch: { bytes?: number; durationMs?: number }): boolean {
    if (this.state.sessionId !== sessionId) return false;
    this.set({
      ...(patch.bytes !== undefined ? { bytes: patch.bytes } : {}),
      ...(patch.durationMs !== undefined ? { durationMs: patch.durationMs } : {}),
    });
    return true;
  }

  /** The studio has flushed its last slice; the session is over either way. */
  finish(sessionId: string, outcome: { durationMs?: number; error?: string }): boolean {
    if (this.state.sessionId !== sessionId) return false;
    this.owner = null;
    this.state = {
      ...IDLE,
      durationMs: outcome.durationMs ?? this.state.durationMs,
      bytes: this.state.bytes,
      error: outcome.error ?? null,
    };
    this.publish();
    return true;
  }

  /** Drops a session the studio never acknowledged, so the workspace is usable again. */
  abandon(sessionId: string, error: string): void {
    if (this.state.sessionId !== sessionId) return;
    this.owner = null;
    this.state = { ...IDLE, error };
    this.publish();
  }

  /**
   * Resolves once the state satisfies `predicate`. Every caller that waits on
   * the studio is on a timeout: a page that never answers must surface as a
   * refusal an agent can read, not as a hung tool call.
   */
  waitFor(predicate: (state: RecorderState) => boolean, timeoutMs: number): Promise<RecorderState> {
    const current = this.snapshot();
    if (predicate(current)) return Promise.resolve(current);

    return new Promise((resolve, reject) => {
      const done = (fn: () => void) => {
        this.watchers.delete(watcher);
        clearTimeout(timer);
        fn();
      };
      const watcher = (state: RecorderState) => {
        if (predicate(state)) done(() => resolve(state));
      };
      const timer = setTimeout(() => done(() => reject(new Error('timeout'))), timeoutMs);
      this.watchers.add(watcher);
    });
  }
}

type HubRegistry = Map<string, RecorderHub>;

const GLOBAL_KEY = '__openRecordingHubs';

/**
 * Two copies of core exist at runtime — the dev server imports `src/`, while
 * `@open-recording/mcp` imports the built `dist/` — and a recorder split in two
 * would let an agent start a session the browser never hears about. The
 * registry therefore lives on `globalThis`, keyed by workspace root.
 */
export function recorderHub(workspaceRoot: string): RecorderHub {
  const globals = globalThis as typeof globalThis & { [GLOBAL_KEY]?: HubRegistry };
  let registry = globals[GLOBAL_KEY];
  if (!registry) {
    registry = new Map();
    globals[GLOBAL_KEY] = registry;
  }
  let hub = registry.get(workspaceRoot);
  if (!hub) {
    hub = new RecorderHub();
    registry.set(workspaceRoot, hub);
  }
  return hub;
}
