import { type KeyboardEvent, useEffect, useRef, useState } from 'react';
import { formatDuration } from '../lib/api';

type Props = {
  start: number;
  text: string;
  onSave: (text: string) => Promise<unknown>;
};

/**
 * One line of the transcript, correctable in place. Whisper mishears names and
 * jargon — every model does — and a subtitle carrying the wrong name is not
 * usable, so fixing it must not mean transcribing the whole thing again.
 */
export function TranscriptLine({ start, text, onSave }: Props) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(text);
  const [busy, setBusy] = useState(false);
  const field = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    if (!editing) setDraft(text);
  }, [editing, text]);

  useEffect(() => {
    if (editing) field.current?.focus();
  }, [editing]);

  const save = async () => {
    const next = draft.trim();
    setEditing(false);
    if (!next || next === text) return;
    setBusy(true);
    try {
      await onSave(next);
    } finally {
      setBusy(false);
    }
  };

  const onKeyDown = (event: KeyboardEvent<HTMLTextAreaElement>) => {
    if (event.key === 'Enter' && !event.shiftKey) {
      event.preventDefault();
      void save();
    }
    if (event.key === 'Escape') {
      setDraft(text);
      setEditing(false);
    }
  };

  return (
    <p className="flex gap-3 text-[14px] leading-relaxed">
      <span className="folio shrink-0 pt-1">{formatDuration(start)}</span>
      {editing ? (
        <textarea
          ref={field}
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onKeyDown={onKeyDown}
          onBlur={save}
          rows={Math.max(1, Math.ceil(draft.length / 60))}
          className="flex-1 resize-none rounded-[4px] border border-foreground/30 bg-background px-1.5 py-0.5 text-[14px] leading-relaxed outline-none"
        />
      ) : (
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          className="flex-1 rounded-[4px] px-1.5 py-0.5 text-left hover:bg-muted/70 disabled:opacity-50"
          title="Click to correct this line"
        >
          {text}
        </button>
      )}
    </p>
  );
}
