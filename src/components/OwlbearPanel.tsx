import { memo, useCallback, useEffect, useRef, useState } from "react";
import { invoke } from "@tauri-apps/api/core";
import {
  AppWindow,
  Focus,
  LoaderCircle,
  RefreshCw,
  ScreenShare,
  Square,
  TriangleAlert,
} from "lucide-react";
import { PanelChrome, HeaderIconBtn } from "./PanelChrome";
import { isNativeApp, supportsWindowMirroring } from "../lib/platform";

interface Props {
  opened: boolean;
  onChange: (opened: boolean) => void;
}

type SurfaceKind = "window" | "browser" | "monitor" | "unknown";

interface FocusCaptureController {
  setFocusBehavior?: (behavior: "focus-captured-surface" | "no-focus-change") => void;
}

type FocusCaptureControllerCtor = new () => FocusCaptureController;

interface OpenApplication {
  id: string;
  title: string;
}

const cleanTrackLabel = (label: string): string => {
  const cleaned = label
    .replace(/^(window|screen|tab|browser)\s*:\s*/i, "")
    .replace(/\s+-\s+sharing$/i, "")
    .trim();
  return cleaned || "janela selecionada";
};

function TabletopPanelInner({ opened, onChange }: Props) {
  const streamRef = useRef<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement>(null);
  const controllerRef = useRef<FocusCaptureController | null>(null);
  const [streaming, setStreaming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [surface, setSurface] = useState<SurfaceKind>("unknown");
  const [windowName, setWindowName] = useState("aplicativo");
  const [focusHint, setFocusHint] = useState(false);
  const [applications, setApplications] = useState<OpenApplication[]>([]);
  const [selectedApplicationId, setSelectedApplicationId] = useState("");
  const [loadingApplications, setLoadingApplications] = useState(false);
  const canMirrorWindows = supportsWindowMirroring();
  const nativeApp = isNativeApp();
  const selectedApplication = applications.find(({ id }) => id === selectedApplicationId) ?? null;

  const refreshApplications = useCallback(async () => {
    setLoadingApplications(true);
    setError(null);
    try {
      const available = await invoke<OpenApplication[]>("list_open_applications");
      setApplications(available);
      setSelectedApplicationId((current) =>
        available.some(({ id }) => id === current) ? current : available[0]?.id ?? ""
      );
    } catch (e) {
      setError(
        e instanceof Error ? e.message :
        typeof e === "string" ? e :
        "não foi possível listar os aplicativos abertos."
      );
    } finally {
      setLoadingApplications(false);
    }
  }, []);

  useEffect(() => {
    if (nativeApp && canMirrorWindows) void refreshApplications();
  }, [canMirrorWindows, nativeApp, refreshApplications]);

  const stopMirror = useCallback(() => {
    streamRef.current?.getTracks().forEach((track) => track.stop());
    streamRef.current = null;
    controllerRef.current = null;
    if (videoRef.current) videoRef.current.srcObject = null;
    setStreaming(false);
    setSurface("unknown");
    setWindowName("aplicativo");
    setFocusHint(false);
    if (opened) onChange(false);
  }, [onChange, opened]);

  const chooseWindow = useCallback(async () => {
    setError(null);
    setFocusHint(false);
    if (nativeApp && !selectedApplication) {
      setError("selecione um aplicativo aberto antes de iniciar o espelhamento.");
      return;
    }
    if (!supportsWindowMirroring()) {
      setError("o espelhamento de janelas está disponível apenas no app desktop.");
      return;
    }
    if (!navigator.mediaDevices?.getDisplayMedia) {
      setError("seu navegador não permite escolher janelas aqui (é necessário usar https).");
      return;
    }

    setBusy(true);
    try {
      streamRef.current?.getTracks().forEach((track) => track.stop());

      const Controller = (window as unknown as {
        CaptureController?: FocusCaptureControllerCtor;
      }).CaptureController;
      const controller = Controller ? new Controller() : null;

      const options = {
        video: {
          displaySurface: "window",
          frameRate: { ideal: 30, max: 60 },
          cursor: "always",
        },
        audio: false,
        ...(controller ? { controller } : {}),
        selfBrowserSurface: "exclude",
        monitorTypeSurfaces: "exclude",
        surfaceSwitching: "exclude",
      };

      const stream = await navigator.mediaDevices.getDisplayMedia(
        options as unknown as DisplayMediaStreamOptions
      );
      const track = stream.getVideoTracks()[0];
      if (!track) {
        stream.getTracks().forEach((item) => item.stop());
        throw new Error("a janela escolhida não forneceu imagem.");
      }

      // O navegador exige que o comportamento de foco seja definido logo após
      // getDisplayMedia. Mantemos o MANTIQUARIUS em primeiro plano após escolher.
      const displaySurface = (track.getSettings().displaySurface ?? "unknown") as SurfaceKind;
      if (controller?.setFocusBehavior && displaySurface !== "monitor") {
        try {
          controller.setFocusBehavior("no-focus-change");
        } catch {
          /* navegadores sem foco condicional */
        }
      }

      streamRef.current = stream;
      controllerRef.current = controller;
      setSurface(displaySurface);
      setWindowName(cleanTrackLabel(track.label));
      track.contentHint = displaySurface === "browser" ? "detail" : "motion";
      track.addEventListener("ended", stopMirror, { once: true });

      if (videoRef.current) {
        videoRef.current.srcObject = stream;
        await videoRef.current.play().catch(() => undefined);
      }
      setStreaming(true);
      // Também corrige o estado caso uma captura anterior tenha encerrado
      // enquanto o seletor da nova janela estava aberto.
      onChange(true);
    } catch (e) {
      if (e instanceof DOMException && e.name === "NotAllowedError") {
        setError("seleção cancelada — escolha uma janela ou aplicativo para espelhar.");
      } else if (e instanceof DOMException && e.name === "NotReadableError") {
        setError("o sistema bloqueou a gravação da janela — verifique as permissões de tela.");
      } else {
        setError(e instanceof Error ? e.message : "não foi possível espelhar essa janela.");
      }
      setStreaming(false);
    } finally {
      setBusy(false);
    }
  }, [nativeApp, onChange, selectedApplication, stopMirror]);

  /**
   * Páginas web não recebem o identificador nativo da janela capturada.
   * Fazemos a melhor tentativa permitida e exibimos o atalho do sistema como
   * fallback quando o navegador bloquear a troca de foco.
   */
  const focusCapturedApp = useCallback(async () => {
    setFocusHint(false);
    if (nativeApp && selectedApplication) {
      try {
        await invoke("focus_application", { windowId: selectedApplication.id });
      } catch (e) {
        setError(
          e instanceof Error ? e.message :
          typeof e === "string" ? e :
          "não foi possível focar o aplicativo selecionado."
        );
      }
      return;
    }
    try {
      controllerRef.current?.setFocusBehavior?.("focus-captured-surface");
    } catch {
      /* a janela de oportunidade dessa API costuma já estar encerrada */
    }
    try {
      window.blur();
    } catch {
      /* alguns navegadores ignoram window.blur */
    }
    window.setTimeout(() => setFocusHint(true), 120);
  }, [nativeApp, selectedApplication]);

  useEffect(() => {
    return () => {
      streamRef.current?.getTracks().forEach((track) => track.stop());
      streamRef.current = null;
    };
  }, []);

  const surfaceLabel =
    surface === "window"
      ? "janela de aplicativo"
      : surface === "browser"
        ? "aba do navegador"
        : surface === "monitor"
          ? "monitor"
          : "janela";

  return (
    <PanelChrome
      index="02"
      title="tabletop"
      icon={AppWindow}
      className="col-span-6 row-span-1 lg:col-span-3"
      actions={
        streaming && canMirrorWindows ? (
          <>
            <HeaderIconBtn title="trocar aplicativo ou janela" onClick={() => void chooseWindow()}>
              <RefreshCw size={12} />
            </HeaderIconBtn>
            <HeaderIconBtn title="tentar focar o aplicativo" onClick={focusCapturedApp} accent>
              <Focus size={12.5} />
            </HeaderIconBtn>
            <HeaderIconBtn title="parar espelhamento" onClick={stopMirror}>
              <Square size={11} />
            </HeaderIconBtn>
          </>
        ) : undefined
      }
    >
      <div className="relative min-h-0 flex-1 bg-black">
        <video
          ref={videoRef}
          muted
          playsInline
          autoPlay
          onClick={focusCapturedApp}
          title={streaming ? "clique para tentar focar o aplicativo" : undefined}
          className={`absolute inset-0 h-full w-full object-contain ${
            streaming ? "cursor-pointer" : "hidden"
          }`}
        />

        {streaming && (
          <>
            <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-ember-400/40 bg-carbon-950/80 px-2.5 py-1 backdrop-blur">
              <span className="h-1.5 w-1.5 rounded-full bg-ember-400 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
              <span className="max-w-[220px] truncate font-mono text-[9px] font-semibold uppercase tracking-[0.18em] text-ember-400">
                {windowName} · ao vivo
              </span>
            </div>

            <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center bg-gradient-to-t from-black/80 to-transparent p-3">
              <span className="rounded-full bg-carbon-950/80 px-3 py-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-carbon-200 backdrop-blur">
                clique para focar · {surfaceLabel}
              </span>
            </div>

            {focusHint && (
              <button
                onClick={() => setFocusHint(false)}
                className="anim-pop-in absolute bottom-12 left-1/2 max-w-[90%] -translate-x-1/2 rounded-lg border border-carbon-600 bg-carbon-950/95 px-3 py-2 text-center text-[11px] leading-relaxed text-carbon-300 shadow-xl backdrop-blur"
              >
                se o sistema não trouxe o aplicativo para frente, use Alt+Tab
                <span className="block font-mono text-[9px] uppercase tracking-wider text-carbon-500">
                  toque para fechar
                </span>
              </button>
            )}
          </>
        )}

        {!canMirrorWindows ? (
          <div className="flex h-full flex-col items-center justify-center gap-3 p-6 text-center">
            <ScreenShare size={24} strokeWidth={1.6} className="text-carbon-400" />
            <p className="max-w-[300px] text-[12px] leading-relaxed text-carbon-300">
              o espelhamento de outras janelas está disponível apenas no app desktop.
            </p>
          </div>
        ) : !streaming && (
          <div className="flex h-full flex-col items-center justify-center gap-4 p-6">
            {nativeApp && (
              <div className="flex w-full max-w-[360px] items-center gap-2">
                <select
                  aria-label="Aplicativo para espelhar"
                  value={selectedApplicationId}
                  onChange={(event) => setSelectedApplicationId(event.target.value)}
                  disabled={loadingApplications || applications.length === 0}
                  className="min-w-0 flex-1 rounded-lg border border-carbon-600 bg-carbon-900 px-3 py-2 text-sm text-white disabled:opacity-60"
                >
                  {applications.length === 0 ? (
                    <option value="">
                      {loadingApplications ? "carregando aplicativos..." : "nenhum aplicativo encontrado"}
                    </option>
                  ) : applications.map((application) => (
                    <option key={application.id} value={application.id}>{application.title}</option>
                  ))}
                </select>
                <HeaderIconBtn
                  title="atualizar aplicativos abertos"
                  onClick={() => void refreshApplications()}
                  disabled={loadingApplications}
                >
                  <RefreshCw size={12} />
                </HeaderIconBtn>
              </div>
            )}

            <button
              onClick={() => void chooseWindow()}
              disabled={busy || (nativeApp && !selectedApplication)}
              className="group flex flex-col items-center gap-4 rounded-2xl border border-dashed border-carbon-500 bg-carbon-900/60 px-10 py-8 transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.98] disabled:opacity-60"
            >
              <span className="flex h-14 w-14 items-center justify-center rounded-2xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
                {busy ? (
                  <LoaderCircle size={24} className="anim-spin-slow" strokeWidth={1.6} />
                ) : (
                  <ScreenShare size={24} strokeWidth={1.6} />
                )}
              </span>
              <span className="text-center">
                <span className="block font-display text-base font-semibold text-white">
                  {busy ? "aguardando escolha..." : "escolher janela"}
                </span>
                <span className="mt-1 block max-w-[290px] font-mono text-[10px] leading-relaxed uppercase tracking-[0.14em] text-carbon-400">
                  {nativeApp
                    ? "selecione qualquer janela no seletor do Windows; o clique focará o aplicativo acima"
                    : "selecione qualquer aplicativo aberto no computador para espelhar aqui"}
                </span>
              </span>
            </button>

            <p className="max-w-[330px] text-center text-[11px] leading-relaxed text-carbon-500">
              funciona com navegadores, mapas, leitores, aplicativos de tabletop e outras janelas.
              o sistema sempre pede sua permissão antes de capturar.
            </p>

            {error && <ErrText msg={error} />}
          </div>
        )}
        {streaming && error && (
          <div className="absolute bottom-12 left-1/2 z-10 w-max max-w-[90%] -translate-x-1/2">
            <ErrText msg={error} />
          </div>
        )}
      </div>
    </PanelChrome>
  );
}

function ErrText({ msg }: { msg: string }) {
  return (
    <p className="anim-pop-in flex max-w-[320px] items-start gap-2 rounded-lg border border-ember-400/40 bg-ember-400/10 px-3 py-2 text-[11.5px] leading-snug text-ember-400">
      <TriangleAlert size={13} className="mt-0.5 shrink-0" />
      {msg}
    </p>
  );
}

export const OwlbearPanel = memo(
  TabletopPanelInner,
  (prev, next) => prev.opened === next.opened
);