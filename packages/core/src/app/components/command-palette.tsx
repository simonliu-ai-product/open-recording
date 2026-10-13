import { Search } from 'lucide-react';
import { useTheme } from 'next-themes';
import { type KeyboardEvent, useEffect, useMemo, useRef, useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { api, formatDuration, type RecordingSummary, type TranscriptHit } from '../lib/api';
import { LOCALES, useLocale, useT } from '../lib/i18n';
import { cn } from '../lib/utils';

type Props = {
  open: boolean;
  onClose: () => void;
  recordings: RecordingSummary[];
  tags: Array<{ name: string; count: number }>;
};

type PaletteEntry = {
  key: string;
  kind: string;
  label: string;
  sub?: string;
  run: () => void;
};

export function CommandPalette({ open, onClose, recordings, tags }: Props) {
  const t = useT();
  const navigate = useNavigate();
  const { resolvedTheme, setTheme } = useTheme();
  const { setLocale } = useLocale();
  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const [hits, setHits] = useState<TranscriptHit[]>([]);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!open) return;
    setQuery('');
    setCursor(0);
    setHits([]);
    window.setTimeout(() => inputRef.current?.focus(), 0);
  }, [open]);

  useEffect(() => {
    if (!open) return;
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .search(needle)
        .then((res) => {
          if (!cancelled) setHits(res.slice(0, 8));
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 150);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [open, query]);

  const entries = useMemo<PaletteEntry[]>(() => {
    const q = query.trim().toLowerCase();
    const recEntries: PaletteEntry[] = recordings
      .filter((r) => !q || r.title.toLowerCase().includes(q) || r.id.toLowerCase().includes(q))
      .slice(0, 8)
      .map((r) => ({
        key: `rec:${r.id}`,
        kind: t('finder.kindRecording'),
        label: r.title,
        sub: formatDuration(r.durationMs),
        run: () => navigate(`/r/${encodeURIComponent(r.id)}`),
      }));

    const hitEntries: PaletteEntry[] = hits.map((h) => ({
      key: `hit:${h.id}:${h.start}`,
      kind: t('finder.kindTranscript'),
      label: h.speaker ? `[${h.speaker}] ${h.text}` : h.text,
      sub: `${h.title} · ${formatDuration(h.start)}`,
      run: () => navigate(`/r/${encodeURIComponent(h.id)}?t=${h.start}`),
    }));

    const tagEntries: PaletteEntry[] = tags
      .filter((tag) => !q || tag.name.toLowerCase().includes(q))
      .map((tag) => ({
        key: `tag:${tag.name}`,
        kind: t('finder.kindTag'),
        label: `#${tag.name}`,
        sub: String(tag.count).padStart(2, '0'),
        run: () => navigate(`/?v=${encodeURIComponent(tag.name)}`),
      }));

    const actionEntries: PaletteEntry[] = [
      {
        key: 'act:all',
        kind: t('finder.kindAction'),
        label: t('finder.goRecordings'),
        run: () => navigate('/'),
      },
      {
        key: 'act:setup',
        kind: t('finder.kindAction'),
        label: t('finder.goSetup'),
        run: () => navigate('/setup'),
      },
      {
        key: 'act:theme',
        kind: t('finder.kindAction'),
        label: t('finder.toggleTheme'),
        run: () => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark'),
      },
      ...LOCALES.map((loc) => ({
        key: `act:locale:${loc.code}`,
        kind: t('finder.kindAction'),
        label: `${t('nav.language')}: ${loc.label}`,
        run: () => setLocale(loc.code),
      })),
    ].filter((a) => !q || a.label.toLowerCase().includes(q));

    return [...recEntries, ...hitEntries, ...tagEntries, ...actionEntries];
  }, [query, recordings, hits, tags, t, navigate, resolvedTheme, setTheme, setLocale]);

  useEffect(() => {
    if (cursor >= entries.length) setCursor(0);
  }, [cursor, entries.length]);

  if (!open) return null;

  const pick = (entry: PaletteEntry | undefined) => {
    if (!entry) return;
    entry.run();
    onClose();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') {
      e.preventDefault();
      onClose();
    } else if (e.key === 'ArrowDown') {
      e.preventDefault();
      setCursor((c) => Math.min(entries.length - 1, c + 1));
    } else if (e.key === 'ArrowUp') {
      e.preventDefault();
      setCursor((c) => Math.max(0, c - 1));
    } else if (e.key === 'Enter') {
      e.preventDefault();
      pick(entries[cursor]);
    }
  };

  return (
    // biome-ignore lint/a11y/noStaticElementInteractions: backdrop dismisses the palette on outside click
    <div
      className="fixed inset-0 z-50 flex items-start justify-center bg-black/50 px-4 pt-[12vh] backdrop-blur-[2px]"
      onMouseDown={(e) => e.target === e.currentTarget && onClose()}
    >
      <div
        role="dialog"
        aria-label={t('nav.search')}
        onKeyDown={onKey}
        className="w-full max-w-[560px] overflow-hidden rounded-[10px] border border-border bg-card shadow-floating"
      >
        <div className="flex items-center gap-2.5 border-hairline border-b px-3.5 py-2.5">
          <Search className="size-4 shrink-0 text-muted-foreground" />
          <input
            ref={inputRef}
            value={query}
            onChange={(e) => {
              setQuery(e.target.value);
              setCursor(0);
            }}
            placeholder={t('finder.placeholder')}
            className="w-full bg-transparent text-[13.5px] outline-none placeholder:text-muted-foreground/70"
          />
          <kbd className="rounded-[4px] border border-border px-1.5 py-0.5 folio text-[10px]">
            ESC
          </kbd>
        </div>

        <div className="max-h-[360px] overflow-y-auto p-1.5">
          {entries.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12.5px] text-muted-foreground">
              {t('finder.empty')}
            </p>
          ) : (
            entries.map((entry, idx) => (
              <button
                key={entry.key}
                type="button"
                onMouseEnter={() => setCursor(idx)}
                onClick={() => pick(entry)}
                className={cn(
                  'flex w-full items-center gap-3 rounded-[6px] px-2.5 py-2 text-left text-[13px]',
                  idx === cursor ? 'bg-muted text-foreground' : 'text-foreground/85',
                )}
              >
                <span className="eyebrow w-20 shrink-0">{entry.kind}</span>
                <span className="min-w-0 flex-1 truncate">{entry.label}</span>
                {entry.sub ? <span className="folio shrink-0">{entry.sub}</span> : null}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
