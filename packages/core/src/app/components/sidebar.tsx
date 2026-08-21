import config from 'virtual:open-recording/config';
import { Moon, Sun } from 'lucide-react';
import { useTheme } from 'next-themes';
import type { StudioState } from '../lib/studio';
import { cn } from '../lib/utils';

export const ALL_ID = '__all__';
export const SETUP_ID = '__setup__';

type NavRowProps = {
  icon: string;
  label: string;
  count?: number;
  selected: boolean;
  onSelect: () => void;
};

function NavRow({ icon, label, count, selected, onSelect }: NavRowProps) {
  return (
    <button
      type="button"
      onClick={onSelect}
      className={cn(
        'relative flex w-full items-center gap-2 rounded-[6px] py-1.5 pr-2 pl-2.5 text-left text-[13px]',
        selected
          ? 'bg-sidebar-accent font-medium text-sidebar-foreground'
          : 'text-sidebar-foreground/75 hover:bg-sidebar-accent/60',
      )}
    >
      {selected ? (
        <span className="-translate-y-1/2 absolute top-1/2 left-0 h-4 w-[3px] rounded-r-full bg-brand" />
      ) : null}
      <span className="grid size-5 shrink-0 place-items-center text-[13px]">{icon}</span>
      <span className="min-w-0 flex-1 truncate">{label}</span>
      {count === undefined ? null : (
        <span className="folio">{count.toString().padStart(2, '0')}</span>
      )}
    </button>
  );
}

type Props = {
  count: number;
  tags: Array<{ name: string; count: number }>;
  selectedId: string;
  onSelect: (id: string) => void;
  state: StudioState;
};

export function Sidebar({ count, tags, selectedId, onSelect, state }: Props) {
  const { resolvedTheme, setTheme } = useTheme();

  return (
    <aside className="flex h-dvh w-[248px] shrink-0 flex-col border-sidebar-border border-r bg-sidebar">
      <div className="flex items-center justify-between px-4 pt-4 pb-3">
        <span className="font-semibold text-[15px] tracking-tight">open-recording</span>
        <button
          type="button"
          onClick={() => setTheme(resolvedTheme === 'dark' ? 'light' : 'dark')}
          className="grid size-7 place-items-center rounded-[6px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
          aria-label="Toggle theme"
        >
          {resolvedTheme === 'dark' ? <Sun className="size-4" /> : <Moon className="size-4" />}
        </button>
      </div>

      <nav className="space-y-0.5 px-2">
        <NavRow
          icon="🎙️"
          label="Recordings"
          count={count}
          selected={selectedId === ALL_ID}
          onSelect={() => onSelect(ALL_ID)}
        />
        <NavRow
          icon="⚙️"
          label="Setup"
          selected={selectedId === SETUP_ID}
          onSelect={() => onSelect(SETUP_ID)}
        />
      </nav>

      {tags.length > 0 ? (
        <>
          <p className="eyebrow mt-6 mb-2 px-4">Tags</p>
          <nav className="space-y-0.5 overflow-y-auto px-2">
            {tags.map((tag) => (
              <NavRow
                key={tag.name}
                icon="🏷️"
                label={tag.name}
                count={tag.count}
                selected={selectedId === tag.name}
                onSelect={() => onSelect(tag.name)}
              />
            ))}
          </nav>
        </>
      ) : null}

      <div className="mt-auto border-sidebar-border border-t px-4 py-3">
        <div className="mt-2 flex items-center justify-between px-2">
          <span className="folio">v{config.version}</span>
          <span className="flex items-center gap-1.5 folio">
            <span
              className={cn(
                'size-1.5 rounded-full',
                state.connected ? 'bg-emerald-500' : 'bg-muted-foreground',
              )}
            />
            {state.connected ? 'connected' : 'offline'}
          </span>
        </div>
      </div>
    </aside>
  );
}
