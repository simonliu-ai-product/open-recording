import studioConfig from 'virtual:open-recording/config';

export type RecorderStatus = 'idle' | 'arming' | 'recording' | 'paused' | 'stopping';

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
  /** What this page is holding, once it holds anything. */
  capture: CaptureKind;
  /** Microphones this browser will offer. Named only once permission is given. */
  devices: Array<{ id: string; label: string }>;
  /** The one in use, or empty for whatever the system calls default. */
  deviceId: string;
  /** Set when a screen capture carries no audio, which is most of them. */
  captureSilent: boolean;
};

type Command =
  | { type: 'hello'; studioId: number }
  | {
      type: 'start';
      sessionId: string;
      recordingId: string;
      title: string;
      chunkMs: number;
      maxDurationMs: number;
    }
  | { type: 'pause'; sessionId: string }
  | { type: 'resume'; sessionId: string }
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

export type CaptureKind = 'audio' | 'screen';

function pickMimeType(kind: CaptureKind): string | undefined {
  const candidates =
    kind === 'screen'
      ? ['video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm']
      : ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus'];
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
    capture: 'audio',
    captureSilent: false,
    devices: [],
    deviceId: '',
  };

  private source: EventSource | null = null;
  private stream: MediaStream | null = null;
  private recorder: MediaRecorder | null = null;
  private audioContext: AudioContext | null = null;
  private levelTimer: number | null = null;
  private stopTimer: number | null = null;
  /** Start of the current run of capture, and what earlier runs already added up to. */
  private segmentStartedAt = 0;
  private capturedMs = 0;
  private sessionId: string | null = null;
  private maxDurationMs = 0;
  private studioId: number | null = null;
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
      case 'hello':
        this.studioId = command.studioId;
        // A reconnect gets a new id, so a studio already holding a microphone
        // has to claim it again or the server would forget which page is live.
        if (this.stream) await this.claimMicrophone();
        return;
      case 'state':
        this.set({ recorder: command.state });
        return;
      case 'start':
        await this.beginRecording(command);
        return;
      case 'pause':
        this.pauseRecording(command.sessionId);
        return;
      case 'resume':
        this.resumeRecording(command.sessionId);
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
  /**
   * Takes a microphone, optionally a named one. A virtual input — BlackHole and
   * the like — is an ordinary device here, which is how a workspace records
   * what the machine is playing rather than what the room is saying.
   */
  arm = async (deviceId?: string): Promise<void> => {
    const wanted = deviceId ?? this.snapshot.deviceId;
    if (this.stream && this.snapshot.capture === 'audio' && wanted === this.snapshot.deviceId) {
      return;
    }
    this.releaseStream();
    try {
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: true,
          noiseSuppression: true,
          ...(wanted ? { deviceId: { exact: wanted } } : {}),
        },
      });
      this.set({ deviceId: wanted });
      this.take(stream, 'audio');
      // Labels are blank until permission is granted, so the list is read after.
      void this.listDevices();
    } catch (err) {
      this.set({ mic: 'denied', micError: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };

  /**
   * Takes a browser tab — picture and, if the person ticked the box, its audio.
   * Chrome will not hand over a window's or the whole screen's sound on macOS,
   * so a screen recording with no audio track is a normal outcome and is worth
   * saying out loud rather than discovering in the transcript.
   */
  armScreen = async (): Promise<void> => {
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true,
      });
      this.releaseStream();
      this.take(stream, 'screen');
      // Chrome's own "Stop sharing" ends the tracks behind our back.
      for (const track of stream.getVideoTracks()) {
        track.addEventListener('ended', () => this.surfaceGone());
      }
    } catch (err) {
      this.set({ mic: 'denied', micError: err instanceof Error ? err.message : String(err) });
      throw err;
    }
  };

  private take(stream: MediaStream, kind: CaptureKind): void {
    this.stream = stream;
    const silent = stream.getAudioTracks().length === 0;
    if (!silent) this.watchLevel(stream);
    this.set({ mic: 'armed', micError: null, capture: kind, captureSilent: silent, level: 0 });
    void this.claimMicrophone();
  }

  /** The inputs this browser will offer, with the names it will show for them. */
  listDevices = async (): Promise<void> => {
    try {
      const all = await navigator.mediaDevices.enumerateDevices();
      const devices = all
        .filter((device) => device.kind === 'audioinput')
        .map((device, i) => ({
          id: device.deviceId,
          label: device.label || `Microphone ${i + 1}`,
        }));
      this.set({ devices });
    } catch {
      this.set({ devices: [] });
    }
  };

  private surfaceGone(): void {
    const sessionId = this.sessionId;
    if (sessionId) this.endRecording(sessionId, false, 'the shared tab stopped');
    this.releaseStream();
    this.set({ mic: 'unknown', capture: 'audio', captureSilent: false, level: 0 });
  }

  private releaseStream(): void {
    this.stopLevelWatch();
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
  }

  /**
   * Tells the server this page is holding a microphone now. Ownership goes to
   * the freshest claim, so the tab someone just armed records rather than one
   * left open in the background, which can still arm itself silently because
   * permission is remembered per origin.
   */
  private async claimMicrophone(): Promise<void> {
    if (this.studioId === null) return;
    await this.post('/__studio/armed', { studioId: this.studioId });
  }

  disarm = (): void => {
    this.releaseStream();
    this.set({ mic: 'unknown', level: 0, capture: 'audio', captureSilent: false });
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

  /**
   * Always sends a JSON body, even an empty one: these endpoints refuse a
   * mutation that does not declare `application/json`, and a bodyless POST
   * carries no content type at all — which is how every acknowledgement used to
   * come back 415, leaving the server waiting for a studio that had in fact
   * started.
   */
  private async post(path: string, body?: unknown): Promise<Response> {
    return await fetch(path, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(body ?? {}),
    });
  }

  private async beginRecording(command: Extract<Command, { type: 'start' }>): Promise<void> {
    this.sessionId = command.sessionId;
    try {
      if (!this.stream) await this.arm();
      const stream = this.stream;
      if (!stream) throw new Error('no microphone');

      const mimeType = pickMimeType(this.snapshot.capture);
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      this.recorder = recorder;
      this.segmentStartedAt = Date.now();
      this.capturedMs = 0;

      recorder.ondataavailable = (event) => {
        if (event.data.size === 0) return;
        const elapsed = this.capturedSoFar();
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
        const durationMs = this.capturedSoFar();
        this.uploads = this.uploads.then(async () => {
          await this.post(`/__studio/sessions/${command.sessionId}/done`, { durationMs });
        });
      };

      recorder.start(command.chunkMs);
      this.maxDurationMs = command.maxDurationMs;
      // A session nobody stops would fill the disk; the studio stops itself.
      this.stopTimer = window.setTimeout(
        () => this.endRecording(command.sessionId, false),
        command.maxDurationMs,
      );
      await this.post(`/__studio/sessions/${command.sessionId}/ack`, {
        kind: this.snapshot.capture,
      });
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      this.set({ mic: 'denied', micError: message });
      await this.post(`/__studio/sessions/${command.sessionId}/ack`, { error: message });
      this.sessionId = null;
    }
  }

  /** Audio actually captured: paused time is not in the file, so it is not counted. */
  private capturedSoFar(): number {
    const running = this.segmentStartedAt === 0 ? 0 : Date.now() - this.segmentStartedAt;
    return this.capturedMs + running;
  }

  private pauseRecording(sessionId: string): void {
    const recorder = this.recorder;
    if (this.sessionId !== sessionId || !recorder || recorder.state !== 'recording') return;
    recorder.pause();
    this.capturedMs = this.capturedSoFar();
    this.segmentStartedAt = 0;
    // The self-stop deadline is about how much audio a session may hold, so it
    // does not run down while nothing is being captured.
    if (this.stopTimer !== null) window.clearTimeout(this.stopTimer);
    this.stopTimer = null;
    void this.post(`/__studio/sessions/${sessionId}/paused`);
  }

  private resumeRecording(sessionId: string): void {
    const recorder = this.recorder;
    if (this.sessionId !== sessionId || !recorder || recorder.state !== 'paused') return;
    recorder.resume();
    this.segmentStartedAt = Date.now();
    if (this.maxDurationMs > 0) {
      this.stopTimer = window.setTimeout(
        () => this.endRecording(sessionId, false),
        Math.max(0, this.maxDurationMs - this.capturedMs),
      );
    }
    void this.post(`/__studio/sessions/${sessionId}/resumed`);
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
