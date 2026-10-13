import {
  ChevronDown,
  Clock,
  LayoutGrid,
  List,
  Loader2,
  Search,
  Star,
  Timer,
  Type,
  Upload,
  X,
} from 'lucide-react';
import { type DragEvent, useEffect, useMemo, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext } from 'react-router-dom';
import { RecordControl } from '../components/record-control';
import { RecordingCard } from '../components/recording-card';
import { RecordingTable } from '../components/recording-table';
import { ALL_ID } from '../components/sidebar';
import { api, formatDuration, type RecordingSummary, type TranscriptHit } from '../lib/api';
import { useLocale } from '../lib/i18n';
import { cn } from '../lib/utils';
import type { ShellContext } from './shell';
import { useStudioState } from './shell';

/**
 * One sort, two controls. The dropdown offers the orderings worth naming; a
 * table header sets the same state, so the two can never disagree about how
 * the list in front of you is ordered.
 */
export type SortField = 'recorded' | 'length' | 'title' | 'size';
export type Sort = { field: SortField; desc: boolean };

type Filter = 'all' | 'transcribed' | 'pending';

/**
 * A filter, not a page. These used to be three sidebar entries that rendered
 * the same cards over the same recordings — a difference the navigation was
 * claiming and the content never showed.
 */
type View = 'grid' | 'table';

const VIEW_KEY = 'open-recording:view';

function same(a: Sort, b: Sort): boolean {
  return a.field === b.field && a.desc === b.desc;
}

function sortRecordings(list: RecordingSummary[], sort: Sort): RecordingSummary[] {
  const compare: Record<SortField, (a: RecordingSummary, b: RecordingSummary) => number> = {
    recorded: (a, b) => a.createdAt.localeCompare(b.createdAt),
    length: (a, b) => a.durationMs - b.durationMs,
    title: (a, b) => a.title.localeCompare(b.title),
    size: (a, b) => a.sizeBytes - b.sizeBytes,
  };
  const sorted = [...list].sort(compare[sort.field]);
  return sort.desc ? sorted.reverse() : sorted;
}

