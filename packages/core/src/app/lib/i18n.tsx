import { createContext, type ReactNode, useCallback, useContext, useMemo, useState } from 'react';
import { ja } from './i18n-ja';
import { ko } from './i18n-ko';
import { zhCN } from './i18n-zh-cn';
import { zhTW } from './i18n-zh-tw';

export type Locale = 'en' | 'zh-TW' | 'zh-CN' | 'ja' | 'ko';

export const LOCALES: Array<{ code: Locale; label: string; short: string }> = [
  { code: 'en', label: 'English', short: 'EN' },
  { code: 'zh-TW', label: '繁體中文', short: '繁' },
  { code: 'zh-CN', label: '简体中文', short: '简' },
  { code: 'ja', label: '日本語', short: '日' },
  { code: 'ko', label: '한국어', short: '한' },
];

export const en = {
  'nav.recordings': 'Recordings',
  'nav.setup': 'Setup',
  'nav.tags': 'Tags',
  'nav.search': 'Search & Commands',
  'nav.language': 'Language',
  'nav.theme': 'Toggle theme',
  'nav.connected': 'connected',
  'nav.offline': 'offline',

  'home.filterAll': 'All',
  'home.filterTranscribed': 'Transcribed',
  'home.filterPending': 'Pending',
  'home.searchPlaceholder': 'Search titles and transcripts',
  'home.clearSearch': 'Clear search',
  'home.showCards': 'Show as cards',
  'home.showTable': 'Show as a table',
  'home.sortNewest': 'Newest',
  'home.sortOldest': 'Oldest',
  'home.sortLongest': 'Longest',
  'home.sortTitle': 'Title',
  'home.fieldRecorded': 'Recorded',
  'home.fieldLength': 'Length',
  'home.fieldTitle': 'Title',
  'home.fieldSize': 'Size',
  'home.import': 'Import',
  'home.importing': 'Importing…',
  'home.dropHint': 'Drop an audio or video file to import it into your studio',
  'home.inTranscripts': 'In transcripts',
  'home.loading': 'Loading',
  'home.noMatches': 'No matches',
  'home.nothingRecorded': 'Nothing recorded yet',
  'home.nothingMatchesQuery': 'Nothing matches “{query}”.',
  'home.emptyHint': 'Press record above, import a file, or ask an agent to start a recording.',
  'home.transcribing': 'Transcribing…',
  'home.notTranscribed': 'Not transcribed yet',
  'home.notesBadge': 'notes',

  'record.sourceMic': 'Microphone',
  'record.sourceTab': 'A browser tab',
  'record.start': 'Start recording',
  'record.stop': 'Stop recording',
  'record.chooseSource': 'Choose what to record',
  'record.input': 'Input',
  'record.paused': 'Paused',
  'record.waitingStudio': 'Waiting for the studio…',
  'record.titlePlaceholder': 'Title (optional)',
  'record.pause': 'Pause',
  'record.resume': 'Resume',
  'record.discard': 'Discard',
  'record.mark': 'Mark',
  'record.markPlaceholder': 'Highlight label…',
  'record.marked': 'Marked at {time}',
  'record.sharingTab': 'Sharing a tab',
  'record.micReady': 'Microphone ready',
  'record.takenWhenRecord': '{source} — taken when you press record',
  'record.studioTabsOpen': '· {count} studio tabs open',
  'record.tabSilentWarning':
    'This tab is shared without audio — reshare it with “Also share tab audio” to get a transcript.',

  'detail.allRecordings': 'All recordings',
  'detail.renameHint': 'Click to rename recording',
  'detail.transcribe': 'Transcribe',
  'detail.transcribeAgain': 'Transcribe again',
  'detail.video': 'Video',
  'detail.audio': 'Audio',
  'detail.markdown': 'Markdown',
  'detail.delete': 'Delete',
  'detail.bookmark': 'Bookmark',
  'detail.bookmarkPrompt': 'Label for this moment:',
  'detail.bookmarks': 'Bookmarks',
  'detail.notes': 'Notes',
  'detail.addNotes': 'Add notes',
  'detail.editNotes': 'Edit',
  'detail.saveNotes': 'Save',
  'detail.cancel': 'Cancel',
  'detail.notesPlaceholder': 'Write meeting summary, decisions, or action items in Markdown…',
  'detail.copy': 'Copy',
  'detail.copied': 'Copied',
  'detail.transcript': 'Transcript',
  'detail.allLines': 'All',
  'detail.starredOnly': 'Starred',
  'detail.notTranscribedYet': 'Not transcribed yet.',
  'detail.noStarredLines': 'No starred lines yet — click ★ beside any line to highlight it.',
  'detail.speakerPlaceholder': 'Speaker',
  'detail.setSpeaker': '+ Speaker',
  'detail.starLine': 'Star this line',
  'detail.seekTo': 'Jump to {time}',
  'detail.clickToCorrect': 'Click to correct this line',

  'setup.title': 'Setup',
  'setup.subtitle': 'Local transcription runs on your machine through ffmpeg and whisper.cpp.',
  'setup.ready': 'Ready — recordings can be transcribed locally.',
  'setup.notReady':
    'Recording works; transcription is unavailable until the missing items below are installed.',
  'setup.recheck': 'Re-check',

  'finder.placeholder': 'Search recordings, transcript lines, tags, or commands…',
  'finder.empty': 'Nothing matches.',
  'finder.kindRecording': 'Recording',
  'finder.kindTranscript': 'Transcript',
  'finder.kindTag': 'Tag',
  'finder.kindAction': 'Action',
  'finder.goRecordings': 'Go to all recordings',
  'finder.goSetup': 'Open Setup & diagnostics',
  'finder.toggleTheme': 'Toggle light / dark theme',
} as const;

