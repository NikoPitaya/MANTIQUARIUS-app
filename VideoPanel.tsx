import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Film, Plus, Pencil, Trash2, Upload, MonitorUp, Square, TriangleAlert, Clapperboard, X,
  Image as ImageIcon, GripVertical, ArrowUpToLine, AudioWaveform,
} from "lucide-react";
import type { OrdoMedia } from "../types";
import { SfxPanel } from "./SfxPanel";
import { fileToDataURL, dataURLToUint8, stripExt, uid } from "../lib/ordo";
import { PanelChrome, HeaderIconBtn } from "./PanelChrome";
import { ContextMenuView, useContextMenu } from "./ContextMenu";
import { VolumeSlider } from "./VolumeSlider";
import { lsGet, lsSet } from "../lib/store";
import { useReorder } from "../lib/useReorder";
import { ItemActions } from "./ItemActions";

interface Props {
  videos: OrdoMedia[];
  onChange: (videos: OrdoMedia[]) => void;
  sfx: OrdoMedia[];
  onSfxChange: (sfx: OrdoMedia[]) => void;
}

type Phase = "idle" | "loading" | "gesture" | "playing" | "error";

const POPUP_CSS = `
  html,body{margin:0;padding:0;height:100%;background:#000;overflow:hidden}
  #stage{position:fixed;inset:0;background:#000}
  video,img{width:100%;height:100%;object-fit:contain;background:#000;outline:none;display:block}
  #overlay{position:fixed;inset:0;display:none;align-items:center;justify-content:center;pointer-events:none;font-family:'JetBrains Mono',ui-monospace,monospace}
  #overlay .box{display:flex;flex-direction:column;align-items:center;gap:12px;background:rgba(0,0,0,.55);padding:22px 30px;border-radius:16px}
  .spin{width:26px;height:26px;border-radius:50%;border:3px solid rgba(255,255,255,.14);border-top-color:rgba(255,255,255,.9);animation:sp .8s linear infinite}
  @keyframes sp{to{transform:rotate(360deg)}}
  .lbl{color:#fff;font-size:11px;letter-spacing:.22em;text-transform:uppercase}
  .sub{color:#888;font-size:10px;max-width:320px;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
  .tapbtn{pointer-events:auto;display:flex;flex-direction:column;align-items:center;gap:18px;background:none;border:0;cursor:pointer;padding:24px}
  .tapbtn .circ{width:96px;height:96px;border-radius:999px;border:2px solid rgba(255,255,255,.85);display:flex;align-items:center;justify-content:center;transition:all .18s ease}
  .tapbtn:hover .circ{background:rgba(255,255,255,.14);transform:scale(1.06)}
  .tapbtn .tri{width:0;height:0;border-top:17px solid transparent;border-bottom:17px solid transparent;border-left:28px solid #fff;margin-left:8px}
  .tapbtn .lbl{color:#ddd;font-size:11px;letter-spacing:.22em;text-transform:uppercase}
  .card{pointer-events:auto;max-width:420px;margin:20px;padding:28px;border:1px solid rgba(255,107,92,.45);border-radius:16px;background:rgba(20,0,0,.85);text-align:center}
  .card .t{color:#ff6b5c;font-size:13px;font-weight:700;letter-spacing:.18em;text-transform:uppercase;margin-bottom:10px}
  .card .m{color:#d4d4d4;font-size:12px;line-height:1.7;margin-bottom:8px}
  .card .f{color:#777;font-size:10px;letter-spacing:.06em;word-break:break-all}
`;

const isImage = (m: OrdoMedia): boolean => m.data.startsWith("data:image");

const esc = (s: string): string =>
  s.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c] as string
  );

function injectPopupDOM(w: Window): boolean {
  try {
    w.document.open();
    w.document.write(
      `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><title>ORDO · vídeo</title><style>${POPUP_CSS}</style></head><body><div id="stage"></div><div id="overlay"></div></body></html>`
    );
    w.document.close();
    return true;
  } catch {
    return false;
  }
}

function setOverlay(w: Window, html: string): void {
  try {
    const o = w.document.getElementById("overlay");
    if (!o) return;
    o.innerHTML = html;
    o.style.display = html ? "flex" : "none";
  } catch { /* popup fora de alcance */ }
}

const loadingHtml = (name: string) =>
  `<div class="box"><div class="spin"></div><div class="lbl">carregando</div><div class="sub">${esc(name)}</div></div>`;

const tapHtml = () =>
  `<button class="tapbtn" id="tapbtn"><span class="circ"><span class="tri"></span></span><span class="lbl">clique para reproduzir</span></button>`;

