import { Languages } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { LOCALES, useLocale, useT } from '../lib/i18n';
import { cn } from '../lib/utils';

export function LanguageMenu() {
  const { locale, setLocale } = useLocale();
  const t = useT();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: PointerEvent) => {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    document.addEventListener('pointerdown', onDown);
    document.addEventListener('keydown', onKey);
    return () => {
      document.removeEventListener('pointerdown', onDown);
      document.removeEventListener('keydown', onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className="grid size-7 place-items-center rounded-[6px] text-muted-foreground hover:bg-sidebar-accent hover:text-foreground"
        aria-label={t('nav.language')}
        aria-expanded={open}
        title={t('nav.language')}
      >
        <Languages className="size-4" />
      </button>
      {open ? (
        <div className="absolute top-8 right-0 z-30 min-w-[160px] rounded-[8px] border border-border bg-card p-1 shadow-floating">
          {LOCALES.map((item) => (
            <button
              key={item.code}
              type="button"
              onClick={() => {
                setLocale(item.code);
                setOpen(false);
              }}
              className={cn(
                'flex w-full items-center gap-2 rounded-[5px] px-2.5 py-1.5 text-left text-[12.5px] hover:bg-muted',
                locale === item.code && 'bg-muted font-medium',
              )}
            >
              <span className="folio w-4 shrink-0">{item.short}</span>
              <span className="flex-1 whitespace-nowrap">{item.label}</span>
              {locale === item.code ? <span className="folio">✓</span> : null}
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
