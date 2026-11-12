import { useRef, useState } from "react";
import { FilePlus2, FolderOpen, History, LoaderCircle, Hexagon, Trash2 } from "lucide-react";

interface Props {
  onOpenFile: (file: File) => Promise<void>;
  onCreate: () => void;
  onRestore: () => void;
  onDiscardAutosave: () => void;
  autosaveInfo: { name: string; savedAt: string } | null;
  error: string | null;
}

export function Home({
  onOpenFile,
  onCreate,
  onRestore,
  onDiscardAutosave,
  autosaveInfo,
  error,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [dragOver, setDragOver] = useState(false);
  const [busy, setBusy] = useState(false);

  const handleFiles = async (files: FileList | null) => {
    const f = files?.[0];
    if (!f) return;
    setBusy(true);
    try {
      await onOpenFile(f);
    } finally {
      setBusy(false);
    }
  };

  return (
    <div
      className="ws-backdrop relative flex h-full flex-col items-center justify-center overflow-hidden"
      onDragOver={(e) => {
        e.preventDefault();
        setDragOver(true);
      }}
      onDragLeave={() => setDragOver(false)}
      onDrop={(e) => {
        e.preventDefault();
        setDragOver(false);
        void handleFiles(e.dataTransfer.files);
      }}
    >
      <div className="ws-grid pointer-events-none absolute inset-0" />

      <div
        className={`pointer-events-none absolute inset-0 z-20 flex items-center justify-center bg-carbon-950/80 backdrop-blur-sm transition-opacity ${
          dragOver ? "opacity-100" : "opacity-0"
        }`}
      >
        <div className="rounded-2xl border-2 border-dashed border-acid-400 px-10 py-8 text-center">
          <p className="font-mono text-sm uppercase tracking-[0.2em] text-acid-300">
            solte o arquivo .ordo
          </p>
        </div>
      </div>

      {/* brand */}
      <div
        className="anim-fade-up relative z-10 mb-12 flex flex-col items-center text-center"
        style={{ animationDelay: "0.05s" }}
      >
        <span className="relative mb-7 flex h-12 w-12 items-center justify-center">
          <Hexagon size={48} strokeWidth={1.2} className="absolute text-acid-400" />
          <span className="font-display text-lg font-bold text-acid-400">M</span>
        </span>
        <h1 className="font-display text-[clamp(2.5rem,8vw,6.5rem)] font-bold leading-[0.9] tracking-[-0.045em] text-white">
          MANTIQUARIUS<span className="text-acid-400">.</span>
        </h1>
      </div>

      {/* actions */}
      <div
        className="anim-fade-up relative z-10 grid w-full max-w-xl grid-cols-1 gap-3 px-6 sm:grid-cols-2"
        style={{ animationDelay: "0.15s" }}
      >
        <button
          onClick={() => inputRef.current?.click()}
          className="group relative flex flex-col items-start gap-6 overflow-hidden rounded-2xl border border-dashed border-carbon-500 bg-carbon-900/60 p-6 text-left transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.985]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
            {busy ? (
              <LoaderCircle size={18} className="anim-spin-slow" />
            ) : (
              <FolderOpen size={18} strokeWidth={1.8} />
            )}
          </span>
          <span>
            <span className="block font-display text-base font-semibold text-white">abrir arquivo</span>
            <span className="mt-1 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-carbon-400">
              arraste ou clique · .ordo
            </span>
          </span>
        </button>

        <button
          onClick={onCreate}
          className="group relative flex flex-col items-start gap-6 overflow-hidden rounded-2xl border border-acid-500/40 bg-acid-400/[0.07] p-6 text-left transition-all hover:border-acid-400 hover:bg-acid-400/[0.12] active:scale-[0.985]"
        >
          <span className="flex h-10 w-10 items-center justify-center rounded-xl bg-acid-400 text-carbon-950 shadow-[0_0_24px_rgba(212,247,76,0.35)] transition-transform group-hover:scale-105">
            <FilePlus2 size={18} strokeWidth={2} />
          </span>
          <span>
            <span className="block font-display text-base font-semibold text-white">criar novo arquivo</span>
            <span className="mt-1 block font-mono text-[10.5px] uppercase tracking-[0.16em] text-acid-300/80">
              sessão em branco
            </span>
          </span>
        </button>
      </div>

      {autosaveInfo && (
        <div
          className="anim-fade-up relative z-10 mt-4 w-full max-w-xl px-6"
          style={{ animationDelay: "0.25s" }}
        >
          <div className="flex items-center gap-3 rounded-xl border border-carbon-700 bg-carbon-900/70 py-2.5 pl-4 pr-2.5">
            <History size={14} className="shrink-0 text-carbon-400" />
            <p className="min-w-0 flex-1 truncate text-[12.5px] text-carbon-300">
              última sessão: <span className="font-medium text-carbon-100">{autosaveInfo.name}</span>
              <span className="ml-2 font-mono text-[10.5px] text-carbon-500">
                {new Date(autosaveInfo.savedAt).toLocaleString("pt-BR")}
              </span>
            </p>
            <button
              onClick={onRestore}
              className="rounded-lg bg-carbon-700 px-3 py-1.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-white transition-colors hover:bg-carbon-600"
            >
              continuar
            </button>
            <button
              onClick={onDiscardAutosave}
              title="apagar sessão salva"
              className="flex h-7 w-7 items-center justify-center rounded-lg text-carbon-400 transition-colors hover:bg-carbon-700 hover:text-ember-400"
            >
              <Trash2 size={13} />
            </button>
          </div>
        </div>
      )}

      {error && (
        <p className="anim-pop-in relative z-10 mt-4 rounded-lg border border-ember-400/40 bg-ember-400/10 px-4 py-2 text-[12.5px] font-medium text-ember-400">
          {error}
        </p>
      )}

      <input
        ref={inputRef}
        type="file"
        accept=".ordo,application/json"
        className="hidden"
        onChange={(e) => {
          void handleFiles(e.target.files);
          e.target.value = "";
        }}
      />
    </div>
  );
}
