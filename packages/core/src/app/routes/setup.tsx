import { Check, Loader2, X } from 'lucide-react';
import { useEffect, useState } from 'react';
import { api, type WhisperEnvironment } from '../lib/api';

const MODEL_URL =
  'https://huggingface.co/ggerganov/whisper.cpp/resolve/main/ggml-large-v3-turbo.bin';

function Row({ label, value, hint }: { label: string; value: string | null; hint: string }) {
  return (
    <li className="flex gap-3 px-4 py-3">
      <span className="pt-0.5">
        {value ? (
          <Check className="size-4 text-emerald-500" />
        ) : (
          <X className="size-4 text-brand" />
        )}
      </span>
      <span className="min-w-0 flex-1">
        <span className="block font-medium text-[13px]">{label}</span>
        <span className="mt-0.5 block break-all font-mono text-[11.5px] text-muted-foreground">
          {value ?? hint}
        </span>
      </span>
    </li>
  );
}

/** The browser half of `open-recording doctor` — same checks, same fixes. */
export function SetupPage() {
  const [env, setEnv] = useState<WhisperEnvironment | null>(null);

  useEffect(() => {
    void api
      .environment()
      .then(setEnv)
      .catch(() => setEnv(null));
  }, []);

  if (!env) {
    return (
      <p className="flex items-center gap-2 text-[13px] text-muted-foreground">
        <Loader2 className="size-4 animate-spin" /> Loading
      </p>
    );
  }

  const ready =
    Boolean(env.bin && env.model && env.ffmpeg) && (env.script === 'as-is' || env.scriptConverter);

  return (
    <div className="mx-auto max-w-[760px]">
      <header className="mb-8">
        <div className="flex flex-wrap items-center gap-3">
          <span className="grid size-7 place-items-center text-2xl">⚙️</span>
          <h1 className="font-semibold text-[32px] leading-[1.05] tracking-[-0.025em]">Setup</h1>
        </div>
        <p className="mt-3 text-[13px] text-muted-foreground">
          Recording works without any of this. Transcription is refused until all three resolve.
        </p>
      </header>

      <ul className="divide-y divide-hairline overflow-hidden rounded-[8px] border border-hairline bg-card">
        <Row label="ffmpeg" value={env.ffmpeg} hint="not found — brew install ffmpeg" />
        <Row label="whisper.cpp" value={env.bin} hint="not found — brew install whisper-cpp" />
        <Row
          label="Model"
          value={env.model}
          hint={`no ggml model found in ${env.modelSearchDirs[0]}`}
        />
        {env.script === 'as-is' ? null : (
          <Row
            label={`Script — ${env.script}`}
            value={env.scriptConverter ? 'opencc-js' : null}
            hint="not installed — pnpm add -D opencc-js"
          />
        )}
      </ul>

      {ready ? (
        <p className="mt-4 text-[13px] text-muted-foreground">
          Ready — recordings can be transcribed locally.
        </p>
      ) : (
        <section className="mt-6">
          <p className="eyebrow mb-3">Fix it</p>
          <pre className="overflow-x-auto rounded-[8px] border border-hairline bg-card p-4 font-mono text-[11.5px] leading-relaxed">
            {`brew install whisper-cpp ffmpeg\nmkdir -p ${env.modelSearchDirs[0]}\ncurl -L -o ${env.modelSearchDirs[0]}/ggml-large-v3-turbo.bin \\\n  ${MODEL_URL}`}
          </pre>
        </section>
      )}

      <section className="mt-9">
        <p className="eyebrow mb-3">Model search path</p>
        <ul className="space-y-1">
          {env.modelSearchDirs.map((dir) => (
            <li key={dir} className="break-all font-mono text-[11.5px] text-muted-foreground">
              {dir}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