export type TranslationKey = keyof typeof en;
export type Dictionary = Record<TranslationKey, string>;

export const DICTIONARIES: Record<Locale, Dictionary> = {
  en,
  'zh-TW': zhTW,
  'zh-CN': zhCN,
  ja,
  ko,
};

const STORAGE_KEY = 'open-recording:locale';

function detectInitialLocale(): Locale {
  if (typeof window === 'undefined') return 'en';
  const stored = window.localStorage.getItem(STORAGE_KEY) as Locale | null;
  if (stored && stored in DICTIONARIES) return stored;
  const nav = window.navigator.language || 'en';
  if (nav.startsWith('zh-TW') || nav.startsWith('zh-HK') || nav.startsWith('zh-Hant')) {
    return 'zh-TW';
  }
  if (nav.startsWith('zh')) return 'zh-CN';
  if (nav.startsWith('ja')) return 'ja';
  if (nav.startsWith('ko')) return 'ko';
  return 'en';
}

type LocaleContextValue = {
  locale: Locale;
  setLocale: (next: Locale) => void;
  t: (key: TranslationKey, vars?: Record<string, string | number>) => string;
};

const LocaleContext = createContext<LocaleContextValue | null>(null);

export function LocaleProvider({ children }: { children: ReactNode }) {
  const [locale, setLocaleState] = useState<Locale>(detectInitialLocale);

  const setLocale = useCallback((next: Locale) => {
    setLocaleState(next);
    try {
      window.localStorage.setItem(STORAGE_KEY, next);
    } catch {
      // Ignore storage errors
    }
  }, []);

  const t = useCallback(
    (key: TranslationKey, vars?: Record<string, string | number>): string => {
      const dict = DICTIONARIES[locale] ?? en;
      let raw = dict[key] ?? en[key] ?? key;
      if (vars) {
        for (const [k, v] of Object.entries(vars)) {
          raw = raw.replaceAll(`{${k}}`, String(v));
        }
      }
      return raw;
    },
    [locale],
  );

  const value = useMemo(() => ({ locale, setLocale, t }), [locale, setLocale, t]);
  return <LocaleContext.Provider value={value}>{children}</LocaleContext.Provider>;
}

export function useLocale() {
  const ctx = useContext(LocaleContext);
  if (!ctx) throw new Error('useLocale must be used within LocaleProvider');
  return ctx;
}

export function useT() {
  return useLocale().t;
}
