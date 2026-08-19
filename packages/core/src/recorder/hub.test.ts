import { describe, expect, it, vi } from 'vitest';
import { RecorderHub, type StudioCommand } from './hub.ts';

function armed() {
  const hub = new RecorderHub();
  const sent: StudioCommand[] = [];
  hub.attachStudio((command) => sent.push(command));
  hub.arm({
    sessionId: 's1',
    recordingId: '20260819-141530-sync',
    title: 'Sync',
    chunkMs: 5000,
    maxDurationMs: 1000,
  });
  return { hub, sent };
}

describe('RecorderHub', () => {
  it('starts idle and reports connected studios', () => {
    const hub = new RecorderHub();
    expect(hub.snapshot().status).toBe('idle');
    const detach = hub.attachStudio(() => {});
    expect(hub.studioCount()).toBe(1);
    detach();
    expect(hub.studioCount()).toBe(0);
  });

  it('arms, then only counts as recording once a studio acknowledges', () => {
    const { hub, sent } = armed();
    expect(hub.snapshot().status).toBe('arming');
    expect(sent.some((c) => c.type === 'start')).toBe(true);

    expect(hub.ackRecording('s1')).toBe(true);
    expect(hub.snapshot().status).toBe('recording');
  });

  it('ignores acknowledgements from a session that is no longer current', () => {
    const { hub } = armed();
    expect(hub.ackRecording('other')).toBe(false);
    expect(hub.snapshot().status).toBe('arming');
  });

  it('returns to idle when the studio finishes', () => {
    const { hub } = armed();
    hub.ackRecording('s1');
    expect(hub.finish('s1', { durationMs: 4200 })).toBe(true);
    const state = hub.snapshot();
    expect(state.status).toBe('idle');
    expect(state.durationMs).toBe(4200);
    expect(state.sessionId).toBeNull();
  });

  it('keeps the failure reason on the state after an abandoned session', () => {
    const { hub } = armed();
    hub.abandon('s1', 'studio did not start');
    expect(hub.snapshot()).toMatchObject({ status: 'idle', error: 'studio did not start' });
  });

  it("pauses and resumes only on the studio's acknowledgement", () => {
    const { hub, sent } = armed();
    hub.ackRecording('s1');

    hub.requestPause();
    expect(sent.some((c) => c.type === 'pause')).toBe(true);
    // The command is out, but nothing claims to be paused until the studio says so.
    expect(hub.snapshot().status).toBe('recording');

    expect(hub.ackPaused('s1')).toBe(true);
    expect(hub.snapshot().status).toBe('paused');

    hub.requestResume();
    expect(hub.ackResumed('s1')).toBe(true);
    expect(hub.snapshot().status).toBe('recording');
  });

  it('refuses a pause that does not match the state it is in', () => {
    const { hub } = armed();
    expect(hub.ackPaused('s1')).toBe(false);
    hub.ackRecording('s1');
    expect(hub.ackResumed('s1')).toBe(false);
    expect(hub.ackPaused('other')).toBe(false);
  });

  it('stops straight from paused, without resuming first', () => {
    const { hub, sent } = armed();
    hub.ackRecording('s1');
    hub.ackPaused('s1');

    hub.requestStop();
    expect(sent.some((c) => c.type === 'stop')).toBe(true);
    expect(hub.finish('s1', { durationMs: 1200 })).toBe(true);
    expect(hub.snapshot().status).toBe('idle');
  });

  it('tells one studio to record, never all of them', () => {
    const hub = new RecorderHub();
    const first: StudioCommand[] = [];
    const second: StudioCommand[] = [];
    hub.attachStudio((c) => first.push(c));
    hub.attachStudio((c) => second.push(c));

    hub.arm({
      sessionId: 's1',
      recordingId: '20260819-141530-sync',
      title: 'Sync',
      chunkMs: 5000,
      maxDurationMs: 1000,
    });

    // Two microphones appending to one file would interleave two WebM streams.
    expect(first.filter((c) => c.type === 'start')).toHaveLength(1);
    expect(second.filter((c) => c.type === 'start')).toHaveLength(0);
    // Both still see the state, because both pages show the same recorder.
    expect(second.some((c) => c.type === 'state')).toBe(true);
  });

  it('resolves waitFor on a matching transition and rejects on timeout', async () => {
    vi.useFakeTimers();
    try {
      const { hub } = armed();
      const waiting = hub.waitFor((s) => s.status === 'recording', 1000);
      hub.ackRecording('s1');
      await expect(waiting).resolves.toMatchObject({ status: 'recording' });

      const doomed = hub.waitFor((s) => s.status === 'idle', 1000);
      const assertion = expect(doomed).rejects.toThrow('timeout');
      await vi.advanceTimersByTimeAsync(1001);
      await assertion;
    } finally {
      vi.useRealTimers();
    }
  });
});
