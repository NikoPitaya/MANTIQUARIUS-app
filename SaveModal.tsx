import { Check, Download, HardDrive, Hexagon, LoaderCircle, RotateCcw, Save, X } from "lucide-react";
import type { ExportBundle } from "../lib/ordo";
import { formatBytes } from "../lib/ordo";

export type ExportPhase = "preparing" | "ready" | "error";

interface Props {
  phase: ExportPhase;
  progress: number;
  label: string;
  bundle: ExportBundle | null;
  error: string | null;
  onRetry: () => void;
  onNativeSave: () => Promise<boolean>;
  onDownload: () => void;
  onClose: () => void;
}

export function SaveModal({
  phase,
  progress,
  label,
  bundle,
  error,
  onRetry,
  onNativeSave,
  onDownload,
  onClose,
}: Props) {
  const percent = Math.max(0, Math.min(100, Math.round(progress * 100)));
  const reduction = bundle && bundle.originalSize > bundle.size
    ? Math.round((1 - bundle.size / bundle.originalSize) * 100)
    : 0;

  return (
    <div className="anim-fade-in fixed inset-0 z-[95] flex items-center justify-center bg-carbon-950/85 p-4 backdrop-blur-md">
      <div className="anim-pop-in w-full max-w-md overflow-hidden rounded-2xl border border-carbon-600 bg-carbon-850 shadow-[0_24px_80px_rgba(0,0,0,0.85)]">
        <header className="flex items-center gap-3 border-b border-carbon-700/80 bg-carbon-900/80 px-6 py-4">
          <span className="relative flex h-9 w-9 shrink-0 items-center justify-center">
            <Hexagon size={36} strokeWidth={1.3} className="absolute text-acid-400" />
            <Save size={14} className="text-acid-400" />
          </span>
          <div>
            <h3 className="font-display text-base font-bold text-white">
              {phase === "preparing" ? "preparando arquivo" : phase === "ready" ? "arquivo pronto" : "falha ao preparar"}
            </h3>
            <p className="font-mono text-[10.5px] text-carbon-400">
              formato ORDO binário otimizado
            </p>
          </div>
          {phase !== "preparing" && (
            <button
              onClick={onClose}
              className="ml-auto flex h-8 w-8 items-center justify-center rounded-lg text-carbon-400 transition-colors hover:bg-carbon-750 hover:text-white"
            >
              <X size={15} />
            </button>
          )}
        </header>

        <div className="p-6">
          {phase === "preparing" && (
            <div className="py-3">
              <div className="mb-5 flex items-center justify-center">
                <span className="relative flex h-16 w-16 items-center justify-center rounded-2xl border border-acid-500/30 bg-acid-400/10 text-acid-300">
                  <HardDrive size={25} strokeWidth={1.6} />
                  <LoaderCircle size={68} strokeWidth={0.8} className="anim-spin-slow absolute text-acid-400/40" />
                </span>
              </div>
              <div className="mb-2 flex items-center justify-between font-mono text-[10.5px] uppercase tracking-wider">
                <span className="text-carbon-300">{label}</span>
                <span className="text-acid-300">{percent}%</span>
              </div>
              <div className="h-2 overflow-hidden rounded-full bg-carbon-700">
                <div
                  className="h-full rounded-full bg-acid-400 transition-[width] duration-150 ease-out shadow-[0_0_12px_rgba(212,247,76,0.4)]"
                  style={{ width: `${percent}%` }}
                />
              </div>
              <p className="mt-4 text-center text-[11.5px] leading-relaxed text-carbon-400">
                convertendo as mídias em blocos menores, sem Base64.<br />
                não feche esta janela durante a preparação.
              </p>
            </div>
          )}

          {phase === "ready" && bundle && (
            <div>
              <div className="mb-5 flex items-center gap-3 rounded-xl border border-acid-500/35 bg-acid-400/[0.08] p-3.5">
                <span className="flex h-9 w-9 shrink-0 items-center justify-center rounded-lg bg-acid-400 text-carbon-950">
                  <Check size={17} strokeWidth={2.6} />
                </span>
                <div className="min-w-0">
                  <p className="truncate text-[12.5px] font-semibold text-white" title={bundle.fileName}>
                    {bundle.fileName}
                  </p>
                  <p className="mt-0.5 font-mono text-[10px] text-carbon-400">
                    {formatBytes(bundle.size)}
                    {reduction > 0 ? ` · aproximadamente ${reduction}% menor` : ""}
                  </p>
                </div>
              </div>

              <p className="mb-4 text-[12.5px] leading-relaxed text-carbon-300">
                O arquivo inteiro já foi gerado. Agora o botão abaixo apenas inicia o download,
                sem precisar processar nada novamente.
              </p>

              <a
                href={bundle.url}
                download={bundle.fileName}
                onClick={onDownload}
                className="flex w-full items-center justify-center gap-2.5 rounded-xl bg-acid-400 py-3.5 text-[13px] font-bold text-carbon-950 shadow-[0_0_22px_rgba(212,247,76,0.24)] transition-all hover:bg-acid-300 active:scale-[0.98]"
              >
                <Download size={16} strokeWidth={2.4} />
                baixar {bundle.fileName}
              </a>

              <button
                onClick={() => void onNativeSave()}
                className="mt-2 flex w-full items-center justify-center gap-2 rounded-xl border border-carbon-600 py-2.5 font-mono text-[10.5px] font-semibold uppercase tracking-wider text-carbon-200 transition-colors hover:bg-carbon-800 hover:text-white"
              >
                <HardDrive size={13} />
                escolher pasta com “salvar como”
              </button>

              <p className="mt-3 text-center font-mono text-[9.5px] leading-relaxed text-carbon-500">
                arquivos ORDO antigos continuam compatíveis; este novo arquivo usa a versão 2 binária.
              </p>
            </div>
          )}

          {phase === "error" && (
            <div className="text-center">
              <p className="mb-4 rounded-xl border border-ember-400/40 bg-ember-400/10 p-3 text-[12px] leading-relaxed text-ember-400">
                {error ?? "não foi possível montar o arquivo."}
              </p>
              <button
                onClick={onRetry}
                className="flex w-full items-center justify-center gap-2 rounded-xl bg-acid-400 py-3 text-[13px] font-bold text-carbon-950 transition-colors hover:bg-acid-300"
              >
                <RotateCcw size={14} />
                tentar novamente
              </button>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}