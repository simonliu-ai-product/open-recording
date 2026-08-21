import { useCallback, useEffect, useMemo, useState, useSyncExternalStore } from 'react';
import { Outlet, useLocation, useNavigate, useSearchParams } from 'react-router-dom';
import { ALL_ID, SETUP_ID, Sidebar } from '../components/sidebar';
import { api, type RecordingSummary } from '../lib/api';
import { studio } from '../lib/studio';

export function useStudioState() {
  return useSyncExternalStore(studio.subscribe, studio.getSnapshot, studio.getSnapshot);
}

export type ShellContext = {
  recordings: RecordingSummary[] | null;
  refresh: () => void;
  selectedId: string;
};

function pathToSelectedId(pathname: string, search: URLSearchParams): string {
  if (pathname === '/setup') return SETUP_ID;
  return search.get('v') ?? ALL_ID;
}

export function Shell() {
  const state = useStudioState();
  const navigate = useNavigate();
  const location = useLocation();
  const [searchParams] = useSearchParams();
  const [recordings, setRecordings] = useState<RecordingSummary[] | null>(null);

  const selectedId = pathToSelectedId(location.pathname, searchParams);

  const refresh = useCallback(() => {
    void api
      .listRecordings()
      .then(setRecordings)
      .catch(() => setRecordings([]));
  }, []);

  // An agent can start or stop a session at any moment, so the list follows the
  // recorder rather than a poll. `arming` is skipped: nothing is on disk yet.
  useEffect(() => {
    if (state.recorder.status !== 'arming') refresh();
  }, [refresh, state.recorder.status]);

  useEffect(() => {
    document.title =
      state.recorder.status === 'recording' ? '● Recording — open-recording' : 'open-recording';
  }, [state.recorder.status]);

  const tags = useMemo(() => {
    const counter = new Map<string, number>();
    for (const recording of recordings ?? []) {
      for (const tag of recording.tags) counter.set(tag, (counter.get(tag) ?? 0) + 1);
    }
    return [...counter]
      .map(([name, count]) => ({ name, count }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }, [recordings]);

  const select = useCallback(
    (id: string) => {
      if (id === SETUP_ID) navigate('/setup', { replace: true });
      else if (id === ALL_ID) navigate('/', { replace: true });
      else navigate(`/?v=${encodeURIComponent(id)}`, { replace: true });
    },
    [navigate],
  );

  const context: ShellContext = { recordings, refresh, selectedId };

  return (
    <div className="flex h-dvh overflow-hidden bg-background text-foreground">
      <div className="hidden md:block">
        <Sidebar
          count={recordings?.length ?? 0}
          tags={tags}
          selectedId={selectedId}
          onSelect={select}
          state={state}
        />
      </div>

      <div className="relative flex min-w-0 flex-1 flex-col overflow-y-auto bg-canvas">
        <div className="mx-auto w-full max-w-[1180px] px-5 py-8 md:px-10 md:py-12">
          <Outlet context={context} />
        </div>
      </div>
    </div>
  );
}
