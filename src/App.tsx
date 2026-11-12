import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { open as openDialog, save as saveDialog } from "@tauri-apps/plugin-dialog";
import { readFile, writeFile } from "@tauri-apps/plugin-fs";
import type { OrdoDoc } from "./types";
import {
  emptyDoc,
  parseDoc,
  parseOrdoFile,
  prepareOrdoExport,
  requestPreparedDownload,
  savePreparedViaPicker,
  serializeDoc,
} from "./lib/ordo";
import type { ExportBundle } from "./lib/ordo";
import { Home } from "./components/Home";
import { TopBar } from "./components/TopBar";
import { NotesPanel } from "./components/NotesPanel";
import { OwlbearPanel } from "./components/OwlbearPanel";
import { AudioPanel } from "./components/AudioPanel";
import { PdfPanel } from "./components/PdfPanel";
import { VideoPanel } from "./components/VideoPanel";
import { SaveModal } from "./components/SaveModal";
import { NotebookPen, AppWindow, Music, FileText, Film, ChevronDown } from "lucide-react";
import { lsGet, lsSet } from "./lib/store";
import { isNativeApp } from "./lib/platform";

const AUTOSAVE_KEY = "ordo:autosave";

const MODULES = [
  { label: "notas", icon: NotebookPen },
  { label: "tabletop", icon: AppWindow },
  { label: "áudio", icon: Music },
  { label: "pdf", icon: FileText },
  { label: "vídeo", icon: Film },
] as const;

interface AutosaveMeta {
  name: string;
  savedAt: string;
}

interface ExportState {
  phase: "preparing" | "ready" | "error";
  progress: number;
  label: string;
  bundle: ExportBundle | null;
  error: string | null;
}

