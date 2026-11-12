import { useEffect, useRef, useState } from "react";
import { Dices, RefreshCw, ScreenShare, Square } from "lucide-react";
import { HeaderIconBtn, PanelChrome } from "./PanelChrome";

export function TabletopPanel() {
  const stage = useRef<HTMLDivElement>(null);
  const video = useRef<HTMLVideoElement>(null);
  const pending = useRef(false);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState("");

  useEffect(() => {
    if (!stream) return;
    const player = video.current!;
    const track = stream.getVideoTracks()[0];
    const ended = () => setStream(current => current === stream ? null : current);
    player.srcObject = stream;
    track.addEventListener("ended", ended);
    if (track.readyState === "ended") ended();

    return () => {
      track.removeEventListener("ended", ended);
      stream.getTracks().forEach(item => item.stop());
      player.srcObject = null;
    };
  }, [stream]);

  useEffect(() => () => { pending.current = false; }, []);

  async function chooseWindow() {
    if (pending.current) return;
    setMessage("");
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setMessage("Use um navegador compatível e abra o site por HTTPS ou localhost.");
      return;
    }
    pending.current = true;
    setBusy(true);
    try {
      const selected = await navigator.mediaDevices.getDisplayMedia({
        video: { displaySurface: "window", frameRate: 30 },
        audio: false,
      });
      if (pending.current) setStream(selected);
      else selected.getTracks().forEach(track => track.stop());
    } catch (error) {
      if (pending.current) {
        setMessage(error instanceof DOMException && error.name === "NotAllowedError"
          ? "Compartilhamento cancelado ou bloqueado."
          : "Não foi possível capturar a janela.");
      }
    } finally {
      if (pending.current) {
        pending.current = false;
        setBusy(false);
      }
    }
  }

  async function expandPreview() {
    try {
      await stage.current?.requestFullscreen();
    } catch {
      setMessage("O navegador bloqueou a tela cheia.");
    }
  }

  return (
    <PanelChrome
      index="02"
      title="tabletop"
      icon={Dices}
      className="col-span-6 row-span-1 lg:col-span-3"
      actions={stream && !busy ? (
        <>
          <HeaderIconBtn title="trocar janela" onClick={() => void chooseWindow()}>
            <RefreshCw size={12} />
          </HeaderIconBtn>
          <HeaderIconBtn title="parar espelhamento" onClick={() => setStream(null)}>
            <Square size={11} />
          </HeaderIconBtn>
        </>
      ) : undefined}
    >
      <div ref={stage} className="ws-backdrop relative flex flex-1 flex-col items-center justify-center gap-4 bg-black p-6">
        <video ref={video} muted playsInline autoPlay
          className={stream ? "absolute inset-0 h-full w-full object-contain" : "hidden"} />
        {stream ? (
          <button type="button" aria-label="Ver espelhamento em tela cheia"
            onClick={() => void expandPreview()}
            className="group absolute inset-0 flex items-end justify-center p-3">
            <span className="rounded-full bg-carbon-950/90 px-3 py-1 text-xs text-white opacity-0 group-hover:opacity-100 group-focus-visible:opacity-100">
              Ver em tela cheia
            </span>
          </button>
        ) : (
          <button type="button" disabled={busy} onClick={() => void chooseWindow()}
            className="flex flex-col items-center gap-4 rounded-2xl border border-carbon-600 bg-carbon-850/80 px-8 py-6 text-white hover:border-acid-500/60 disabled:opacity-60">
            <ScreenShare size={26} />
            <span className="font-display font-semibold">{busy ? "Aguardando escolha…" : "Escolher janela"}</span>
            <span className="text-xs text-carbon-400">Abra o aplicativo e selecione a janela dele no navegador.</span>
          </button>
        )}
        {message && <p role="status" className="relative z-10 rounded-lg bg-carbon-950 px-3 py-2 text-xs text-ember-400">{message}</p>}
      </div>
    </PanelChrome>
  );
}
