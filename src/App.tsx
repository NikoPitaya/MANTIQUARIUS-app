import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type { OrdoDoc } from "./types";
import {
  emptyDoc,
  parseDoc,
  parseOrdoFile,
  prepareOrdoExport,
  serializeDoc,
} from "./lib/ordo";
import { Home } from "./components/Home";
import { Library } from "./components/Library";
import { TopBar } from "./components/TopBar";
import { NotesPanel } from "./components/NotesPanel";
import { OwlbearPanel } from "./components/OwlbearPanel";
import { AudioPanel } from "./components/AudioPanel";
import { PdfPanel } from "./components/PdfPanel";
import { VideoPanel } from "./components/VideoPanel";
import { NotebookPen, AppWindow, Music, FileText, Film, ChevronDown } from "lucide-react";
import { lsGet, lsSet } from "./lib/store";
import { isAndroidRuntime, isNativeApp } from "./lib/platform";
import { getCurrentWindow } from "@tauri-apps/api/window";
import {
  deleteLibraryFile,
  getLibraryFile,
  listLibraryFiles,
  openLibraryLocation,
  pickOrdoFile,
  renameLibraryFile,
  saveLibraryFile,
  shareLibraryFileOnAndroid,
} from "./lib/fileLibrary";
import type { LibraryFile } from "./lib/fileLibrary";

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

