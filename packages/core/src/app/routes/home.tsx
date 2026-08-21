import { ChevronDown, Clock, Loader2, Search, Timer, Type, X } from 'lucide-react';
import { useEffect, useMemo, useState } from 'react';
import { Link, useOutletContext } from 'react-router-dom';
import { RecordControl } from '../components/record-control';
import { RecordingCard } from '../components/recording-card';
import { ALL_ID } from '../components/sidebar';
import { api, formatDuration, type RecordingSummary, type TranscriptHit } from '../lib/api';
import { cn } from '../lib/utils';
import type { ShellContext } from './shell';
import { useStudioState } from './shell';

type SortKey = 'newest' | 'oldest' | 'longest' | 'title';

type Filter = 'all' | 'transcribed' | 'pending';

/**
 * A filter, not a page. These used to be three sidebar entries that rendered
 * the same cards over the same recordings — a difference the navigation was
 * claiming and the content never showed.
 */
const FILTERS: Array<{ key: Filter; label: string }> = [
  { key: 'all', label: 'All' },
  { key: 'transcribed', label: 'Transcribed' },
  { key: 'pending', label: 'Pending' },
];

const SORTS: Array<{ key: SortKey; label: string }> = [
  { key: 'newest', label: 'Newest' },
  { key: 'oldest', label: 'Oldest' },
  { key: 'longest', label: 'Longest' },
  { key: 'title', label: 'Title' },
];

const VIEW_LABELS: Record<string, { icon: string; title: string }> = {
  [ALL_ID]: { icon: '🎙️', title: 'Recordings' },
};

function sortRecordings(list: RecordingSummary[], key: SortKey): RecordingSummary[] {
  const sorted = [...list];
  if (key === 'newest') sorted.sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (key === 'oldest') sorted.sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  if (key === 'longest') sorted.sort((a, b) => b.durationMs - a.durationMs);
  if (key === 'title') sorted.sort((a, b) => a.title.localeCompare(b.title));
  return sorted;
}

export function Home() {
  const state = useStudioState();
  const { recordings, refresh, selectedId } = useOutletContext<ShellContext>();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<SortKey>('newest');
  const [sortOpen, setSortOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [hits, setHits] = useState<TranscriptHit[]>([]);

  // Titles filter locally; what was *said* only exists in the stored
  // transcripts, so that half of the search runs on the server.
  useEffect(() => {
    const needle = query.trim();
    if (needle.length < 2) {
      setHits([]);
      return;
    }
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void api
        .search(needle)
        .then((result) => {
          if (!cancelled) setHits(result);
        })
        .catch(() => {
          if (!cancelled) setHits([]);
        });
    }, 200);
    return () => {
      cancelled = true;
      window.clearTimeout(timer);
    };
  }, [query]);

  const view = VIEW_LABELS[selectedId] ?? { icon: '🏷️', title: selectedId };

  const visible = useMemo(() => {
    let list = recordings ?? [];
    if (selectedId !== ALL_ID) list = list.filter((r) => r.tags.includes(selectedId));
    if (filter === 'transcribed') list = list.filter((r) => r.transcribed);
    else if (filter === 'pending') list = list.filter((r) => !r.transcribed);

    const needle = query.trim().toLowerCase();
    if (needle) {
      list = list.filter(
        (r) =>
          r.title.toLowerCase().includes(needle) ||
          (r.preview?.toLowerCase().includes(needle) ?? false),
      );
    }
    return sortRecordings(list, sort);
  }, [recordings, selectedId, filter, query, sort]);

  return (
    <>
      <header className="mb-8 md:mb-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-7 place-items-center text-2xl">{view.icon}</span>
          <h1 className="font-semibold text-[32px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
            {view.title}
          </h1>
          <span className="folio self-end pb-2">{visible.length.toString().padStart(2, '0')}</span>

          <div className="ml-auto flex w-full items-center gap-2 md:w-auto">
            <div className="flex h-8 shrink-0 items-center rounded-[6px] border border-border bg-background p-0.5">
              {FILTERS.map((option) => (
                <button
                  key={option.key}
                  type="button"
                  onClick={() => setFilter(option.key)}
                  className={cn(
                    'rounded-[4px] px-2 py-1 text-[12px]',
                    filter === option.key
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {option.label}
                </button>
              ))}
            </div>

            <div className="relative w-full md:w-[240px]">
              <Search className="-translate-y-1/2 pointer-events-none absolute top-1/2 left-2.5 size-3.5 text-muted-foreground" />
              <input
                value={query}
                onChange={(e) => setQuery(e.target.value)}
                placeholder="Search titles and transcripts"
                className="h-8 w-full rounded-[6px] border border-border bg-background pr-7 pl-8 text-[12.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground/40"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="-translate-y-1/2 absolute top-1/2 right-1.5 grid size-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label="Clear search"
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setSortOpen((open) => !open)}
                onBlur={() => window.setTimeout(() => setSortOpen(false), 120)}
                className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border bg-background pr-1.5 pl-2 font-medium text-[12.5px] outline-none hover:bg-muted"
              >
                {sort === 'title' ? (
                  <Type className="size-3.5 text-muted-foreground" />
                ) : sort === 'longest' ? (
                  <Timer className="size-3.5 text-muted-foreground" />
                ) : (
                  <Clock className="size-3.5 text-muted-foreground" />
                )}
                {SORTS.find((s) => s.key === sort)?.label}
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
              {sortOpen ? (
                <div className="absolute right-0 z-10 mt-1 min-w-[150px] rounded-[6px] border border-border bg-card p-1 shadow-floating">
                  {SORTS.map((option) => (
                    <button
                      key={option.key}
                      type="button"
                      onMouseDown={() => {
                        setSort(option.key);
                        setSortOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center rounded-[4px] px-2 py-1.5 text-left text-[12.5px] hover:bg-muted',
                        sort === option.key && 'bg-muted font-medium',
                      )}
                    >
                      {option.label}
                    </button>
                  ))}
                </div>
              ) : null}
            </div>
          </div>
        </div>
      </header>

      <div className="mb-9">
        <RecordControl state={state} onChanged={refresh} />
      </div>

      {hits.length > 0 ? (
        <section className="mb-9">
          <p className="eyebrow mb-3">In transcripts · {hits.length}</p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-[8px] border border-hairline bg-card">
            {hits.map((hit) => (
              <li key={`${hit.id}-${hit.start}`}>
                <Link
                  to={`/r/${encodeURIComponent(hit.id)}`}
                  className="flex gap-3 px-4 py-2.5 hover:bg-muted/60"
                >
                  <span className="folio shrink-0 pt-0.5">{formatDuration(hit.start)}</span>
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{hit.text}</span>
                  <span className="folio shrink-0 truncate pt-0.5">{hit.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recordings === null ? (
        <p className="flex items-center gap-2 py-16 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> Loading
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-[10px] border border-border border-dashed bg-card/60 px-8 py-20 text-center">
          <p className="font-semibold text-[15px] tracking-tight">
            {query ? 'No matches' : 'Nothing recorded yet'}
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {query
              ? `Nothing matches “${query}”.`
              : 'Press record above, or ask an agent to start a recording.'}
          </p>
        </div>
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-9 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {visible.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </ul>
      )}
    </>
  );
}
