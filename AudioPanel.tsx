import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  Music, Plus, Pencil, Trash2, Upload, Repeat, LoaderCircle, X, Link2, TriangleAlert, PlayCircle,
  GripVertical, ArrowUpToLine,
} from "lucide-react";
import type { OrdoMedia } from "../types";
import { fileToDataURL, dataURLToObjectURL, stripExt, uid } from "../lib/ordo";
import { PanelChrome, HeaderIconBtn } from "./PanelChrome";
import { ContextMenuView, useContextMenu } from "./ContextMenu";
import { VolumeSlider } from "./VolumeSlider";
import { lsGet, lsSet } from "../lib/store";
import { useReorder } from "../lib/useReorder";
import { ItemActions } from "./ItemActions";
import { FadeToggles } from "./FadeToggles";
import type { YTPlayer } from "../lib/youtube";
import { parseYouTubeId, fetchYouTubeTitle, loadYouTubeAPI } from "../lib/youtube";

interface Props {
  audios: OrdoMedia[];
  onChange: (audios: OrdoMedia[]) => void;
}

const readVol = (key: string): number => {
  const raw = Number(lsGet(key));
  return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 1;
};

function AudioPanelInner({ audios, onChange }: Props) {
  const [playingId, setPlayingId] = useState<string | null>(null);
  const [volume, setVolume] = useState(() => readVol("ordo:vol:audio"));

  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [busy, setBusy] = useState(false);
  const [chooser, setChooser] = useState(false);
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytBusy, setYtBusy] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [ytPrepared, setYtPrepared] = useState<Record<string, "loading" | "ready" | "error">>({});
  const els = useRef(new Map<string, HTMLAudioElement>());
  const inputRef = useRef<HTMLInputElement>(null);
  const ytHostRef = useRef<HTMLDivElement>(null);
  const ytPlayers = useRef(new Map<string, YTPlayer>());
  const ytCreating = useRef(new Map<string, Promise<YTPlayer | null>>());
  const ytVolumes = useRef(new Map<string, number>());
  const { menu, open, close } = useContextMenu();
  const { dragProps, markerCls, move } = useReorder(audios, (next) => onChangeRef.current(next));

  const audiosRef = useRef(audios);
  useEffect(() => { audiosRef.current = audios; });
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });

  const volumeRef = useRef(volume);
  useEffect(() => { volumeRef.current = volume; });
  const playingRef = useRef(playingId);
  useEffect(() => { playingRef.current = playingId; });

  // fade por faixa (padrão: ligado quando não definido)
  const wantsFadeIn = (m?: OrdoMedia) => m?.fadeIn !== false;
  const wantsFadeOut = (m?: OrdoMedia) => m?.fadeOut !== false;

  // Estado e referência precisam mudar juntos. O player do YouTube pode iniciar
  // no mesmo tick do clique, antes de o React executar o próximo useEffect.
  const setPlaying = useCallback((id: string | null) => {
    playingRef.current = id;
    setPlayingId(id);
  }, []);

  const getEl = useCallback((m: OrdoMedia): HTMLAudioElement => {
    const cached = els.current.get(m.id);
    if (cached) return cached;
    const a = new Audio(dataURLToObjectURL(m.data));
    a.loop = true;
    a.preload = "auto";
    a.volume = volumeRef.current;
    els.current.set(m.id, a);
    return a;
  }, []);

  /* ---- controle unificado (arquivo local ou youtube) ---- */
  const isYT = (m: OrdoMedia) => m.source === "youtube" && !!m.videoId;

  /** adaptador de volume/transporte para os dois tipos de faixa */
  const ctrl = useCallback(
    (m: OrdoMedia) => {
      if (isYT(m)) {
        const p = ytPlayers.current.get(m.id);
        return {
          get: () => ytVolumes.current.get(m.id) ?? 0,
          set: (v: number) => {
            ytVolumes.current.set(m.id, v);
            try { p?.setVolume(Math.round(v * 100)); } catch { /* ainda carregando */ }
          },
          pauseReset: () => {
            try {
              p?.pauseVideo();
              p?.seekTo(0, true);
            } catch { /* ignore */ }
          },
        };
      }
      const a = els.current.get(m.id);
      return {
        get: () => a?.volume ?? 0,
        set: (v: number) => { if (a) a.volume = Math.max(0, Math.min(1, v)); },
        pauseReset: () => {
          if (a) {
            a.pause();
            a.currentTime = 0;
          }
        },
      };
    },
    []
  );

  /* ---- fades ---- */
  const fades = useRef(new Map<string, { raf: number; to: number }>());

  const cancelFade = useCallback((id: string) => {
    const f = fades.current.get(id);
    if (f) {
      cancelAnimationFrame(f.raf);
      fades.current.delete(id);
    }
  }, []);

  const fadeTo = useCallback(
    (
      id: string,
      c: { get: () => number; set: (v: number) => void },
      to: number,
      ms: number,
      done?: () => void
    ) => {
      cancelFade(id);
      const from = c.get();
      if (ms <= 0 || Math.abs(to - from) < 0.005) {
        c.set(Math.max(0, Math.min(1, to)));
        done?.();
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const entry = fades.current.get(id);
        const target = entry ? entry.to : to;
        const t = Math.min(1, (now - start) / ms);
        // curva suave (ease-in-out) para o fade soar natural
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        c.set(Math.max(0, Math.min(1, from + (target - from) * eased)));
        if (t < 1) {
          fades.current.set(id, { raf: requestAnimationFrame(step), to: target });
        } else {
          fades.current.delete(id);
          done?.();
        }
      };
      fades.current.set(id, { raf: requestAnimationFrame(step), to });
    },
    [cancelFade]
  );

  /* aplica o volume em todas as faixas já carregadas */
  useEffect(() => {
    els.current.forEach((a, id) => {
      const f = fades.current.get(id);
      if (f) {
        // fade em andamento: só atualiza o alvo se for um fade-in
        if (f.to > 0) f.to = volume;
      } else {
        a.volume = volume;
      }
    });
    // youtube: cada faixa tem seu próprio player para permitir crossfade real
    ytPlayers.current.forEach((player, id) => {
      const f = fades.current.get(id);
      if (f) {
        if (f.to > 0) f.to = volume;
      } else if (playingRef.current === id) {
        ytVolumes.current.set(id, volume);
        try { player.setVolume(Math.round(volume * 100)); } catch { /* ignore */ }
      }
    });
    lsSet("ordo:vol:audio", String(volume));
  }, [volume]);

  const FADE_MS = 900;

  /** para imediatamente, sem fade (usado ao remover/desmontar) */
  const hardStop = useCallback(
    (id: string) => {
      cancelFade(id);
      const a = els.current.get(id);
      if (a) {
        a.pause();
        a.currentTime = 0;
      }
      const m = audiosRef.current.find((x) => x.id === id);
      if (m && isYT(m)) {
        try {
          const player = ytPlayers.current.get(id);
          player?.pauseVideo();
          player?.seekTo(0, true);
        } catch { /* ignore */ }
      }
    },
    [cancelFade]
  );

  /** para com fade out e reinicia do zero ao terminar */
  const fadeOutStop = useCallback(
    (id: string) => {
      const m = audiosRef.current.find((x) => x.id === id);
      if (!m) return;
      if (!isYT(m) && !els.current.get(id)) return;
      const c = ctrl(m);
      fadeTo(id, c, 0, wantsFadeOut(m) ? FADE_MS : 0, () => {
        c.pauseReset(); // reinicia do zero ao parar
        c.set(volumeRef.current);
      });
    },
    [ctrl, fadeTo]
  );

  const stop = hardStop;

  /** garante um player independente para cada faixa do youtube */
  const ensureYT = useCallback(async (media: OrdoMedia): Promise<YTPlayer | null> => {
    const ready = ytPlayers.current.get(media.id);
    if (ready) return ready;
    const creating = ytCreating.current.get(media.id);
    if (creating) return creating;
    const host = ytHostRef.current;
    if (!host) return null;
    const YT = await loadYouTubeAPI();
    const existing = ytPlayers.current.get(media.id);
    if (existing) return existing;

    setYtPrepared((state) => ({ ...state, [media.id]: "loading" }));
    const promise = new Promise<YTPlayer | null>((resolve) => {
      const mount = document.createElement("div");
      mount.dataset.youtubeTrack = media.id;
      host.appendChild(mount);
      const player = new YT.Player(mount, {
        width: "320",
        height: "180",
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            ytPlayers.current.set(media.id, player);
            ytVolumes.current.set(media.id, volumeRef.current);
            try {
              player.setVolume(Math.round(volumeRef.current * 100));
              player.cueVideoById(media.videoId!);
            } catch { /* ignore */ }
            ytCreating.current.delete(media.id);
            resolve(player);
          },
          onError: () => {
            if (playingRef.current === media.id) {
              setYtError("não foi possível tocar este vídeo (pode ter bloqueio de incorporação).");
            }
            setYtPrepared((state) => ({ ...state, [media.id]: "error" }));
            ytCreating.current.delete(media.id);
            resolve(player);
          },
          onStateChange: (ev: { data: number }) => {
            // 5 = mídia carregada em cue; 1 = reproduzindo
            if (ev.data === 5 || ev.data === 1 || ev.data === 2) {
              setYtPrepared((state) => ({ ...state, [media.id]: "ready" }));
            }
            // 0 = terminou -> repete, mantendo o loop igual aos arquivos
            if (ev.data === 0) {
              try {
                player.seekTo(0, true);
                player.playVideo();
              } catch { /* ignore */ }
            }
          },
        },
      });
    });
    ytCreating.current.set(media.id, promise);
    return promise;
  }, []);

  /*
   * Pré-carrega e deixa cada faixa do YouTube em estado "cue". A fila é
   * sequencial para não criar dezenas de iframes ao mesmo tempo nem travar a UI.
   */
  useEffect(() => {
    const youtubeTracks = audios.filter(isYT);
    if (youtubeTracks.length === 0) return;
    let cancelled = false;
    const timer = window.setTimeout(() => {
      void (async () => {
        for (const media of youtubeTracks) {
          if (cancelled) return;
          try {
            await ensureYT(media);
          } catch {
            if (!cancelled) {
              setYtPrepared((state) => ({ ...state, [media.id]: "error" }));
            }
          }
          // Dá tempo ao navegador entre iframes, principalmente no celular.
          await new Promise((resolve) => setTimeout(resolve, 80));
        }
      })();
    }, 250);
    return () => {
      cancelled = true;
      clearTimeout(timer);
    };
  }, [audios, ensureYT]);

  const toggle = useCallback(
    (id: string) => {
      if (playingId === id) {
        fadeOutStop(id); // parada manual também dá fade out
        setPlaying(null);
        return;
      }
      if (playingId) fadeOutStop(playingId); // a anterior sai em fade out
      const m = audiosRef.current.find((x) => x.id === id);
      if (!m) return;

      /* ---- faixa do youtube ---- */
      if (isYT(m)) {
        setYtError(null);
        setPlaying(id);
        cancelFade(id);
        ytVolumes.current.set(id, wantsFadeIn(m) ? 0 : volumeRef.current);
        const start = (p: YTPlayer | null) => {
          if (!p || playingRef.current !== id) return;
          try {
            p.setVolume(wantsFadeIn(m) ? 0 : Math.round(volumeRef.current * 100));
            // O vídeo já foi preparado por cueVideoById no preload. Recarregá-lo
            // aqui anulava o preload e introduzia outra espera desnecessária.
            p.seekTo(0, true);
            p.playVideo();
            fadeTo(id, ctrl(m), volumeRef.current, wantsFadeIn(m) ? FADE_MS : 0);
          } catch {
            setYtError("não foi possível iniciar esta faixa do youtube.");
            setPlaying(null);
          }
        };

        // Player pré-carregado: inicia sincronamente no clique e preserva a
        // permissão de reprodução do navegador. Só aguarda quando ainda carrega.
        const ready = ytPlayers.current.get(id);
        if (ready) {
          start(ready);
        } else {
          void ensureYT(m)
            .then(start)
            .catch(() => {
              setYtError("não foi possível carregar o youtube.");
              setPlaying(null);
            });
        }
        return;
      }

      /* ---- arquivo local (comportamento original) ---- */
      const a = getEl(m);
      cancelFade(id);
      a.currentTime = 0;
      // com fade-in começa do silêncio; sem fade-in já entra no volume cheio
      a.volume = wantsFadeIn(m) ? 0 : volumeRef.current;
      a.play()
        .then(() => fadeTo(id, ctrl(m), volumeRef.current, wantsFadeIn(m) ? FADE_MS : 0))
        .catch(() => {
          a.volume = volumeRef.current;
          setPlaying(null);
        });
      setPlaying(id);
    },
    [playingId, getEl, fadeOutStop, fadeTo, cancelFade, ctrl, ensureYT, setPlaying]
  );

  useEffect(
    () => () => {
      fades.current.forEach((f) => cancelAnimationFrame(f.raf));
      fades.current.clear();
      els.current.forEach((a) => {
        a.pause();
        URL.revokeObjectURL(a.src);
      });
      els.current.clear();
      ytPlayers.current.forEach((player) => {
        try { player.destroy(); } catch { /* ignore */ }
      });
      ytPlayers.current.clear();
      ytCreating.current.clear();
      ytVolumes.current.clear();
    },
    []
  );

  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|wma)$/i.test(f.name));
    if (list.length === 0) return;
    setBusy(true);
    try {
      const items: OrdoMedia[] = [];
      for (const f of list) {
        items.push({ id: uid(), name: stripExt(f.name), data: await fileToDataURL(f) });
      }
      onChangeRef.current([...audiosRef.current, ...items]);
    } finally {
      setBusy(false);
    }
  }, []);

  const addYouTube = useCallback(async () => {
    const id = parseYouTubeId(ytUrl);
    if (!id) {
      setYtError("link inválido — cole o endereço completo do vídeo.");
      return;
    }
    setYtBusy(true);
    setYtError(null);
    try {
      const title = await fetchYouTubeTitle(id);
      const item: OrdoMedia = {
        id: uid(),
        name: title ?? `youtube ${id}`,
        data: "",
        source: "youtube",
        videoId: id,
      };
      onChangeRef.current([...audiosRef.current, item]);
      setYtUrl("");
      setYtOpen(false);
    } finally {
      setYtBusy(false);
    }
  }, [ytUrl]);

  const remove = useCallback(
    (id: string) => {
      if (playingId === id) setPlaying(null);
      stop(id);
      const a = els.current.get(id);
      if (a) URL.revokeObjectURL(a.src);
      els.current.delete(id);
      const player = ytPlayers.current.get(id);
      if (player) {
        try { player.destroy(); } catch { /* ignore */ }
        ytPlayers.current.delete(id);
        ytVolumes.current.delete(id);
      }
      onChangeRef.current(audiosRef.current.filter((x) => x.id !== id));
    },
    [playingId, stop, setPlaying]
  );

  const toggleFade = useCallback((id: string, which: "fadeIn" | "fadeOut") => {
    onChangeRef.current(
      audiosRef.current.map((x) =>
        x.id === id ? { ...x, [which]: x[which] === false } : x
      )
    );
  }, []);

  const commitRename = useCallback(() => {
    const id = renamingId;
    setRenamingId(null);
    const v = renameVal.trim();
    if (!id || !v) return;
    onChangeRef.current(audiosRef.current.map((x) => (x.id === id ? { ...x, name: v } : x)));
    const a = els.current.get(id);
    if (a) a.dataset.name = v;
  }, [renamingId, renameVal]);

  return (
    <PanelChrome
      index="03"
      title="áudio"
      icon={Music}
      className="col-span-6 row-span-1 lg:col-span-2"
      actions={
        <HeaderIconBtn title="adicionar áudio" onClick={() => setChooser(true)} accent>
          <Plus size={13} strokeWidth={2.4} />
        </HeaderIconBtn>
      }
    >
      <div
        className="flex min-h-0 flex-1 flex-col"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
      >
        {audios.length === 0 ? (
          <div className="flex flex-1 items-center justify-center p-5">
            <button
              onClick={() => setChooser(true)}
              className="group flex w-full flex-col items-center gap-3.5 rounded-2xl border border-dashed border-carbon-500 px-6 py-9 transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.98]"
            >
              <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
                <Upload size={20} strokeWidth={1.7} />
              </span>
              <span className="text-center">
                <span className="block font-display text-sm font-semibold text-white">adicionar áudio</span>
                <span className="mt-1 block font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.16em] text-carbon-400">
                  qualquer formato · toca em loop
                  <br />
                  botão direito para renomear
                </span>
              </span>
            </button>
          </div>
        ) : (
          <div className="os-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
            {audios.map((m, i) => {
              const active = playingId === m.id;
              const prep = m.source === "youtube" ? ytPrepared[m.id] : undefined;
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
                    onClick={() => toggle(m.id)}
                    title={active ? "parar (reinicia do zero)" : "tocar em loop"}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all active:scale-90 ${
                      active
                        ? "bg-acid-400 text-carbon-950 shadow-[0_0_16px_rgba(212,247,76,0.35)]"
                        : "border border-carbon-600 text-carbon-300 group-hover:border-acid-500/40 group-hover:text-acid-300"
                    }`}
                  >
                    {active ? (
                      <span className="eq text-carbon-950"><i /><i /><i /><i /></span>
                    ) : prep === "loading" ? (
                      <LoaderCircle size={13} className="anim-spin-slow" />
                    ) : m.source === "youtube" ? (
                      <PlayCircle size={14} />
                    ) : (
                      <Music size={13.5} />
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
                    <button
                      onClick={() => toggle(m.id)}
                      className="min-w-0 flex-1 text-left"
                      title={m.name}
                    >
                      <span className={`block break-words text-[12.5px] font-medium leading-snug ${active ? "text-white" : "text-carbon-200"}`}>
                        {m.name}
                      </span>
                      {active ? (
                        <span className="mt-0.5 flex items-center gap-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-acid-400">
                          <Repeat size={9} /> loop ativo
                        </span>
                      ) : m.source === "youtube" ? (
                        <span className={`mt-0.5 flex items-center gap-1.5 font-mono text-[8.5px] font-semibold uppercase tracking-[0.18em] ${
                          prep === "ready"
                            ? "text-acid-400/75"
                            : prep === "error"
                              ? "text-ember-400"
                              : "text-carbon-500"
                        }`}>
                          <span className={`h-1.5 w-1.5 rounded-full ${
                            prep === "ready"
                              ? "bg-acid-400"
                              : prep === "error"
                                ? "bg-ember-400"
                                : "bg-carbon-500 animate-pulse"
                          }`} />
                          {prep === "ready"
                            ? "youtube · pronto"
                            : prep === "error"
                              ? "youtube · indisponível"
                              : "youtube · preparando"}
                        </span>
                      ) : null}
                    </button>
                  )}

                  {renamingId !== m.id && (
                    <>
                      <FadeToggles
                        fadeIn={m.fadeIn !== false}
                        fadeOut={m.fadeOut !== false}
                        onToggleIn={() => toggleFade(m.id, "fadeIn")}
                        onToggleOut={() => toggleFade(m.id, "fadeOut")}
                      />
                      <ItemActions
                        onRename={() => {
                          setRenamingId(m.id);
                          setRenameVal(m.name);
                        }}
                        onRemove={() => remove(m.id)}
                      />
                    </>
                  )}
                </div>
              );
            })}
          </div>
        )}

        {audios.length > 0 && (
          <>
            <div className="shrink-0 border-t border-carbon-700/60 px-3 py-1.5">
              <VolumeSlider value={volume} onChange={setVolume} title="volume das músicas" />
            </div>
            <footer className="flex h-6 shrink-0 items-center border-t border-carbon-700/60 px-3">
              <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-carbon-500">
                {audios.length} {audios.length === 1 ? "faixa" : "faixas"}{busy ? " · carregando" : ""}
              </span>
              <span className={`ml-auto font-mono text-[9.5px] uppercase tracking-[0.18em] ${playingId ? "text-acid-400" : "text-carbon-500"}`}>
                {playingId ? "tocando" : "parado"}
              </span>
            </footer>
          </>
        )}
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="audio/*"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
      />
      <ContextMenuView menu={menu} onClose={close} />

      {/* player do youtube fora da tela (só o áudio importa) */}
      <div
        ref={ytHostRef}
        aria-hidden
        className="pointer-events-none fixed bottom-0 left-0 z-[-1] h-px w-px overflow-hidden opacity-[0.01]"
      />

      {/* escolha da origem */}
      {chooser && (
        <div
          className="anim-fade-in absolute inset-0 z-30 flex items-center justify-center bg-carbon-950/85 p-4 backdrop-blur-sm"
          onMouseDown={() => setChooser(false)}
        >
          <div
            className="anim-pop-in w-full max-w-[260px] rounded-2xl border border-carbon-600 bg-carbon-850 p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center justify-between">
              <p className="font-display text-[13.5px] font-semibold text-white">adicionar música</p>
              <button
                onClick={() => setChooser(false)}
                className="flex h-6 w-6 items-center justify-center rounded-md text-carbon-400 hover:bg-carbon-700 hover:text-white"
              >
                <X size={13} />
              </button>
            </div>
            <button
              onClick={() => {
                setChooser(false);
                inputRef.current?.click();
              }}
              className="mb-2 flex w-full items-center gap-2.5 rounded-xl border border-carbon-600 bg-carbon-800/70 px-3 py-2.5 text-left transition-colors hover:border-acid-500/50 hover:bg-carbon-800"
            >
              <Upload size={15} className="shrink-0 text-acid-300" />
              <span>
                <span className="block text-[12.5px] font-medium text-white">adicionar arquivo</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-carbon-400">
                  do computador
                </span>
              </span>
            </button>
            <button
              onClick={() => {
                setChooser(false);
                setYtUrl("");
                setYtError(null);
                setYtOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl border border-carbon-600 bg-carbon-800/70 px-3 py-2.5 text-left transition-colors hover:border-ember-400/50 hover:bg-carbon-800"
            >
              <PlayCircle size={15} className="shrink-0 text-ember-400" />
              <span>
                <span className="block text-[12.5px] font-medium text-white">link do youtube</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-carbon-400">
                  colar endereço do vídeo
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* caixa do link */}
      {ytOpen && (
        <div
          className="anim-fade-in absolute inset-0 z-30 flex items-center justify-center bg-carbon-950/85 p-4 backdrop-blur-sm"
          onMouseDown={() => !ytBusy && setYtOpen(false)}
        >
          <div
            className="anim-pop-in w-full max-w-[300px] rounded-2xl border border-carbon-600 bg-carbon-850 p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <PlayCircle size={15} className="text-ember-400" />
              <p className="font-display text-[13.5px] font-semibold text-white">link do youtube</p>
              <button
                onClick={() => setYtOpen(false)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-carbon-400 hover:bg-carbon-700 hover:text-white"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-carbon-600 bg-carbon-900 px-2.5">
              <Link2 size={13} className="shrink-0 text-carbon-500" />
              <input
                autoFocus
                value={ytUrl}
                onChange={(e) => setYtUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && !ytBusy && void addYouTube()}
                placeholder="https://youtube.com/watch?v=..."
                className="min-w-0 flex-1 bg-transparent py-2 text-[12px] text-white outline-none placeholder:text-carbon-600"
              />
            </div>
            {ytError && (
              <p className="anim-pop-in mb-2 flex items-start gap-1.5 rounded-lg border border-ember-400/40 bg-ember-400/10 px-2.5 py-1.5 text-[11px] leading-snug text-ember-400">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {ytError}
              </p>
            )}
            <button
              onClick={() => void addYouTube()}
              disabled={ytBusy || !ytUrl.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-acid-400 py-2.5 text-[12.5px] font-bold text-carbon-950 transition-colors hover:bg-acid-300 disabled:opacity-50"
            >
              {ytBusy ? <LoaderCircle size={14} className="anim-spin-slow" /> : <Plus size={14} strokeWidth={2.6} />}
              {ytBusy ? "buscando..." : "adicionar à lista"}
            </button>
            <p className="mt-2 text-center font-mono text-[9px] leading-relaxed text-carbon-500">
              o áudio toca direto do youtube, em loop,
              <br />
              com os mesmos controles de volume e fade
            </p>
          </div>
        </div>
      )}
    </PanelChrome>
  );
}

export const AudioPanel = memo(AudioPanelInner, (p, n) => p.audios === n.audios);
