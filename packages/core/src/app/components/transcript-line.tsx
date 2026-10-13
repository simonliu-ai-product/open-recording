import { Star } from 'lucide-react';
import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { formatDuration, type SegmentPatch } from '../lib/api';
import { useT } from '../lib/i18n';
import { cn } from '../lib/utils';

type Props = {
  start: number;
  text: string;
  speaker?: string;
  starred?: boolean;
  active?: boolean;
  onSeek?: (ms: number) => void;
  onSave: (patch: SegmentPatch) => Promise<unknown>;
};

/**
 * One line of the transcript, correctable in place, with clickable timestamp
 * seek, speaker badge, and star toggle.
 */
export function TranscriptLine({ start, text, speaker, starred, active, onSeek, onSave }: Props) {
  const t = useT();
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [editingSpeaker, setEditingSpeaker] = useState(false);
  const [speakerDraft, setSpeakerDraft] = useState(speaker ?? '');
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);
  const speakerField = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [editing, text]);

  useEffect(() => {
    if (!editingSpeaker) setSpeakerDraft(speaker ?? '');
  }, [editingSpeaker, speaker]);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  useEffect(() => {
    if (editingSpeaker) speakerField.current?.focus();
  }, [editingSpeaker]);

  const saveText = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === text) return;
    setBusy(true);
    try {
      await onSave({ text: next });
    } finally {
      setBusy(false);
    }
  };

  const saveSpeaker = async () => {
    const next = speakerDraft.trim();
    setEditingSpeaker(false);
    if (next === (speaker ?? '')) return;
    setBusy(true);
    try {
      await onSave({ speaker: next || null });
    } finally {
      setBusy(false);
    }
  };

  const toggleStar = async () => {
    setBusy(true);
    try {
      await onSave({ starred: !starred });
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void saveText();
    }
    if (event.key === 'Escape') {
      setDraft(text);
      setEditing(false);
    }
  };

  const timeStr = formatDuration(start);

  return (
    <div
      className={cn(
        'group relative flex items-start gap-2.5 rounded-[6px] px-2 py-1 text-[14px] leading-relaxed transition-colors',
        active && 'bg-brand-soft/60',
      )}
    >
      {active ? (
        <span className="-translate-y-1/2 absolute top-1/2 left-0 h-5 w-[3px] rounded-r-full bg-brand" />
      ) : null}

      <button
        type="button"
        onClick={() => onSeek?.(start)}
        title={t('detail.seekTo', { time: timeStr })}
        className={cn(
          'folio shrink-0 rounded-[4px] px-1 pt-1 hover:bg-muted hover:text-foreground',
          active && 'font-medium text-brand',
        )}
      >
        {timeStr}
      </button>

      {editingSpeaker ? (
        <input
          ref={speakerField}
          value={speakerDraft}
          onChange={(e) => setSpeakerDraft(e.target.value)}
          onBlur={saveSpeaker}
          onKeyDown={(e) => {
            if (e.key === 'Enter') {
              e.preventDefault();
              void saveSpeaker();
            }
            if (e.key === 'Escape') {
              setSpeakerDraft(speaker ?? '');
              setEditingSpeaker(false);
            }
          }}
          placeholder={t('detail.speakerPlaceholder')}
          className="mt-0.5 h-6 w-24 shrink-0 rounded-[4px] border border-foreground/30 bg-background px-1.5 text-[11.5px] outline-none"
        />
      ) : speaker ? (
        <button
          type="button"
          onClick={() => setEditingSpeaker(true)}
          className="mt-1 shrink-0 rounded-[4px] bg-muted px-1.5 py-0.5 font-medium text-[11px] text-foreground/85 hover:bg-muted/80"
        >
          {speaker}
        </button>
      ) : (
        <button
          type="button"
          onClick={() => setEditingSpeaker(true)}
          className="mt-1 hidden shrink-0 rounded-[4px] px-1.5 py-0.5 folio text-[10.5px] hover:bg-muted group-hover:inline-block"
        >
          {t('detail.setSpeaker')}
        </button>
      )}

      {editing ? (
        <textarea
          ref={field}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={saveText}
          rows={Math.max(1, Math.ceil(draft.length / 60))}
          className="flex-1 resize-none rounded-[4px] border border-foreground/30 bg-background px-1.5 py-0.5 text-[14px] leading-relaxed outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          className="flex-1 rounded-[4px] px-1.5 py-0.5 text-left hover:bg-muted/70 disabled:opacity-50"
          title={t('detail.clickToCorrect')}
        >
          {text}
        </button>
      )}

      <button
        type="button"
        disabled={busy}
        onClick={toggleStar}
        aria-label={t('detail.starLine')}
        aria-pressed={Boolean(starred)}
        className={cn(
          'mt-1 grid size-6 shrink-0 place-items-center rounded-[4px] hover:bg-muted',
          starred
            ? 'text-brand opacity-100'
            : 'text-muted-foreground opacity-0 group-hover:opacity-100',
        )}
      >
        <Star className={cn('size-3.5', starred && 'fill-current')} />
      </button>
    </div>
  );
}
