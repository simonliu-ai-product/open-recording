import studioConfig from 'virtual:open-recording/config';

export type RecorderStatus = 'idle' | 'arming' | 'recording' | 'stopping';

export type RecorderState = {
  status: RecorderStatus;
  sessionId: string | null;
  recordingId: string | null;
  title: string | null;
  startedAt: string | null;
  durationMs: number;
  bytes: number;
  studios: number;
  error: string | null;
};

export type MicState = 'unknown' | 'armed' | 'denied';

export type StudioState = {
  connected: boolean;
  recorder: RecorderState;
  mic: MicState;
  /** 0–1, from the analyser on the live stream. Zero unless a stream is open. */
  level: number;
  micError: string | null;
};

type Command =
  | {
      type: 'start';
      sessionId: string;
      recordingId: string;
      title: string;
      chunkMs: number;
      maxDurationMs: number;
    }
  | { type: 'stop'; sessionId: string }
  | { type: 'cancel'; sessionId: string }
  | { type: 'state'; state: RecorderState };

const IDLE_RECORDER: RecorderState = {
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

function pickMimeType(): string | undefined {
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
  return candidates.find((type) => MediaRecorder.isTypeSupported(type));
}

/**
 * The studio is the one thing in the browser that holds a microphone. It lives
 * outside React so that a remount — StrictMode's double mount included — never
 * opens a second event stream or drops a recording in progress.
 */
class Studio {
  private listeners = new Set<() => void>();
  private snapshot: StudioState = {
    connected: false,
    recorder: IDLE_RECORDER,
    mic: 'unknown',
    level: 0,
    micError: null,
  };

  private source: EventSource | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private levelTimer: number | null = null;
  private stopTimer: number | null = null;
  private startedAt = 0;
  private sessionId: string | null = null;
  /** Slices are appended server-side in arrival order, so uploads are chained, never parallel. */
  private uploads: Promise<void> = Promise.resolve();

  subscribe = (listener: () => void): (() => void) => {
    this.listeners.add(listener);
    this.connect();
    return () => this.listeners.delete(listener);
  };

  getSnapshot = (): StudioState => this.snapshot;

  private set(patch: Partial<StudioState>): void {
    this.snapshot = { ...this.snapshot, ...patch };
    for (const listener of this.listeners) listener();
  }

  private connect(): void {
    if (this.source) return;
    const source = new EventSource('/__studio/stream');
    this.source = source;
    source.onopen = () => this.set({ connected: true });
    source.onerror = () => this.set({ connected: false });
    source.onmessage = (event) => {
      const command = JSON.parse(event.data) as Command;
      void this.handle(command);
    };
  }

  private async handle(command: Command): Promise<void> {
    switch (command.type) {
      case 'state':
        this.set({ recorder: command.state });
        return;
      case 'start':
        await this.beginRecording(command);
        return;
      case 'stop':
        this.endRecording(command.sessionId, false);
        return;
      case 'cancel':
        this.endRecording(command.sessionId, true);
        return;
    }
  }

  /**
   * Opens the microphone ahead of time. The permission prompt has to happen on a
   * user gesture, so a studio that is armed before an agent calls start is the
   * difference between recording instantly and timing out on a blocked prompt.
   */
  arm = async (): Promise<void> => {
    if (this.stream) return;
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: { echoCancellation: true, noiseSuppression: true },
      });
      this.stream = stream;
      this.watchLevel(stream);
      this.set({ mic: 'armed', micError: null });
    } catch (err) {
      this.set({ mic: 'denied', micError: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };

  disarm = (): void => {
    this.stopLevelWatch();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    this.set({ mic: 'unknown', level: 0 });
  };

  private watchLevel(stream: MediaStream): void {
    this.stopLevelWatch();
    const context = new AudioContext();
    const analyser = context.createAnalyser();
    analyser.fftSize = 512;
    context.createMediaStreamSource(stream).connect(analyser);
    this.audioContext = context;

    const buffer = new Uint8Array(analyser.frequencyBinCount);
    // Polled rather than driven by rAF: a backgrounded tab still records, and
    // rAF would stall the meter into a lie about a live session.
    this.levelTimer = window.setInterval(() => {
      analyser.getByteTimeDomainData(buffer);
      let peak = 0;
      for (const sample of buffer) peak = Math.max(peak, Math.abs(sample - 128) / 128);
      this.set({ level: peak });
    }, 100);
  }

  private stopLevelWatch(): void {
    if (this.levelTimer !== null) window.clearInterval(this.levelTimer);
    this.levelTimer = null;
    void this.audioContext?.close();
    this.audioContext = null;
  }

  private async post(path: string, body?: unknown): Promise<void> {
    await fetch(path, {
      method: 'POST',
      ...(body === undefined
        ? {}
        : { headers: { 'content-type': 'application/json' }, body: JSON.stringify(body) }),
    });
  }

  private async beginRecording(command: Extract<Command, { type: 'start' }>): Promise<void> {
    this.sessionId = command.sessionId;
    try {
      if (!this.stream) await this.arm();
      const stream = this.stream;
      if (!stream) throw new Error('no microphone');

      const mimeType = pickMimeType();
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      this.startedAt = Date.now();

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const elapsed = Date.now() - this.startedAt;
        this.uploads = this.uploads.then(async () => {
          await fetch(`/__studio/sessions/${command.sessionId}/chunk?durationMs=${elapsed}`, {
            method: 'POST',
            body: event.data,
          });
        });
      };
      recorder.onerror = () => {
        this.endRecording(command.sessionId, false, 'MediaRecorder error');
      };
      recorder.onstop = () => {
        const durationMs = Date.now() - this.startedAt;
        this.uploads = this.uploads.then(async () => {
          await this.post(`/__studio/sessions/${command.sessionId}/done`, { durationMs });
        });
      };

      recorder.start(command.chunkMs);
      // A session nobody stops would fill the disk; the studio stops itself.
      this.stopTimer = window.setTimeout(
        () => this.endRecording(command.sessionId, false),
        command.maxDurationMs,
      );
      await this.post(`/__studio/sessions/${command.sessionId}/ack`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.set({ mic: 'denied', micError: message });
      await this.post(`/__studio/sessions/${command.sessionId}/ack`, { error: message });
      this.sessionId = null;
    }
  }

  private endRecording(sessionId: string, discard: boolean, error?: string): void {
    if (this.sessionId !== sessionId) return;
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = null;

    const recorder = this.recorder;
    this.recorder = null;
    this.sessionId = null;

    if (!recorder || recorder.state === 'inactive') {
      void this.post(`/__studio/sessions/${sessionId}/done`, {
        ...(error ? { error } : {}),
        ...(discard ? { error: 'cancelled' } : {}),
      });
      return;
    }
    recorder.stop();
  }
}

export const studio = new Studio();
export const studioSettings = studioConfig;
