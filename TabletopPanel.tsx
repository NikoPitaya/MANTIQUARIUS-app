import { memo, useCallback, useEffect, useRef, useState } from "react";
import { MonitorUp, RefreshCw, ScreenShare, Square, TriangleAlert } from "lucide-react";
import { HeaderIconBtn, PanelChrome } from "./PanelChrome";

interface Props {
  opened: boolean;
  onChange: (opened: boolean) => void;
}

/**
 * O navegador mostra o seletor nativo de compartilhamento. Nele a pessoa pode
 * escolher qualquer janela, aplicativo, tela ou aba que o sistema disponibilizar.
 */
function TabletopPanelInner({ opened, onChange }: Props) {
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const [streaming, setStreaming] = useState(false);
  const [sourceName, setSourceName] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  const stopMirror = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
    setSourceName(null);
  }, []);

  const chooseWindow = useCallback(async () => {
    setError(null);
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("este navegador não permite escolher uma janela para espelhar. Abra o site em HTTPS ou localhost.");
      return;
    }

    setBusy(true);
    try {
      stopMirror();
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: false,
      });
      const track = stream.getVideoTracks()[0];
      if (!track) throw new Error("nenhuma janela foi escolhida");
      streamRef.current = stream;
      track.addEventListener("ended", stopMirror, { once: true });
      setSourceName(track.label || "janela escolhida");
      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStreaming(true);
      if (!opened) onChange(true);
    } catch (caught) {
      if (caught instanceof DOMException && caught.name === "NotAllowedError") {
        setError("escolha cancelada. Selecione uma janela, aplicativo ou aba para exibi-la no tabletop.");
      } else {
        setError("não foi possível iniciar o espelhamento. Tente escolher a janela novamente.");
      }
    } finally {
      setBusy(false);
    }
  }, [onChange, opened, stopMirror]);

  useEffect(() => stopMirror, [stopMirror]);

  return (
    <PanelChrome
      index="02"
      title="tabletop"
      icon={MonitorUp}
      className="col-span-6 row-span-1 lg:col-span-3"
      actions={
        streaming ? (
          <>
            <HeaderIconBtn title="escolher outra janela" onClick={() => void chooseWindow()}>
              <RefreshCw size={12} />
            </HeaderIconBtn>
            <HeaderIconBtn title="parar espelhamento" onClick={stopMirror}>
              <Square size={11} />
            </HeaderIconBtn>
          </>
        ) : undefined
      }
    >
      <div className="relative flex-1 bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          className={`absolute inset-0 h-full w-full object-contain ${streaming ? "" : "hidden"}`}
        />

        {streaming && (
          <>
            <div className="pointer-events-none absolute left-3 top-3 flex max-w-[calc(100%-1.5rem)] items-center gap-2 rounded-full border border-ember-400/40 bg-carbon-950/80 px-2.5 py-1 backdrop-blur">
              <span className="h-1.5 w-1.5 shrink-0 rounded-full bg-ember-400 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
              <span className="truncate font-mono text-[9px] font-semibold uppercase tracking-[0.16em] text-ember-400">
                ao vivo · {sourceName}
              </span>
            </div>
            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/80 to-transparent p-3">
              <span className="rounded-full bg-carbon-950/80 px-3 py-1 text-center font-mono text-[9.5px] uppercase tracking-[0.14em] text-carbon-200 backdrop-blur">
                para interagir com o aplicativo, use a janela original
              </span>
            </div>
          </>
        )}

        {!streaming && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            <button
              onClick={() => void chooseWindow()}
              disabled={busy}
              className="group flex flex-col items-center gap-4 rounded-2xl border border-dashed border-carbon-500 bg-carbon-900/60 px-10 py-8 transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.98] disabled:opacity-60"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
                <ScreenShare size={24} strokeWidth={1.6} />
              </span>
              <span className="text-center">
                <span className="block font-display text-base font-semibold text-white">
                  {busy ? "aguardando escolha..." : "escolher janela"}
                </span>
                <span className="mt-1 block max-w-[290px] font-mono text-[10px] leading-relaxed uppercase tracking-[0.14em] text-carbon-400">
                  escolha qualquer aplicativo, janela ou aba para espelhar aqui em tempo real
                </span>
              </span>
            </button>
            {error && <ErrText msg={error} />}
          </div>
        )}
      </div>
    </PanelChrome>
  );
}

function ErrText({ msg }: { msg: string }) {
  return (
    <p className="anim-pop-in flex max-w-[330px] items-start gap-2 rounded-lg border border-ember-400/40 bg-ember-400/10 px-3 py-2 text-[11.5px] leading-snug text-ember-400">
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      {msg}
    </p>
  );
}

export const TabletopPanel = memo(TabletopPanelInner, (previous, next) => previous.opened === next.opened);