export function Home() {
  const state = useStudioState();
  const { recordings, refresh, selectedId } = useOutletContext<ShellContext>();
  const { t } = useLocale();
  const navigate = useNavigate();
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<Sort>({ field: 'recorded', desc: true });
  const [importing, setImporting] = useState(false);
  const [importError, setImportError] = useState<string | null>(null);
  const [dragging, setDragging] = useState(false);
  const fileInputRef = useRef<HTMLInputElement>(null);

  const fieldLabels: Record<SortField, string> = {
    recorded: t('home.fieldRecorded'),
    length: t('home.fieldLength'),
    title: t('home.fieldTitle'),
    size: t('home.fieldSize'),
  };

  const filters: Array<{ key: Filter; label: string }> = [
    { key: 'all', label: t('home.filterAll') },
    { key: 'transcribed', label: t('home.filterTranscribed') },
    { key: 'pending', label: t('home.filterPending') },
  ];

  const sorts: Array<{ label: string; sort: Sort }> = [
    { label: t('home.sortNewest'), sort: { field: 'recorded', desc: true } },
    { label: t('home.sortOldest'), sort: { field: 'recorded', desc: false } },
    { label: t('home.sortLongest'), sort: { field: 'length', desc: true } },
    { label: t('home.sortTitle'), sort: { field: 'title', desc: false } },
  ];

  const sortLabel = (s: Sort): string => {
    const preset = sorts.find((option) => same(option.sort, s));
    return preset ? preset.label : `${fieldLabels[s.field]} ${s.desc ? '↓' : '↑'}`;
  };

  // A second click on the same column turns it around; a new column starts
  // whichever way round reads as "most interesting first".
  const sortBy = (field: SortField) =>
    setSort((was) =>
      was.field === field ? { field, desc: !was.desc } : { field, desc: field !== 'title' },
    );
  const [sortOpen, setSortOpen] = useState(false);
  const [filter, setFilter] = useState<Filter>('all');
  const [layout, setLayout] = useState<View>(() =>
    localStorage.getItem(VIEW_KEY) === 'table' ? 'table' : 'grid',
  );

  const showAs = (next: View) => {
    setLayout(next);
    localStorage.setItem(VIEW_KEY, next);
  };
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

  const handleFiles = async (files: FileList | null) => {
    const file = files?.[0];
    if (!file) return;
    setImporting(true);
    setImportError(null);
    try {
      const meta = await api.importFile(file);
      refresh();
      navigate(`/r/${encodeURIComponent(meta.id)}`);
    } catch (err) {
      setImportError(err instanceof Error ? err.message : String(err));
    } finally {
      setImporting(false);
      if (fileInputRef.current) fileInputRef.current.value = '';
    }
  };

  const onDrop = (e: DragEvent<HTMLDivElement>) => {
    e.preventDefault();
    setDragging(false);
    void handleFiles(e.dataTransfer.files);
  };

  const view =
    selectedId === ALL_ID
      ? { icon: '🎙️', title: t('nav.recordings') }
      : { icon: '🏷️', title: selectedId };

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
    // biome-ignore lint/a11y/noStaticElementInteractions: dropzone wraps the archive view so any file dropped onto the studio imports cleanly
    <div
      onDragOver={(e) => {
        e.preventDefault();
        setDragging(true);
      }}
      onDragLeave={(e) => {
        if (e.currentTarget === e.target) setDragging(false);
      }}
      onDrop={onDrop}
      className="relative"
    >
      {dragging ? (
        <div className="pointer-events-none fixed inset-4 z-40 grid place-items-center rounded-[12px] border-2 border-brand border-dashed bg-background/85 backdrop-blur-xs">
          <div className="flex items-center gap-2.5 font-medium text-[15px] text-foreground">
            <Upload className="size-5 text-brand" />
            {t('home.dropHint')}
          </div>
        </div>
      ) : null}

      <header className="mb-8 md:mb-10">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-7 place-items-center text-2xl">{view.icon}</span>
          <h1 className="font-semibold text-[32px] leading-[1.05] tracking-[-0.025em] md:text-[44px]">
            {view.title}
          </h1>
          <span className="folio self-end pb-2">{visible.length.toString().padStart(2, '0')}</span>

          <div className="ml-auto flex w-full flex-wrap items-center gap-2 md:w-auto">
            <input
              ref={fileInputRef}
              type="file"
              accept="audio/*,video/*,.mp3,.m4a,.wav,.mp4,.mov,.webm,.ogg,.flac,.aac"
              onChange={(e) => void handleFiles(e.target.files)}
              className="hidden"
            />
            <button
              type="button"
              disabled={importing}
              onClick={() => fileInputRef.current?.click()}
              className="flex h-8 shrink-0 items-center gap-1.5 rounded-[6px] border border-border bg-background px-2.5 font-medium text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground disabled:opacity-50"
            >
              {importing ? (
                <Loader2 className="size-3.5 animate-spin" />
              ) : (
                <Upload className="size-3.5" />
              )}
              {importing ? t('home.importing') : t('home.import')}
            </button>

            <div className="flex h-8 shrink-0 items-center rounded-[6px] border border-border bg-background p-0.5">
              {filters.map((option) => (
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
                placeholder={t('home.searchPlaceholder')}
                className="h-8 w-full rounded-[6px] border border-border bg-background pr-7 pl-8 text-[12.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground/40"
              />
              {query ? (
                <button
                  type="button"
                  onClick={() => setQuery('')}
                  className="-translate-y-1/2 absolute top-1/2 right-1.5 grid size-5 place-items-center rounded-[4px] text-muted-foreground hover:bg-muted hover:text-foreground"
                  aria-label={t('home.clearSearch')}
                >
                  <X className="size-3" />
                </button>
              ) : null}
            </div>

            <div className="flex h-8 shrink-0 items-center rounded-[6px] border border-border bg-background p-0.5">
              <button
                type="button"
                onClick={() => showAs('grid')}
                aria-label={t('home.showCards')}
                aria-pressed={layout === 'grid'}
                className={cn(
                  'grid size-6 place-items-center rounded-[4px]',
                  layout === 'grid' ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
              >
                <LayoutGrid className="size-3.5" />
              </button>
              <button
                type="button"
                onClick={() => showAs('table')}
                aria-label={t('home.showTable')}
                aria-pressed={layout === 'table'}
                className={cn(
                  'grid size-6 place-items-center rounded-[4px]',
                  layout === 'table' ? 'bg-muted text-foreground' : 'text-muted-foreground',
                )}
              >
                <List className="size-3.5" />
              </button>
            </div>

            <div className="relative">
              <button
                type="button"
                onClick={() => setSortOpen((open) => !open)}
                onBlur={() => window.setTimeout(() => setSortOpen(false), 120)}
                className="flex h-8 shrink-0 items-center gap-1.5 whitespace-nowrap rounded-[6px] border border-border bg-background pr-1.5 pl-2 font-medium text-[12.5px] outline-none hover:bg-muted"
              >
                {sort.field === 'title' ? (
                  <Type className="size-3.5 text-muted-foreground" />
                ) : sort.field === 'recorded' ? (
                  <Clock className="size-3.5 text-muted-foreground" />
                ) : (
                  <Timer className="size-3.5 text-muted-foreground" />
                )}
                {sortLabel(sort)}
                <ChevronDown className="size-3 text-muted-foreground" />
              </button>
              {sortOpen ? (
                <div className="absolute right-0 z-10 mt-1 min-w-[150px] rounded-[6px] border border-border bg-card p-1 shadow-floating">
                  {sorts.map((option) => (
                    <button
                      key={option.label}
                      type="button"
                      onMouseDown={() => {
                        setSort(option.sort);
                        setSortOpen(false);
                      }}
                      className={cn(
                        'flex w-full items-center rounded-[4px] px-2 py-1.5 text-left text-[12.5px] hover:bg-muted',
                        same(option.sort, sort) && 'bg-muted font-medium',
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

      {importError ? <p className="mb-4 text-[12px] text-brand">{importError}</p> : null}

      <div className="mb-9">
        <RecordControl state={state} onChanged={refresh} />
      </div>

      {hits.length > 0 ? (
        <section className="mb-9">
          <p className="eyebrow mb-3">
            {t('home.inTranscripts')} · {hits.length}
          </p>
          <ul className="divide-y divide-hairline overflow-hidden rounded-[8px] border border-hairline bg-card">
            {hits.map((hit) => (
              <li key={`${hit.id}-${hit.start}`}>
                <Link
                  to={`/r/${encodeURIComponent(hit.id)}?t=${hit.start}`}
                  className="flex items-center gap-3 px-4 py-2.5 hover:bg-muted/60"
                >
                  <span className="folio shrink-0 text-brand">{formatDuration(hit.start)}</span>
                  {hit.speaker ? (
                    <span className="shrink-0 rounded-[3px] bg-muted px-1.5 py-0.5 font-medium text-[11px] text-muted-foreground">
                      {hit.speaker}
                    </span>
                  ) : null}
                  {hit.starred ? (
                    <Star className="size-3 shrink-0 fill-amber-400 text-amber-400" />
                  ) : null}
                  <span className="min-w-0 flex-1 truncate text-[12.5px]">{hit.text}</span>
                  <span className="folio shrink-0 truncate">{hit.title}</span>
                </Link>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {recordings === null ? (
        <p className="flex items-center gap-2 py-16 text-[13px] text-muted-foreground">
          <Loader2 className="size-4 animate-spin" /> {t('home.loading')}
        </p>
      ) : visible.length === 0 ? (
        <div className="rounded-[10px] border border-border border-dashed bg-card/60 px-8 py-20 text-center">
          <p className="font-semibold text-[15px] tracking-tight">
            {query ? t('home.noMatches') : t('home.nothingRecorded')}
          </p>
          <p className="mt-1.5 text-[13px] text-muted-foreground">
            {query ? t('home.nothingMatchesQuery', { query }) : t('home.emptyHint')}
          </p>
        </div>
      ) : layout === 'table' ? (
        <RecordingTable recordings={visible} sort={sort} onSort={sortBy} />
      ) : (
        <ul className="grid grid-cols-[repeat(auto-fill,minmax(240px,1fr))] gap-x-6 gap-y-9 md:grid-cols-[repeat(auto-fill,minmax(300px,1fr))]">
          {visible.map((recording) => (
            <RecordingCard key={recording.id} recording={recording} />
          ))}
        </ul>
      )}
    </div>
  );
}
