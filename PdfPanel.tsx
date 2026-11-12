import { memo, useCallback, useEffect, useRef, useState } from "react";
import PdfWorker from "pdfjs-dist/build/pdf.worker.min.mjs?worker&inline";
import type { PDFDocumentProxy, PDFPageProxy } from "pdfjs-dist";
import {
  FileText, PanelLeftClose, PanelLeftOpen, Plus, Trash2, Upload, LoaderCircle,
  TriangleAlert, Lock, ChevronLeft, ChevronRight, ZoomIn, ZoomOut, Maximize,
  Globe, Link2, X, ExternalLink, RotateCw, ScreenShare, Square, Focus, MonitorUp, GripVertical,
} from "lucide-react";
import type { OrdoMedia } from "../types";
import { fileToDataURL, dataURLToUint8, stripExt, uid } from "../lib/ordo";
import { lsGet, lsSet } from "../lib/store";
import { useReorder } from "../lib/useReorder";
import { PanelChrome, HeaderIconBtn } from "./PanelChrome";

interface Props {
  pdfs: OrdoMedia[];
  activePdfId: string | null;
  onChange: (pdfs: OrdoMedia[], activePdfId?: string) => void;
}

type LoadStatus = "idle" | "loading" | "ready" | "error";

interface DocView {
  id: string;
  doc: PDFDocumentProxy;
  dims: { w: number; h: number }[];
}

let pdfjsPromise: Promise<typeof import("pdfjs-dist")> | null = null;
const loadPdfjs = () => {
  if (!pdfjsPromise) {
    pdfjsPromise = import("pdfjs-dist").then((m) => {
      try {
        m.GlobalWorkerOptions.workerPort = new PdfWorker();
      } catch {
        // fallback: worker via CDN (pdf.js cai para fake-worker se também falhar)
        m.GlobalWorkerOptions.workerSrc =
          "https://unpkg.com/pdfjs-dist@4.10.38/build/pdf.worker.min.mjs";
      }
      return m;
    });
  }
  return pdfjsPromise;
};

