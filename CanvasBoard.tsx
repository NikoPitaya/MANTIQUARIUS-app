import { useCallback, useEffect, useRef, useState } from "react";
import {
  StickyNote, Type, ImagePlus, Trash2, Copy, Pencil, Check,
  ZoomIn, ZoomOut, Maximize, Hand, MousePointer2, Palette, Brush, Waypoints, Tag,
  Bold, Italic, Underline, Strikethrough, AlignLeft, AlignCenter, AlignRight,
  ArrowUpToLine, AlignVerticalJustifyCenter, ArrowDownToLine, Baseline, CaseSensitive,
} from "lucide-react";
import type { CanvasItem } from "../types";
import { uid, fileToDataURL } from "../lib/ordo";

interface Props {
  items: CanvasItem[];
  view?: { x: number; y: number; z: number };
  onChange: (items: CanvasItem[], view?: { x: number; y: number; z: number }) => void;
}

const COLORS = ["#d4f74c", "#ffd166", "#ff9f7a", "#ff6b8b", "#b18cff", "#6fb4ff", "#5fe0c0", "#e6e8eb"];
const TEXT_COLORS = ["#08090b", "#ffffff", "#d4f74c", "#ff6b5c", "#6fb4ff", "#b18cff"];
const FONTS = [
  { label: "Padrão", value: "Inter, sans-serif" },
  { label: "Display", value: "'Space Grotesk', sans-serif" },
  { label: "Serifa", value: "'Newsreader', Georgia, serif" },
  { label: "Mono", value: "'JetBrains Mono', monospace" },
  { label: "Manuscrita", value: "'Caveat', cursive" },
];
const MIN_Z = 0.2;
const MAX_Z = 3;
const clampZ = (z: number) => Math.min(MAX_Z, Math.max(MIN_Z, z));

type Drag =
  | { kind: "pan"; startX: number; startY: number; ox: number; oy: number }
  | { kind: "move"; id: string; startX: number; startY: number; ix: number; iy: number }
  | {
      kind: "resize";
      id: string;
      startX: number;
      startY: number;
      iw: number;
      ih: number;
      lockAspect: boolean; // imagens mantêm a proporção ao escalar
      ratio: number; // proporção original da imagem (iw/ih no início do arraste)
    }
  | null;

