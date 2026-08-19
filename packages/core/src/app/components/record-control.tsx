import { Mic, Pause, Play, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, formatDuration } from '../lib/api';
import type { StudioState } from '../lib/studio';
import { cn } from '../lib/utils';

type Props = {
  state: StudioState;
  onChanged: () => void;
};

/** Twelve bars, centre-weighted, so the meter reads as listening rather than loading. */
const BARS = Array.from({ length: 12 }, (_, i) => ({ id: i, weight: 1 - Math.abs(i - 5.5) / 8 }));

export function RecordControl({ state, onChanged }: Props) {
  const [title, setTitle] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);

  const recording = state.recorder.status === 'recording';
  const paused = state.recorder.status === 'paused';
  const open = recording || paused;
  const startedAt = state.recorder.startedAt;
  const capturedMs = state.recorder.durationMs;

  useEffect(() => {
    if (!open || !startedAt) {
      setElapsed(0);
      return;
    }
    // Paused time is not in the file, so the clock stops with the recorder and
    // shows the last figure the studio reported.
    if (paused) {
      setElapsed(capturedMs);
      return;
    }
    const started = new Date(startedAt).getTime();
    const tick = () => setElapsed(Date.now() - started);
    tick();
    const timer = window.setInterval(tick, 250);
    return () => window.clearInterval(timer);
  }, [open, paused, capturedMs, startedAt]);

  const act = async (fn: () => Promise<unknown>) => {
    setBusy(true);
    setError(null);
    try {
      await fn();
      setTitle('');
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const pending = state.recorder.status === 'arming' || state.recorder.status === 'stopping';

  return (
    <section className="rounded-[8px] border border-hairline bg-card p-4 shadow-edge">
      <div className="flex items-center gap-4">
        <button
          type="button"
          disabled={busy || pending}
          onClick={() =>
            act(() => (open ? api.stop() : api.start(title.trim() ? { title: title.trim() } : {})))
          }
          className={cn(
            'relative grid size-11 shrink-0 place-items-center rounded-full disabled:opacity-50',
            recording
              ? 'recording-ring bg-brand text-brand-foreground'
              : paused
                ? 'bg-brand/70 text-brand-foreground'
                : 'bg-primary text-primary-foreground hover:opacity-90',
          )}
          aria-label={open ? 'Stop recording' : 'Start recording'}
        >
          {open ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
        </button>

        <div className="min-w-0 flex-1">
          {open ? (
            <>
              <p className="nums flex items-center gap-2 font-medium text-[19px] leading-tight tracking-tight">
                {formatDuration(elapsed)}
                {paused ? (
                  <span className="rounded-[3px] bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
                    Paused
                  </span>
                ) : null}
              </p>
              <p className="folio mt-0.5 truncate">
                {state.recorder.title} · {state.recorder.recordingId}
              </p>
            </>
          ) : (
            <input
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              placeholder={
                pending ? 'Waiting for the studio…' : 'Title (optional) — then press record'
              }
              className="h-8 w-full rounded-[6px] border border-border bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground/40"
            />
          )}
        </div>

        {/* Only shown once a microphone is open: an idle meter is a row of
            dots that says nothing. */}
        <div
          className={cn(
            'flex h-8 shrink-0 items-end gap-[3px]',
            (state.mic !== 'armed' || paused) && 'hidden',
          )}
          aria-hidden
        >
          {BARS.map((bar) => (
            <span
              key={bar.id}
              className={cn('w-[3px] rounded-full', recording ? 'bg-brand' : 'bg-muted')}
              style={{
                height: `${Math.max(3, Math.round(state.level * bar.weight * 32))}px`,
                transition: 'height 100ms linear',
              }}
            />
          ))}
        </div>

        {open ? (
          <button
            type="button"
            disabled={busy || pending}
            onClick={() => act(() => (paused ? api.resume() : api.pause()))}
            className="flex items-center gap-1.5 rounded-[6px] border border-border px-2.5 py-1.5 font-medium text-[12px] hover:bg-muted disabled:opacity-50"
          >
            {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
            {paused ? 'Resume' : 'Pause'}
          </button>
        ) : null}

        {open ? (
          <button
            type="button"
            disabled={busy}
            onClick={() => act(() => api.cancel())}
            className="flex items-center gap-1.5 rounded-[6px] px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <X className="size-3.5" />
            Discard
          </button>
        ) : null}
      </div>

      {(error ?? state.recorder.error) ? (
        <p className="mt-3 text-[12px] text-brand">{error ?? state.recorder.error}</p>
      ) : null}
    </section>
  );
}
