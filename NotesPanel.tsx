import { memo, useCallback, useEffect, useRef, useState } from "react";
import {
  NotebookPen, PanelLeftClose, PanelLeftOpen, Type, Plus, GripVertical, Pencil, Trash2,
  Undo2, Redo2, Bold, Italic, Underline, Strikethrough, Baseline, Highlighter,
  Link2, Unlink, AlignLeft, AlignCenter, AlignRight, AlignJustify, List, ListOrdered,
  IndentDecrease, IndentIncrease, Subscript, Superscript, Minus, RemoveFormatting,
  ImagePlus, Maximize2, LayoutGrid, FileText,
} from "lucide-react";
import type { OrdoNote, CanvasItem } from "../types";
import { CanvasBoard } from "./CanvasBoard";
import { newNote, fileToDataURL } from "../lib/ordo";
import { lsGet, lsSet } from "../lib/store";
import { PanelChrome, HeaderIconBtn } from "./PanelChrome";
import { ContextMenuView, useContextMenu } from "./ContextMenu";

interface Props {
  notes: OrdoNote[];
  activeId: string;
  onChange: (notes: OrdoNote[], activeId?: string) => void;
}

const BLOCKS = [
  { value: "P", label: "Normal" },
  { value: "H1", label: "Título 1" },
  { value: "H2", label: "Título 2" },
  { value: "H3", label: "Título 3" },
  { value: "BLOCKQUOTE", label: "Citação" },
  { value: "PRE", label: "Código" },
];

const FONTS: { label: string; value: string }[] = [
  { label: "Padrão", value: "Inter, sans-serif" },
  { label: "Display", value: "'Space Grotesk', sans-serif" },
  { label: "Serifa", value: "'Newsreader', Georgia, serif" },
  { label: "Mono", value: "'JetBrains Mono', monospace" },
  { label: "Manuscrita", value: "'Caveat', cursive" },
  { label: "Arial", value: "Arial, sans-serif" },
  { label: "Georgia", value: "Georgia, serif" },
  { label: "Times", value: "'Times New Roman', serif" },
  { label: "Courier", value: "'Courier New', monospace" },
];

const TB = ({
  label, active = false, onClick, children,
}: { label: string; active?: boolean; onClick: () => void; children: React.ReactNode }) => (
  <button
    type="button"
    title={label}
    aria-label={label}
    onMouseDown={(e) => e.preventDefault()}
    onClick={onClick}
    className={`flex h-7 w-7 shrink-0 items-center justify-center rounded-md border transition-all active:scale-90 ${
      active
        ? "border-acid-500/50 bg-acid-400/15 text-acid-300"
        : "border-transparent text-carbon-300 hover:border-carbon-600 hover:bg-carbon-700/60 hover:text-white"
    }`}
  >
    {children}
  </button>
);

const Divider = () => <span className="mx-0.5 h-5 w-px shrink-0 bg-carbon-700" />;

const BLOCK_TAGS = new Set(["P", "DIV", "H1", "H2", "H3", "LI", "UL", "OL", "PRE", "BLOCKQUOTE"]);

const selCls =
  "h-7 shrink-0 cursor-pointer rounded-md border border-transparent bg-transparent px-1.5 text-[11.5px] font-medium text-carbon-200 outline-none transition-colors hover:border-carbon-600 hover:bg-carbon-700/60 focus:border-carbon-600 [&>option]:bg-carbon-800 [&>option]:text-white";