export function CanvasBoard({ items, view, onChange }: Props) {
  const [tx, setTx] = useState(view?.x ?? 0);
  const [ty, setTy] = useState(view?.y ?? 0);
  const [z, setZ] = useState(view?.z ?? 1);
  const [selected, setSelected] = useState<string | null>(null);
  const [editing, setEditing] = useState<string | null>(null);
  const [tool, setTool] = useState<"select" | "pan" | "draw" | "connect">("select");
  const [linkFrom, setLinkFrom] = useState<string | null>(null);
  const [liveRect, setLiveRect] = useState<{ id: string; x: number; y: number; w: number; h: number } | null>(null);
  const [palette, setPalette] = useState(false);
  const [format, setFormat] = useState(false);
  const [penColor, setPenColor] = useState("#d4f74c");
  const [penWidth, setPenWidth] = useState(4);
  const [livePath, setLivePath] = useState<string | null>(null);
  const stroke = useRef<{ pts: { x: number; y: number }[] } | null>(null);

  const boardRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const drag = useRef<Drag>(null);
  const pointers = useRef(new Map<number, { x: number; y: number }>());
  const pinch = useRef<{ dist: number; z: number; cx: number; cy: number; tx: number; ty: number } | null>(null);
  const moved = useRef(false);

  const itemsRef = useRef(items);
  useEffect(() => { itemsRef.current = items; });
  const onChangeRef = useRef(onChange);
  useEffect(() => { onChangeRef.current = onChange; });
  const viewRef = useRef({ tx, ty, z });
  useEffect(() => { viewRef.current = { tx, ty, z }; });

  /* salva a posição da câmera (com atraso, para não pesar) */
  useEffect(() => {
    const t = setTimeout(() => {
      onChangeRef.current(itemsRef.current, { x: tx, y: ty, z });
    }, 600);
    return () => clearTimeout(t);
  }, [tx, ty, z]);

  const commit = useCallback((next: CanvasItem[]) => {
    onChangeRef.current(next, { x: viewRef.current.tx, y: viewRef.current.ty, z: viewRef.current.z });
  }, []);

  const patchItem = useCallback(
    (id: string, p: Partial<CanvasItem>) =>
      commit(itemsRef.current.map((it) => (it.id === id ? { ...it, ...p } : it))),
    [commit]
  );

  /** trava a proporção de imagens: o retângulo que contém a foto tem
   * sempre a mesma proporção da imagem, em qualquer ponto do fluxo
   * (arraste ao vivo, gravação no estado e re-hidratação de notas antigas) */
  const enforceImageAspect = useCallback((it: CanvasItem): CanvasItem => {
    if (it.type !== "image") return it;
    // usa a proporção natural real da imagem como fonte da verdade;
    // sem ela, mantém a proporção do próprio item
    let ratio = it.imgRatio ?? (it.nw && it.nh ? it.nw / it.nh : undefined);
    if (!ratio || !isFinite(ratio) || ratio <= 0) {
      ratio = it.w && it.h ? it.w / it.h : 1;
    }
    const w = Math.max(64, it.w);
    const h = w / ratio;
    if (Math.abs(it.h - h) < 0.5 && it.w === w) return it;
    return { ...it, w, h };
  }, []);

  /** converte coordenadas da tela para coordenadas do quadro */
  const toWorld = useCallback((clientX: number, clientY: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    const { tx: x, ty: y, z: s } = viewRef.current;
    if (!r) return { x: 0, y: 0 };
    return { x: (clientX - r.left - x) / s, y: (clientY - r.top - y) / s };
  }, []);

  /** centro visível do board em coordenadas do mundo */
  const centerWorld = useCallback(() => {
    const r = boardRef.current?.getBoundingClientRect();
    const { tx: x, ty: y, z: s } = viewRef.current;
    if (!r) return { x: 0, y: 0 };
    return { x: (r.width / 2 - x) / s, y: (r.height / 2 - y) / s };
  }, []);

  const addItem = useCallback(
    (type: CanvasItem["type"], extra?: Partial<CanvasItem>) => {
      const c = centerWorld();
      const base: CanvasItem = {
        id: uid(),
        type,
        x: Math.round(c.x - (type === "text" ? 110 : 90)),
        y: Math.round(c.y - 60),
        w: type === "text" ? 220 : 180,
        h: type === "text" ? 60 : 180,
        text: type === "sticky" ? "" : type === "text" ? "" : undefined,
        color: type === "sticky" ? COLORS[1] : type === "text" ? "#e6e8eb" : undefined,
        fontSize: type === "text" ? 18 : 14,
        ...extra,
      };
      commit([...itemsRef.current, base]);
      setSelected(base.id);
      if (type !== "image") setEditing(base.id);
    },
    [centerWorld, commit]
  );

  const addImageFile = useCallback(
    async (file: File) => {
      if (!file.type.startsWith("image/")) return;
      const src = await fileToDataURL(file);
      const probe = new Image();
      probe.src = src;
      await probe.decode().catch(() => undefined);
      const nw = probe.naturalWidth || 320;
      const nh = probe.naturalHeight || 240;
      const w = Math.min(360, nw);
      const c = centerWorld();
      addItem("image", {
        src,
        nw,
        nh,
        imgRatio: nw / nh,
        w,
        h: Math.round((w * nh) / nw),
        x: Math.round(c.x - w / 2),
        y: Math.round(c.y - (w * nh) / nw / 2),
      });
    },
    [addItem, centerWorld]
  );

  const removeItem = useCallback(
    (id: string) => {
      // apagar um item também remove as setas ligadas a ele
      commit(itemsRef.current.filter((i) => i.id !== id && i.from !== id && i.to !== id));
      setSelected(null);
      setEditing(null);
    },
    [commit]
  );

  const connect = useCallback(
    (fromId: string, toId: string) => {
      if (fromId === toId) return;
      const exists = itemsRef.current.some(
        (i) => i.type === "arrow" && i.from === fromId && i.to === toId
      );
      if (exists) return;
      const arrow: CanvasItem = {
        id: uid(),
        type: "arrow",
        x: 0, y: 0, w: 0, h: 0,
        from: fromId,
        to: toId,
        color: "#8b909b",
        strokeWidth: 2,
        fontSize: 12,
      };
      commit([...itemsRef.current, arrow]);
      setSelected(arrow.id);
    },
    [commit]
  );

  const duplicateItem = useCallback(
    (id: string) => {
      const it = itemsRef.current.find((i) => i.id === id);
      if (!it) return;
      const copy = { ...it, id: uid(), x: it.x + 24, y: it.y + 24 };
      commit([...itemsRef.current, copy]);
      setSelected(copy.id);
    },
    [commit]
  );

  /* ---------------- zoom ---------------- */
  const zoomAt = useCallback((factor: number, cx: number, cy: number) => {
    const r = boardRef.current?.getBoundingClientRect();
    if (!r) return;
    const px = cx - r.left;
    const py = cy - r.top;
    setZ((prev) => {
      const nz = clampZ(prev * factor);
      const k = nz / prev;
      setTx((x) => px - (px - x) * k);
      setTy((y) => py - (py - y) * k);
      return nz;
    });
  }, []);

  const zoomCenter = useCallback(
    (factor: number) => {
      const r = boardRef.current?.getBoundingClientRect();
      if (!r) return;
      zoomAt(factor, r.left + r.width / 2, r.top + r.height / 2);
    },
    [zoomAt]
  );

  const fitAll = useCallback(() => {
    const r = boardRef.current?.getBoundingClientRect();
    const list = itemsRef.current.filter((i) => i.type !== "arrow");
    if (!r) return;
    if (list.length === 0) {
      setTx(0); setTy(0); setZ(1);
      return;
    }
    const minX = Math.min(...list.map((i) => i.x));
    const minY = Math.min(...list.map((i) => i.y));
    const maxX = Math.max(...list.map((i) => i.x + i.w));
    const maxY = Math.max(...list.map((i) => i.y + i.h));
    const pad = 48;
    const nz = clampZ(Math.min((r.width - pad) / (maxX - minX || 1), (r.height - pad) / (maxY - minY || 1), 1.4));
    setZ(nz);
    setTx(r.width / 2 - ((minX + maxX) / 2) * nz);
    setTy(r.height / 2 - ((minY + maxY) / 2) * nz);
  }, []);

  useEffect(() => {
    const el = boardRef.current;
    if (!el) return;
    const onWheel = (e: WheelEvent) => {
      e.preventDefault();
      if (e.ctrlKey || e.metaKey) {
        zoomAt(e.deltaY < 0 ? 1.12 : 1 / 1.12, e.clientX, e.clientY);
      } else {
        setTx((x) => x - e.deltaX);
        setTy((y) => y - e.deltaY);
      }
    };
    el.addEventListener("wheel", onWheel, { passive: false });
    return () => el.removeEventListener("wheel", onWheel);
  }, [zoomAt]);

  /* ---------------- ponteiros (mouse + toque) ---------------- */
  const onPointerDown = useCallback(
    (e: React.PointerEvent) => {
      const target = e.target as HTMLElement;
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });

      // pinça com dois dedos
      if (pointers.current.size === 2) {
        const [a, b] = [...pointers.current.values()];
        pinch.current = {
          dist: Math.hypot(a.x - b.x, a.y - b.y),
          z: viewRef.current.z,
          cx: (a.x + b.x) / 2,
          cy: (a.y + b.y) / 2,
          tx: viewRef.current.tx,
          ty: viewRef.current.ty,
        };
        drag.current = null;
        return;
      }

      // ---- modo desenho: um dedo/mouse traça o rabisco ----
      if (tool === "draw") {
        e.preventDefault();
        setSelected(null);
        setEditing(null);
        const p = toWorld(e.clientX, e.clientY);
        stroke.current = { pts: [p] };
        setLivePath(`M ${p.x.toFixed(1)} ${p.y.toFixed(1)}`);
        return;
      }

      const handle = target.closest<HTMLElement>("[data-handle]");
      const card = target.closest<HTMLElement>("[data-card]");
      moved.current = false;

      // ---- modo conectar: primeiro item é a origem, segundo é o destino ----
      if (tool === "connect") {
        e.preventDefault();
        if (!card) {
          setLinkFrom(null);
          return;
        }
        const id = card.dataset.card!;
        if (!linkFrom) {
          setLinkFrom(id);
        } else {
          connect(linkFrom, id);
          setLinkFrom(null);
        }
        return;
      }

      // clique numa seta seleciona a seta
      const arrowEl = target.closest<HTMLElement>("[data-arrow]");
      if (arrowEl && tool === "select") {
        e.preventDefault();
        setSelected(arrowEl.dataset.arrow!);
        setEditing(null);
        return;
      }

      if (handle && selected) {
        const it = itemsRef.current.find((i) => i.id === selected);
        if (!it) return;
        e.preventDefault();
        drag.current = {
          kind: "resize",
          id: it.id,
          startX: e.clientX,
          startY: e.clientY,
          iw: it.w,
          ih: it.h,
          lockAspect: it.type === "image",
          ratio:
            it.imgRatio ?? (it.nw && it.nh ? it.nw / it.nh : it.h > 0 ? it.w / it.h : 1),
        };
        setLiveRect({ id: it.id, x: it.x, y: it.y, w: it.w, h: it.h });
        return;
      }

      if (card && tool === "select") {
        const id = card.dataset.card!;
        if (editing === id) return; // deixa editar o texto normalmente
        e.preventDefault();
        const it = itemsRef.current.find((i) => i.id === id);
        if (!it) return;
        setSelected(id);
        setEditing(null);
        drag.current = { kind: "move", id, startX: e.clientX, startY: e.clientY, ix: it.x, iy: it.y };
        setLiveRect({ id, x: it.x, y: it.y, w: it.w, h: it.h });
        return;
      }

      // fundo → pan
        e.preventDefault();
        setSelected(null);
        setEditing(null);
        setPalette(false);
        setFormat(false);
      drag.current = {
        kind: "pan",
        startX: e.clientX,
        startY: e.clientY,
        ox: viewRef.current.tx,
        oy: viewRef.current.ty,
      };
    },
    [editing, selected, tool, toWorld, linkFrom, connect]
  );

  const onPointerMove = useCallback((e: React.PointerEvent) => {
    if (pointers.current.has(e.pointerId)) {
      pointers.current.set(e.pointerId, { x: e.clientX, y: e.clientY });
    }

    if (stroke.current && pointers.current.size < 2) {
      e.preventDefault();
      const p = toWorld(e.clientX, e.clientY);
      const pts = stroke.current.pts;
      const last = pts[pts.length - 1];
      if (Math.hypot(p.x - last.x, p.y - last.y) < 1.2) return;
      pts.push(p);
      setLivePath(
        pts.map((q, i) => `${i === 0 ? "M" : "L"} ${q.x.toFixed(1)} ${q.y.toFixed(1)}`).join(" ")
      );
      return;
    }

    if (pinch.current && pointers.current.size >= 2) {
      const [a, b] = [...pointers.current.values()];
      const dist = Math.hypot(a.x - b.x, a.y - b.y);
      const p = pinch.current;
      const nz = clampZ(p.z * (dist / (p.dist || 1)));
      const r = boardRef.current?.getBoundingClientRect();
      if (r) {
        const px = p.cx - r.left;
        const py = p.cy - r.top;
        const k = nz / p.z;
        setZ(nz);
        setTx(px - (px - p.tx) * k);
        setTy(py - (py - p.ty) * k);
      }
      return;
    }

    const d = drag.current;
    if (!d) return;
    const s = viewRef.current.z;
    const dx = e.clientX - d.startX;
    const dy = e.clientY - d.startY;
    if (Math.abs(dx) > 3 || Math.abs(dy) > 3) moved.current = true;

    if (d.kind === "pan") {
      setTx(d.ox + dx);
      setTy(d.oy + dy);
    } else if (d.kind === "move") {
      const el = boardRef.current?.querySelector<HTMLElement>(`[data-card="${d.id}"]`);
      if (el) {
        const nx = d.ix + dx / s;
        const ny = d.iy + dy / s;
        el.style.left = `${nx}px`;
        el.style.top = `${ny}px`;
        // mantém as setas coladas no item enquanto ele é arrastado
        setLiveRect((prev) => (prev && prev.id === d.id ? { ...prev, x: nx, y: ny } : prev));
      }
    } else if (d.kind === "resize") {
      const el = boardRef.current?.querySelector<HTMLElement>(`[data-card="${d.id}"]`);
      if (el) {
        let nw = Math.max(64, d.iw + dx / s);
        let nh = Math.max(48, d.ih + dy / s);
        // imagens: o retângulo que contém a foto acompanha SEMPRE a
        // proporção original — nada de caixa livre que corta a imagem.
        // usa o eixo de maior deslocamento relativo como base e deriva
        // o outro dele; os mínimos são aplicados de forma proporcional.
        if (d.lockAspect && d.ratio > 0 && isFinite(d.ratio)) {
          const sx = dx / s;
          const sy = dy / s;
          if (Math.abs(sy) * d.ratio >= Math.abs(sx)) {
            nh = Math.max(48, d.ih + sy);
            nw = nh * d.ratio;
          } else {
            nw = Math.max(64, d.iw + sx);
            nh = nw / d.ratio;
            if (nh < 48) {
              nh = 48;
              nw = nh * d.ratio;
            }
          }
        }
        el.style.width = `${nw}px`;
        el.style.height = `${nh}px`;
        setLiveRect((prev) => (prev && prev.id === d.id ? { ...prev, w: nw, h: nh } : prev));
      }
    }
  }, [toWorld]);

  /** finaliza o rabisco, criando um item a partir dele */
  const finishStroke = useCallback(() => {
    const s = stroke.current;
    stroke.current = null;
    setLivePath(null);
    if (!s || s.pts.length < 2) return;

    const pad = penWidth;
    const xs = s.pts.map((p) => p.x);
    const ys = s.pts.map((p) => p.y);
    const minX = Math.min(...xs) - pad;
    const minY = Math.min(...ys) - pad;
    const w = Math.max(...xs) - minX + pad;
    const h = Math.max(...ys) - minY + pad;
    const d = s.pts
      .map((p, i) => `${i === 0 ? "M" : "L"} ${(p.x - minX).toFixed(1)} ${(p.y - minY).toFixed(1)}`)
      .join(" ");

    const item: CanvasItem = {
      id: uid(),
      type: "draw",
      x: Math.round(minX),
      y: Math.round(minY),
      w: Math.round(w),
      h: Math.round(h),
      vw: Math.round(w),
      vh: Math.round(h),
      d,
      color: penColor,
      strokeWidth: penWidth,
    };
    commit([...itemsRef.current, item]);
  }, [commit, penColor, penWidth]);

  const onPointerUp = useCallback(
    (e: React.PointerEvent) => {
      pointers.current.delete(e.pointerId);
      if (pointers.current.size < 2) pinch.current = null;
      if (stroke.current) {
        finishStroke();
        return;
      }
      const d = drag.current;
      drag.current = null;
      setLiveRect(null);
      if (!d || d.kind === "pan") return;

      const el = boardRef.current?.querySelector<HTMLElement>(`[data-card="${d.id}"]`);
      if (!el) return;
      if (d.kind === "move") {
        patchItem(d.id, { x: parseFloat(el.style.left), y: parseFloat(el.style.top) });
      } else {
        patchItem(d.id, { w: parseFloat(el.style.width), h: parseFloat(el.style.height) });
      }
    },
    [patchItem, finishStroke]
  );

  const sel = items.find((i) => i.id === selected) ?? null;
  const hasText = sel?.type === "sticky" || sel?.type === "text";
  const isArrow = sel?.type === "arrow";

  const nodes = items.filter((i) => i.type !== "arrow");
  const arrows = items.filter((i) => i.type === "arrow");

  /** posição atual do item (considerando o arraste em andamento) */
  const rectOf = (id?: string) => {
    if (!id) return null;
    if (liveRect && liveRect.id === id) return liveRect;
    const it = items.find((i) => i.id === id);
    return it ? { x: it.x, y: it.y, w: it.w, h: it.h } : null;
  };

  /** ponto na borda do retângulo apontando para (tx,ty) */
  const edgePoint = (r: { x: number; y: number; w: number; h: number }, tx2: number, ty2: number) => {
    const cx = r.x + r.w / 2;
    const cy = r.y + r.h / 2;
    const dx = tx2 - cx;
    const dy = ty2 - cy;
    if (dx === 0 && dy === 0) return { x: cx, y: cy };
    const sx = dx !== 0 ? r.w / 2 / Math.abs(dx) : Infinity;
    const sy = dy !== 0 ? r.h / 2 / Math.abs(dy) : Infinity;
    const t = Math.min(sx, sy);
    return { x: cx + dx * t, y: cy + dy * t };
  };

  const arrowGeom = (a: CanvasItem) => {
    const ra = rectOf(a.from);
    const rb = rectOf(a.to);
    if (!ra || !rb) return null;
    const ca = { x: ra.x + ra.w / 2, y: ra.y + ra.h / 2 };
    const cb = { x: rb.x + rb.w / 2, y: rb.y + rb.h / 2 };
    const p1 = edgePoint(ra, cb.x, cb.y);
    const p2 = edgePoint(rb, ca.x, ca.y);
    const ang = Math.atan2(p2.y - p1.y, p2.x - p1.x);
    const head = 11 + (a.strokeWidth ?? 2);
    const spread = 0.42;
    const tip = { x: p2.x, y: p2.y };
    const hp = [
      `${tip.x},${tip.y}`,
      `${tip.x - head * Math.cos(ang - spread)},${tip.y - head * Math.sin(ang - spread)}`,
      `${tip.x - head * Math.cos(ang + spread)},${tip.y - head * Math.sin(ang + spread)}`,
    ].join(" ");
    return {
      p1,
      p2: { x: tip.x - head * 0.8 * Math.cos(ang), y: tip.y - head * 0.8 * Math.sin(ang) },
      hp,
      mid: { x: (p1.x + p2.x) / 2, y: (p1.y + p2.y) / 2 },
    };
  };

  return (
    <div className="relative flex min-h-0 flex-1 flex-col bg-carbon-950">
      {/* barra de ferramentas */}
      <div className="flex shrink-0 flex-wrap items-center gap-1 border-b border-carbon-700/70 bg-carbon-900/80 px-2 py-1.5">
        <ToolBtn label="nota adesiva" onClick={() => addItem("sticky")}><StickyNote size={15} /></ToolBtn>
        <ToolBtn label="texto" onClick={() => addItem("text")}><Type size={15} /></ToolBtn>
        <ToolBtn label="imagem" onClick={() => fileRef.current?.click()}><ImagePlus size={15} /></ToolBtn>

        <span className="mx-1 h-5 w-px bg-carbon-700" />

        <ToolBtn label="selecionar / mover itens" active={tool === "select"} onClick={() => setTool("select")}>
          <MousePointer2 size={15} />
        </ToolBtn>
        <ToolBtn label="mover o quadro" active={tool === "pan"} onClick={() => setTool("pan")}>
          <Hand size={15} />
        </ToolBtn>
        <ToolBtn label="desenhar" active={tool === "draw"} onClick={() => setTool(tool === "draw" ? "select" : "draw")}>
          <Brush size={15} />
        </ToolBtn>
        <ToolBtn
          label="ligar itens com seta"
          active={tool === "connect"}
          onClick={() => {
            setLinkFrom(null);
            setTool(tool === "connect" ? "select" : "connect");
          }}
        >
          <Waypoints size={15} />
        </ToolBtn>

        {tool === "draw" && (
          <span className="flex items-center gap-1 rounded-lg border border-carbon-700 bg-carbon-850 px-1.5 py-0.5">
            {COLORS.slice(0, 6).map((c) => (
              <button
                key={c}
                onClick={() => setPenColor(c)}
                title="cor do traço"
                className={`h-5 w-5 rounded-full border-2 transition-transform active:scale-90 ${
                  penColor === c ? "border-white" : "border-transparent"
                }`}
                style={{ background: c }}
              />
            ))}
            <span className="mx-0.5 h-4 w-px bg-carbon-700" />
            {[2, 4, 8, 14].map((wpx) => (
              <button
                key={wpx}
                onClick={() => setPenWidth(wpx)}
                title={`espessura ${wpx}px`}
                className={`flex h-6 w-6 items-center justify-center rounded transition-colors ${
                  penWidth === wpx ? "bg-acid-400/20" : ""
                }`}
              >
                <span
                  className="rounded-full bg-carbon-200"
                  style={{ width: Math.min(wpx, 12), height: Math.min(wpx, 12) }}
                />
              </button>
            ))}
          </span>
        )}

        <span className="ml-auto flex shrink-0 items-center gap-1">
          <ToolBtn label="menos zoom" onClick={() => zoomCenter(1 / 1.2)}><ZoomOut size={15} /></ToolBtn>
          <span className="w-10 text-center font-mono text-[10px] tabular-nums text-carbon-400">
            {Math.round(z * 100)}%
          </span>
          <ToolBtn label="mais zoom" onClick={() => zoomCenter(1.2)}><ZoomIn size={15} /></ToolBtn>
          <ToolBtn label="enquadrar tudo" onClick={fitAll}><Maximize size={14} /></ToolBtn>
        </span>
      </div>

      {/* área do quadro */}
      <div
        ref={boardRef}
        onPointerDown={onPointerDown}
        onPointerMove={onPointerMove}
        onPointerUp={onPointerUp}
        onPointerCancel={onPointerUp}
        onPaste={(e) => {
          const f = Array.from(e.clipboardData?.items ?? [])
            .find((i) => i.type.startsWith("image/"))?.getAsFile();
          if (f) { e.preventDefault(); void addImageFile(f); }
        }}
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          const f = Array.from(e.dataTransfer.files).find((x) => x.type.startsWith("image/"));
          if (f) { e.preventDefault(); void addImageFile(f); }
        }}
        className={`canvas-board relative min-h-0 flex-1 overflow-hidden ${
          tool === "pan" ? "cursor-grab" : tool === "draw" ? "cursor-crosshair" : "cursor-default"
        }`}
        style={{
          backgroundSize: `${28 * z}px ${28 * z}px`,
          backgroundPosition: `${tx}px ${ty}px`,
        }}
      >
        <div
          className="absolute left-0 top-0 origin-top-left"
          style={{ transform: `translate(${tx}px, ${ty}px) scale(${z})` }}
        >
          {/* camada das setas, sempre atrás dos cartões */}
          <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
            {arrows.map((a) => {
              const g = arrowGeom(a);
              if (!g) return null;
              const on = a.id === selected;
              const col = on ? "#d4f74c" : a.color ?? "#8b909b";
              const sw = a.strokeWidth ?? 2;
              return (
                <g key={a.id} data-arrow={a.id} className="pointer-events-auto cursor-pointer">
                  {/* trilha invisível mais grossa, para facilitar o toque */}
                  <line
                    x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y}
                    stroke="transparent" strokeWidth={Math.max(18, sw * 6)}
                  />
                  <line
                    x1={g.p1.x} y1={g.p1.y} x2={g.p2.x} y2={g.p2.y}
                    stroke={col} strokeWidth={sw} strokeLinecap="round"
                  />
                  <polygon points={g.hp} fill={col} />
                  {a.label && (
                    <g>
                      <rect
                        x={g.mid.x - (a.label.length * (a.fontSize ?? 12) * 0.3 + 6)}
                        y={g.mid.y - (a.fontSize ?? 12) * 0.9}
                        width={a.label.length * (a.fontSize ?? 12) * 0.6 + 12}
                        height={(a.fontSize ?? 12) * 1.8}
                        rx={6}
                        fill="#0c0d10"
                        stroke={col}
                        strokeWidth={1}
                      />
                      <text
                        x={g.mid.x} y={g.mid.y}
                        textAnchor="middle" dominantBaseline="central"
                        fill="#e6e8eb" fontSize={a.fontSize ?? 12}
                        style={{ fontFamily: "Inter, sans-serif" }}
                      >
                        {a.label}
                      </text>
                    </g>
                  )}
                </g>
              );
            })}
          </svg>

          {nodes.map((it) => {
            const isSel = it.id === selected;
            const isEdit = it.id === editing;
            const isLinkSrc = linkFrom === it.id;
            return (
              <div
                key={it.id}
                data-card={it.id}
                className={`absolute select-none rounded-xl transition-shadow ${
                  isSel ? "shadow-[0_8px_30px_rgba(0,0,0,0.5)]" : "shadow-[0_3px_14px_rgba(0,0,0,0.35)]"
                }`}
                style={{
                  left: it.x,
                  top: it.y,
                  width: it.w,
                  height: it.h,
                  outline: isLinkSrc
                    ? "2px dashed #6fb4ff"
                    : isSel
                      ? "2px solid var(--color-acid-400)"
                      : "none",
                  outlineOffset: 2,
                }}
                onDoubleClick={() => it.type !== "image" && setEditing(it.id)}
              >
                {it.type === "draw" ? (
                  <svg
                    viewBox={`0 0 ${it.vw ?? it.w} ${it.vh ?? it.h}`}
                    preserveAspectRatio="none"
                    className="pointer-events-none h-full w-full overflow-visible"
                  >
                    <path
                      d={it.d}
                      fill="none"
                      stroke={it.color ?? "#d4f74c"}
                      strokeWidth={it.strokeWidth ?? 4}
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      vectorEffect="non-scaling-stroke"
                    />
                  </svg>
                ) : it.type === "image" ? (
                  <img
                    src={it.src}
                    alt=""
                    draggable={false}
                    className="pointer-events-none h-full w-full rounded-xl object-contain"
                  />
                ) : it.type === "sticky" ? (
                  <div
                    className="h-full w-full overflow-hidden rounded-xl p-3"
                    style={{ background: it.color ?? COLORS[1] }}
                  >
                    <CardText
                      item={it}
                      editing={isEdit}
                      fontSize={it.fontSize ?? 14}
                      dark
                      onChange={(v) => patchItem(it.id, { text: v })}
                      onDone={() => setEditing(null)}
                    />
                  </div>
                ) : (
                  <div className="h-full w-full overflow-hidden rounded-xl p-2">
                    <CardText
                      item={it}
                      editing={isEdit}
                      fontSize={it.fontSize ?? 18}
                      color={it.color ?? "#e6e8eb"}
                      onChange={(v) => patchItem(it.id, { text: v })}
                      onDone={() => setEditing(null)}
                    />
                  </div>
                )}

                {isSel && it.type !== "arrow" && (
                  <div
                    data-handle="1"
                    title="arraste para redimensionar"
                    className="absolute -bottom-2.5 -right-2.5 h-5 w-5 cursor-nwse-resize touch-none rounded-md border-2 border-carbon-900 bg-acid-400 shadow-[0_0_10px_rgba(212,247,76,0.6)]"
                    style={{ transform: `scale(${1 / z})`, transformOrigin: "bottom right" }}
                  />
                )}
              </div>
            );
          })}

          {/* traço sendo desenhado agora */}
          {livePath && (
            <svg className="pointer-events-none absolute left-0 top-0 overflow-visible" width={1} height={1}>
              <path
                d={livePath}
                fill="none"
                stroke={penColor}
                strokeWidth={penWidth}
                strokeLinecap="round"
                strokeLinejoin="round"
              />
            </svg>
          )}
        </div>

        {tool === "connect" && (
          <div className="pointer-events-none absolute left-1/2 top-2 z-10 -translate-x-1/2 rounded-full border border-sky-400/40 bg-carbon-950/90 px-3 py-1.5 backdrop-blur">
            <p className="font-mono text-[10px] uppercase tracking-[0.14em] text-sky-300">
              {linkFrom ? "toque no item de destino" : "toque no item de origem"}
            </p>
          </div>
        )}

        {items.length === 0 && (
          <div className="pointer-events-none absolute inset-0 flex flex-col items-center justify-center gap-2 text-center">
            <StickyNote size={26} className="text-carbon-600" strokeWidth={1.5} />
            <p className="font-mono text-[10px] uppercase tracking-[0.18em] text-carbon-500">
              quadro vazio
            </p>
            <p className="max-w-[240px] text-[11.5px] leading-relaxed text-carbon-500">
              adicione notas, textos e imagens, ou use o pincel para desenhar.
              arraste o fundo para mover, pinça ou Ctrl+scroll para o zoom.
            </p>
          </div>
        )}
      </div>

      {/* barra do item selecionado (grande, pensada para o toque) */}
      {sel && (
        <div className="anim-pop-in absolute inset-x-0 bottom-0 z-20 border-t border-carbon-700 bg-carbon-900/95 px-2 py-2 backdrop-blur">
          {palette && sel.type !== "image" && (
            /* cores do item (texto, adesiva ou traço) */
            <div className="mb-2 flex flex-wrap items-center gap-1.5 px-1">
              {COLORS.map((c) => (
                <button
                  key={c}
                  onClick={() => patchItem(sel.id, { color: c })}
                  className={`h-7 w-7 rounded-lg border-2 transition-transform active:scale-90 ${
                    sel.color === c ? "border-white" : "border-transparent"
                  }`}
                  style={{ background: c }}
                />
              ))}
            </div>
          )}

          {format && hasText && (
            <div className="mb-2 space-y-1.5 border-b border-carbon-700/70 px-1 pb-2">
              {/* estilos */}
              <div className="flex flex-wrap items-center gap-1">
                <FmtBtn label="negrito" active={!!sel.bold} onClick={() => patchItem(sel.id, { bold: !sel.bold })}>
                  <Bold size={14} />
                </FmtBtn>
                <FmtBtn label="itálico" active={!!sel.italic} onClick={() => patchItem(sel.id, { italic: !sel.italic })}>
                  <Italic size={14} />
                </FmtBtn>
                <FmtBtn label="sublinhado" active={!!sel.underline} onClick={() => patchItem(sel.id, { underline: !sel.underline })}>
                  <Underline size={14} />
                </FmtBtn>
                <FmtBtn label="tachado" active={!!sel.strike} onClick={() => patchItem(sel.id, { strike: !sel.strike })}>
                  <Strikethrough size={14} />
                </FmtBtn>

                <span className="mx-0.5 h-5 w-px bg-carbon-700" />

                <FmtBtn label="alinhar à esquerda" active={(sel.align ?? "left") === "left"} onClick={() => patchItem(sel.id, { align: "left" })}>
                  <AlignLeft size={14} />
                </FmtBtn>
                <FmtBtn label="centralizar" active={sel.align === "center"} onClick={() => patchItem(sel.id, { align: "center" })}>
                  <AlignCenter size={14} />
                </FmtBtn>
                <FmtBtn label="alinhar à direita" active={sel.align === "right"} onClick={() => patchItem(sel.id, { align: "right" })}>
                  <AlignRight size={14} />
                </FmtBtn>

                <span className="mx-0.5 h-5 w-px bg-carbon-700" />

                <FmtBtn label="topo" active={(sel.valign ?? "top") === "top"} onClick={() => patchItem(sel.id, { valign: "top" })}>
                  <ArrowUpToLine size={14} />
                </FmtBtn>
                <FmtBtn label="meio" active={sel.valign === "middle"} onClick={() => patchItem(sel.id, { valign: "middle" })}>
                  <AlignVerticalJustifyCenter size={14} />
                </FmtBtn>
                <FmtBtn label="base" active={sel.valign === "bottom"} onClick={() => patchItem(sel.id, { valign: "bottom" })}>
                  <ArrowDownToLine size={14} />
                </FmtBtn>
              </div>

              {/* fonte e cor da letra */}
              <div className="flex flex-wrap items-center gap-1.5">
                <select
                  value={sel.font ?? FONTS[0].value}
                  onChange={(e) => patchItem(sel.id, { font: e.target.value })}
                  title="fonte"
                  className="h-7 cursor-pointer rounded-lg border border-carbon-600 bg-carbon-800 px-1.5 text-[11px] text-carbon-100 outline-none [&>option]:bg-carbon-800"
                >
                  {FONTS.map((f) => (
                    <option key={f.label} value={f.value}>{f.label}</option>
                  ))}
                </select>

                <span className="flex items-center gap-1 rounded-lg border border-carbon-600 px-1.5 py-1">
                  <Baseline size={13} className="shrink-0 text-carbon-400" />
                  {TEXT_COLORS.map((c) => (
                    <button
                      key={c}
                      onClick={() => patchItem(sel.id, { textColor: c })}
                      title="cor da letra"
                      className={`h-5 w-5 rounded-md border-2 transition-transform active:scale-90 ${
                        sel.textColor === c ? "border-acid-400" : "border-carbon-700"
                      }`}
                      style={{ background: c }}
                    />
                  ))}
                  <button
                    onClick={() => patchItem(sel.id, { textColor: undefined })}
                    title="cor padrão"
                    className="rounded-md px-1.5 py-0.5 font-mono text-[9px] uppercase text-carbon-400 hover:text-white"
                  >
                    auto
                  </button>
                </span>
              </div>
            </div>
          )}
          <div className="flex flex-wrap items-center gap-1.5">
            {sel.type !== "image" && (
              <BarBtn onClick={() => setPalette((p) => !p)} active={palette}>
                <Palette size={15} />
                cor
              </BarBtn>
            )}
            {isArrow && (
              <BarBtn
                onClick={() => {
                  const v = window.prompt("rótulo da seta:", sel.label ?? "");
                  if (v !== null) patchItem(sel.id, { label: v.trim() || undefined });
                }}
              >
                <Tag size={15} />
                rótulo
              </BarBtn>
            )}
            {hasText && (
              <>
                <BarBtn onClick={() => setEditing(editing === sel.id ? null : sel.id)}>
                  {editing === sel.id ? <Check size={15} /> : <Pencil size={15} />}
                  {editing === sel.id ? "pronto" : "editar"}
                </BarBtn>
                <BarBtn onClick={() => setFormat((f) => !f)} active={format}>
                  <CaseSensitive size={16} />
                  formatar
                </BarBtn>
                <div className="flex items-center overflow-hidden rounded-lg border border-carbon-600">
                  <button
                    onClick={() => patchItem(sel.id, { fontSize: Math.max(9, (sel.fontSize ?? 14) - 2) })}
                    className="px-2.5 py-1.5 text-[13px] font-bold text-carbon-200 active:bg-carbon-700"
                  >−</button>
                  <span className="w-7 text-center font-mono text-[10px] text-carbon-400">
                    {sel.fontSize ?? 14}
                  </span>
                  <button
                    onClick={() => patchItem(sel.id, { fontSize: Math.min(72, (sel.fontSize ?? 14) + 2) })}
                    className="px-2.5 py-1.5 text-[13px] font-bold text-carbon-200 active:bg-carbon-700"
                  >+</button>
                </div>
              </>
            )}
            {!isArrow && (
              <BarBtn onClick={() => duplicateItem(sel.id)}>
                <Copy size={15} />
                duplicar
              </BarBtn>
            )}
            <BarBtn danger onClick={() => removeItem(sel.id)}>
              <Trash2 size={15} />
              apagar
            </BarBtn>
          </div>
        </div>
      )}

      <input
        ref={fileRef}
        type="file"
        accept="image/*"
        className="hidden"
        onChange={(e) => {
          const f = e.target.files?.[0];
          if (f) void addImageFile(f);
          e.target.value = "";
        }}
      />
    </div>
  );
}