export default function App() {
  const nativeApp = isNativeApp();
  const fullscreenTogglePending = useRef(false);
  const [screen, setScreen] = useState<"home" | "library" | "work">("home");
  const [doc, setDoc] = useState<OrdoDoc | null>(null);
  const [dirty, setDirty] = useState(false);
  const [saving, setSaving] = useState(false);
  const [savedFlash, setSavedFlash] = useState(false);
  const [saveError, setSaveError] = useState<string | null>(null);
  const [activeModule, setActiveModule] = useState(0);
  const [topBarOpen, setTopBarOpen] = useState(() => lsGet("ordo:ui:topbar") !== "0");
  const [homeError, setHomeError] = useState<string | null>(null);
  const [libraryFiles, setLibraryFiles] = useState<LibraryFile[]>([]);
  const [libraryError, setLibraryError] = useState<string | null>(null);
  const [currentFileId, setCurrentFileId] = useState<string | null>(null);
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
    if (!nativeApp) return;
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "F11" && event.code !== "F11") return;
      event.preventDefault();
      event.stopPropagation();
      if (event.repeat || fullscreenTogglePending.current) return;
      fullscreenTogglePending.current = true;
      void (async () => {
        try {
          const appWindow = getCurrentWindow();
          await appWindow.setFullscreen(!(await appWindow.isFullscreen()));
        } catch (error) {
          console.error("Não foi possível alternar a tela cheia.", error);
        } finally {
          fullscreenTogglePending.current = false;
        }
      })().catch((error: unknown) => {
        console.error("Não foi possível processar o atalho de tela cheia.", error);
      });
    };

    window.addEventListener("keydown", onKey, true);
    return () => window.removeEventListener("keydown", onKey, true);
  }, [nativeApp]);

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
  const currentFileIdRef = useRef(currentFileId);
  useEffect(() => { currentFileIdRef.current = currentFileId; });
  const dirtyRef = useRef(dirty);
  useEffect(() => { dirtyRef.current = dirty; });
  const savingRef = useRef(false);

  const refreshLibrary = useCallback(async () => {
    try {
      setLibraryFiles(await listLibraryFiles());
      setLibraryError(null);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "não foi possível carregar seus arquivos.");
    }
  }, []);

  useEffect(() => {
    if (screen === "library") void refreshLibrary();
  }, [screen, refreshLibrary]);

  /* ---------------- doc updates ---------------- */
  const patch = useCallback((p: Partial<OrdoDoc>) => {
    setDoc((d) => (d ? { ...d, ...p } : d));
    setDirty(true);
    setSaveError(null);
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

  const save = useCallback(async () => {
    const source = docRef.current;
    if (!source || savingRef.current) return;
    savingRef.current = true;
    setSaving(true);
    setSaveError(null);
    try {
      const bundle = await prepareOrdoExport(source);
      const saved = await saveLibraryFile(currentFileIdRef.current, source.name, bundle.blob);
      setCurrentFileId(saved.id);
      currentFileIdRef.current = saved.id;
      flashSaved();
    } catch (error) {
      setSaveError(error instanceof Error ? error.message : "não foi possível salvar o arquivo .ordo.");
    } finally {
      savingRef.current = false;
      setSaving(false);
    }
  }, [flashSaved]);

  const openFile = useCallback(async (
    file: File,
    fileId: string | null = null,
    savedName?: string
  ) => {
    setHomeError(null);
    const parsed = await parseOrdoFile(file);
    if (!parsed) {
      const message = "este arquivo não é um .ordo válido.";
      if (screen === "library") setLibraryError(message);
      else setHomeError(message);
      return;
    }
    if (savedName) {
      parsed.name = savedName;
    } else if (!parsed.name || parsed.name === "sessão importada") {
      parsed.name = file.name.replace(/\.ordo$/i, "") || parsed.name;
    }
    setDoc(parsed);
    setCurrentFileId(fileId);
    currentFileIdRef.current = fileId;
    setDirty(false);
    setScreen("work");
  }, [screen]);

  const importOrdoFromDevice = useCallback(async () => {
    try {
      const file = await pickOrdoFile();
      if (file) await openFile(file);
    } catch (error) {
      const message = error instanceof Error ? error.message : "não foi possível importar o arquivo .ordo.";
      if (screen === "library") setLibraryError(message);
      else setHomeError(message);
    }
  }, [openFile, screen]);

  const openLibraryFile = useCallback(async (id: string) => {
    try {
      const savedFile = await getLibraryFile(id);
      if (!savedFile) throw new Error("o arquivo não foi encontrado na biblioteca.");
      await openFile(new File([savedFile.blob], `${savedFile.name}.ordo`), id, savedFile.name);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "não foi possível abrir o arquivo .ordo.");
    }
  }, [openFile]);

  const shareLibraryFile = useCallback(async (id: string) => {
    if (nativeApp && isAndroidRuntime()) {
      await shareLibraryFileOnAndroid(id);
      return;
    }
    const savedFile = await getLibraryFile(id);
    if (!savedFile) throw new Error("o arquivo não foi encontrado na biblioteca.");
    const file = new File([savedFile.blob], `${savedFile.name}.ordo`, {
      type: "application/octet-stream",
    });
    if (navigator.share && (!navigator.canShare || navigator.canShare({ files: [file] }))) {
      await navigator.share({ files: [file], title: file.name });
      return;
    }
    const url = URL.createObjectURL(savedFile.blob);
    const anchor = document.createElement("a");
    anchor.href = url;
    anchor.download = file.name;
    anchor.click();
    window.setTimeout(() => URL.revokeObjectURL(url), 1000);
  }, [nativeApp]);

  const handleOpenLibraryLocation = useCallback(async () => {
    try {
      await openLibraryLocation();
      setLibraryError(null);
    } catch (error) {
      setLibraryError(error instanceof Error ? error.message : "não foi possível abrir o local dos arquivos.");
    }
  }, []);

  const createNew = useCallback(() => {
    setDoc(emptyDoc());
    setCurrentFileId(null);
    currentFileIdRef.current = null;
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
        setCurrentFileId(null);
        currentFileIdRef.current = null;
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
    if (d && dirtyRef.current && !window.confirm("há alterações não salvas. fechar sem salvar?")) {
      return;
    }
    setDoc(null);
    setCurrentFileId(null);
    currentFileIdRef.current = null;
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

  if (screen === "home") {
    return (
      <Home
        onOpenFile={openFile}
        onImportFromDevice={importOrdoFromDevice}
        useNativeImporter={nativeApp && isAndroidRuntime()}
        onChooseFile={() => setScreen("library")}
        onCreate={createNew}
        onRestore={restoreAutosave}
        onDiscardAutosave={discardAutosave}
        autosaveInfo={autosaveMeta}
        error={homeError}
      />
    );
  }

  if (screen === "library") {
    return (
      <Library
        files={libraryFiles}
        error={libraryError}
        onBack={() => setScreen("home")}
        onOpen={(id) => void openLibraryFile(id)}
        onImport={(file) => void openFile(file)}
        onImportFromDevice={() => void importOrdoFromDevice()}
        onOpenLocation={() => void handleOpenLibraryLocation()}
        showOpenLocation={nativeApp}
        useNativeImporter={nativeApp && isAndroidRuntime()}
        showShare={isAndroidRuntime()}
        onRename={async (id, name) => {
          await renameLibraryFile(id, name);
          await refreshLibrary();
        }}
        onDelete={async (id) => {
          await deleteLibraryFile(id);
          await refreshLibrary();
        }}
        onShare={shareLibraryFile}
      />
    );
  }

  if (!doc) return null;

  return (
    <div className="ws-backdrop relative flex h-full flex-col">
      {topBarOpen ? (
        <TopBar
          name={doc.name}
          dirty={dirty}
          saving={saving}
          savedFlash={savedFlash}
          saveError={saveError}
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

    </div>
  );
}