function PdfPanelInner({ pdfs, activePdfId, onChange }: Props) {
  const [sbOpen, setSbOpen] = useState(() => lsGet("ordo:ui:pdf-sb") !== "0");
  const [status, setStatus] = useState<LoadStatus>("idle");
  const [error, setError] = useState<string | null>(null);
  const [pwState, setPwState] = useState<"none" | "need" | "wrong">("none");
  const [pwVal, setPwVal] = useState("");
  const [docView, setDocView] = useState<DocView | null>(null);
  const [pageCount, setPageCount] = useState(0);
  const [currentPage, setCurrentPage] = useState(1);
  const [zoom, setZoom] = useState(1);
  const [renderTick, setRenderTick] = useState(0);
  const [containerW, setContainerW] = useState(0);
  const [chooser, setChooser] = useState(false);
  const [linkOpen, setLinkOpen] = useState(false);
  const [linkUrl, setLinkUrl] = useState("");
  const [linkError, setLinkError] = useState<string | null>(null);
  const [frameKey, setFrameKey] = useState(0);
  const [webMode, setWebMode] = useState<Record<string, "frame" | "mirror">>({});
  const [streamingId, setStreamingId] = useState<string | null>(null);
  const [winOpenId, setWinOpenId] = useState<string | null>(null);
  const [mirrorBusy, setMirrorBusy] = useState(false);
  const [mirrorError, setMirrorError] = useState<string | null>(null);
  const webWin = useRef<Window | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const mirrorVideoRef = useRef<HTMLVideoElement>(null);

  const inputRef = useRef<HTMLInputElement>(null);
  const scrollRef = useRef<HTMLDivElement>(null);
  const cache = useRef(new Map<string, PDFDocumentProxy>());
  const pwCb = useRef<((pw: string) => void) | null>(null);

  const pageEls = useRef(new Map<number, HTMLElement>());
  const visible = useRef(new Set<number>());
  const ratios = useRef(new Map<number, number>());
  const observerRef = useRef<IntersectionObserver | null>(null);
  const renderedFor = useRef(new Map<number, number>());
  const queue = useRef<number[]>([]);
  const processing = useRef(false);
  const version = useRef(0);
  const restoredFor = useRef<string | null>(null);

  const pdfsRef = useRef(pdfs);
  useEffect(() => { pdfsRef.current = pdfs; });
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const zoomRef = useRef(zoom);
  useEffect(() => { zoomRef.current = zoom; });

  const { dragProps, markerCls } = useReorder(pdfs, (next) => onChangeRef.current(next));

  const setSb = (v: boolean) => {
    setSbOpen(v);
    lsSet("ordo:ui:pdf-sb", v ? "1" : "0");
  };

  /* ---------------- render engine ---------------- */
  const renderPage = useCallback(async (pageNum: number) => {
    const view = docViewRef.current;
    const wrap = pageEls.current.get(pageNum);
    if (!view || !wrap || !wrap.isConnected) return;
    const v = version.current;
    try {
      const page: PDFPageProxy = await view.doc.getPage(pageNum);
      if (v !== version.current) return;
      const cssW = wrap.clientWidth;
      if (cssW < 10) return;
      const base = page.getViewport({ scale: 1 });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      let scale = (cssW / base.width) * dpr;
      // clamp gigantic canvases
      if (base.width * scale > 4200) scale = 4200 / base.width;
      const viewport = page.getViewport({ scale });
      const canvas = document.createElement("canvas");
      canvas.width = Math.floor(viewport.width);
      canvas.height = Math.floor(viewport.height);
      const ctx = canvas.getContext("2d", { alpha: false });
      if (!ctx) return;
      ctx.fillStyle = "#ffffff";
      ctx.fillRect(0, 0, canvas.width, canvas.height);
      await page.render({ canvasContext: ctx, viewport }).promise;
      if (v !== version.current) return;
      wrap.replaceChildren(canvas);
      renderedFor.current.set(pageNum, v);
    } catch {
      /* cancelled / destroyed */
    }
  }, []);

  const processQueue = useCallback(async () => {
    if (processing.current) return;
    processing.current = true;
    while (queue.current.length > 0) {
      const p = queue.current.shift()!;
      if (renderedFor.current.get(p) === version.current) continue;
      if (!visible.current.has(p)) continue;
      await renderPage(p);
    }
    processing.current = false;
  }, [renderPage]);

  const enqueue = useCallback(
    (pageNum: number) => {
      if (renderedFor.current.get(pageNum) === version.current) return;
      if (!queue.current.includes(pageNum)) queue.current.push(pageNum);
      void processQueue();
    },
    [processQueue]
  );

  const docViewRef = useRef<DocView | null>(null);
  docViewRef.current = docView; // atribuído durante o render para a fila nunca correr com ref velho

  /* ---------------- observer ---------------- */
  useEffect(() => {
    if (!docView) return;
    const obs = new IntersectionObserver(
      (entries) => {
        for (const en of entries) {
          const el = en.target as HTMLElement;
          const p = Number(el.dataset.page);
          if (!p) continue;
          if (en.isIntersecting) {
            visible.current.add(p);
            ratios.current.set(p, en.intersectionRatio);
            enqueue(p);
          } else {
            visible.current.delete(p);
            ratios.current.delete(p);
          }
        }
        let best = 0;
        let bestP = currentPageRef.current;
        ratios.current.forEach((r, p) => {
          if (r > best) { best = r; bestP = p; }
        });
        setCurrentPage(bestP);
      },
      { root: scrollRef.current, rootMargin: "700px 0px", threshold: [0, 0.05, 0.25, 0.5, 0.75] }
    );
    observerRef.current = obs;
    pageEls.current.forEach((el) => obs.observe(el));
    return () => obs.disconnect();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [docView, renderTick, enqueue]);

  const registerPage = useCallback(
    (pageNum: number) => (el: HTMLElement | null) => {
      if (el) {
        pageEls.current.set(pageNum, el);
        observerRef.current?.observe(el);
      } else {
        const old = pageEls.current.get(pageNum);
        if (old) observerRef.current?.unobserve(old);
        pageEls.current.delete(pageNum);
      }
    },
    []
  );

  /* ---------------- document loading ---------------- */
  const activeIdRef = useRef(activePdfId);
  useEffect(() => { activeIdRef.current = activePdfId; });

  useEffect(() => {
    if (!activePdfId) {
      setDocView(null);
      setStatus("idle");
      setPageCount(0);
      return;
    }
    const media = pdfsRef.current.find((p) => p.id === activePdfId);
    if (!media) return;
    // sites não passam pelo renderizador de pdf
    if (media.source === "web") {
      setDocView(null);
      setStatus("idle");
      setPageCount(0);
      setError(null);
      setPwState("none");
      return;
    }
    let alive = true;
    const loadId = activePdfId;
    version.current += 1;
    renderedFor.current.clear();
    queue.current = [];
    visible.current.clear();
    ratios.current.clear();
    setStatus("loading");
    setError(null);
    setPwState("none");
    setCurrentPage(1);

    (async () => {
      try {
        let doc = cache.current.get(loadId);
        if (!doc) {
          const pdfjs = await loadPdfjs();
          const task = pdfjs.getDocument({
            data: dataURLToUint8(media.data),
            isEvalSupported: false,
            verbosity: 0,
          });
          task.onPassword = (update: (pw: string) => void, reason: number) => {
            if (!alive) return;
            pwCb.current = update;
            setPwState(reason === 2 ? "wrong" : "need");
          };
          doc = await task.promise;
          cache.current.set(loadId, doc);
        }
        if (!alive || activeIdRef.current !== loadId) return;
        const dims: { w: number; h: number }[] = [];
        for (let i = 1; i <= doc.numPages; i++) {
          const pg = await doc.getPage(i);
          const vp = pg.getViewport({ scale: 1 });
          dims.push({ w: vp.width, h: vp.height });
        }
        if (!alive || activeIdRef.current !== loadId) return;
        setDocView({ id: loadId, doc, dims });
        setPageCount(doc.numPages);
        setStatus("ready");
        setPwState("none");
        version.current += 1;
        renderedFor.current.clear();
      } catch (e) {
        if (!alive) return;
        const msg = e instanceof Error ? e.message : String(e);
        if (/password/i.test(msg)) {
          setPwState("need");
          setStatus("loading");
        } else {
          setError(msg.includes("Invalid PDF") ? "este arquivo não é um pdf válido." : `falha ao abrir: ${msg}`);
          setStatus("error");
        }
      }
    })();

    return () => { alive = false; };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activePdfId]);

  /* restore last page */
  useEffect(() => {
    if (status !== "ready" || !docView || !activePdfId) return;
    if (restoredFor.current === activePdfId) return;
    restoredFor.current = activePdfId;
    const media = pdfsRef.current.find((p) => p.id === activePdfId);
    const target = media?.lastPage;
    if (target && target > 1 && target <= pageCount) {
      setTimeout(() => {
        pageEls.current.get(target)?.scrollIntoView({ block: "start" });
      }, 120);
    }
  }, [status, docView, activePdfId, pageCount]);

  /* persist current page (debounced) */
  const currentPageRef = useRef(1);
  useEffect(() => {
    currentPageRef.current = currentPage;
    if (status !== "ready" || !activePdfId) return;
    const t = setTimeout(() => {
      const id = activeIdRef.current ?? "";
      const media = pdfsRef.current.find((p) => p.id === id);
      if (media && media.lastPage !== currentPageRef.current) {
        onChangeRef.current(
          pdfsRef.current.map((p) => (p.id === id ? { ...p, lastPage: currentPageRef.current } : p))
        );
      }
    }, 900);
    return () => clearTimeout(t);
  }, [currentPage, status, activePdfId]);

  /* container resize -> rerender */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el) return;
    let t: ReturnType<typeof setTimeout>;
    const ro = new ResizeObserver((entries) => {
      const w = entries[0]?.contentRect.width ?? 0;
      clearTimeout(t);
      t = setTimeout(() => {
        setContainerW(w);
        if (docViewRef.current) {
          version.current += 1;
          setRenderTick((x) => x + 1);
        }
      }, 220);
    });
    ro.observe(el);
    setContainerW(el.clientWidth);
    return () => {
      ro.disconnect();
      clearTimeout(t);
    };
  }, [activePdfId, status]);

  /**
   * Aplica zoom mantendo estável o ponto de referência na tela.
   * `anchorY` é a coordenada vertical do cursor/pinça (em px da janela).
   */
  const applyZoom = useCallback(
    (next: number | ((prev: number) => number), anchorY?: number) => {
      setZoom((z) => {
        const raw = typeof next === "function" ? next(z) : next;
        const nz = Math.min(3, Math.max(0.5, Math.round(raw * 100) / 100));
        if (nz === z) return z;

        const el = scrollRef.current;
        if (el) {
          const rect = el.getBoundingClientRect();
          const focus = anchorY === undefined ? rect.height / 2 : anchorY - rect.top;
          const ratio = nz / z;
          const target = (el.scrollTop + focus) * ratio - focus;
          // reposiciona depois que o novo tamanho das páginas é aplicado
          requestAnimationFrame(() => {
            if (scrollRef.current) scrollRef.current.scrollTop = Math.max(0, target);
          });
        }

        version.current += 1;
        setRenderTick((x) => x + 1);
        return nz;
      });
    },
    []
  );

  const bumpZoom = (delta: number) => applyZoom((z) => z + delta);

  const resetZoom = () => {
    if (zoom !== 1) {
      version.current += 1;
      setRenderTick((x) => x + 1);
      setZoom(1);
    }
  };

  /* ctrl+scroll (desktop) e pinça com dois dedos (celular) sobre o leitor */
  useEffect(() => {
    const el = scrollRef.current;
    if (!el || status !== "ready") return;

    const onWheel = (e: WheelEvent) => {
      if (!e.ctrlKey && !e.metaKey) return;
      e.preventDefault();
      applyZoom((z) => z * (e.deltaY < 0 ? 1.12 : 1 / 1.12), e.clientY);
    };

    const pts = new Map<number, { x: number; y: number }>();
    let baseDist = 0;
    let baseZoom = 1;
    let anchorY = 0;

    const onDown = (e: PointerEvent) => {
      if (e.pointerType !== "touch") return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size === 2) {
        const [a, b] = [...pts.values()];
        baseDist = Math.hypot(a.x - b.x, a.y - b.y);
        baseZoom = zoomRef.current;
        anchorY = (a.y + b.y) / 2;
      }
    };

    const onMove = (e: PointerEvent) => {
      if (e.pointerType !== "touch" || !pts.has(e.pointerId)) return;
      pts.set(e.pointerId, { x: e.clientX, y: e.clientY });
      if (pts.size < 2 || baseDist === 0) return;
      e.preventDefault(); // impede a rolagem enquanto dá pinça
      const [a, b] = [...pts.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      applyZoom(baseZoom * (dist / baseDist), anchorY);
    };

    const onUp = (e: PointerEvent) => {
      pts.delete(e.pointerId);
      if (pts.size < 2) baseDist = 0;
    };

    el.addEventListener("wheel", onWheel, { passive: false });
    el.addEventListener("pointerdown", onDown, { passive: true });
    el.addEventListener("pointermove", onMove, { passive: false });
    el.addEventListener("pointerup", onUp, { passive: true });
    el.addEventListener("pointercancel", onUp, { passive: true });
    return () => {
      el.removeEventListener("wheel", onWheel);
      el.removeEventListener("pointerdown", onDown);
      el.removeEventListener("pointermove", onMove);
      el.removeEventListener("pointerup", onUp);
      el.removeEventListener("pointercancel", onUp);
    };
  }, [applyZoom, status]);

  const goTo = useCallback(
    (p: number) => {
      const target = Math.min(Math.max(1, p), pageCount);
      pageEls.current.get(target)?.scrollIntoView({ behavior: "smooth", block: "start" });
    },
    [pageCount]
  );

  /* ---------------- crud ---------------- */
  const addFiles = useCallback(async (files: FileList | File[]) => {
    const list = Array.from(files).filter((f) => f.type === "application/pdf" || /\.pdf$/i.test(f.name));
    if (list.length === 0) return;
    const items: OrdoMedia[] = [];
    for (const f of list) {
      items.push({ id: uid(), name: stripExt(f.name), data: await fileToDataURL(f) });
    }
    const next = [...pdfsRef.current, ...items];
    onChangeRef.current(next, items[0]?.id ?? activeIdRef.current ?? undefined);
  }, []);

  const addLink = useCallback(() => {
    const raw = linkUrl.trim();
    if (!raw) return;
    let parsed: URL;
    try {
      parsed = new URL(/^https?:\/\//i.test(raw) ? raw : `https://${raw}`);
    } catch {
      setLinkError("endereço inválido — verifique o link.");
      return;
    }
    if (parsed.protocol !== "http:" && parsed.protocol !== "https:") {
      setLinkError("use um endereço http ou https.");
      return;
    }
    const item: OrdoMedia = {
      id: uid(),
      name: parsed.hostname.replace(/^www\./, "") + (parsed.pathname !== "/" ? parsed.pathname : ""),
      data: "",
      source: "web",
      url: parsed.toString(),
    };
    const next = [...pdfsRef.current, item];
    onChangeRef.current(next, item.id);
    setLinkUrl("");
    setLinkError(null);
    setLinkOpen(false);
  }, [linkUrl]);

  /* ---------------- site em janela real + espelho ---------------- */
  const stopMirror = useCallback(() => {
    streamRef.current?.getTracks().forEach((t) => t.stop());
    streamRef.current = null;
    if (mirrorVideoRef.current) mirrorVideoRef.current.srcObject = null;
    setStreamingId(null);
  }, []);

  const openWebWindow = useCallback((item: OrdoMedia) => {
    setMirrorError(null);
    const w = window.open(item.url, "ordo-web", "popup,width=1280,height=860");
    if (!w) {
      setMirrorError("o navegador bloqueou o pop-up — permita pop-ups e tente de novo.");
      return null;
    }
    webWin.current = w;
    setWinOpenId(item.id);
    return w;
  }, []);

  const focusWebWindow = useCallback(
    (item: OrdoMedia) => {
      if (webWin.current && !webWin.current.closed) webWin.current.focus();
      else openWebWindow(item);
    },
    [openWebWindow]
  );

  const startMirror = useCallback(
    async (item: OrdoMedia) => {
      setMirrorError(null);
      if (!navigator.mediaDevices?.getDisplayMedia) {
        setMirrorError("seu navegador não permite espelhar janelas aqui (precisa de https).");
        return;
      }
      setMirrorBusy(true);
      try {
        stopMirror();
        const stream = await navigator.mediaDevices.getDisplayMedia({
          video: { frameRate: 30 },
          audio: false,
        });
        streamRef.current = stream;
        stream.getVideoTracks()[0]?.addEventListener("ended", stopMirror);
        if (mirrorVideoRef.current) {
          mirrorVideoRef.current.srcObject = stream;
          await mirrorVideoRef.current.play().catch(() => undefined);
        }
        setStreamingId(item.id);
      } catch (e) {
        if (e instanceof DOMException && e.name === "NotAllowedError") {
          setMirrorError("captura cancelada — escolha a janela do site para espelhar.");
        } else {
          setMirrorError("não foi possível espelhar a janela neste navegador.");
        }
      } finally {
        setMirrorBusy(false);
      }
    },
    [stopMirror]
  );

  /* acompanha se a janela do site continua aberta */
  useEffect(() => {
    const t = setInterval(() => {
      if (webWin.current?.closed) {
        webWin.current = null;
        setWinOpenId(null);
      }
    }, 1000);
    return () => clearInterval(t);
  }, []);

  useEffect(() => stopMirror, [stopMirror]);

  const removePdf = useCallback((id: string) => {
    const doc = cache.current.get(id);
    if (doc) {
      doc.destroy().catch(() => undefined);
      cache.current.delete(id);
    }
    const next = pdfsRef.current.filter((p) => p.id !== id);
    const nextActive =
      id === activeIdRef.current ? next[0]?.id ?? null : activeIdRef.current;
    onChangeRef.current(next, nextActive ?? undefined);
  }, []);

  const submitPw = () => {
    if (!pwVal.trim() || !pwCb.current) return;
    const cb = pwCb.current;
    pwCb.current = null;
    setPwState("none");
    setPwVal("");
    cb(pwVal.trim());
  };

  const pageWidth = Math.max(160, (containerW - 28) * zoom);
  const activeItem = pdfs.find((p) => p.id === activePdfId) ?? null;
  const activeWeb = activeItem?.source === "web" && activeItem.url ? activeItem : null;
  const activeMode = activeWeb ? webMode[activeWeb.id] ?? "frame" : "frame";
  const isMirroring = !!activeWeb && streamingId === activeWeb.id;

  return (
    <PanelChrome
      index="04"
      title="leitor de pdf"
      icon={FileText}
      className="col-span-6 row-span-1 lg:col-span-2"
      actions={
        <HeaderIconBtn title={sbOpen ? "recolher documentos" : "mostrar documentos"} onClick={() => setSb(!sbOpen)}>
          {sbOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
        </HeaderIconBtn>
      }
    >
      {/* sidebar */}
      <aside
        className={`shrink-0 overflow-hidden border-carbon-700/70 bg-carbon-850/50 transition-[width,border] duration-300 ease-out ${
          sbOpen ? "w-44 border-r" : "w-0 border-r-0"
        }`}
      >
        <div className="flex h-full w-44 flex-col">
          <div className="shrink-0 border-b border-carbon-700/60 p-2">
            <button
              onClick={() => setChooser(true)}
              className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-carbon-500 py-2 font-mono text-[10px] font-semibold uppercase tracking-[0.14em] text-carbon-200 transition-all hover:border-acid-500/60 hover:text-acid-300 active:scale-[0.98]"
            >
              <Plus size={12} strokeWidth={2.4} />
              adicionar
            </button>
          </div>
          <div className="os-scroll min-h-0 flex-1 space-y-1 overflow-y-auto p-1.5">
            {pdfs.map((p, i) => (
              <div
                key={p.id}
                {...dragProps(i)}
                onClick={() => onChange(pdfsRef.current, p.id)}
                className={`group relative flex cursor-pointer items-center gap-1.5 rounded-lg border px-1.5 py-2 transition-colors ${
                  p.id === activePdfId
                    ? "border-acid-500/40 bg-acid-400/[0.07]"
                    : "border-transparent hover:bg-carbon-800/70"
                } ${markerCls(i)}`}
              >
                <span title="arraste para reordenar" className="shrink-0 cursor-grab active:cursor-grabbing">
                  <GripVertical
                    size={12}
                    className="text-carbon-500 opacity-40 transition-opacity group-hover:opacity-80"
                  />
                </span>
                {p.source === "web" ? (
                  <Globe size={13} className={`shrink-0 ${p.id === activePdfId ? "text-acid-400" : "text-carbon-400"}`} />
                ) : (
                  <FileText size={13} className={`shrink-0 ${p.id === activePdfId ? "text-acid-400" : "text-carbon-400"}`} />
                )}
                <span className={`min-w-0 flex-1 truncate text-[11.5px] ${p.id === activePdfId ? "font-medium text-white" : "text-carbon-300"}`} title={p.name}>
                  {p.name}
                </span>
                <button
                  title={p.source === "web" ? "remover site" : "remover pdf"}
                  onClick={(e) => {
                    e.stopPropagation();
                    removePdf(p.id);
                  }}
                  className="flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-carbon-400 transition-all hover:bg-ember-400/15 hover:text-ember-400 active:scale-90 lg:opacity-0 lg:group-hover:opacity-100"
                >
                  <Trash2 size={13} />
                </button>
              </div>
            ))}
            {pdfs.length === 0 && (
              <p className="px-2 py-3 text-center font-mono text-[9px] uppercase leading-relaxed tracking-[0.16em] text-carbon-500">
                nenhum documento
              </p>
            )}
          </div>
        </div>
      </aside>

      {/* viewer */}
      <div
        className="flex min-w-0 flex-1 flex-col bg-carbon-950/60"
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          void addFiles(e.dataTransfer.files);
        }}
      >
        {activeWeb ? (
          /* ---------- site: modo embutido ou janela espelhada ---------- */
          <>
            <div className="flex h-9 shrink-0 items-center gap-1 border-b border-carbon-700/70 px-2">
              <Globe size={13} className="shrink-0 text-acid-400" />
              <span className="min-w-0 flex-1 truncate font-mono text-[10.5px] text-carbon-300" title={activeWeb.url}>
                {activeWeb.url}
              </span>

              {/* alterna entre embutido e janela real espelhada */}
              <div className="flex shrink-0 items-center overflow-hidden rounded-md border border-carbon-600">
                <button
                  title="modo embutido (rápido, mas alguns sites bloqueiam)"
                  onClick={() => {
                    stopMirror();
                    setWebMode((m) => ({ ...m, [activeWeb.id]: "frame" }));
                  }}
                  className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                    activeMode === "frame" ? "bg-acid-400/15 text-acid-300" : "text-carbon-400 hover:text-white"
                  }`}
                >
                  embutido
                </button>
                <button
                  title="janela real espelhada (funciona com qualquer site)"
                  onClick={() => setWebMode((m) => ({ ...m, [activeWeb.id]: "mirror" }))}
                  className={`px-2 py-1 font-mono text-[9px] uppercase tracking-wider transition-colors ${
                    activeMode === "mirror" ? "bg-acid-400/15 text-acid-300" : "text-carbon-400 hover:text-white"
                  }`}
                >
                  janela
                </button>
              </div>

              {activeMode === "frame" ? (
                <button
                  title="recarregar"
                  onClick={() => setFrameKey((k) => k + 1)}
                  className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white"
                >
                  <RotateCw size={12.5} />
                </button>
              ) : (
                <>
                  {isMirroring && (
                    <>
                      <button
                        title="trocar janela espelhada"
                        onClick={() => void startMirror(activeWeb)}
                        className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white"
                      >
                        <RotateCw size={12.5} />
                      </button>
                      <button
                        title="parar espelhamento"
                        onClick={stopMirror}
                        className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white"
                      >
                        <Square size={11} />
                      </button>
                    </>
                  )}
                  <button
                    title="focar a janela do site"
                    onClick={() => focusWebWindow(activeWeb)}
                    className={`flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md transition-colors hover:bg-carbon-700/60 hover:text-white ${
                      winOpenId === activeWeb.id ? "text-acid-300" : "text-carbon-300"
                    }`}
                  >
                    <Focus size={12.5} />
                  </button>
                </>
              )}

              <button
                title="abrir em nova janela"
                onClick={() => window.open(activeWeb.url, "_blank", "noopener")}
                className="flex h-6.5 w-6.5 shrink-0 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white"
              >
                <ExternalLink size={12.5} />
              </button>
            </div>

            {activeMode === "frame" ? (
              <div className="relative min-h-0 flex-1 bg-white">
                <iframe
                  key={`${activeWeb.id}-${frameKey}`}
                  src={activeWeb.url}
                  title={activeWeb.name}
                  className="h-full w-full border-0"
                  referrerPolicy="no-referrer"
                  sandbox="allow-scripts allow-same-origin allow-forms allow-popups allow-popups-to-escape-sandbox"
                />
                <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-2">
                  <span className="pointer-events-auto rounded-full border border-carbon-600 bg-carbon-950/90 px-2.5 py-1 font-mono text-[9px] uppercase tracking-[0.14em] text-carbon-400 backdrop-blur">
                    em branco? troque para o modo janela
                  </span>
                </div>
              </div>
            ) : (
              <div className="relative min-h-0 flex-1 bg-black">
                <video
                  ref={mirrorVideoRef}
                  muted
                  playsInline
                  autoPlay
                  onClick={() => focusWebWindow(activeWeb)}
                  title="clique para usar a janela do site"
                  className={`absolute inset-0 h-full w-full object-contain ${isMirroring ? "cursor-pointer" : "hidden"}`}
                />

                {isMirroring && (
                  <div className="pointer-events-none absolute left-3 top-3 flex items-center gap-2 rounded-full border border-ember-400/40 bg-carbon-950/80 px-2.5 py-1 backdrop-blur">
                    <span className="h-1.5 w-1.5 rounded-full bg-ember-400 animate-[pulse-dot_1.4s_ease-in-out_infinite]" />
                    <span className="font-mono text-[9px] font-semibold uppercase tracking-[0.22em] text-ember-400">
                      ao vivo
                    </span>
                  </div>
                )}

                {!isMirroring && (
                  <div className="flex h-full flex-col items-center justify-center gap-4 p-5 text-center">
                    <p className="max-w-[300px] text-[12px] leading-relaxed text-carbon-300">
                      abra o site em uma janela real e espelhe aqui — funciona com{" "}
                      <span className="font-medium text-white">qualquer site</span>, mesmo os que
                      bloqueiam incorporação.
                    </p>
                    <div className="flex flex-wrap items-center justify-center gap-2">
                      <button
                        onClick={() => openWebWindow(activeWeb)}
                        className="flex items-center gap-2 rounded-xl bg-acid-400 px-4 py-2.5 text-[12.5px] font-bold text-carbon-950 transition-colors hover:bg-acid-300"
                      >
                        <MonitorUp size={14} />
                        {winOpenId === activeWeb.id ? "reabrir janela" : "abrir o site"}
                      </button>
                      <button
                        onClick={() => void startMirror(activeWeb)}
                        disabled={mirrorBusy}
                        className="flex items-center gap-2 rounded-xl border border-carbon-600 px-4 py-2.5 text-[12.5px] font-medium text-carbon-100 transition-colors hover:border-acid-500/50 hover:text-acid-300 disabled:opacity-60"
                      >
                        <ScreenShare size={14} />
                        {mirrorBusy ? "aguardando..." : "espelhar janela"}
                      </button>
                    </div>
                    {mirrorError && (
                      <p className="anim-pop-in max-w-[300px] rounded-lg border border-ember-400/40 bg-ember-400/10 px-3 py-2 text-[11.5px] leading-snug text-ember-400">
                        {mirrorError}
                      </p>
                    )}
                  </div>
                )}
              </div>
            )}
          </>
        ) : null}

        {!activeWeb && status === "ready" && docView && (
          <div className="flex h-9 shrink-0 items-center gap-1 border-b border-carbon-700/70 px-2">
            <button
              title="página anterior"
              onClick={() => goTo(currentPage - 1)}
              disabled={currentPage <= 1}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white disabled:opacity-30"
            >
              <ChevronLeft size={14} />
            </button>
            <PageJump current={currentPage} total={pageCount} onGo={goTo} />
            <button
              title="próxima página"
              onClick={() => goTo(currentPage + 1)}
              disabled={currentPage >= pageCount}
              className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white disabled:opacity-30"
            >
              <ChevronRight size={14} />
            </button>

            <span className="mx-1 h-4 w-px bg-carbon-700" />

            <button title="diminuir zoom" onClick={() => bumpZoom(-0.25)} className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white">
              <ZoomOut size={13} />
            </button>
            <span className="w-11 text-center font-mono text-[10.5px] text-carbon-300">
              {Math.round(zoom * 100)}%
            </span>
            <button title="aumentar zoom" onClick={() => bumpZoom(0.25)} className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white">
              <ZoomIn size={13} />
            </button>
            <button title="ajustar à largura" onClick={resetZoom} className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white">
              <Maximize size={12} />
            </button>
          </div>
        )}

        <div
          ref={scrollRef}
          className={`os-scroll pdf-scroll relative min-h-0 flex-1 overflow-auto ${activeWeb ? "hidden" : ""}`}
        >
          {/* empty */}
          {status === "idle" && pdfs.length === 0 && (
            <div className="flex h-full items-center justify-center p-5">
              <button
                onClick={() => setChooser(true)}
                className="group flex w-full max-w-[260px] flex-col items-center gap-3.5 rounded-2xl border border-dashed border-carbon-500 px-6 py-9 transition-all hover:border-acid-500/60 hover:bg-carbon-850 active:scale-[0.98]"
              >
                <span className="flex h-12 w-12 items-center justify-center rounded-xl border border-carbon-600 bg-carbon-800 text-carbon-200 transition-colors group-hover:border-acid-500/50 group-hover:text-acid-300">
                  <Upload size={20} strokeWidth={1.7} />
                </span>
                <span className="text-center">
                  <span className="block font-display text-sm font-semibold text-white">adicionar pdf</span>
                  <span className="mt-1 block font-mono text-[9.5px] uppercase leading-relaxed tracking-[0.16em] text-carbon-400">
                    arraste ou clique · role para navegar
                  </span>
                </span>
              </button>
            </div>
          )}
          {status === "idle" && pdfs.length > 0 && !activeWeb && (
            <div className="flex h-full flex-col items-center justify-center gap-2 text-carbon-500">
              <FileText size={22} strokeWidth={1.5} />
              <p className="font-mono text-[10px] uppercase tracking-[0.18em]">escolha um item ao lado</p>
            </div>
          )}

          {/* loading */}
          {status === "loading" && pwState === "none" && (
            <div className="absolute inset-0 z-10 flex flex-col items-center justify-center gap-3 bg-carbon-950/80">
              <LoaderCircle size={22} className="anim-spin-slow text-acid-400" />
              <p className="font-mono text-[10px] uppercase tracking-[0.2em] text-carbon-400">abrindo documento...</p>
            </div>
          )}

          {/* password */}
          {pwState !== "none" && (
            <div className="absolute inset-0 z-10 flex items-center justify-center bg-carbon-950/85 p-5 backdrop-blur-sm">
              <div className="anim-pop-in w-full max-w-[280px] rounded-2xl border border-carbon-600 bg-carbon-850 p-5">
                <div className="mb-3 flex items-center gap-2.5">
                  <span className="flex h-9 w-9 items-center justify-center rounded-lg border border-acid-500/40 bg-acid-400/10 text-acid-300">
                    <Lock size={15} />
                  </span>
                  <div>
                    <p className="text-[13px] font-semibold text-white">pdf protegido</p>
                    <p className={`font-mono text-[9px] uppercase tracking-[0.14em] ${pwState === "wrong" ? "text-ember-400" : "text-carbon-400"}`}>
                      {pwState === "wrong" ? "senha incorreta" : "digite a senha"}
                    </p>
                  </div>
                </div>
                <input
                  type="password"
                  autoFocus
                  value={pwVal}
                  onChange={(e) => setPwVal(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && submitPw()}
                  placeholder="senha do documento"
                  className="mb-2.5 w-full rounded-lg border border-carbon-600 bg-carbon-900 px-3 py-2 text-[13px] text-white outline-none transition-colors placeholder:text-carbon-500 focus:border-acid-500/60"
                />
                <button
                  onClick={submitPw}
                  className="w-full rounded-lg bg-acid-400 py-2 font-mono text-[11px] font-bold uppercase tracking-wider text-carbon-950 transition-all hover:bg-acid-300 active:scale-[0.98]"
                >
                  desbloquear
                </button>
              </div>
            </div>
          )}

          {/* error */}
          {status === "error" && (
            <div className="flex h-full items-center justify-center p-6">
              <div className="anim-pop-in flex max-w-[280px] flex-col items-center gap-3 rounded-2xl border border-ember-400/40 bg-ember-400/[0.06] p-6 text-center">
                <TriangleAlert size={22} className="text-ember-400" />
                <p className="text-[12.5px] font-medium leading-relaxed text-ember-400">{error}</p>
              </div>
            </div>
          )}

          {/* pages */}
          {status === "ready" && docView && (
            <div className="min-w-full px-3.5 py-3.5">
              {docView.dims.map((d, i) => (
                <div key={`${docView.id}-${i + 1}-${renderTick}`} className="mx-auto mb-3" style={{ width: pageWidth }}>
                  <div
                    ref={registerPage(i + 1)}
                    data-page={i + 1}
                    className="pdf-page"
                    style={{ width: pageWidth, aspectRatio: `${d.w} / ${d.h}` }}
                  />
                  <p className="mt-1.5 text-center font-mono text-[8.5px] uppercase tracking-[0.2em] text-carbon-600">
                    pág. {i + 1}
                  </p>
                </div>
              ))}
            </div>
          )}
        </div>
      </div>

      <input
        ref={inputRef}
        type="file"
        accept="application/pdf,.pdf"
        multiple
        className="hidden"
        onChange={(e) => {
          if (e.target.files) void addFiles(e.target.files);
          e.target.value = "";
        }}
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
              <p className="font-display text-[13.5px] font-semibold text-white">adicionar</p>
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
                <span className="block text-[12.5px] font-medium text-white">arquivo pdf</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-carbon-400">
                  do computador
                </span>
              </span>
            </button>
            <button
              onClick={() => {
                setChooser(false);
                setLinkUrl("");
                setLinkError(null);
                setLinkOpen(true);
              }}
              className="flex w-full items-center gap-2.5 rounded-xl border border-carbon-600 bg-carbon-800/70 px-3 py-2.5 text-left transition-colors hover:border-acid-500/50 hover:bg-carbon-800"
            >
              <Globe size={15} className="shrink-0 text-acid-300" />
              <span>
                <span className="block text-[12.5px] font-medium text-white">link de site</span>
                <span className="font-mono text-[9px] uppercase tracking-[0.14em] text-carbon-400">
                  navegar dentro da janela
                </span>
              </span>
            </button>
          </div>
        </div>
      )}

      {/* caixa do link */}
      {linkOpen && (
        <div
          className="anim-fade-in absolute inset-0 z-30 flex items-center justify-center bg-carbon-950/85 p-4 backdrop-blur-sm"
          onMouseDown={() => setLinkOpen(false)}
        >
          <div
            className="anim-pop-in w-full max-w-[300px] rounded-2xl border border-carbon-600 bg-carbon-850 p-4"
            onMouseDown={(e) => e.stopPropagation()}
          >
            <div className="mb-3 flex items-center gap-2">
              <Globe size={15} className="text-acid-300" />
              <p className="font-display text-[13.5px] font-semibold text-white">link do site</p>
              <button
                onClick={() => setLinkOpen(false)}
                className="ml-auto flex h-6 w-6 items-center justify-center rounded-md text-carbon-400 hover:bg-carbon-700 hover:text-white"
              >
                <X size={13} />
              </button>
            </div>
            <div className="mb-2 flex items-center gap-2 rounded-lg border border-carbon-600 bg-carbon-900 px-2.5">
              <Link2 size={13} className="shrink-0 text-carbon-500" />
              <input
                autoFocus
                value={linkUrl}
                onChange={(e) => setLinkUrl(e.target.value)}
                onKeyDown={(e) => e.key === "Enter" && addLink()}
                placeholder="exemplo.com/pagina"
                className="min-w-0 flex-1 bg-transparent py-2 text-[12px] text-white outline-none placeholder:text-carbon-600"
              />
            </div>
            {linkError && (
              <p className="anim-pop-in mb-2 flex items-start gap-1.5 rounded-lg border border-ember-400/40 bg-ember-400/10 px-2.5 py-1.5 text-[11px] leading-snug text-ember-400">
                <TriangleAlert size={12} className="mt-0.5 shrink-0" />
                {linkError}
              </p>
            )}
            <button
              onClick={addLink}
              disabled={!linkUrl.trim()}
              className="flex w-full items-center justify-center gap-2 rounded-xl bg-acid-400 py-2.5 text-[12.5px] font-bold text-carbon-950 transition-colors hover:bg-acid-300 disabled:opacity-50"
            >
              <Plus size={14} strokeWidth={2.6} />
              adicionar à lista
            </button>
            <p className="mt-2 text-center font-mono text-[9px] leading-relaxed text-carbon-500">
              alguns sites bloqueiam incorporação;
              <br />
              nesses casos use o botão de abrir em nova janela
            </p>
          </div>
        </div>
      )}
    </PanelChrome>
  );
}

function PageJump({ current, total, onGo }: { current: number; total: number; onGo: (p: number) => void }) {
  const [val, setVal] = useState(String(current));
  useEffect(() => setVal(String(current)), [current]);
  const commit = () => {
    const v = parseInt(val, 10);
    if (!Number.isNaN(v)) onGo(v);
    else setVal(String(current));
  };
  return (
    <div className="flex items-center gap-1 font-mono text-[10.5px] text-carbon-300">
      <input
        value={val}
        onChange={(e) => setVal(e.target.value.replace(/\D/g, ""))}
        onBlur={commit}
        onKeyDown={(e) => {
          if (e.key === "Enter") {
            commit();
            (e.target as HTMLInputElement).blur();
          }
          if (e.key === "ArrowUp") onGo(current + 1);
          if (e.key === "ArrowDown") onGo(current - 1);
        }}
        className="nospin w-9 rounded border border-carbon-700 bg-carbon-850 px-1 py-0.5 text-center text-white outline-none focus:border-acid-500/60"
      />
      <span className="text-carbon-500">/ {total}</span>
    </div>
  );
}

export const PdfPanel = memo(
  PdfPanelInner,
  (p, n) => p.pdfs === n.pdfs && p.activePdfId === n.activePdfId
);