function CardText({
  item, editing, fontSize, color, dark, onChange, onDone,
}: {
  item: CanvasItem;
  editing: boolean;
  fontSize: number;
  color?: string;
  dark?: boolean;
  onChange: (v: string) => void;
  onDone: () => void;
}) {
  const ref = useRef<HTMLTextAreaElement>(null);
  useEffect(() => {
    if (editing) {
      ref.current?.focus();
      ref.current?.select();
    }
  }, [editing]);

  const value = item.text ?? "";
  const decoration = [item.underline ? "underline" : "", item.strike ? "line-through" : ""]
    .filter(Boolean)
    .join(" ");

  const style: React.CSSProperties = {
    fontSize,
    color: item.textColor ?? (dark ? "#08090b" : color),
    lineHeight: 1.4,
    fontWeight: item.bold ? 700 : 400,
    fontStyle: item.italic ? "italic" : "normal",
    textDecoration: decoration || "none",
    textAlign: item.align ?? "left",
    fontFamily: item.font ?? "Inter, sans-serif",
    textUnderlineOffset: 2,
  };

  if (editing) {
    return (
      <textarea
        ref={ref}
        value={value}
        onChange={(e) => onChange(e.target.value)}
        onBlur={onDone}
        onPointerDown={(e) => e.stopPropagation()}
        onKeyDown={(e) => {
          if (e.key === "Escape") onDone();
          e.stopPropagation();
        }}
        placeholder="digite..."
        className="h-full w-full resize-none bg-transparent outline-none placeholder:opacity-40"
        style={style}
      />
    );
  }
  const vAlign =
    item.valign === "middle" ? "center" : item.valign === "bottom" ? "flex-end" : "flex-start";
  return (
    <p
      className="flex h-full w-full flex-col overflow-hidden whitespace-pre-wrap break-words"
      style={{ ...style, justifyContent: vAlign }}
    >
      {value || <span className="opacity-40">toque duas vezes para escrever</span>}
    </p>
  );
}

