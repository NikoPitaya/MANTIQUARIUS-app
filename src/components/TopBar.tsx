import { useEffect, useRef, useState } from "react";
import { Check, Save, X, Hexagon, LoaderCircle, ChevronUp } from "lucide-react";

interface Props {
  name: string;
  dirty: boolean;
  saving: boolean;
  savedFlash: boolean;
  status: string;
  onRename: (name: string) => void;
  onSave: () => void;
  onHide: () => void;
  onClose: () => void;
}

export function TopBar({ name, dirty, saving, savedFlash, status, onRename, onSave, onHide, onClose }: Props) {
  const [editing, setEditing] = useState(false);
  const [temp, setTemp] = useState(name);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    if (editing) {
      inputRef.current?.focus();
      inputRef.current?.select();
    }
  }, [editing]);

  const commit = () => {
    setEditing(false);
    const v = temp.trim();
    if (v) onRename(v.replace(/\.ordo$/i, ""));
    else setTemp(name);
  };

  return (
    <header className="z-30 flex h-12 shrink-0 items-center gap-3 border-b border-carbon-700/80 bg-carbon-900/90 px-3 backdrop-blur">
      <div className="flex items-center gap-2.5">
        <span className="relative flex h-7 w-7 items-center justify-center">
          <Hexagon size={27} strokeWidth={1.4} className="absolute text-acid-400" />
          <span className="font-display text-[11px] font-bold text-acid-400">M</span>
        </span>
        <span className="hidden font-display text-sm font-bold tracking-tight text-white sm:inline">
          MANTIQUARIUS
        </span>
      </div>

      <span className="hidden h-4 w-px bg-carbon-600 sm:block" />

      {/* file name */}
      {editing ? (
        <input
          ref={inputRef}
          value={temp}
          onChange={(e) => setTemp(e.target.value)}
          onBlur={commit}
          onKeyDown={(e) => {
            if (e.key === "Enter") commit();
            if (e.key === "Escape") {
              setTemp(name);
              setEditing(false);
            }
          }}
          className="w-32 rounded-md border border-acid-500/50 bg-carbon-800 px-2 py-1 font-mono text-[12px] text-acid-300 outline-none sm:w-48"
        />
      ) : (
        <button
          onClick={() => {
            setTemp(name);
            setEditing(true);
          }}
          title="clique para renomear a sessão"
          className="group flex min-w-0 max-w-[150px] items-center gap-1.5 rounded-md px-1.5 py-1 transition-colors hover:bg-carbon-800 sm:max-w-[240px]"
        >
          <span className="truncate font-mono text-[12px] font-medium text-carbon-100">
            {name}.ordo
          </span>
          <span
            className={`h-1.5 w-1.5 shrink-0 rounded-full transition-colors ${
              dirty ? "bg-acid-400" : savedFlash ? "bg-acid-400" : "bg-carbon-600"
            } ${dirty ? "animate-[pulse-dot_1.6s_ease-in-out_infinite] text-acid-400" : ""}`}
          />
        </button>
      )}

      <p className="ml-1 hidden truncate font-mono text-[10px] uppercase tracking-[0.18em] text-carbon-500 lg:block">
        {status}
      </p>

      <div className="ml-auto flex items-center gap-2">
        <button
          onClick={onSave}
          disabled={saving}
          className={`flex h-8 items-center gap-2 rounded-lg px-3.5 font-mono text-[11px] font-semibold uppercase tracking-wider transition-all active:scale-95 disabled:opacity-80 ${
            savedFlash
              ? "bg-acid-400/15 text-acid-300"
              : "bg-acid-400 text-carbon-950 shadow-[0_0_20px_rgba(212,247,76,0.25)] hover:bg-acid-300"
          }`}
        >
          {saving ? (
            <LoaderCircle size={13.5} className="anim-spin-slow" strokeWidth={2.4} />
          ) : savedFlash ? (
            <Check size={13.5} strokeWidth={2.5} />
          ) : (
            <Save size={13.5} strokeWidth={2.2} />
          )}
          <span className="hidden sm:inline">
            {saving ? "preparando" : savedFlash ? "salvo" : "salvar .ordo"}
          </span>
        </button>
        <button
          onClick={onHide}
          title="esconder menu superior"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-carbon-600 text-carbon-300 transition-all hover:border-carbon-500 hover:bg-carbon-800 hover:text-white active:scale-95"
        >
          <ChevronUp size={14} strokeWidth={2.2} />
        </button>
        <button
          onClick={onClose}
          title="fechar arquivo"
          className="flex h-8 w-8 items-center justify-center rounded-lg border border-carbon-600 text-carbon-300 transition-all hover:border-carbon-500 hover:bg-carbon-800 hover:text-white active:scale-95"
        >
          <X size={14} strokeWidth={2.2} />
        </button>
      </div>
    </header>
  );
}