function NotesPanelInner({ notes, activeId, onChange }: Props) {
  const [sbOpen, setSbOpen] = useState(() => lsGet("ordo:ui:notes-sb") !== "0");
  const [tbOpen, setTbOpen] = useState(() => lsGet("ordo:ui:notes-tb") !== "0");
  const [renamingId, setRenamingId] = useState<string | null>(null);
  const [renameVal, setRenameVal] = useState("");
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const [words, setWords] = useState(0);
  const [activeStates, setActiveStates] = useState<Record<string, boolean>>({});
  const [blockVal, setBlockVal] = useState("P");
  const [sizeVal, setSizeVal] = useState<number | "">("");
  const [fontVal, setFontVal] = useState("");

  const editorRef = useRef<HTMLDivElement>(null);
  const savedRange = useRef<Range | null>(null);
  const dragIdx = useRef<number | null>(null);
  const imgInputRef = useRef<HTMLInputElement>(null);
  const skipBlurApply = useRef(false);
  const sizeRef = useRef<number>(15);
  const { menu: imgMenu, open: openImgMenu, close: closeImgMenu } = useContextMenu();
  const imgDrag = useRef<{
    img: HTMLImageElement;
    mode: "move" | "resize";
    startX: number;
    startY: number;
    left: number;
    top: number;
    width: number;
  } | null>(null);
  const selImg = useRef<HTMLImageElement | null>(null);
  const [selBox, setSelBox] = useState<{ l: number; t: number; w: number; h: number } | null>(null);

  const notesRef = useRef(notes);
  const activeIdRef = useRef(activeId);
  const onChangeRef = useRef(onChange);
  useEffect(() => { notesRef.current = notes; });
  useEffect(() => { activeIdRef.current = activeId; });
  useEffect(() => { onChangeRef.current = onChange; });

  /* ---- editor <-> state sync ---- */
  const sync = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const html = ed.innerHTML;
    const id = activeIdRef.current;
    const arr = notesRef.current.map((n) => (n.id === id ? { ...n, content: html } : n));
    onChangeRef.current(arr);
    const t = ed.innerText.trim();
    setWords(t ? t.split(/\s+/).filter(Boolean).length : 0);
  }, []);

  /* load note into editor on switch */
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const note = notesRef.current.find((n) => n.id === activeId);
    ed.innerHTML = note?.content ?? "";
    savedRange.current = null;
    const t = ed.innerText.trim();
    setWords(t ? t.split(/\s+/).filter(Boolean).length : 0);
    setTimeout(() => ed.focus(), 0);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [activeId]);

  const saveRange = useCallback(() => {
    const sel = window.getSelection();
    const ed = editorRef.current;
    if (!sel || !ed || sel.rangeCount === 0) return;
    const r = sel.getRangeAt(0);
    if (ed.contains(r.commonAncestorContainer)) savedRange.current = r.cloneRange();
  }, []);

  const updateStates = useCallback(() => {
    saveRange();
    try {
      setActiveStates({
        bold: document.queryCommandState("bold"),
        italic: document.queryCommandState("italic"),
        underline: document.queryCommandState("underline"),
        strikeThrough: document.queryCommandState("strikeThrough"),
        subscript: document.queryCommandState("subscript"),
        superscript: document.queryCommandState("superscript"),
        insertUnorderedList: document.queryCommandState("insertUnorderedList"),
        insertOrderedList: document.queryCommandState("insertOrderedList"),
        justifyLeft: document.queryCommandState("justifyLeft"),
        justifyCenter: document.queryCommandState("justifyCenter"),
        justifyRight: document.queryCommandState("justifyRight"),
        justifyFull: document.queryCommandState("justifyFull"),
      });
      const bv = (document.queryCommandValue("formatBlock") || "P").toUpperCase();
      setBlockVal(BLOCKS.some((b) => b.value === bv) ? bv : "P");
      const fv = document.queryCommandValue("fontName") || "";
      setFontVal(fv);
      const sel = window.getSelection();
      let node: Node | null = sel?.anchorNode ?? null;
      if (node && node.nodeType === Node.TEXT_NODE) node = node.parentNode;
      if (node instanceof Element && editorRef.current?.contains(node)) {
        const px = Math.round(parseFloat(getComputedStyle(node).fontSize));
        if (px) {
          sizeRef.current = px;
          setSizeVal(px);
        }
      }
    } catch { /* commands unsupported */ }
  }, [saveRange]);

  useEffect(() => {
    const onSel = () => {
      const ed = editorRef.current;
      const sel = window.getSelection();
      if (!ed || !sel || sel.rangeCount === 0) return;
      if (ed.contains(sel.getRangeAt(0).commonAncestorContainer)) updateStates();
    };
    document.addEventListener("selectionchange", onSel);
    return () => document.removeEventListener("selectionchange", onSel);
  }, [updateStates]);

  const restoreAndFocus = useCallback(() => {
    const ed = editorRef.current;
    if (!ed) return;
    ed.focus();
    const r = savedRange.current;
    const sel = window.getSelection();
    if (r && ed.contains(r.commonAncestorContainer)) {
      sel?.removeAllRanges();
      sel?.addRange(r);
    } else if (sel && (sel.rangeCount === 0 || !ed.contains(sel.getRangeAt(0).commonAncestorContainer))) {
      // sem seleção válida: coloca o cursor no fim
      const end = document.createRange();
      end.selectNodeContents(ed);
      end.collapse(false);
      sel.removeAllRanges();
      sel.addRange(end);
    }
  }, []);

  const exec = useCallback(
    (cmd: string, val?: string) => {
      restoreAndFocus();
      document.execCommand(cmd, false, val);
      updateStates();
      sync();
    },
    [restoreAndFocus, sync, updateStates]
  );

  const applyFontSize = useCallback(
    (px: number) => {
      const ed = editorRef.current;
      const size = Math.round(px);
      if (!ed || !size || size < 6 || size > 400) return;
      restoreAndFocus();
      const sel = window.getSelection();
      if (!sel || sel.rangeCount === 0) return;
      const range = sel.getRangeAt(0);
      if (!ed.contains(range.commonAncestorContainer)) return;

      sizeRef.current = size;
      setSizeVal(size);

      // ---- sem seleção: prepara o tamanho para o que for digitado a seguir ----
      if (range.collapsed) {
        const span = document.createElement("span");
        span.style.fontSize = `${size}px`;
        span.appendChild(document.createTextNode("\u200B"));
        range.insertNode(span);
        const caret = document.createRange();
        caret.setStart(span.firstChild as Text, 1);
        caret.collapse(true);
        sel.removeAllRanges();
        sel.addRange(caret);
        savedRange.current = caret.cloneRange();
        sync();
        return;
      }

      // ---- com seleção: extrai, limpa tamanhos antigos e reaplica ----
      const frag = range.extractContents();

      // remove qualquer tamanho já existente dentro do trecho
      frag.querySelectorAll<HTMLElement>('[style*="font-size"]').forEach((el) => {
        el.style.fontSize = "";
        if (!el.getAttribute("style")?.trim() && el.tagName === "SPAN") {
          el.replaceWith(...Array.from(el.childNodes)); // desembrulha span vazio
        }
      });
      frag.querySelectorAll("font[size]").forEach((f) => f.removeAttribute("size"));

      const hasBlock = Array.from(frag.childNodes).some(
        (n) => n.nodeType === Node.ELEMENT_NODE && BLOCK_TAGS.has((n as Element).tagName)
      );

      let firstNode: Node | null = null;
      let lastNode: Node | null = null;

      if (hasBlock) {
        // seleção com parágrafos: aplica o tamanho em cada bloco, sem quebrar o layout
        const nodes = Array.from(frag.childNodes);
        for (const n of nodes) {
          if (n.nodeType === Node.ELEMENT_NODE) {
            (n as HTMLElement).style.fontSize = `${size}px`;
          } else if (n.nodeType === Node.TEXT_NODE && n.nodeValue?.trim()) {
            const s = document.createElement("span");
            s.style.fontSize = `${size}px`;
            n.parentNode?.replaceChild(s, n);
            s.appendChild(n);
          }
        }
        range.insertNode(frag);
        firstNode = nodes[0] ?? null;
        lastNode = nodes[nodes.length - 1] ?? null;
      } else {
        const span = document.createElement("span");
        span.style.fontSize = `${size}px`;
        span.appendChild(frag);
        range.insertNode(span);
        firstNode = span;
        lastNode = span;
      }

      // reseleciona o conteúdo: a âncora fica DENTRO do novo tamanho,
      // então o campo continua mostrando o valor certo e dá para clicar de novo
      if (firstNode && lastNode) {
        const r = document.createRange();
        r.setStart(firstNode, 0);
        r.setEnd(lastNode, lastNode.childNodes.length || 0);
        sel.removeAllRanges();
        sel.addRange(r);
        savedRange.current = r.cloneRange();
      }

      ed.normalize();
      sync();
    },
    [restoreAndFocus, sync]
  );

  const applyHighlight = useCallback(
    (color: string) => {
      restoreAndFocus();
      try { document.execCommand("styleWithCSS", false, "true"); } catch { /* ignore */ }
      try { document.execCommand("hiliteColor", false, color); } catch { /* ignore */ }
      // garante que o modo CSS nunca fique ligado (quebrava os outros comandos)
      try { document.execCommand("styleWithCSS", false, "false"); } catch { /* ignore */ }
      updateStates();
      sync();
    },
    [restoreAndFocus, sync, updateStates]
  );

  const insertLink = useCallback(() => {
    const url = window.prompt("URL do link:", "https://");
    if (url && url.trim()) exec("createLink", url.trim());
  }, [exec]);

  /* ---- imagens flutuantes na nota ---- */
  const insertImageFile = useCallback(
    async (file: File) => {
      const ed = editorRef.current;
      if (!ed || !file.type.startsWith("image/")) return;
      const dataUrl = await fileToDataURL(file);
      const probe = new Image();
      probe.src = dataUrl;
      await probe.decode().catch(() => undefined);
      const natural = probe.naturalWidth || 320;
      const width = Math.min(natural, Math.max(160, ed.clientWidth - 80), 420);

      const img = ed.ownerDocument.createElement("img");
      img.src = dataUrl;
      img.className = "note-img";
      img.setAttribute("contenteditable", "false");
      img.draggable = false;
      img.style.left = `${24 + ed.scrollLeft}px`;
      img.style.top = `${24 + ed.scrollTop}px`;
      img.style.width = `${Math.round(width)}px`;
      ed.appendChild(img);
      sync();
    },
    [sync]
  );

  const onEditorPaste = useCallback(
    (e: React.ClipboardEvent<HTMLDivElement>) => {
      const items = e.clipboardData?.items;
      if (!items) return;
      for (const item of Array.from(items)) {
        if (item.type.startsWith("image/")) {
          const file = item.getAsFile();
          if (file) {
            e.preventDefault();
            void insertImageFile(file);
            return;
          }
        }
      }
    },
    [insertImageFile]
  );

  const onEditorDrop = useCallback(
    (e: React.DragEvent<HTMLDivElement>) => {
      const file = Array.from(e.dataTransfer?.files ?? []).find((f) =>
        f.type.startsWith("image/")
      );
      if (!file) return;
      e.preventDefault();
      void insertImageFile(file);
    },
    [insertImageFile]
  );

  /** recalcula a caixa de seleção (coordenadas relativas à área visível do editor) */
  const syncSelBox = useCallback(() => {
    const ed = editorRef.current;
    const img = selImg.current;
    if (!ed || !img || !img.isConnected) {
      setSelBox(null);
      return;
    }
    const er = ed.getBoundingClientRect();
    const ir = img.getBoundingClientRect();
    setSelBox({ l: ir.left - er.left, t: ir.top - er.top, w: ir.width, h: ir.height });
  }, []);

  const selectImage = useCallback(
    (img: HTMLImageElement | null) => {
      selImg.current?.classList.remove("selected");
      selImg.current = img;
      img?.classList.add("selected");
      syncSelBox();
    },
    [syncSelBox]
  );

  const onImgPointerMove = useCallback(
    (e: PointerEvent) => {
      const st = imgDrag.current;
      if (!st) return;
      e.preventDefault();
      const dx = e.clientX - st.startX;
      const dy = e.clientY - st.startY;
      if (st.mode === "move") {
        st.img.style.left = `${Math.max(0, st.left + dx)}px`;
        st.img.style.top = `${Math.max(0, st.top + dy)}px`;
      } else {
        st.img.style.width = `${Math.max(48, Math.min(4000, st.width + dx))}px`;
        st.img.style.height = "auto";
      }
      syncSelBox();
    },
    [syncSelBox]
  );

  const onImgPointerUp = useCallback(() => {
    const st = imgDrag.current;
    window.removeEventListener("pointermove", onImgPointerMove);
    if (st) {
      st.img.classList.remove("dragging");
      imgDrag.current = null;
      syncSelBox();
      sync();
    }
  }, [onImgPointerMove, sync, syncSelBox]);

  const beginImgDrag = useCallback(
    (img: HTMLImageElement, mode: "move" | "resize", clientX: number, clientY: number) => {
      imgDrag.current = {
        img,
        mode,
        startX: clientX,
        startY: clientY,
        left: parseFloat(img.style.left) || 0,
        top: parseFloat(img.style.top) || 0,
        width: img.offsetWidth,
      };
      img.classList.add("dragging");
      window.addEventListener("pointermove", onImgPointerMove, { passive: false });
      window.addEventListener("pointerup", onImgPointerUp, { once: true });
      window.addEventListener("pointercancel", onImgPointerUp, { once: true });
    },
    [onImgPointerMove, onImgPointerUp]
  );

  const onEditorPointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (target instanceof HTMLImageElement && target.classList.contains("note-img")) {
        e.preventDefault();
        selectImage(target);
        beginImgDrag(target, "move", e.clientX, e.clientY);
      } else {
        selectImage(null);
      }
    },
    [beginImgDrag, selectImage]
  );

  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent<HTMLDivElement>) => {
      const img = selImg.current;
      if (!img) return;
      e.preventDefault();
      e.stopPropagation();
      beginImgDrag(img, "resize", e.clientX, e.clientY);
    },
    [beginImgDrag]
  );

  /* mantém a alça grudada na imagem ao rolar / redimensionar o painel */
  useEffect(() => {
    const ed = editorRef.current;
    if (!ed) return;
    const upd = () => syncSelBox();
    ed.addEventListener("scroll", upd, { passive: true });
    window.addEventListener("resize", upd);
    const ro = new ResizeObserver(upd);
    ro.observe(ed);
    return () => {
      ed.removeEventListener("scroll", upd);
      window.removeEventListener("resize", upd);
      ro.disconnect();
    };
  }, [syncSelBox]);

  /* ao trocar de nota, limpa a seleção */
  useEffect(() => {
    selImg.current = null;
    setSelBox(null);
  }, [activeId]);

  const onEditorContextMenu = useCallback(
    (e: React.MouseEvent<HTMLDivElement>) => {
      const target = e.target as HTMLElement;
      if (!(target instanceof HTMLImageElement) || !target.classList.contains("note-img")) return;
      openImgMenu(e, [
        {
          label: "tamanho original",
          icon: Maximize2,
          onClick: () => {
            target.style.width = `${target.naturalWidth}px`;
            target.style.height = "auto";
            sync();
          },
        },
        {
          label: "remover imagem",
          icon: Trash2,
          danger: true,
          onClick: () => {
            target.remove();
            sync();
          },
        },
      ]);
    },
    [openImgMenu, sync]
  );

  /* ---- notes CRUD ---- */
  const addNote = useCallback(() => {
    const n = newNote(`nota ${String(notesRef.current.length + 1).padStart(2, "0")}`);
    onChangeRef.current([...notesRef.current, n], n.id);
  }, []);

  const removeNote = useCallback((id: string) => {
    const arr = notesRef.current;
    if (arr.length <= 1) return;
    const note = arr.find((n) => n.id === id);
    if (note && note.content.replace(/<[^>]*>/g, "").trim().length > 12) {
      if (!window.confirm(`apagar a nota "${note.title}"?`)) return;
    }
    const idx = arr.findIndex((n) => n.id === id);
    const next = arr.filter((n) => n.id !== id);
    const nextActive =
      id === activeIdRef.current ? next[Math.max(0, idx - 1)].id : activeIdRef.current;
    onChangeRef.current(next, nextActive);
  }, []);

  const commitRename = useCallback(() => {
    const id = renamingId;
    setRenamingId(null);
    const v = renameVal.trim();
    if (!id || !v) return;
    onChangeRef.current(notesRef.current.map((n) => (n.id === id ? { ...n, title: v } : n)));
  }, [renamingId, renameVal]);

  const reorder = useCallback((from: number, to: number) => {
    const arr = [...notesRef.current];
    if (from === to || from < 0 || from >= arr.length) return;
    const [it] = arr.splice(from, 1);
    arr.splice(Math.min(to, arr.length), 0, it);
    onChangeRef.current(arr);
  }, []);

  const setSb = (v: boolean) => {
    setSbOpen(v);
    lsSet("ordo:ui:notes-sb", v ? "1" : "0");
  };
  const setTb = (v: boolean) => {
    setTbOpen(v);
    lsSet("ordo:ui:notes-tb", v ? "1" : "0");
  };

  const activeIdx = notes.findIndex((n) => n.id === activeId);
  const activeNote = notes[activeIdx];
  const isCanvas = activeNote?.mode === "canvas";

  const setMode = useCallback((mode: "doc" | "canvas") => {
    const id = activeIdRef.current;
    onChangeRef.current(
      notesRef.current.map((n) => (n.id === id ? { ...n, mode } : n))
    );
  }, []);

  const handleCanvas = useCallback(
    (canvas: CanvasItem[], view?: { x: number; y: number; z: number }) => {
      const id = activeIdRef.current;
      onChangeRef.current(
        notesRef.current.map((n) => (n.id === id ? { ...n, canvas, ...(view ? { view } : {}) } : n))
      );
    },
    []
  );

  return (
    <PanelChrome
      index="01"
      title="notas"
      icon={NotebookPen}
      className="col-span-6 row-span-1 lg:col-span-3"
      actions={
        <>
          <HeaderIconBtn title={sbOpen ? "recolher barra lateral" : "abrir barra lateral"} onClick={() => setSb(!sbOpen)}>
            {sbOpen ? <PanelLeftClose size={13} /> : <PanelLeftOpen size={13} />}
          </HeaderIconBtn>
          {!isCanvas && (
            <HeaderIconBtn title={tbOpen ? "recolher formatação" : "mostrar formatação"} onClick={() => setTb(!tbOpen)} accent={tbOpen}>
              <Type size={13} />
            </HeaderIconBtn>
          )}
          <HeaderIconBtn
            title={isCanvas ? "voltar para o documento" : "transformar em quadro (canvas)"}
            onClick={() => setMode(isCanvas ? "doc" : "canvas")}
            accent={isCanvas}
          >
            {isCanvas ? <FileText size={13} /> : <LayoutGrid size={13} />}
          </HeaderIconBtn>
        </>
      }
    >
      {/* sidebar */}
      <aside
        className={`shrink-0 overflow-hidden border-carbon-700/70 bg-carbon-850/50 transition-[width,border] duration-300 ease-out ${
          sbOpen ? "w-52 border-r" : "w-0 border-r-0"
        }`}
      >
        <div className="flex h-full w-52 flex-col">
          <div className="flex h-9 shrink-0 items-center gap-2 border-b border-carbon-700/60 px-3">
            <span className="font-mono text-[9.5px] uppercase tracking-[0.2em] text-carbon-400">
              notas · {notes.length}
            </span>
            <button
              onClick={addNote}
              title="nova nota"
              className="ml-auto flex h-5.5 w-5.5 items-center justify-center rounded-md border border-carbon-600 text-carbon-300 transition-all hover:border-acid-500/60 hover:text-acid-300 active:scale-90"
            >
              <Plus size={12} strokeWidth={2.4} />
            </button>
          </div>
          <div className="os-scroll min-h-0 flex-1 overflow-y-auto p-1.5" onDragOver={(e) => e.preventDefault()}>
            {notes.map((n, i) => (
              <div
                key={n.id}
                draggable={renamingId !== n.id}
                onDragStart={(e) => {
                  dragIdx.current = i;
                  e.dataTransfer.effectAllowed = "move";
                }}
                onDragOver={(e) => {
                  e.preventDefault();
                  e.dataTransfer.dropEffect = "move";
                  setOverIdx(i);
                }}
                onDragLeave={() => setOverIdx((v) => (v === i ? null : v))}
                onDrop={(e) => {
                  e.preventDefault();
                  if (dragIdx.current !== null) reorder(dragIdx.current, i);
                  dragIdx.current = null;
                  setOverIdx(null);
                }}
                onDragEnd={() => {
                  dragIdx.current = null;
                  setOverIdx(null);
                }}
                onClick={() => activeId !== n.id && onChange(notesRef.current, n.id)}
                className={`group relative mb-0.5 flex cursor-pointer items-center gap-1 rounded-lg border border-transparent px-1.5 py-[7px] transition-colors ${
                  n.id === activeId
                    ? "border-carbon-600 bg-carbon-750"
                    : "hover:bg-carbon-800/70"
                } ${overIdx === i ? "before:absolute before:-top-[2.5px] before:left-1 before:right-1 before:h-[2px] before:rounded before:bg-acid-400" : ""}`}
              >
                <span className={`absolute -ml-0.5 h-4 w-[2.5px] rounded-full bg-acid-400 transition-opacity ${n.id === activeId ? "opacity-100" : "opacity-0"}`} />
                <GripVertical
                  size={12}
                  className={`shrink-0 cursor-grab text-carbon-500 transition-opacity active:cursor-grabbing ${n.id === activeId ? "opacity-60" : "opacity-0 group-hover:opacity-60"}`}
                />
                {renamingId === n.id ? (
                  <input
                    autoFocus
                    value={renameVal}
                    onChange={(e) => setRenameVal(e.target.value)}
                    onBlur={commitRename}
                    onKeyDown={(e) => {
                      if (e.key === "Enter") commitRename();
                      if (e.key === "Escape") setRenamingId(null);
                    }}
                    onClick={(e) => e.stopPropagation()}
                    className="min-w-0 flex-1 rounded border border-acid-500/50 bg-carbon-900 px-1.5 py-0.5 text-[12px] text-white outline-none"
                  />
                ) : (
                  <span
                    className={`min-w-0 flex-1 truncate pl-0.5 text-[12.5px] ${n.id === activeId ? "font-medium text-white" : "text-carbon-300"}`}
                    onDoubleClick={(e) => {
                      e.stopPropagation();
                      setRenamingId(n.id);
                      setRenameVal(n.title);
                    }}
                  >
                    {n.title}
                  </span>
                )}
                {renamingId !== n.id && (
                  <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
                    <button
                      title="renomear"
                      aria-label="renomear"
                      onClick={(e) => {
                        e.stopPropagation();
                        setRenamingId(n.id);
                        setRenameVal(n.title);
                      }}
                      className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-400 transition-colors hover:bg-carbon-600 hover:text-white active:scale-90"
                    >
                      <Pencil size={12} />
                    </button>
                    {notes.length > 1 && (
                      <button
                        title="apagar"
                        aria-label="apagar"
                        onClick={(e) => {
                          e.stopPropagation();
                          removeNote(n.id);
                        }}
                        className="flex h-6.5 w-6.5 items-center justify-center rounded-md text-carbon-400 transition-colors hover:bg-ember-400/15 hover:text-ember-400 active:scale-90"
                      >
                        <Trash2 size={12} />
                      </button>
                    )}
                  </span>
                )}
              </div>
            ))}
          </div>
        </div>
      </aside>

      {/* editor column */}
      <div className="flex min-w-0 flex-1 flex-col">
        {isCanvas && (
          <CanvasBoard
            key={activeId}
            items={activeNote?.canvas ?? []}
            view={activeNote?.view}
            onChange={handleCanvas}
          />
        )}

        {/* toolbar */}
        <div className={`grid shrink-0 transition-all duration-300 ease-out ${isCanvas ? "hidden" : ""} ${tbOpen ? "grid-rows-[1fr] border-b border-carbon-700/70" : "grid-rows-[0fr]"}`}>
          <div className="min-h-0 overflow-hidden">
            <div className="flex flex-wrap items-center gap-x-0.5 gap-y-1 p-1.5">
              <TB label="desfazer" onClick={() => exec("undo")}><Undo2 size={13.5} /></TB>
              <TB label="refazer" onClick={() => exec("redo")}><Redo2 size={13.5} /></TB>
              <Divider />

              <select
                className={`${selCls} w-[104px]`}
                value={blockVal}
                title="estilo do parágrafo"
                onMouseDown={saveRange}
                onChange={(e) => exec("formatBlock", e.target.value)}
              >
                {BLOCKS.map((b) => (
                  <option key={b.value} value={b.value}>{b.label}</option>
                ))}
              </select>

              <select
                className={`${selCls} w-[112px]`}
                value={FONTS.find((f) => fontVal.replace(/"/g, "'").toLowerCase().includes(f.value.split(",")[0].replace(/'/g, "").toLowerCase()))?.value ?? ""}
                title="fonte"
                onMouseDown={saveRange}
                onChange={(e) => e.target.value && exec("fontName", e.target.value)}
              >
                <option value="" disabled>fonte</option>
                {FONTS.map((f) => (
                  <option key={f.label} value={f.value}>{f.label}</option>
                ))}
              </select>

              <Divider />

              <TB label="diminuir tamanho" onClick={() => applyFontSize(Math.max(6, sizeRef.current - 1))}>
                <span className="text-[13px] font-bold leading-none">−</span>
              </TB>
              <input
                type="number"
                min={6}
                max={400}
                value={sizeVal}
                title="tamanho da fonte (px)"
                onMouseDown={saveRange}
                onChange={(e) => {
                  const v = parseInt(e.target.value, 10);
                  setSizeVal(Number.isNaN(v) ? "" : v);
                }}
                onKeyDown={(e) => {
                  if (e.key === "Enter") {
                    e.preventDefault(); // sem isso o browser insere quebra de linha no editor
                    skipBlurApply.current = true;
                    if (typeof sizeVal === "number") applyFontSize(sizeVal);
                  }
                  if (e.key === "ArrowUp") {
                    e.preventDefault();
                    applyFontSize(Math.min(400, sizeRef.current + 1));
                  }
                  if (e.key === "ArrowDown") {
                    e.preventDefault();
                    applyFontSize(Math.max(6, sizeRef.current - 1));
                  }
                }}
                onBlur={() => {
                  if (skipBlurApply.current) {
                    skipBlurApply.current = false;
                    return;
                  }
                  if (typeof sizeVal === "number") applyFontSize(sizeVal);
                }}
                className="nospin h-7 w-12 shrink-0 rounded-md border border-transparent bg-transparent text-center text-[11.5px] font-medium text-carbon-100 outline-none transition-colors hover:border-carbon-600 hover:bg-carbon-700/60 focus:border-acid-500/50 focus:bg-carbon-800"
              />
              <TB label="aumentar tamanho" onClick={() => applyFontSize(Math.min(400, sizeRef.current + 1))}>
                <span className="text-[13px] font-bold leading-none">+</span>
              </TB>

              <Divider />

              <TB label="negrito" active={activeStates.bold} onClick={() => exec("bold")}><Bold size={13.5} /></TB>
              <TB label="itálico" active={activeStates.italic} onClick={() => exec("italic")}><Italic size={13.5} /></TB>
              <TB label="sublinhado" active={activeStates.underline} onClick={() => exec("underline")}><Underline size={13.5} /></TB>
              <TB label="tachado" active={activeStates.strikeThrough} onClick={() => exec("strikeThrough")}><Strikethrough size={13.5} /></TB>
              <TB label="subscrito" active={activeStates.subscript} onClick={() => exec("subscript")}><Subscript size={13.5} /></TB>
              <TB label="sobrescrito" active={activeStates.superscript} onClick={() => exec("superscript")}><Superscript size={13.5} /></TB>

              <Divider />

              <div title="cor do texto" className="relative flex h-7 w-7 shrink-0 flex-col items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white">
                <Baseline size={13.5} className="pointer-events-none" />
                <span className="pointer-events-none mt-[1px] h-[2.5px] w-4 rounded-full bg-acid-400" id="font-color-bar" />
                <input type="color" defaultValue="#e6e8eb" className="swatch absolute inset-0" onMouseDown={saveRange} onChange={(e) => exec("foreColor", e.target.value)} />
              </div>
              <div title="cor de destaque" className="relative flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-carbon-300 transition-colors hover:bg-carbon-700/60 hover:text-white">
                <Highlighter size={13.5} className="pointer-events-none" />
                <input type="color" defaultValue="#d4f74c" className="swatch absolute inset-0" onMouseDown={saveRange} onChange={(e) => applyHighlight(e.target.value)} />
              </div>

              <Divider />

              <TB label="inserir link" onClick={insertLink}><Link2 size={13.5} /></TB>
              <TB label="remover link" onClick={() => exec("unlink")}><Unlink size={13.5} /></TB>

              <Divider />

              <TB label="alinhar à esquerda" active={!!activeStates.justifyLeft} onClick={() => exec("justifyLeft")}><AlignLeft size={13.5} /></TB>
              <TB label="centralizar" active={activeStates.justifyCenter} onClick={() => exec("justifyCenter")}><AlignCenter size={13.5} /></TB>
              <TB label="alinhar à direita" active={activeStates.justifyRight} onClick={() => exec("justifyRight")}><AlignRight size={13.5} /></TB>
              <TB label="justificar" active={activeStates.justifyFull} onClick={() => exec("justifyFull")}><AlignJustify size={13.5} /></TB>

              <Divider />

              <TB label="lista com marcadores" active={activeStates.insertUnorderedList} onClick={() => exec("insertUnorderedList")}><List size={13.5} /></TB>
              <TB label="lista numerada" active={activeStates.insertOrderedList} onClick={() => exec("insertOrderedList")}><ListOrdered size={13.5} /></TB>
              <TB label="diminuir recuo" onClick={() => exec("outdent")}><IndentDecrease size={13.5} /></TB>
              <TB label="aumentar recuo" onClick={() => exec("indent")}><IndentIncrease size={13.5} /></TB>

              <Divider />

              <TB label="linha horizontal" onClick={() => exec("insertHorizontalRule")}><Minus size={13.5} /></TB>
              <TB label="limpar formatação" onClick={() => exec("removeFormat")}><RemoveFormatting size={13.5} /></TB>

              <Divider />

              <TB label="inserir imagem (ou cole com Ctrl+V)" onClick={() => imgInputRef.current?.click()}>
                <ImagePlus size={13.5} />
              </TB>
            </div>
          </div>
        </div>

        {/* editor */}
        <div className={`relative flex min-h-0 flex-1 overflow-hidden ${isCanvas ? "hidden" : ""}`}>
          <div
            ref={editorRef}
            className="ws-editor os-scroll min-h-0 flex-1 overflow-y-auto px-5 py-4"
            contentEditable
            suppressContentEditableWarning
            dir="ltr"
            spellCheck={false}
            data-ph="escreva aqui as anotações da sessão..."
            onInput={sync}
            onBlur={saveRange}
            onPaste={onEditorPaste}
            onDragOver={(e) => e.preventDefault()}
            onDrop={onEditorDrop}
            onPointerDown={onEditorPointerDown}
            onContextMenu={onEditorContextMenu}
          />

          {/* moldura + alça de redimensionar da imagem selecionada */}
          {selBox && (
            <div
              className="pointer-events-none absolute z-10 rounded-md border border-acid-400/80"
              style={{ left: selBox.l, top: selBox.t, width: selBox.w, height: selBox.h }}
            >
              <div
                onPointerDown={onHandlePointerDown}
                title="arraste para redimensionar"
                className="pointer-events-auto absolute -bottom-2 -right-2 h-4.5 w-4.5 cursor-nwse-resize touch-none rounded-[4px] border-2 border-carbon-900 bg-acid-400 shadow-[0_0_10px_rgba(212,247,76,0.6)] transition-transform hover:scale-125"
              />
            </div>
          )}
        </div>

        <input
          ref={imgInputRef}
          type="file"
          accept="image/*"
          className="hidden"
          onChange={(e) => {
            const f = e.target.files?.[0];
            if (f) void insertImageFile(f);
            e.target.value = "";
          }}
        />
        <ContextMenuView menu={imgMenu} onClose={closeImgMenu} />

        {/* status */}
        <footer className="flex h-6 shrink-0 items-center gap-3 border-t border-carbon-700/60 px-3">
          <span className="font-mono text-[9.5px] uppercase tracking-[0.18em] text-carbon-500">
            {activeIdx + 1}/{notes.length} · {notes[activeIdx]?.title ?? ""}
          </span>
          <span className="ml-auto font-mono text-[9.5px] uppercase tracking-[0.18em] text-carbon-500">
            {isCanvas
              ? `${activeNote?.canvas?.length ?? 0} ${(activeNote?.canvas?.length ?? 0) === 1 ? "item" : "itens"}`
              : `${words} ${words === 1 ? "palavra" : "palavras"}`}
          </span>
        </footer>
      </div>
    </PanelChrome>
  );
}

export const NotesPanel = memo(
  NotesPanelInner,
  (p, n) => p.notes === n.notes && p.activeId === n.activeId
);
