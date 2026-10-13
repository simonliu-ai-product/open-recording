import {
  ArrowLeft,
  Bookmark as BookmarkIcon,
  Check,
  Copy,
  Download,
  Loader2,
  Pencil,
  Plus,
  Star,
  Trash2,
  Wand2,
  X,
} from 'lucide-react';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams, useSearchParams } from 'react-router-dom';
import { TagEditor } from '../components/tag-editor';
import { TranscriptLine } from '../components/transcript-line';
import { api, formatBytes, formatDuration, type RecordingMeta, type Transcript } from '../lib/api';
import { useLocale } from '../lib/i18n';
import { cn } from '../lib/utils';
import type { ShellContext } from './shell';

const PLAYBACK_RATES = [1, 1.25, 1.5, 2] as const;

export function RecordingPage() {
  const { id = '' } = useParams();
  const [searchParams, setSearchParams] = useSearchParams();
  const navigate = useNavigate();
  const { refresh } = useOutletContext<ShellContext>();
  const { t } = useLocale();
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [editingNotes, setEditingNotes] = useState(false);
  const [notesDraft, setNotesDraft] = useState('');
  const [editingTitle, setEditingTitle] = useState(false);
  const [titleDraft, setTitleDraft] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [currentMs, setCurrentMs] = useState(0);
  const [rate, setRate] = useState<number>(1);
  const [lineFilter, setLineFilter] = useState<'all' | 'starred'>('all');
  const [addingBookmark, setAddingBookmark] = useState(false);
  const [bookmarkLabel, setBookmarkLabel] = useState('');
  const [copiedNotes, setCopiedNotes] = useState(false);
  const [copiedTranscript, setCopiedTranscript] = useState(false);

  const mediaRef = useRef<HTMLVideoElement & HTMLAudioElement>(null);

  const load = useCallback(() => {
    void api
      .readRecording(id)
      .then((m) => {
        setMeta(m);
        setTitleDraft(m.title);
      })
      .catch((err: Error) => setError(err.message));
    void api
      .readTranscript(id)
      .then(setTranscript)
      .catch(() => setTranscript(null));
    void api
      .readNotes(id)
      .then((r) => {
        setNotes(r.text);
        setNotesDraft(r.text);
      })
      .catch(() => {
        setNotes(null);
        setNotesDraft('');
      });
  }, [id]);

  useEffect(load, [load]);

  // Report active recording to the server so agents calling `current_recording`
  // know which recording is open and where the playhead sits.
  useEffect(() => {
    void api.reportCurrent({ recordingId: id, currentTimeMs: 0 }).catch(() => {});
    return () => {
      void api.reportCurrent({ recordingId: null }).catch(() => {});
    };
  }, [id]);

  const seekTo = useCallback(
    (ms: number, autoPlay = true) => {
      const el = mediaRef.current;
      const clamped = Math.max(0, ms);
      setCurrentMs(clamped);
      if (el) {
        el.currentTime = clamped / 1000;
        if (autoPlay) {
          void el.play().catch(() => {});
        }
      }
      void api.reportCurrent({ recordingId: id, currentTimeMs: clamped }).catch(() => {});
    },
    [id],
  );

  // Deep-link timestamp support: `/r/:id?t=12340`
  useEffect(() => {
    if (!meta) return;
    const raw = searchParams.get('t');
    if (!raw) return;
    const ms = Number(raw);
    if (!Number.isFinite(ms) || ms < 0) return;
    const el = mediaRef.current;
    if (el && el.readyState >= 1) {
      seekTo(ms, true);
      setSearchParams({}, { replace: true });
    } else if (el) {
      const onLoaded = () => {
        seekTo(ms, true);
        setSearchParams({}, { replace: true });
      };
      el.addEventListener('loadedmetadata', onLoaded, { once: true });
      return () => el.removeEventListener('loadedmetadata', onLoaded);
    } else {
      setCurrentMs(ms);
    }
  }, [meta, searchParams, seekTo, setSearchParams]);

  const changeRate = (nextRate: number) => {
    setRate(nextRate);
    if (mediaRef.current) {
      mediaRef.current.playbackRate = nextRate;
    }
  };

  const transcribe = async () => {
    setBusy(true);
    setError(null);
    try {
      await api.transcribe(id, { force: Boolean(transcript) });
      load();
      refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
    } finally {
      setBusy(false);
    }
  };

  const remove = async () => {
    await api.remove(id).catch(() => {});
    refresh();
    navigate('/');
  };

  const saveTitle = async () => {
    setEditingTitle(false);
    const trimmed = titleDraft.trim();
    if (!meta || !trimmed || trimmed === meta.title) {
      setTitleDraft(meta?.title ?? '');
      return;
    }
    const updated = await api.rename(id, trimmed);
    setMeta(updated);
    refresh();
  };

  const saveNotes = async () => {
    const trimmed = notesDraft.trim();
    if (!trimmed) {
      setEditingNotes(false);
      return;
    }
    await api.writeNotes(id, notesDraft);
    setNotes(notesDraft);
    setEditingNotes(false);
    refresh();
  };

  const addBookmarkAtPlayhead = async () => {
    const label = bookmarkLabel.trim() || `Mark ${formatDuration(currentMs)}`;
    const updated = await api.addBookmark(id, currentMs, label);
    setMeta(updated);
    setBookmarkLabel('');
    setAddingBookmark(false);
  };

  const removeBookmark = async (bookmarkId: string) => {
    const updated = await api.deleteBookmark(id, bookmarkId);
    setMeta(updated);
  };

  const copyText = async (text: string, which: 'notes' | 'transcript') => {
    try {
      await navigator.clipboard.writeText(text);
      if (which === 'notes') {
        setCopiedNotes(true);
        window.setTimeout(() => setCopiedNotes(false), 1600);
      } else {
        setCopiedTranscript(true);
        window.setTimeout(() => setCopiedTranscript(false), 1600);
      }
    } catch {
      // Ignore clipboard failures
    }
  };

  const downloads = [
    {
      kind: 'media',
      label: meta?.kind === 'screen' ? t('detail.video') : t('detail.audio'),
    },
    ...(transcript
      ? [
          { kind: 'srt', label: 'SRT' },
          { kind: 'vtt', label: 'VTT' },
          { kind: 'transcript', label: t('detail.markdown') },
        ]
      : []),
  ];

  if (!meta) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        {error ? (
          error
        ) : (
          <>
            <Loader2 className="size-4 animate-spin" /> {t('home.loading')}
          </>
        )}
      </p>
    );
  }

  const bookmarks = meta.bookmarks ?? [];
  const starredCount = transcript?.segments.filter((s) => s.starred).length ?? 0;

  return (
    <div className="mx-auto max-w-[760px]">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> {t('detail.allRecordings')}
      </Link>

      <header className="mb-6">
        {editingTitle ? (
          <input
            value={titleDraft}
            onChange={(e) => setTitleDraft(e.target.value)}
            onBlur={() => void saveTitle()}
            onKeyDown={(e) => {
              if (e.key === 'Enter') {
                e.preventDefault();
                void saveTitle();
              } else if (e.key === 'Escape') {
                setTitleDraft(meta.title);
                setEditingTitle(false);
              }
            }}
            className="-mx-2 w-full rounded-[6px] bg-muted px-2 py-0.5 font-semibold text-[28px] leading-[1.1] tracking-[-0.025em] outline-none"
          />
        ) : (
          <h1 className="font-semibold text-[28px] leading-[1.1] tracking-[-0.025em]">
            <button
              type="button"
              onClick={() => {
                setTitleDraft(meta.title);
                setEditingTitle(true);
              }}
              title={t('detail.renameHint')}
              className="-mx-2 cursor-text rounded-[6px] px-2 py-0.5 text-left hover:bg-muted/60"
            >
              {meta.title}
            </button>
          </h1>
        )}
        <p className="folio mt-2">
          {new Date(meta.createdAt).toLocaleString()} · {formatDuration(meta.durationMs)} ·{' '}
          {formatBytes(meta.sizeBytes)} · {meta.kind === 'screen' ? 'screen' : 'audio'} ·{' '}
          {meta.source} · {meta.id}
        </p>
        <div className="mt-3">
          <TagEditor
            tags={meta.tags}
            onChange={async (tags) => {
              setMeta(await api.setTags(id, tags));
              refresh();
            }}
          />
        </div>
      </header>

      {meta.kind === 'screen' ? (
        // biome-ignore lint/a11y/useMediaCaption: the cue track is added below once the recording has been transcribed; there are no captions to offer before that
        <video
          ref={mediaRef}
          controls
          onTimeUpdate={(e) => setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))}
          src={`/__rec/recordings/${encodeURIComponent(id)}/audio`}
          className="w-full rounded-[8px] border border-hairline bg-black"
        >
          {transcript ? (
            <track
              default
              kind="subtitles"
              label={transcript.language}
              srcLang={transcript.language}
              src={`/__rec/recordings/${encodeURIComponent(id)}/subtitles.vtt`}
            />
          ) : null}
        </video>
      ) : (
        // biome-ignore lint/a11y/useMediaCaption: the transcript below is the caption
        <audio
          ref={mediaRef}
          controls
          onTimeUpdate={(e) => setCurrentMs(Math.round(e.currentTarget.currentTime * 1000))}
          src={`/__rec/recordings/${encodeURIComponent(id)}/audio`}
          className="w-full rounded-[6px]"
        />
      )}

      <div className="mt-4 flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={transcribe}
          disabled={busy}
          className="flex h-8 items-center gap-1.5 rounded-[6px] bg-primary px-3 font-medium text-[12.5px] text-primary-foreground hover:opacity-90 disabled:opacity-50"
        >
          {busy ? <Loader2 className="size-3.5 animate-spin" /> : <Wand2 className="size-3.5" />}
          {transcript ? t('detail.transcribeAgain') : t('detail.transcribe')}
        </button>

        {/* Playback speed selector */}
        <span className="flex h-8 items-center rounded-[6px] border border-border bg-background p-0.5">
          {PLAYBACK_RATES.map((r) => (
            <button
              key={r}
              type="button"
              onClick={() => changeRate(r)}
              className={cn(
                'rounded-[4px] px-2 py-1 font-mono text-[11.5px] tabular-nums',
                rate === r
                  ? 'bg-muted font-medium text-foreground'
                  : 'text-muted-foreground hover:text-foreground',
              )}
            >
              {r}×
            </button>
          ))}
        </span>

        {/* Bookmark at current playhead */}
        {addingBookmark ? (
          <span className="flex h-8 items-center gap-1 rounded-[6px] border border-border bg-background px-1.5">
            <BookmarkIcon className="size-3.5 text-brand" />
            <span className="folio">{formatDuration(currentMs)}</span>
            <input
              value={bookmarkLabel}
              onChange={(e) => setBookmarkLabel(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'Enter') {
                  e.preventDefault();
                  void addBookmarkAtPlayhead();
                } else if (e.key === 'Escape') {
                  setAddingBookmark(false);
                }
              }}
              placeholder={t('record.markPlaceholder')}
              className="h-6 w-36 bg-transparent px-1 text-[12px] outline-none placeholder:text-muted-foreground/70"
            />
            <button
              type="button"
              onClick={() => void addBookmarkAtPlayhead()}
              className="rounded-[4px] bg-primary px-2 py-0.5 font-medium text-[11px] text-primary-foreground"
            >
              {t('detail.saveNotes')}
            </button>
            <button
              type="button"
              onClick={() => setAddingBookmark(false)}
              className="grid size-5 place-items-center rounded-[4px] text-muted-foreground hover:text-foreground"
            >
              <X className="size-3" />
            </button>
          </span>
        ) : (
          <button
            type="button"
            onClick={() => setAddingBookmark(true)}
            className="flex h-8 items-center gap-1.5 rounded-[6px] border border-border bg-background px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
          >
            <BookmarkIcon className="size-3.5" />
            {t('detail.bookmark')}
          </button>
        )}

        <span className="flex h-8 items-center rounded-[6px] border border-border bg-background p-0.5">
          <Download className="mr-0.5 ml-1.5 size-3.5 shrink-0 text-muted-foreground" />
          {downloads.map((item) => (
            <a
              key={item.kind}
              href={`/__rec/recordings/${encodeURIComponent(id)}/download/${item.kind}`}
              className="rounded-[4px] px-2 py-1 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
            >
              {item.label}
            </a>
          ))}
        </span>

        <button
          type="button"
          onClick={remove}
          className="ml-auto flex h-8 items-center gap-1.5 rounded-[6px] px-2.5 text-[12.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
        >
          <Trash2 className="size-3.5" /> {t('detail.delete')}
        </button>
      </div>

      {error ? <p className="mt-3 text-[12px] text-brand">{error}</p> : null}

      {bookmarks.length > 0 ? (
        <section className="mt-6">
          <p className="eyebrow mb-2.5">
            {t('detail.bookmarks')} · {bookmarks.length}
          </p>
          <div className="flex flex-wrap gap-1.5">
            {bookmarks.map((bm) => (
              <span
                key={bm.id}
                className="group inline-flex items-center gap-1.5 rounded-[6px] border border-hairline bg-card py-1 pr-1.5 pl-2.5 text-[12px]"
              >
                <button
                  type="button"
                  onClick={() => seekTo(bm.atMs)}
                  className="inline-flex items-center gap-1.5 text-left hover:text-brand"
                >
                  <BookmarkIcon className="size-3 text-brand" />
                  <span className="folio text-foreground">{formatDuration(bm.atMs)}</span>
                  <span className="text-muted-foreground">{bm.label}</span>
                </button>
                <button
                  type="button"
                  onClick={() => void removeBookmark(bm.id)}
                  aria-label="Remove bookmark"
                  className="grid size-4 place-items-center rounded-[3px] text-muted-foreground/60 opacity-0 hover:bg-muted hover:text-foreground group-hover:opacity-100"
                >
                  <X className="size-2.5" />
                </button>
              </span>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-9">
        <div className="mb-3 flex items-center justify-between gap-2">
          <p className="eyebrow">{t('detail.notes')}</p>
          <div className="flex items-center gap-1.5">
            {notes && !editingNotes ? (
              <button
                type="button"
                onClick={() => void copyText(notes, 'notes')}
                className="inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copiedNotes ? (
                  <>
                    <Check className="size-3 text-emerald-500" /> {t('detail.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="size-3" /> {t('detail.copy')}
                  </>
                )}
              </button>
            ) : null}
            {!editingNotes ? (
              <button
                type="button"
                onClick={() => {
                  setNotesDraft(notes ?? '');
                  setEditingNotes(true);
                }}
                className="inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {notes ? (
                  <>
                    <Pencil className="size-3" /> {t('detail.editNotes')}
                  </>
                ) : (
                  <>
                    <Plus className="size-3" /> {t('detail.addNotes')}
                  </>
                )}
              </button>
            ) : null}
          </div>
        </div>

        {editingNotes ? (
          <div className="space-y-2">
            <textarea
              rows={6}
              value={notesDraft}
              onChange={(e) => setNotesDraft(e.target.value)}
              placeholder={t('detail.notesPlaceholder')}
              className="w-full rounded-[8px] border border-border bg-card p-3.5 font-sans text-[13px] leading-relaxed outline-none focus-visible:border-foreground/40"
            />
            <div className="flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setEditingNotes(false)}
                className="h-7 rounded-[5px] px-2.5 text-[12px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {t('detail.cancel')}
              </button>
              <button
                type="button"
                onClick={() => void saveNotes()}
                className="h-7 rounded-[5px] bg-primary px-3 font-medium text-[12px] text-primary-foreground hover:opacity-90"
              >
                {t('detail.saveNotes')}
              </button>
            </div>
          </div>
        ) : notes ? (
          <pre className="whitespace-pre-wrap rounded-[8px] border border-hairline bg-card p-4 font-sans text-[13px] leading-relaxed">
            {notes}
          </pre>
        ) : null}
      </section>

      <section className="mt-9">
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <p className="eyebrow">
            {t('detail.transcript')}
            {transcript ? ` · ${transcript.language}` : ''}
          </p>
          {transcript ? (
            <div className="flex items-center gap-2">
              <div className="flex h-6 items-center rounded-[5px] border border-border bg-background p-0.5">
                <button
                  type="button"
                  onClick={() => setLineFilter('all')}
                  className={cn(
                    'rounded-[3px] px-2 py-0.5 text-[11px]',
                    lineFilter === 'all'
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  {t('detail.allLines')} ({transcript.segments.length})
                </button>
                <button
                  type="button"
                  onClick={() => setLineFilter('starred')}
                  className={cn(
                    'inline-flex items-center gap-1 rounded-[3px] px-2 py-0.5 text-[11px]',
                    lineFilter === 'starred'
                      ? 'bg-muted font-medium text-foreground'
                      : 'text-muted-foreground hover:text-foreground',
                  )}
                >
                  <Star className="size-2.5 fill-amber-400 text-amber-400" />
                  {t('detail.starredOnly')} ({starredCount})
                </button>
              </div>
              <button
                type="button"
                onClick={() =>
                  void copyText(
                    transcript.segments
                      .filter((s) => (lineFilter === 'starred' ? s.starred : true))
                      .map(
                        (s) =>
                          `[${formatDuration(s.start)}] ${s.speaker ? `${s.speaker}: ` : ''}${s.text}`,
                      )
                      .join('\n'),
                    'transcript',
                  )
                }
                className="inline-flex h-6 items-center gap-1 rounded-[4px] px-2 text-[11.5px] text-muted-foreground hover:bg-muted hover:text-foreground"
              >
                {copiedTranscript ? (
                  <>
                    <Check className="size-3 text-emerald-500" /> {t('detail.copied')}
                  </>
                ) : (
                  <>
                    <Copy className="size-3" /> {t('detail.copy')}
                  </>
                )}
              </button>
            </div>
          ) : null}
        </div>

        {transcript ? (
          lineFilter === 'starred' && starredCount === 0 ? (
            <p className="rounded-[8px] border border-border border-dashed bg-card/60 px-6 py-10 text-center text-[13px] text-muted-foreground">
              {t('detail.noStarredLines')}
            </p>
          ) : (
            <div className="space-y-1">
              {transcript.segments.map((segment, index) => {
                if (lineFilter === 'starred' && !segment.starred) return null;
                const active = currentMs >= segment.start && currentMs < segment.end;
                return (
                  <TranscriptLine
                    key={`${segment.start}-${segment.end}`}
                    start={segment.start}
                    text={segment.text}
                    speaker={segment.speaker}
                    starred={segment.starred}
                    active={active}
                    onSeek={(ms) => seekTo(ms)}
                    onSave={async (patch) => setTranscript(await api.editSegment(id, index, patch))}
                  />
                );
              })}
            </div>
          )
        ) : (
          <p className="rounded-[8px] border border-border border-dashed bg-card/60 px-6 py-10 text-center text-[13px] text-muted-foreground">
            {t('detail.notTranscribedYet')}
          </p>
        )}
      </section>
    </div>
  );
}
