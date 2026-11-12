import { useCallback, useEffect, useRef, useState } from "react";
import {
  AudioWaveform, Plus, Pencil, Trash2, Upload, Repeat, X, Link2, TriangleAlert,
  PlayCircle, LoaderCircle, Volume2, Square, GripVertical, ArrowUpToLine,
} from "lucide-react";
import type { OrdoMedia } from "../types";
import { fileToDataURL, dataURLToObjectURL, stripExt, uid } from "../lib/ordo";
import { ContextMenuView, useContextMenu } from "./ContextMenu";
import { lsGet, lsSet } from "../lib/store";
import { useReorder } from "../lib/useReorder";
import { ItemActions } from "./ItemActions";
import { FadeToggles } from "./FadeToggles";
import type { YTPlayer } from "../lib/youtube";
import { parseYouTubeId, fetchYouTubeTitle, loadYouTubeAPI } from "../lib/youtube";

interface Props {
  sfx: OrdoMedia[];
  onChange: (sfx: OrdoMedia[]) => void;
}

const DEFAULT_VOL = 0.7;



export function SfxPanel({ sfx, onChange }: Props) {
  /** ids tocando agora — ambientes podem tocar em camadas */
  const [playing, setPlaying] = useState<Set<string>>(new Set());
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [chooser, setChooser] = useState(false);
  const [ytOpen, setYtOpen] = useState(false);
  const [ytUrl, setYtUrl] = useState("");
  const [ytBusy, setYtBusy] = useState(false);
  const [ytError, setYtError] = useState<string | null>(null);
  const [loadingIds, setLoadingIds] = useState<Set<string>>(new Set());
  const [master, setMaster] = useState(() => {
    const raw = Number(lsGet("ordo:vol:sfxmaster"));
    return Number.isFinite(raw) && raw >= 0 && raw <= 1 ? raw : 0.8;
  });


  const els = useRef(new Map<string, HTMLAudioElement>());
  const ytPlayers = useRef(new Map<string, YTPlayer>());
  const ytCreating = useRef(new Map<string, Promise<YTPlayer | null>>());
  const ytHostRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);
  const { menu, open, close } = useContextMenu();

  const sfxRef = useRef(sfx);
  useEffect(() => { sfxRef.current = sfx; });
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const masterRef = useRef(master);
  useEffect(() => { masterRef.current = master; });
  const playingRef = useRef(playing);
  useEffect(() => { playingRef.current = playing; });

  // fade por som (padrão: ligado quando não definido)
  const wantsFadeIn = (id: string) =>
    sfxRef.current.find((x) => x.id === id)?.fadeIn !== false;
  const wantsFadeOut = (id: string) =>
    sfxRef.current.find((x) => x.id === id)?.fadeOut !== false;

  const { dragProps, markerCls, move } = useReorder(sfx, (next) => onChangeRef.current(next));

  const volOf = useCallback(
    (m: OrdoMedia) => (typeof m.volume === "number" ? m.volume : DEFAULT_VOL),
    []
  );

  const isYT = (m: OrdoMedia) => m.source === "youtube" && !!m.videoId;

  /* ---------- volume ---------- */
  /** multiplicador do fade por item (0 = mudo, 1 = volume cheio) */
  const fadeMul = useRef(new Map<string, number>());
  const fades = useRef(new Map<string, number>());

  const setRawVol = useCallback((id: string, v: number) => {
    const clamped = Math.max(0, Math.min(1, v));
    const el = els.current.get(id);
    if (el) el.volume = clamped;
    const p = ytPlayers.current.get(id);
    if (p) {
      try { p.setVolume(Math.round(clamped * 100)); } catch { /* carregando */ }
    }
  }, []);

  const applyVol = useCallback(
    (m: OrdoMedia) => {
      const base = (typeof m.volume === "number" ? m.volume : DEFAULT_VOL) * masterRef.current;
      setRawVol(m.id, base * (fadeMul.current.get(m.id) ?? 1));
    },
    [setRawVol]
  );

  const cancelFade = useCallback((id: string) => {
    const raf = fades.current.get(id);
    if (raf) {
      cancelAnimationFrame(raf);
      fades.current.delete(id);
    }
  }, []);

  const FADE_MS = 1200;

  /** anima o multiplicador do item entre o valor atual e `to` */
  const fadeItem = useCallback(
    (id: string, to: number, ms: number, done?: () => void) => {
      cancelFade(id);
      const m = sfxRef.current.find((x) => x.id === id);
      const base = m
        ? (typeof m.volume === "number" ? m.volume : DEFAULT_VOL) * masterRef.current
        : 0;
      const from = fadeMul.current.get(id) ?? (to > 0 ? 0 : 1);
      if (ms <= 0) {
        fadeMul.current.set(id, to);
        setRawVol(id, base * to);
        done?.();
        return;
      }
      const start = performance.now();
      const step = (now: number) => {
        const t = Math.min(1, (now - start) / ms);
        const eased = t < 0.5 ? 2 * t * t : 1 - (-2 * t + 2) ** 2 / 2;
        const mul = from + (to - from) * eased;
        fadeMul.current.set(id, mul);
        // relê o volume atual do item, para o slider continuar funcionando durante o fade
        const cur = sfxRef.current.find((x) => x.id === id);
        const b = cur
          ? (typeof cur.volume === "number" ? cur.volume : DEFAULT_VOL) * masterRef.current
          : base;
        setRawVol(id, b * mul);
        if (t < 1) fades.current.set(id, requestAnimationFrame(step));
        else {
          fades.current.delete(id);
          done?.();
        }
      };
      fades.current.set(id, requestAnimationFrame(step));
    },
    [cancelFade, setRawVol]
  );

  useEffect(() => {
    lsSet("ordo:vol:sfxmaster", String(master));
    sfxRef.current.forEach(applyVol);
  }, [master, applyVol]);

  /* ---------- elementos ---------- */
  const getEl = useCallback((m: OrdoMedia): HTMLAudioElement => {
    const hit = els.current.get(m.id);
    if (hit) return hit;
    const a = new Audio(dataURLToObjectURL(m.data));
    a.loop = true;
    a.preload = "auto";
    els.current.set(m.id, a);
    return a;
  }, []);

  const ensureYT = useCallback(async (media: OrdoMedia): Promise<YTPlayer | null> => {
    const ready = ytPlayers.current.get(media.id);
    if (ready) return ready;
    const creating = ytCreating.current.get(media.id);
    if (creating) return creating;
    const host = ytHostRef.current;
    if (!host) return null;
    const YT = await loadYouTubeAPI();
    if (ytPlayers.current.get(media.id)) return ytPlayers.current.get(media.id)!;

    const promise = new Promise<YTPlayer | null>((resolve) => {
      const mount = document.createElement("div");
      host.appendChild(mount);
      const player = new YT.Player(mount, {
        width: "200",
        height: "120",
        playerVars: { autoplay: 0, controls: 0, disablekb: 1, playsinline: 1, rel: 0 },
        events: {
          onReady: () => {
            ytPlayers.current.set(media.id, player);
            try {
              player.cueVideoById(media.videoId!);
              applyVol(media);
            } catch { /* ignore */ }
            ytCreating.current.delete(media.id);
            resolve(player);
          },
          onError: () => {
            ytCreating.current.delete(media.id);
            resolve(player);
          },
          onStateChange: (ev: { data: number }) => {
            if (ev.data === 0) {
              // terminou -> repete, mantendo o loop
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
  }, [applyVol]);

  /* pré-carrega as faixas do youtube do ambiente */
  useEffect(() => {
    const list = sfx.filter(isYT);
    if (list.length === 0) return;
    let cancelled = false;
    const t = window.setTimeout(() => {
      void (async () => {
        for (const m of list) {
          if (cancelled) return;
          await ensureYT(m).catch(() => undefined);
          await new Promise((r) => setTimeout(r, 80));
        }
      })();
    }, 300);
    return () => {
      cancelled = true;
      clearTimeout(t);
    };
  }, [sfx, ensureYT]);

  /* ---------- play / stop (em camadas) ---------- */
  /** corta na hora, sem fade (usado ao remover/desmontar) */
  const hardStop = useCallback((id: string) => {
    cancelFade(id);
    fadeMul.current.set(id, 1);
    const el = els.current.get(id);
    if (el) {
      el.pause();
      el.currentTime = 0;
    }
    const p = ytPlayers.current.get(id);
    if (p) {
      try {
        p.pauseVideo();
        p.seekTo(0, true);
      } catch { /* ignore */ }
    }
    setPlaying((prev) => {
      const n = new Set(prev);
      n.delete(id);
      return n;
    });
  }, [cancelFade]);

  /** para com fade out (quando ligado) e reinicia do zero ao terminar */
  const stopOne = useCallback(
    (id: string) => {
      setPlaying((prev) => {
        const n = new Set(prev);
        n.delete(id);
        return n;
      });
      if (!wantsFadeOut(id)) {
        hardStop(id);
        return;
      }
      fadeItem(id, 0, FADE_MS, () => {
        const el = els.current.get(id);
        if (el) {
          el.pause();
          el.currentTime = 0;
        }
        const p = ytPlayers.current.get(id);
        if (p) {
          try {
            p.pauseVideo();
            p.seekTo(0, true);
          } catch { /* ignore */ }
        }
        fadeMul.current.set(id, 1); // pronto para a próxima vez
      });
    },
    [fadeItem, hardStop]
  );

  const toggle = useCallback(
    (id: string) => {
      const m = sfxRef.current.find((x) => x.id === id);
      if (!m) return;
      if (playingRef.current.has(id)) {
        stopOne(id);
        return;
      }

      setPlaying((prev) => new Set(prev).add(id));
      cancelFade(id);
      // com fade-in entra do silêncio; sem ele já começa no volume cheio
      fadeMul.current.set(id, wantsFadeIn(id) ? 0 : 1);

      if (isYT(m)) {
        const start = (p: YTPlayer | null) => {
          if (!p) return;
          try {
            applyVol(m);
            p.seekTo(0, true);
            p.playVideo();
            if (wantsFadeIn(id)) fadeItem(id, 1, FADE_MS);
          } catch { /* ignore */ }
          setLoadingIds((prev) => {
            const n = new Set(prev);
            n.delete(id);
            return n;
          });
        };
        const ready = ytPlayers.current.get(id);
        if (ready) start(ready);
        else {
          setLoadingIds((prev) => new Set(prev).add(id));
          void ensureYT(m).then(start).catch(() => hardStop(id));
        }
        return;
      }

      const a = getEl(m);
      applyVol(m);
      a.currentTime = 0;
      a.play()
        .then(() => {
          if (wantsFadeIn(id)) fadeItem(id, 1, FADE_MS);
        })
        .catch(() => hardStop(id));
    },
    [applyVol, cancelFade, ensureYT, fadeItem, getEl, hardStop, stopOne]
  );

  const stopAll = useCallback(() => {
    playingRef.current.forEach((id) => stopOne(id));
  }, [stopOne]);

  useEffect(
    () => () => {
      els.current.forEach((a) => {
        a.pause();
        URL.revokeObjectURL(a.src);
      });
      els.current.clear();
      ytPlayers.current.forEach((p) => {
        try { p.destroy(); } catch { /* ignore */ }
      });
      ytPlayers.current.clear();
    },
    []
  );

  /* ---------- crud ---------- */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter(
      (f) => f.type.startsWith("audio/") || /\.(mp3|wav|ogg|oga|flac|m4a|aac|opus|webm|wma)$/i.test(f.name)
    );
    if (list.length === 0) return;
    const items: OrdoMedia[] = [];
    for (const f of list) {
      items.push({
        id: uid(),
        name: stripExt(f.name),
        data: await fileToDataURL(f),
        source: "file",
        volume: DEFAULT_VOL,
      });
    }
    onChangeRef.current([...sfxRef.current, ...items]);
  }, []);

  const addYouTube = useCallback(async () => {
    const vid = parseYouTubeId(ytUrl);
    if (!vid) {
      setYtError("link inválido — cole o endereço completo do vídeo.");
      return;
    }
    setYtBusy(true);
    setYtError(null);
    try {
      const title = await fetchYouTubeTitle(vid);
      onChangeRef.current([
        ...sfxRef.current,
        {
          id: uid(),
          name: title ?? `youtube ${vid}`,
          data: "",
          source: "youtube",
          videoId: vid,
          volume: DEFAULT_VOL,
        },
      ]);
      setYtUrl("");
      setYtOpen(false);
    } finally {
      setYtBusy(false);
    }
  }, [ytUrl]);

  const remove = useCallback(
    (id: string) => {
      hardStop(id);
      const a = els.current.get(id);
      if (a) URL.revokeObjectURL(a.src);
      els.current.delete(id);
      const p = ytPlayers.current.get(id);
      if (p) {
        try { p.destroy(); } catch { /* ignore */ }
        ytPlayers.current.delete(id);
      }
      onChangeRef.current(sfxRef.current.filter((x) => x.id !== id));
    },
    [hardStop]
  );

  const setVolume = useCallback(
    (id: string, v: number) => {
      const next = sfxRef.current.map((x) => (x.id === id ? { ...x, volume: v } : x));
      onChangeRef.current(next);
      const m = next.find((x) => x.id === id);
      if (m) applyVol(m);
    },
    [applyVol]
  );

  const toggleFade = useCallback((id: string, which: "fadeIn" | "fadeOut") => {
    onChangeRef.current(
      sfxRef.current.map((x) => (x.id === id ? { ...x, [which]: x[which] === false } : x))
    );
  }, []);

  const commitRename = useCallback(() => {
    const id = renamingId;
    setRenamingId(null);
    const v = renameVal.trim();
    if (!id || !v) return;
    onChangeRef.current(sfxRef.current.map((x) => (x.id === id ? { ...x, name: v } : x)));
  }, [renamingId, renameVal]);

  const playingCount = playing.size;

  return (
    <div
      className="relative flex min-h-0 flex-1 flex-col"
      onDragOver={(e) => e.preventDefault()}
      onDrop={(e) => {
        e.preventDefault();
        void addFiles(e.dataTransfer.files);
      }}
    >
      {/* ação de adicionar */}
      <div className="shrink-0 border-b border-carbon-700/60 p-2">
        <button
          onClick={() => setChooser(true)}
          className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-carbon-500 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-carbon-200 transition-all hover:border-acid-500/60 hover:text-acid-300 active:scale-[0.98]"
        >
          <Plus size={12} strokeWidth={2.4} />
          adicionar som
        </button>
      </div>

      {sfx.length === 0 ? (
        <div className="flex flex-1 items-center justify-center p-5">
          <button
            onClick={() => setChooser(true)}
            className="group flex w-full flex-col items-center gap-3.5 rounded-2xl border border-dashed border-carbon-500 px-6 py-8 transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.98]"
          >
            <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
              <Upload size={20} strokeWidth={1.7} />
            </span>
            <span className="text-center">
              <span className="block font-display text-sm font-semibold text-white">
                adicionar som de ambiente
              </span>
              <span className="mt-1 block font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.16em] text-carbon-400">
                arquivo ou link do youtube
                <br />
                vários tocam ao mesmo tempo
              </span>
            </span>
          </button>
        </div>
      ) : (
        <div className="os-scroll min-h-0 flex-1 space-y-1.5 overflow-y-auto p-2">
          {sfx.map((m, i) => {
            const on = playing.has(m.id);
            const loading = loadingIds.has(m.id);
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
                className={`group relative rounded-xl border px-2 py-2 transition-all ${
                  on
                    ? "border-acid-500/50 bg-acid-400/[0.08]"
                    : "border-carbon-700 bg-carbon-850/60 hover:border-carbon-500 hover:bg-carbon-800"
                } ${markerCls(i)}`}
              >
                <div className="flex items-center gap-2">
                  <span title="arraste para reordenar" className="shrink-0 cursor-grab active:cursor-grabbing">
                    <GripVertical
                      size={13}
                      className="text-carbon-500 opacity-40 transition-opacity group-hover:opacity-80"
                    />
                  </span>

                  <button
                    onClick={() => toggle(m.id)}
                    title={on ? "parar" : "tocar em loop"}
                    className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg transition-all active:scale-90 ${
                      on
                        ? "bg-acid-400 text-carbon-950 shadow-[0_0_16px_rgba(212,247,76,0.35)]"
                        : "border border-carbon-600 text-carbon-300 group-hover:border-acid-500/40 group-hover:text-acid-300"
                    }`}
                  >
                    {loading ? (
                      <LoaderCircle size={13} className="anim-spin-slow" />
                    ) : on ? (
                      <span className="eq text-carbon-950"><i /><i /><i /><i /></span>
                    ) : m.source === "youtube" ? (
                      <PlayCircle size={14} />
                    ) : (
                      <AudioWaveform size={13.5} />
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
                    <button onClick={() => toggle(m.id)} className="min-w-0 flex-1 text-left" title={m.name}>
                      <span className={`block break-words text-[12.5px] font-medium leading-snug ${on ? "text-white" : "text-carbon-200"}`}>
                        {m.name}
                      </span>
                      {on ? (
                        <span className="mt-0.5 flex items-center gap-1 font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-acid-400">
                          <Repeat size={9} /> em loop
                        </span>
                      ) : m.source === "youtube" ? (
                        <span className="mt-0.5 block font-mono text-[8.5px] font-semibold uppercase tracking-[0.2em] text-carbon-500">
                          youtube
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

                {/* volume individual */}
                <div className="mt-1.5 flex items-center gap-1.5 pl-[22px]">
                  <Volume2 size={11} className="shrink-0 text-carbon-500" />
                  <input
                    type="range"
                    min={0}
                    max={100}
                    value={Math.round(volOf(m) * 100)}
                    onChange={(e) => setVolume(m.id, Number(e.target.value) / 100)}
                    className="vol-range h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none"
                    style={{
                      background: `linear-gradient(to right, var(--color-acid-400) ${Math.round(
                        volOf(m) * 100
                      )}%, var(--color-carbon-700) ${Math.round(volOf(m) * 100)}%)`,
                    }}
                  />
                  <span className="w-6 shrink-0 text-right font-mono text-[9px] tabular-nums text-carbon-500">
                    {Math.round(volOf(m) * 100)}
                  </span>
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* volume geral */}
      {sfx.length > 0 && (
        <div className="flex shrink-0 items-center gap-1.5 border-t border-carbon-700/60 px-3 py-1.5">
          <Volume2 size={13} className="shrink-0 text-carbon-400" />
          <span className="shrink-0 font-mono text-[9.5px] uppercase tracking-[0.14em] text-carbon-400">
            geral
          </span>
          <input
            type="range"
            min={0}
            max={100}
            value={Math.round(master * 100)}
            onChange={(e) => setMaster(Number(e.target.value) / 100)}
            className="vol-range h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full outline-none"
            style={{
              background: `linear-gradient(to right, var(--color-acid-400) ${Math.round(
                master * 100
              )}%, var(--color-carbon-700) ${Math.round(master * 100)}%)`,
            }}
          />
          <span className="w-6 shrink-0 text-right font-mono text-[9px] tabular-nums text-carbon-500">
            {Math.round(master * 100)}
          </span>
        </div>
      )}

      <footer className="flex h-6 shrink-0 items-center gap-2 border-t border-carbon-700/60 px-3">
        <span
          className={`h-1.5 w-1.5 rounded-full ${
            playingCount > 0 ? "bg-acid-400 animate-[pulse-dot_1.6s_ease-in-out_infinite]" : "bg-carbon-600"
          }`}
        />
        <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-carbon-500">
          {playingCount > 0
            ? `${playingCount} em camadas`
            : `${sfx.length} ${sfx.length === 1 ? "som" : "sons"}`}
        </span>
        {playingCount > 0 && (
          <button
            onClick={stopAll}
            className="ml-auto flex items-center gap-1 font-mono text-[9.5px] uppercase tracking-[0.16em] text-carbon-400 transition-colors hover:text-ember-400"
          >
            <Square size={9} />
            parar tudo
          </button>
        )}
      </footer>

      {/* host invisível dos players do youtube */}
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
              <p className="font-display text-[13.5px] font-semibold text-white">adicionar som</p>
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
          </div>
        </div>
      )}

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
    </div>
  );
}