const errHtml = (msg: string, name: string) =>
  `<div class="card"><div class="t">falha ao reproduzir</div><div class="m">${esc(msg)}</div><div class="f">${esc(name)}</div></div>`;

const readVol = (): number => {
  const raw = Number(lsGet("ordo:vol:video"));
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
};

function VideoPanelInner({ videos, onChange, sfx, onSfxChange }: Props) {
  const [tab, setTab] = useState<"cine" | "sfx">("cine");
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [volume, setVolume] = useState(readVol);
  const [phase, setPhase] = useState<Phase>("idle");
  const [popupOpen, setPopupOpen] = useState(false);
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [panelError, setPanelError] = useState<string | null>(null);

  const winRef = useRef<Window | null>(null);
  const currentVideoEl = useRef<HTMLVideoElement | HTMLImageElement | null>(null);
  const currentUrl = useRef<string | null>(null);
  const blobCache = useRef(new Map<string, Blob>());
  const inputRef = useRef<HTMLInputElement>(null);
  const { menu, open, close } = useContextMenu();
  const { dragProps, markerCls, move } = useReorder(videos, (next) => onChangeRef.current(next));

  const videosRef = useRef(videos);
  useEffect(() => { videosRef.current = videos; });
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const playingRef = useRef(playingId);
  useEffect(() => { playingRef.current = playingId; });
  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; });

  /* aplica o volume no vídeo que já está tocando na janela externa */
  useEffect(() => {
    const el = currentVideoEl.current;
    if (el && "volume" in el) {
      try { el.volume = volume; } catch { /* ignore */ }
    }
    lsSet("ordo:vol:video", String(volume));
  }, [volume]);

  const getBlob = useCallback((m: OrdoMedia): Blob => {
    const c = blobCache.current.get(m.id);
    if (c) return c;
    const u8 = dataURLToUint8(m.data);
    const mime = m.data.slice(5, m.data.indexOf(";")) || "application/octet-stream";
    const b = new Blob([u8.buffer as ArrayBuffer], { type: mime });
    blobCache.current.set(m.id, b);
    return b;
  }, []);

  const revokeUrl = useCallback(() => {
    if (currentUrl.current) {
      try { URL.revokeObjectURL(currentUrl.current); } catch { /* ignore */ }
      currentUrl.current = null;
    }
  }, []);

  /* poll popup state */
  useEffect(() => {
    const t = setInterval(() => {
      const w = winRef.current;
      const isOpen = !!(w && !w.closed);
      setPopupOpen(isOpen);
      if (!isOpen && playingRef.current) {
        currentVideoEl.current = null;
        revokeUrl();
        setPlayingId(null);
        setPhase("idle");
      }
    }, 900);
    return () => clearInterval(t);
  }, [revokeUrl]);

  useEffect(
    () => () => {
      revokeUrl();
      blobCache.current.clear();
    },
    [revokeUrl]
  );

  const ensureWindow = useCallback((): Window | null => {
    const existing = winRef.current;
    if (existing && !existing.closed) {
      try {
        if (!existing.document.getElementById("stage")) injectPopupDOM(existing);
        return existing;
      } catch {
        try { existing.close(); } catch { /* ignore */ }
        winRef.current = null;
      }
    }
    const w = window.open("", "ordo-video", "popup,width=1280,height=720");
    if (!w) {
      setPanelError("pop-up bloqueado — permita pop-ups para este site.");
      return null;
    }
    if (!injectPopupDOM(w)) {
      setPanelError("não consegui preparar a janela de vídeo (permissões do navegador).");
      try { w.close(); } catch { /* ignore */ }
      return null;
    }
    winRef.current = w;
    setPopupOpen(true);
    return w;
  }, []);

  const stop = useCallback(() => {
    const el = currentVideoEl.current;
    if (el && "pause" in el) el.pause();
    currentVideoEl.current = null;
    revokeUrl();
    const w = winRef.current;
    if (w && !w.closed) {
      try {
        const stage = w.document.getElementById("stage");
        if (stage) stage.innerHTML = ""; // monitor volta a ficar 100% preto
        setOverlay(w, "");
      } catch { /* ignore */ }
    }
    setPlayingId(null);
    setPhase("idle");
  }, [revokeUrl]);

  const play = useCallback(
    (id: string) => {
      if (playingRef.current === id) {
        stop();
        return;
      }
      const media = videosRef.current.find((v) => v.id === id);
      if (!media) return;
      const w = ensureWindow();
      if (!w) return;

      stop();
      setPanelError(null);

      const stage = w.document.getElementById("stage");
      if (!stage) {
        setPanelError("janela de vídeo indisponível.");
        return;
      }
      stage.innerHTML = "";
      setOverlay(w, loadingHtml(media.name));
      setPhase("loading");

      // blob é passado para a janela e a URL é criada lá dentro — o mais robusto possível
      const blob = getBlob(media);
      if (blob.size === 0) {
        setOverlay(w, errHtml("o arquivo está vazio.", media.name));
        setPhase("error");
        return;
      }
      const url = (w as unknown as { URL: typeof URL }).URL.createObjectURL(blob);
      currentUrl.current = url;

      // ---- imagens: mesmo fluxo, só que sem player ----
      if (isImage(media)) {
        const img = w.document.createElement("img");
        img.src = url;
        img.alt = media.name;
        img.addEventListener("load", () => {
          if (currentVideoEl.current !== img) return;
          setOverlay(w, "");
          setPhase("playing");
          setPanelError(null);
        });
        img.addEventListener("error", () => {
          if (currentVideoEl.current !== img) return;
          setOverlay(w, errHtml("não foi possível exibir esta imagem.", media.name));
          setPhase("error");
          setPanelError("a imagem não pôde ser exibida — detalhes na janela.");
        });
        stage.appendChild(img);
        currentVideoEl.current = img;
        setPlayingId(id);
        return;
      }

      const v = w.document.createElement("video");
      v.src = url;
      v.controls = true;
      v.loop = true;
      v.playsInline = true;
      v.preload = "auto";
      v.volume = volumeRef.current;

      const errText = (code?: number) => {
        const map: Record<number, string> = {
          1: "o carregamento foi interrompido.",
          2: "erro de rede ao carregar o vídeo.",
          3: "não foi possível decodificar — o codec provavelmente não é compatível com este navegador (evite .mkv/.avi, prefira .mp4).",
          4: "formato não suportado por este navegador — prefira .mp4 ou .webm.",
        };
        return map[code ?? 0] ?? "erro desconhecido ao reproduzir.";
      };

      v.addEventListener("playing", () => {
        if (currentVideoEl.current !== v) return;
        setOverlay(w, "");
        setPhase("playing");
        setPanelError(null);
      });
      v.addEventListener("waiting", () => {
        if (currentVideoEl.current !== v) return;
        setOverlay(w, loadingHtml(media.name));
      });
      v.addEventListener("error", () => {
        if (currentVideoEl.current !== v) return;
        setOverlay(w, errHtml(errText(v.error?.code), media.name));
        setPhase("error");
        setPanelError("o vídeo não pôde ser reproduzido — detalhes na janela de vídeo.");
      });

      stage.appendChild(v);
      currentVideoEl.current = v;
      setPlayingId(id);

      const startPlayback = () => {
        v.play().catch(() => {
          if (currentVideoEl.current !== v) return;
          setOverlay(w, errHtml(errText(v.error?.code), media.name));
          setPhase("error");
        });
      };

      v.play().catch(() => {
        // autoplay com som bloqueado (o clique foi na outra janela) -> botão gigante no popup
        if (currentVideoEl.current !== v) return;
        setPhase("gesture");
        setOverlay(w, tapHtml());
        try {
          const btn = w.document.getElementById("tapbtn");
          if (btn) {
            (btn as HTMLButtonElement).onclick = () => {
              setOverlay(w, loadingHtml(media.name));
              startPlayback();
            };
          }
        } catch { /* ignore */ }
      });
    },
    [ensureWindow, getBlob, stop]
  );

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) =>
        f.type.startsWith("video/") ||
        f.type.startsWith("image/") ||
        /\.(mp4|mkv|webm|mov|avi|m4v|ogv|wmv|png|jpe?g|gif|webp|bmp|avif|svg)$/i.test(f.name)
    );
    if (list.length === 0) return;
    const items: OrdoMedia[] = [];
    for (const f of list) {
      items.push({ id: uid(), name: stripExt(f.name), data: await fileToDataURL(f) });
    }
    onChangeRef.current([...videosRef.current, ...items]);
  }, []);

  const remove = useCallback(
    (id: string) => {
      if (playingRef.current === id) stop();
      blobCache.current.delete(id);
      onChangeRef.current(videosRef.current.filter((x) => x.id !== id));
    },
    [stop]
  );

  const commitRename = useCallback(() => {
    const id = renamingId;
    setRenamingId(null);
    const v = renameVal.trim();
    if (!id || !v) return;
    onChangeRef.current(videosRef.current.map((x) => (x.id === id ? { ...x, name: v } : x)));
  }, [renamingId, renameVal]);

  const focusPopup = useCallback(() => {
    const w = winRef.current;
    if (w && !w.closed) {
      w.focus();
    } else {
      ensureWindow();
    }
  }, [ensureWindow]);

  const playingName = videos.find((v) => v.id === playingId)?.name;

  const phaseLabel =
    phase === "playing"
      ? playingName ?? "tocando"
      : phase === "loading"
        ? "carregando..."
        : phase === "gesture"
          ? "toque na janela para iniciar"
          : phase === "error"
            ? "erro na reprodução"
            : `${videos.length} ${videos.length === 1 ? "vídeo" : "vídeos"}`;

  return (
    <PanelChrome
      index="05"
      title="vídeo"
      icon={Film}
      className="col-span-6 row-span-1 lg:col-span-2"
      actions={
        tab === "cine" ? (
          <>
            {playingId && (
              <HeaderIconBtn title="parar exibição" onClick={stop}>
                <Square size={11} />
              </HeaderIconBtn>
            )}
            <HeaderIconBtn title={popupOpen ? "focar janela de vídeo" : "abrir janela de vídeo"} onClick={focusPopup} accent={popupOpen}>
              <MonitorUp size={12.5} />
            </HeaderIconBtn>
            <HeaderIconBtn title="adicionar vídeo ou imagem" onClick={() => inputRef.current?.click()} accent>
              <Plus size={13} strokeWidth={2.4} />
            </HeaderIconBtn>
          </>
        ) : undefined
      }
    >
      <div className="flex min-h-0 flex-1 flex-col">
        {/* abas */}
        <div className="flex shrink-0 items-center gap-1 border-b border-carbon-700/70 px-1.5 py-1">
          <TabBtn active={tab === "cine"} onClick={() => setTab("cine")}>
            <Clapperboard size={12} />
            cinematics
          </TabBtn>
          <TabBtn active={tab === "sfx"} onClick={() => setTab("sfx")}>
            <AudioWaveform size={12} />
            ambiente
          </TabBtn>
          {sfx.length > 0 && (
            <span
              title={`${sfx.length} ambiência(s) tocando`}
              className="ml-auto mr-1 flex items-center gap-1 font-mono text-[9px] uppercase tracking-[0.14em] text-acid-400"
            >
              <span className="h-1.5 w-1.5 rounded-full bg-acid-400 animate-[pulse-dot_1.6s_ease-in-out_infinite]" />
              {sfx.length}
            </span>
          )}
        </div>

        {tab === "sfx" ? (
          <SfxPanel sfx={sfx} onChange={onSfxChange} />
        ) : (
      <div
        className="flex min-h-0 flex-1 flex-col"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
      >
        {videos.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-5">
            <button
              onClick={() => inputRef.current?.click()}
              className="group flex w-full flex-col items-center gap-3.5 rounded-2xl border border-dashed border-carbon-500 px-6 py-9 transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.98]"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
                <Upload size={20} strokeWidth={1.7} />
              </span>
              <span className="text-center">
                <span className="block font-display text-sm font-semibold text-white">
                  adicionar vídeo ou imagem
                </span>
                <span className="mt-1 block font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.16em] text-carbon-400">
                  exibe na janela externa
                  <br />
                  tela preta quando parado
                </span>
              </span>
            </button>
          </div>
        ) : (
          <div className="os-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {videos.map((m, i) => {
              const active = playingId === m.id;
              return (
                <div
                  key={m.id}
                  {...dragProps(i)}
                  onContextMenu={(e) =>
                    open(e, [
                      {
                        label: "renomear",
                        icon: Pencil,
                        onClick: () => {
                          setRenamingId(m.id);
                          setRenameVal(m.name);
                        },
                      },
                      { label: "mover para o topo", icon: ArrowUpToLine, onClick: () => move(i, 0) },
                      { label: "remover", icon: Trash2, danger: true, onClick: () => remove(m.id) },
                    ])
                  }
                  className={`group relative flex items-center gap-2 rounded-xl border px-2 py-2.5 transition-all ${
                    active
                      ? "border-acid-500/50 bg-acid-400/[0.08]"
                      : "border-carbon-700 bg-carbon-850/60 hover:border-carbon-500 hover:bg-carbon-800"
                  } ${markerCls(i)}`}
                >
                  <span title="arraste para reordenar" className="shrink-0 cursor-grab active:cursor-grabbing">
                    <GripVertical
                      size={13}
                      className="text-carbon-500 opacity-40 transition-opacity group-hover:opacity-80"
                    />
                  </span>
                  <button
                    onClick={() => play(m.id)}
                    title={
                      active
                        ? "parar (monitor fica preto)"
                        : isImage(m)
                          ? "exibir na janela externa"
                          : "tocar na janela externa"
                    }
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all active:scale-90 ${
                      active
                        ? "bg-acid-400 text-carbon-950 shadow-[0_0_16px_rgba(212,247,76,0.35)]"
                        : "border border-carbon-600 text-carbon-300 group-hover:border-acid-500/40 group-hover:text-acid-300"
                    }`}
                  >
                    {active ? (
                      isImage(m) ? (
                        <ImageIcon size={13.5} />
                      ) : (
                        <span className="eq text-carbon-950"><i /><i /><i /><i /></span>
                      )
                    ) : isImage(m) ? (
                      <ImageIcon size={13.5} />
                    ) : (
                      <Clapperboard size={13.5} />
                    )}
                  </button>

                  {renamingId === m.id ? (
                    <input
                      autoFocus
                      value={renameVal}
                      onChange={(e) => setRenameVal(e.target.value)}
                      onBlur={commitRename}
                      onKeyDown={(e) => {
                        if (e.key === "Enter") commitRename();
                        if (e.key === "Escape") setRenamingId(null);
                      }}
                      className="min-w-0 flex-1 rounded-md border border-acid-500/50 bg-carbon-900 px-2 py-1 text-[12.5px] text-white outline-none"
                    />
                  ) : (
                    <button onClick={() => play(m.id)} className="min-w-0 flex-1 text-left" title={m.name}>
                      <span className={`block break-words text-[12.5px] font-medium leading-snug ${active ? "text-white" : "text-carbon-200"}`}>
                        {m.name}
                      </span>
                      {active && phase === "gesture" && (
                        <span className="mt-0.5 block font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-amber-300">
                          toque na janela preta
                        </span>
                      )}
                      {active && phase === "playing" && (
                        <span className="mt-0.5 block font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-acid-400">
                          na janela externa
                        </span>
                      )}
                      {active && phase === "error" && (
                        <span className="mt-0.5 block font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-ember-400">
                          falhou — veja a janela
                        </span>
                      )}
                    </button>
                  )}

                  {renamingId !== m.id && (
                    <ItemActions
                      onRename={() => {
                        setRenamingId(m.id);
                        setRenameVal(m.name);
                      }}
                      onRemove={() => remove(m.id)}
                    />
                  )}
                </div>
              );
            })}
          </div>
        )}

        {videos.length > 0 && (
          <div className="shrink-0 border-t border-carbon-700/60 px-3 py-1.5">
            <VolumeSlider value={volume} onChange={setVolume} title="volume dos vídeos" />
          </div>
        )}

        <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-carbon-700/60 px-3">
          <span className={`h-1.5 w-1.5 rounded-full ${popupOpen ? "bg-acid-400 animate-[pulse-dot_1.6s_ease-in-out_infinite]" : "bg-carbon-600"}`} />
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-carbon-500">
            {popupOpen ? "janela aberta" : "janela fechada"}
          </span>
          <span className={`ml-auto max-w-[55%] truncate font-mono text-[9.5px] uppercase tracking-[0.18em] ${
            phase === "error" ? "text-ember-400" : phase === "gesture" ? "text-amber-300" : phase === "playing" ? "text-acid-400" : "text-carbon-500"
          }`}>
            {phaseLabel}
          </span>
        </footer>

        {panelError && (
          <div className="absolute inset-x-2 bottom-8 z-10 flex items-start gap-2 rounded-lg border border-ember-400/50 bg-carbon-950/95 px-3 py-2 backdrop-blur">
            <TriangleAlert size={13} className="mt-0.5 shrink-0 text-ember-400" />
            <p className="text-[11px] leading-snug text-ember-400">{panelError}</p>
            <button
              onClick={() => setPanelError(null)}
              className="ml-auto flex h-4.5 w-4.5 shrink-0 items-center justify-center rounded text-carbon-400 transition-colors hover:text-white"
            >
              <X size={12} />
            </button>
          </div>
        )}
      </div>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="video/*,image/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <ContextMenuView menu={menu} onClose={close} />
    </PanelChrome>
  );
}

function TabBtn({
  active, onClick, children,
}: { active: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg px-2.5 py-1 font-mono text-[9.5px] font-semibold uppercase tracking-[0.14em] transition-colors ${
        active
          ? "bg-acid-400/15 text-acid-300"
          : "text-carbon-400 hover:bg-carbon-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

export const VideoPanel = memo(
  VideoPanelInner,
  (p, n) => p.videos === n.videos && p.sfx === n.sfx
);
