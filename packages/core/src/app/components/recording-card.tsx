import { FileText, StickyNote } from 'lucide-react';
import { Link } from 'react-router-dom';
import { formatDuration, type RecordingSummary } from '../lib/api';

/**
 * The tile shows the opening words of the transcript rather than a waveform:
 * it is the only thing on a recording that tells you what it was, and a drawn
 * waveform would be decoration standing in for content.
 */
export function RecordingCard({ recording }: { recording: RecordingSummary }) {
  return (
    <li>
      <Link to={`/r/${encodeURIComponent(recording.id)}`} className="group block">
        <div className="relative flex aspect-video flex-col overflow-hidden rounded-[6px] border border-hairline bg-card p-4 shadow-edge ring-1 ring-foreground/[0.04] group-hover:shadow-floating group-hover:ring-foreground/20 motion-safe:transition-[box-shadow,--tw-ring-color] motion-safe:duration-200">
          <div className="flex items-center gap-2">
            <span className="folio">{formatDuration(recording.durationMs)}</span>
            {recording.source === 'agent' ? (
              <span className="rounded-[3px] bg-brand-soft px-1.5 py-0.5 font-medium text-[10px] text-brand">
                agent
              </span>
            ) : null}
            {recording.status === 'failed' ? (
              <span className="rounded-[3px] bg-muted px-1.5 py-0.5 font-medium text-[10px] text-muted-foreground">
                failed
              </span>
            ) : null}
            <span className="ml-auto flex items-center gap-1.5 text-muted-foreground">
              {recording.hasNotes ? <StickyNote className="size-3.5" /> : null}
              {recording.transcribed ? <FileText className="size-3.5" /> : null}
            </span>
          </div>

          {recording.preview ? (
            <p className="mt-3 line-clamp-4 text-[12.5px] text-muted-foreground leading-relaxed">
              {recording.preview}
            </p>
          ) : (
            <p className="mt-3 text-[12.5px] text-muted-foreground/60 italic">Not transcribed</p>
          )}

          {recording.tags.length > 0 ? (
            <div className="mt-auto flex flex-wrap gap-1 pt-3">
              {recording.tags.map((tag) => (
                <span key={tag} className="folio rounded-[3px] bg-muted px-1.5 py-0.5">
                  {tag}
                </span>
              ))}
            </div>
          ) : null}
        </div>

        <p className="mt-2.5 truncate font-medium text-[13.5px] tracking-tight">
          {recording.title}
        </p>
        <p className="folio mt-0.5">{new Date(recording.createdAt).toLocaleString()}</p>
      </Link>
    </li>
  );
}
