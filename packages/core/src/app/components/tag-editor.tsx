import { X } from 'lucide-react';
import { type KeyboardEvent, useState } from 'react';

type Props = {
  tags: string[];
  onChange: (tags: string[]) => Promise<unknown>;
};

/**
 * Tags could only be set by an agent — `start_recording` or `tag_recording` —
 * which left the sidebar's tag list unbuildable by the person looking at it.
 * The whole list is written on every change because that is what the ops layer
 * takes: tags are a set, not a log.
 */
export function TagEditor({ tags, onChange }: Props) {
  const [draft, setDraft] = useState('');
  const [busy, setBusy] = useState(false);

  const commit = async (next: string[]) => {
    setBusy(true);
    try {
      await onChange(next);
    } finally {
      setBusy(false);
    }
  };

  const add = async () => {
    const tag = draft.trim();
    setDraft('');
    if (!tag || tags.includes(tag)) return;
    await commit([...tags, tag]);
  };

  const onKeyDown = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      void add();
    }
    // Backspace on an empty box takes the last one off, the way tag inputs do.
    if (event.key === 'Backspace' && draft === '' && tags.length > 0) {
      void commit(tags.slice(0, -1));
    }
  };

  return (
    <div className="flex flex-wrap items-center gap-1.5">
      {tags.map((tag) => (
        <span
          key={tag}
          className="folio flex items-center gap-1 rounded-[3px] bg-muted py-0.5 pr-1 pl-1.5"
        >
          {tag}
          <button
            type="button"
            disabled={busy}
            onClick={() => commit(tags.filter((t) => t !== tag))}
            aria-label={`Remove tag ${tag}`}
            className="grid size-3.5 place-items-center rounded-[2px] hover:bg-foreground/10"
          >
            <X className="size-2.5" />
          </button>
        </span>
      ))}
      <input
        value={draft}
        disabled={busy}
        onChange={(e) => setDraft(e.target.value)}
        onKeyDown={onKeyDown}
        onBlur={() => void add()}
        placeholder={tags.length === 0 ? 'Add a tag' : 'Add'}
        aria-label="Add a tag"
        className="h-6 w-24 rounded-[4px] border border-border bg-background px-1.5 text-[11.5px] outline-none placeholder:text-muted-foreground/70 focus-visible:border-foreground/40"
      />
    </div>
  );
}
