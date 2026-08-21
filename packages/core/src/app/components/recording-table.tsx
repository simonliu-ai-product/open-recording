import { ChevronDown, ChevronUp, FileText, Mic, Monitor, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatBytes, formatDuration, type RecordingSummary } from '../lib/api';
import { cn } from '../lib/utils';
import type { Sort, SortField } from '../routes/home';

type Props = {
  recordings: RecordingSummary[];
  sort: Sort;
  onSort: (field: SortField) => void;
};

/** A sortable column heading, carrying the state a screen reader needs too. */
function Column({
  field,
  label,
  sort,
  onSort,
  align = 'left',
}: {
  field: SortField;
  label: string;
  sort: Sort;
  onSort: (field: SortField) => void;
  align?: 'left' | 'right';
}) {
  const active = sort.field === field;
  return (
    <th
      className={cn('px-3 py-2.5', align === 'right' && 'text-right')}
      aria-sort={active ? (sort.desc ? 'descending' : 'ascending') : 'none'}
    >
      <button
        type="button"
        onClick={() => onSort(field)}
        className={cn(
          'eyebrow inline-flex items-center gap-1 font-medium hover:text-foreground',
          active && 'text-foreground',
          align === 'right' && 'flex-row-reverse',
        )}
      >
        {label}
        {active ? (
          sort.desc ? (
            <ChevronDown className="size-3" />
          ) : (
            <ChevronUp className="size-3" />
          )
        ) : null}
      </button>
    </th>
  );
}

/**
 * The same recordings as the grid, read down a column instead of across a
 * page. A grid is for recognising one recording; a table is for comparing many
 * — which was recorded, how long, whether it has a transcript yet.
 */
export function RecordingTable({ recordings, sort, onSort }: Props) {
  return (
    <div className="overflow-x-auto rounded-[8px] border border-hairline bg-card">
      <table className="w-full min-w-[720px] border-collapse text-left">
        <thead>
          <tr className="border-hairline border-b">
            <Column field="title" label="Title" sort={sort} onSort={onSort} />
            <Column field="recorded" label="Recorded" sort={sort} onSort={onSort} />
            <Column field="length" label="Length" sort={sort} onSort={onSort} align="right" />
            <Column field="size" label="Size" sort={sort} onSort={onSort} align="right" />
            <th className="eyebrow px-3 py-2.5 font-medium">Tags</th>
            <th className="eyebrow px-4 py-2.5 text-right font-medium">Transcript</th>
          </tr>
        </thead>
        <tbody>
          {recordings.map((recording) => (
            <tr
              key={recording.id}
              className="border-hairline border-b last:border-b-0 hover:bg-muted/50"
            >
              <td className="px-3 py-2.5">
                <Link
                  to={`/r/${encodeURIComponent(recording.id)}`}
                  className="flex items-center gap-2 text-[13px]"
                >
                  {recording.kind === 'screen' ? (
                    <Monitor className="size-3.5 shrink-0 text-muted-foreground" />
                  ) : (
                    <Mic className="size-3.5 shrink-0 text-muted-foreground" />
                  )}
                  <span className="truncate">{recording.title}</span>
                  {recording.source === 'agent' ? <span className="folio">agent</span> : null}
                  {recording.status === 'failed' ? (
                    <span className="folio text-brand">failed</span>
                  ) : null}
                </Link>
              </td>
              <td className="folio whitespace-nowrap px-3 py-2.5">
                {new Date(recording.createdAt).toLocaleString()}
              </td>
              <td className="folio px-3 py-2.5 text-right">
                {formatDuration(recording.durationMs)}
              </td>
              <td className="folio px-3 py-2.5 text-right">{formatBytes(recording.sizeBytes)}</td>
              <td className="px-3 py-2.5">
                <span className="flex flex-wrap gap-1">
                  {recording.tags.map((tag) => (
                    <span key={tag} className="folio rounded-[3px] bg-muted px-1.5 py-0.5">
                      {tag}
                    </span>
                  ))}
                </span>
              </td>
              <td className="px-4 py-2.5">
                <span className="flex items-center justify-end gap-2 text-muted-foreground">
                  {recording.hasNotes ? <StickyNote className="size-3.5" /> : null}
                  {recording.transcribed ? (
                    <FileText className="size-3.5" />
                  ) : (
                    <span className="folio">—</span>
                  )}
                </span>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}