function ToolBtn({
  label, onClick, active, children,
}: { label: string; onClick: () => void; active?: boolean; children: React.ReactNode }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-lg border transition-colors active:scale-95 ${
        active
          ? "border-acid-500/50 bg-acid-400/15 text-acid-300"
          : "border-transparent text-carbon-300 hover:border-carbon-600 hover:bg-carbon-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function FmtBtn({
  label, active, onClick, children,
}: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) {
  return (
    <button
      title={label}
      onClick={onClick}
      className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-lg border transition-colors active:scale-90 ${
        active
          ? "border-acid-500/50 bg-acid-400/15 text-acid-300"
          : "border-transparent text-carbon-300 hover:border-carbon-600 hover:bg-carbon-800 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}

function BarBtn({
  onClick, children, danger, active,
}: { onClick: () => void; children: React.ReactNode; danger?: boolean; active?: boolean }) {
  return (
    <button
      onClick={onClick}
      className={`flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-[11.5px] font-medium transition-colors active:scale-95 ${
        danger
          ? "border-ember-400/40 text-ember-400 active:bg-ember-400/10"
          : active
            ? "border-acid-500/50 bg-acid-400/15 text-acid-300"
            : "border-carbon-600 text-carbon-200 active:bg-carbon-800"
      }`}
    >
      {children}
    </button>
  );
}