export default function App() {
  const nativeApp = isNativeApp();
  const [screen, setScreen] = useState<"home" | "work">("home");
  const [doc, setDoc] = useState<OrdoDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [exportState, setExportState] = useState<ExportState | null>(null);
  const [activeModule, setActiveModule] = useState(0);
  const [topBarOpen, setTopBarOpen] = useState(() => lsGet("ordo:ui:topbar") !== "0");
  const [homeError, setHomeError] = useState<string | null>(null);
  const [autosaveMeta, setAutosaveMeta] = useState<AutosaveMeta | null>(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return null;
      const j = JSON.parse(raw) as { savedAt?: string; name?: string };
      return typeof j.savedAt === "string" ? { name: j.name ?? "sessão", savedAt: j.savedAt } : null;
    } catch {
      return null;
    }
  });

  useEffect(() => {
    const mobileViewport = window.matchMedia("(max-width: 1023px)");
    const showAvailableMobileModule = () => {
      if (mobileViewport.matches) {
        setActiveModule((module) => (module === 1 ? 0 : module));
      }
    };

    showAvailableMobileModule();
    mobileViewport.addEventListener("change", showAvailableMobileModule);
    return () => mobileViewport.removeEventListener("change", showAvailableMobileModule);
  }, []);

  const docRef = useRef(doc);
  useEffect(() => { docRef.current = doc; });
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; });
  const exportRunRef = useRef(0);
  const savingRef = useRef(false);

  /* ---------------- doc updates ---------------- */
  const patch = useCallback((p: Partial<OrdoDoc>) => {
    setDoc((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
  }, []);

  const handleNotes = useCallback(
    (notes: OrdoDoc["notes"], activeId?: string) =>
      patch({ notes, ...(activeId ? { activeNoteId: activeId } : {}) }),
    [patch]
  );
  const handleAudios = useCallback((audios: OrdoDoc["audios"]) => patch({ audios }), [patch]);
  const handleVideos = useCallback((videos: OrdoDoc["videos"]) => patch({ videos }), [patch]);
  const handlePdfs = useCallback(
    (pdfs: OrdoDoc["pdfs"], activePdfId?: string) =>
      patch({ pdfs, ...(activePdfId !== undefined ? { activePdfId } : {}) }),
    [patch]
  );
  const handleOwlbear = useCallback((owlbearOpened: boolean) => patch({ owlbearOpened }), [patch]);
  const handleSfx = useCallback((sfx: OrdoDoc["sfx"]) => patch({ sfx }), [patch]);

  const setTopBar = useCallback((open: boolean) => {
    setTopBarOpen(open);
    lsSet("ordo:ui:topbar", open ? "1" : "0");
  }, []);

  /* ---------------- save / export ---------------- */
  const flashSaved = useCallback(() => {
    setDirty(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 2000);
  }, []);

  const prepareExport = useCallback(async (source: OrdoDoc) => {
    const run = ++exportRunRef.current;
    savingRef.current = true;
    setSaving(true);
    setExportState({
      phase: "preparing",
      progress: 0,
      label: "iniciando preparação",
      bundle: null,
      error: null,
    });
    try {
      const bundle = await prepareOrdoExport(source, (progress, label) => {
        if (exportRunRef.current !== run) return;
        setExportState((state) => state ? { ...state, progress, label } : state);
      });
      if (exportRunRef.current !== run) return;
      savingRef.current = false;
      setSaving(false);
      setExportState({
        phase: "ready",
        progress: 1,
        label: "arquivo pronto para baixar",
        bundle,
        error: null,
      });
      // Em ambientes que permitem downloads programáticos, já começa após gerar tudo.
      if (!nativeApp) requestPreparedDownload(bundle);
    } catch (error) {
      if (exportRunRef.current !== run) return;
      savingRef.current = false;
      setSaving(false);
      setExportState({
        phase: "error",
        progress: 0,
        label: "falha na preparação",
        bundle: null,
        error: error instanceof Error ? error.message : "não foi possível montar o arquivo .ordo.",
      });
    }
  }, [nativeApp]);

  const save = useCallback(() => {
    const source = docRef.current;
    if (!source || savingRef.current) return;
    void prepareExport(source);
  }, [prepareExport]);

  const openFile = useCallback(async (file: File) => {
    setHomeError(null);
    const parsed = await parseOrdoFile(file);
    if (!parsed) {
      setHomeError("este arquivo não é um .ordo válido.");
      return;
    }
    if (!parsed.name || parsed.name === "sessão importada") {
      parsed.name = file.name.replace(/\.ordo$/i, "") || parsed.name;
    }
    setDoc(parsed);
    setDirty(false);
    setScreen("work");
  }, []);

  const chooseNativeFile = useCallback(async () => {
    setHomeError(null);
    try {
      const selectedPath = await openDialog({
        multiple: false,
        directory: false,
        filters: [{ name: "Arquivo ORDO", extensions: ["ordo"] }],
      });
      if (typeof selectedPath !== "string") return;

      const bytes = await readFile(selectedPath);
      const contents = new Uint8Array(bytes);
      let fileName = selectedPath.split(/[\\/]/).pop() || "sessao.ordo";
      try {
        fileName = decodeURIComponent(fileName);
      } catch {
        // Keep literal percent characters in local filenames.
      }
      await openFile(new File([contents.buffer as ArrayBuffer], fileName));
    } catch (error) {
      setHomeError(
        error instanceof Error ? error.message : "não foi possível abrir o arquivo .ordo."
      );
    }
  }, [openFile]);

  const createNew = useCallback(() => {
    setDoc(emptyDoc());
    setDirty(false);
    setScreen("work");
  }, []);

  const restoreAutosave = useCallback(() => {
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (!raw) return;
      const parsed = parseDoc(raw);
      if (parsed) {
        setDoc(parsed);
        setDirty(false);
        setScreen("work");
      }
    } catch { /* ignore */ }
  }, []);

  const discardAutosave = useCallback(() => {
    try {
      localStorage.removeItem(AUTOSAVE_KEY);
    } catch { /* ignore */ }
    setAutosaveMeta(null);
  }, []);

  const close = useCallback(() => {
    const d = docRef.current;
    if (d) {
      const hasAnything =
        d.audios.length + d.pdfs.length + d.videos.length > 0 ||
        d.notes.some((n) => n.content.replace(/<[^>]*>/g, "").trim().length > 0);
      if (hasAnything && !window.confirm("fechar o arquivo? guarde o .ordo antes se quiser manter tudo.")) {
        return;
      }
    }
    setDoc(null);
    setDirty(false);
    setScreen("home");
    try {
      const raw = localStorage.getItem(AUTOSAVE_KEY);
      if (raw) {
        const j = JSON.parse(raw) as { savedAt?: string; name?: string };
        if (typeof j.savedAt === "string") setAutosaveMeta({ name: j.name ?? "sessão", savedAt: j.savedAt });
      }
    } catch { /* ignore */ }
  }, []);

  /* autosave local */
  useEffect(() => {
    if (!doc || screen !== "work") return;
    const t = setTimeout(() => {
      try {
        localStorage.setItem(AUTOSAVE_KEY, serializeDoc(doc));
        setAutosaveMeta({ name: doc.name, savedAt: new Date().toISOString() });
      } catch { /* cota excedida — ignora */ }
    }, 1200);
    return () => clearTimeout(t);
  }, [doc, screen]);

  /* ctrl+s + beforeunload */
  useEffect(() => {
    if (screen !== "work") return;
    const onKey = (e: KeyboardEvent) => {
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === "s") {
        e.preventDefault();
        save();
      }
    };
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (docRef.current && dirtyRef.current) {
        e.preventDefault();
      }
    };
    window.addEventListener("keydown", onKey);
    window.addEventListener("beforeunload", onBeforeUnload);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("beforeunload", onBeforeUnload);
    };
  }, [screen, save]);

  const status = useMemo(() => {
    if (!doc) return "";
    const parts = [
      `${doc.notes.length} ${doc.notes.length === 1 ? "nota" : "notas"}`,
      `${doc.audios.length} ${doc.audios.length === 1 ? "áudio" : "áudios"}`,
      `${doc.pdfs.length} ${doc.pdfs.length === 1 ? "pdf" : "pdfs"}`,
      `${doc.videos.length} ${doc.videos.length === 1 ? "vídeo" : "vídeos"}`,
    ];
    return parts.join(" · ");
  }, [doc]);

  if (screen === "home" || !doc) {
    return (
      <Home
        onOpenFile={openFile}
        onChooseFile={nativeApp ? chooseNativeFile : undefined}
        onCreate={createNew}
        onRestore={restoreAutosave}
        onDiscardAutosave={discardAutosave}
        autosaveInfo={autosaveMeta}
        error={homeError}
      />
    );
  }

  return (
    <div className="ws-backdrop relative flex h-full flex-col">
      {topBarOpen ? (
        <TopBar
          name={doc.name}
          dirty={dirty}
          saving={saving}
          savedFlash={savedFlash}
          status={status}
          onRename={(name) => patch({ name })}
          onSave={save}
          onHide={() => setTopBar(false)}
          onClose={close}
        />
      ) : (
        <button
          onClick={() => setTopBar(true)}
          title="mostrar menu superior"
          className="anim-pop-in absolute right-3 top-2 z-40 flex h-8 items-center gap-1.5 rounded-lg border border-carbon-600 bg-carbon-900/95 px-2.5 font-mono text-[9.5px] font-semibold uppercase tracking-wider text-carbon-300 shadow-[0_8px_24px_rgba(0,0,0,0.5)] backdrop-blur transition-colors hover:border-acid-500/50 hover:text-acid-300"
        >
          <ChevronDown size={13} />
          <span className="hidden sm:inline">mostrar menu</span>
        </button>
      )}
      <main
        data-active={activeModule}
        className="ws-main grid min-h-0 flex-1 grid-cols-6 grid-rows-2 gap-2 overflow-hidden p-2"
      >
        <NotesPanel notes={doc.notes} activeId={doc.activeNoteId} onChange={handleNotes} />
        <OwlbearPanel opened={doc.owlbearOpened} onChange={handleOwlbear} />
        <AudioPanel audios={doc.audios} onChange={handleAudios} />
        <PdfPanel pdfs={doc.pdfs} activePdfId={doc.activePdfId} onChange={handlePdfs} />
        <VideoPanel
          videos={doc.videos}
          onChange={handleVideos}
          sfx={doc.sfx ?? []}
          onSfxChange={handleSfx}
        />
      </main>

      {/* seletor de módulos — apenas no celular/tablet */}
      <nav className="flex shrink-0 items-stretch gap-1 border-t border-carbon-700/80 bg-carbon-900/95 px-1.5 py-1.5 backdrop-blur lg:hidden">
        {MODULES.map((m, i) => {
          if (i === 1) return null;
          const active = activeModule === i;
          return (
            <button
              key={m.label}
              onClick={() => setActiveModule(i)}
              className={`flex flex-1 flex-col items-center gap-1 rounded-lg py-1.5 transition-colors ${
                active ? "bg-acid-400/[0.12] text-acid-300" : "text-carbon-400 active:bg-carbon-800"
              }`}
            >
              <m.icon size={17} strokeWidth={active ? 2.2 : 1.8} />
              <span className="font-mono text-[8.5px] uppercase tracking-[0.1em]">{m.label}</span>
            </button>
          );
        })}
      </nav>

      {exportState && (
        <SaveModal
          phase={exportState.phase}
          progress={exportState.progress}
          label={exportState.label}
          bundle={exportState.bundle}
          error={exportState.error}
          nativeApp={nativeApp}
          onRetry={() => {
            const source = docRef.current;
            if (source) void prepareExport(source);
          }}
          onNativeSave={async () => {
            if (!exportState.bundle) return false;
            if (nativeApp) {
              const filePath = await saveDialog({
                defaultPath: exportState.bundle.fileName,
                filters: [{ name: "Arquivo ORDO", extensions: ["ordo"] }],
              });
              if (!filePath) return false;
              const bytes = new Uint8Array(await exportState.bundle.blob.arrayBuffer());
              await writeFile(filePath, bytes);
            } else {
              const ok = await savePreparedViaPicker(exportState.bundle);
              if (!ok) return false;
            }
            flashSaved();
            setExportState(null);
            return true;
          }}
          onDownload={flashSaved}
          onClose={() => setExportState(null)}
        />
      )}
    </div>
  );
}
