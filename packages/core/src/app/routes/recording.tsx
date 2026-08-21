import { ArrowLeft, Download, Loader2, Trash2, Wand2 } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { Link, useNavigate, useOutletContext, useParams } from 'react-router-dom';
import { TagEditor } from '../components/tag-editor';
import { TranscriptLine } from '../components/transcript-line';
import { api, formatBytes, formatDuration, type RecordingMeta, type Transcript } from '../lib/api';
import type { ShellContext } from './shell';

export function RecordingPage() {
  const { id = '' } = useParams();
  const navigate = useNavigate();
  const { refresh } = useOutletContext<ShellContext>();
  const [meta, setMeta] = useState<RecordingMeta | null>(null);
  const [transcript, setTranscript] = useState<Transcript | null>(null);
  const [notes, setNotes] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(() => {
    void api
      .readRecording(id)
      .then(setMeta)
      .catch((err: Error) => setError(err.message));
    void api
      .readTranscript(id)
      .then(setTranscript)
      .catch(() => setTranscript(null));
    void api
      .readNotes(id)
      .then((r) => setNotes(r.text))
      .catch(() => setNotes(null));
  }, [id]);

  useEffect(load, [load]);

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

  const downloads = [
    { kind: 'media', label: meta?.kind === 'screen' ? 'Video' : 'Audio' },
    ...(transcript
      ? [
          { kind: 'srt', label: 'SRT' },
          { kind: 'vtt', label: 'VTT' },
          { kind: 'transcript', label: 'Markdown' },
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
            <Loader2 className="size-4 animate-spin" /> Loading
          </>
        )}
      </p>
    );
  }

  return (
    <div className="mx-auto max-w-[760px]">
      <Link
        to="/"
        className="mb-6 inline-flex items-center gap-1.5 text-[12px] text-muted-foreground hover:text-foreground"
      >
        <ArrowLeft className="size-3.5" /> All recordings
      </Link>

      <header className="mb-6">
        <h1 className="font-semibold text-[28px] leading-[1.1] tracking-[-0.025em]">
          {meta.title}
        </h1>
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
          controls
          src={`/__rec/recordings/${encodeURIComponent(id)}/audio`}
          className="w-full rounded-[8px] border border-hairline bg-black"
        >
          {/* The cues the transcription wrote, so the recording plays subtitled. */}
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
          controls
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
          {transcript ? 'Transcribe again' : 'Transcribe'}
        </button>
        {/* One control with parts, the way the filters and the view toggle
            are — four bare links beside a solid button read as a jumble. */}
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
          <Trash2 className="size-3.5" /> Delete
        </button>
      </div>

      {error ? <p className="mt-3 text-[12px] text-brand">{error}</p> : null}

      {notes ? (
        <section className="mt-9">
          <p className="eyebrow mb-3">Notes</p>
          <pre className="whitespace-pre-wrap rounded-[8px] border border-hairline bg-card p-4 font-sans text-[13px] leading-relaxed">
            {notes}
          </pre>
        </section>
      ) : null}

      <section className="mt-9">
        <p className="eyebrow mb-3">Transcript{transcript ? ` · ${transcript.language}` : ''}</p>
        {transcript ? (
          <div className="space-y-1">
            {transcript.segments.map((segment, index) => (
              <TranscriptLine
                key={`${segment.start}-${segment.end}`}
                start={segment.start}
                text={segment.text}
                onSave={async (text) => setTranscript(await api.editSegment(id, index, text))}
              />
            ))}
          </div>
        ) : (
          <p className="rounded-[8px] border border-border border-dashed bg-card/60 px-6 py-10 text-center text-[13px] text-muted-foreground">
            Not transcribed yet.
          </p>
        )}
      </section>
    </div>
  );
}
