import { Bookmark, ChevronDown, Mic, Monitor, Pause, Play, Square, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, formatDuration } from '../lib/api';
import { useT } from '../lib/i18n';
import { type CaptureKind, type StudioState, studio } from '../lib/studio';
import { cn } from '../lib/utils';

type Props = {
  state: StudioState;
  onChanged: () => void;
};

/** Twelve bars, centre-weighted, so the meter reads as listening rather than loading. */
const BARS = Array.from({ length: 12 }, (_, i) => ({ id: i, weight: 1 - Math.abs(i - 5.5) / 8 }));

const REMEMBERED = 'open-recording:source';

function remembered(): CaptureKind {
  return localStorage.getItem(REMEMBERED) === 'screen' ? 'screen' : 'audio';
}

export function RecordControl({ state, onChanged }: Props) {
  const t = useT();
  const [title, setTitle] = useState('');
  const [markLabel, setMarkLabel] = useState('');
  const [lastMarked, setLastMarked] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [elapsed, setElapsed] = useState(0);
  const [menuOpen, setMenuOpen] = useState(false);
  const [source, setSource] = useState<CaptureKind>(remembered);

  const SOURCES: Array<{ kind: CaptureKind; label: string; icon: typeof Mic }> = [
    { kind: 'audio', label: t('record.sourceMic'), icon: Mic },
    { kind: 'screen', label: t('record.sourceTab'), icon: Monitor },
  ];

  const recording = state.recorder.status === 'recording';
  const paused = state.recorder.status === 'paused';
  const open = recording || paused;
  const pending = state.recorder.status === 'arming' || state.recorder.status === 'stopping';
  const held = state.mic === 'armed';
  const startedAt = state.recorder.startedAt;
  const capturedMs = state.recorder.durationMs;

  const current = held ? state.capture : source;
  const chosen = SOURCES.find((s) => s.kind === current) ?? SOURCES[0];

  useEffect(() => {
    if (!open || !startedAt) {
      setElapsed(0);
      setLastMarked(null);
      return;
    }
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

  const take = async (kind: CaptureKind, deviceId?: string) => {
    if (kind === 'screen') await studio.armScreen();
    else await studio.arm(deviceId);
  };

  const record = () =>
    act(async () => {
      if (open) return api.stop();
      if (!held) await take(source);
      return api.start(title.trim() ? { title: title.trim() } : {});
    });

  const pick = (kind: CaptureKind) =>
    act(async () => {
      setSource(kind);
      localStorage.setItem(REMEMBERED, kind);
      setMenuOpen(false);
      await take(kind);
    });

  const markMoment = async () => {
    try {
      const label = markLabel.trim() || undefined;
      await api.markMoment(label);
      setMarkLabel('');
      setLastMarked(formatDuration(elapsed));
      onChanged();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    }
  };

  const SourceIcon = chosen.icon;

  return (
    <section className="rounded-[8px] border border-hairline bg-card p-4 shadow-edge">
      <div className="flex flex-wrap items-center gap-4">
        <div className="relative flex shrink-0 items-center">
          <button
            type="button"
            disabled={busy || pending}
            onClick={record}
            className={cn(
              'relative grid size-11 place-items-center rounded-full disabled:opacity-50',
              recording
                ? 'recording-ring bg-brand text-brand-foreground'
                : paused
                  ? 'bg-brand/70 text-brand-foreground'
                  : 'bg-primary text-primary-foreground hover:opacity-90',
            )}
            aria-label={open ? t('record.stop') : t('record.start')}
          >
            {open ? <Square className="size-4 fill-current" /> : <Mic className="size-5" />}
          </button>

          {open ? null : (
            <button
              type="button"
              onClick={() => setMenuOpen((was) => !was)}
              onBlur={() => window.setTimeout(() => setMenuOpen(false), 120)}
              aria-label={t('record.chooseSource')}
              aria-expanded={menuOpen}
              className="-ml-1.5 grid size-6 place-items-center rounded-full border border-border bg-background text-muted-foreground hover:text-foreground"
            >
              <ChevronDown className="size-3.5" />
            </button>
          )}

          {menuOpen ? (
            <div className="absolute top-12 left-0 z-10 min-w-[230px] rounded-[6px] border border-border bg-card p-1 shadow-floating">
              {SOURCES.map((option) => {
                const Icon = option.icon;
                return (
                  <button
                    key={option.kind}
                    type="button"
                    onMouseDown={() => pick(option.kind)}
                    aria-current={option.kind === current}
                    className={cn(
                      'flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12.5px] hover:bg-muted',
                      option.kind === current && 'font-medium',
                    )}
                  >
                    <Icon className="size-3.5 text-muted-foreground" />
                    <span className="flex-1">{option.label}</span>
                    {option.kind === current ? (
                      <span className="folio" aria-hidden>
                        ✓
                      </span>
                    ) : null}
                  </button>
                );
              })}

              {state.devices.length > 1 && current === 'audio' ? (
                <>
                  <p className="eyebrow mt-1.5 mb-1 px-2">{t('record.input')}</p>
                  {state.devices.map((device) => (
                    <button
                      key={device.id}
                      type="button"
                      onMouseDown={() => {
                        setMenuOpen(false);
                        void act(() => take('audio', device.id));
                      }}
                      aria-current={device.id === state.deviceId}
                      className={cn(
                        'flex w-full items-center gap-2 rounded-[4px] px-2 py-1.5 text-left text-[12.5px] hover:bg-muted',
                        device.id === state.deviceId && 'font-medium',
                      )}
                    >
                      <span className="flex-1 truncate">{device.label}</span>
                      {device.id === state.deviceId ? (
                        <span className="folio" aria-hidden>
                          ✓
                        </span>
                      ) : null}
                    </button>
                  ))}
                </>
              ) : null}
            </div>
          ) : null}
        </div>

        <div className="min-w-0 flex-1">
          {open ? (
            <>
              <p className="nums flex items-center gap-2 font-medium text-[19px] leading-tight tracking-tight">
                {formatDuration(elapsed)}
                {paused ? (
                  <span className="rounded-[3px] bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground uppercase tracking-widest">
                    {t('record.paused')}
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
              placeholder={pending ? t('record.waitingStudio') : t('record.titlePlaceholder')}
              className="h-8 w-full rounded-[6px] border border-border bg-background px-2.5 text-[12.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground/40"
            />
          )}
        </div>

        <div
          className={cn(
            'flex h-8 shrink-0 items-end gap-[3px]',
            (!held || paused || state.captureSilent) && 'hidden',
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
          <div className="flex flex-wrap items-center gap-2">
            <div className="flex items-center rounded-[6px] border border-border bg-background">
              <input
                value={markLabel}
                onChange={(e) => setMarkLabel(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter') {
                    e.preventDefault();
                    void markMoment();
                  }
                }}
                placeholder={t('record.markPlaceholder')}
                className="h-7 w-28 bg-transparent px-2 text-[12px] outline-none placeholder:text-muted-foreground/70"
              />
              <button
                type="button"
                onClick={() => void markMoment()}
                className="flex h-7 items-center gap-1 whitespace-nowrap border-border border-l px-2 font-medium text-[12px] hover:bg-muted"
              >
                <Bookmark className="size-3 text-brand" />
                {t('record.mark')}
              </button>
            </div>
            <button
              type="button"
              disabled={busy || pending}
              onClick={() => act(() => (paused ? api.resume() : api.pause()))}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border px-2.5 py-1.5 font-medium text-[12px] hover:bg-muted disabled:opacity-50"
            >
              {paused ? <Play className="size-3.5" /> : <Pause className="size-3.5" />}
              {paused ? t('record.resume') : t('record.pause')}
            </button>
            <button
              type="button"
              disabled={busy}
              onClick={() => act(() => api.cancel())}
              className="flex items-center gap-1.5 whitespace-nowrap rounded-[6px] px-2 py-1.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              <X className="size-3.5" />
              {t('record.discard')}
            </button>
          </div>
        ) : null}
      </div>

      <p className="folio mt-3 flex flex-wrap items-center gap-x-1.5">
        <SourceIcon className="size-3 shrink-0" />
        {held
          ? current === 'screen'
            ? t('record.sharingTab')
            : t('record.micReady')
          : t('record.takenWhenRecord', { source: chosen.label })}
        {state.recorder.studios > 1 ? (
          <span>{t('record.studioTabsOpen', { count: state.recorder.studios })}</span>
        ) : null}
        {lastMarked ? (
          <span className="text-brand">· {t('record.marked', { time: lastMarked })}</span>
        ) : null}
      </p>

      {held && current === 'screen' && state.captureSilent ? (
        <p className="mt-1.5 text-[12px] text-brand">{t('record.tabSilentWarning')}</p>
      ) : null}

      {(error ?? state.recorder.error) ? (
        <p className="mt-2 text-[12px] text-brand">{error ?? state.recorder.error}</p>
      ) : null}
    </section>
  );
}
