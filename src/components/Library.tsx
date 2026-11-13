import { useRef, useState } from "react";
import {
  ArrowLeft,
  FileText,
  FolderOpen,
  MoreHorizontal,
  Pencil,
  Share2,
  Trash2,
} from "lucide-react";
import type { LibraryFile } from "../lib/fileLibrary";
import { formatBytes } from "../lib/ordo";

interface Props {
  files: LibraryFile[];
  error: string | null;
  onBack: () => void;
  onOpen: (id: string) => void;
  onImport: (file: File) => void;
  onImportFromDevice: () => void;
  onOpenLocation: () => void;
  showOpenLocation: boolean;
  useNativeImporter: boolean;
  showShare: boolean;
  onRename: (id: string, name: string) => Promise<void>;
  onDelete: (id: string) => Promise<void>;
  onShare: (id: string) => Promise<void>;
}

export function Library({
  files,
  error,
  onBack,
  onOpen,
  onImport,
  onImportFromDevice,
  onOpenLocation,
  showOpenLocation,
  useNativeImporter,
  showShare,
  onRename,
  onDelete,
  onShare,
}: Props) {
  const inputRef = useRef<HTMLInputElement>(null);
  const longPressTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const longPressTriggered = useRef(false);
  const [menuFileId, setMenuFileId] = useState<string | null>(null);
  const [renamingFile, setRenamingFile] = useState<LibraryFile | null>(null);
  const [renameValue, setRenameValue] = useState("");
  const [actionError, setActionError] = useState<string | null>(null);

  const stopLongPress = () => {
    if (longPressTimer.current) clearTimeout(longPressTimer.current);
    longPressTimer.current = null;
  };

  const showMenu = (id: string) => {
    longPressTriggered.current = true;
    setMenuFileId(id);
  };

  const handleRename = async () => {
    if (!renamingFile) return;
    try {
      await onRename(renamingFile.id, renameValue);
      setRenamingFile(null);
    } catch (renameError) {
      setActionError(renameError instanceof Error ? renameError.message : "não foi possível renomear o arquivo.");
    }
  };

  const handleDelete = async (file: LibraryFile) => {
    if (!window.confirm(`excluir ${file.name}.ordo?`)) return;
    try {
      await onDelete(file.id);
      setMenuFileId(null);
    } catch (deleteError) {
      setActionError(deleteError instanceof Error ? deleteError.message : "não foi possível excluir o arquivo.");
    }
  };

  const importFile = () => {
    if (useNativeImporter) {
      onImportFromDevice();
      return;
    }
    inputRef.current?.click();
  };

  return (
    <div className="ws-backdrop relative flex h-full flex-col overflow-y-auto">
      <div className="ws-grid pointer-events-none fixed inset-0" />
      <header className="relative z-10 flex items-center gap-3 border-b border-carbon-700/80 bg-carbon-900/80 px-5 py-4">
        <button
          onClick={onBack}
          aria-label="voltar"
          className="flex h-9 w-9 items-center justify-center rounded-lg border border-carbon-600 text-carbon-300 transition-colors hover:border-acid-500/50 hover:text-acid-300"
        >
          <ArrowLeft size={17} />
        </button>
        <div>
          <h1 className="font-display text-lg font-bold text-white">meus arquivos</h1>
          <p className="font-mono text-[10px] uppercase tracking-[0.16em] text-carbon-400">
            {files.length} {files.length === 1 ? "arquivo salvo" : "arquivos salvos"}
          </p>
        </div>
        <div className="ml-auto flex gap-2">
          {showOpenLocation && (
            <button
              onClick={onOpenLocation}
              aria-label="abrir local dos arquivos"
              title="abrir local dos arquivos"
              className="flex items-center gap-2 rounded-lg border border-carbon-600 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-carbon-300 transition-colors hover:border-acid-500/50 hover:text-acid-300"
            >
              <FolderOpen size={14} />
              <span className="hidden sm:inline">abrir local</span>
            </button>
          )}
          <button
            onClick={importFile}
            aria-label="importar arquivo ORDO"
            className="flex items-center gap-2 rounded-lg border border-carbon-600 px-3 py-2 font-mono text-[10px] font-semibold uppercase tracking-wider text-carbon-300 transition-colors hover:border-acid-500/50 hover:text-acid-300"
          >
            <FileText size={14} />
            <span className="hidden sm:inline">importar .ordo</span>
          </button>
        </div>
      </header>

      <main className="relative z-10 mx-auto w-full max-w-5xl flex-1 p-5 sm:p-8">
        {error && (
          <p className="mb-4 rounded-lg border border-ember-400/40 bg-ember-400/10 px-4 py-2 text-sm text-ember-400">
            {error}
          </p>
        )}
        {actionError && (
          <p className="mb-4 rounded-lg border border-ember-400/40 bg-ember-400/10 px-4 py-2 text-sm text-ember-400">
            {actionError}
          </p>
        )}

        {files.length === 0 ? (
          <div className="flex min-h-64 flex-col items-center justify-center rounded-2xl border border-dashed border-carbon-600 bg-carbon-900/50 px-6 text-center">
            <FileText size={28} className="mb-3 text-carbon-500" />
            <h2 className="font-display text-base font-semibold text-carbon-200">nenhum arquivo salvo</h2>
            <p className="mt-1 max-w-sm text-sm text-carbon-400">
              Salve uma sessão no aplicativo para encontrá-la aqui.
            </p>
          </div>
        ) : (
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            {files.map((file) => (
              <article
                key={file.id}
                className="relative"
                onContextMenu={(event) => {
                  event.preventDefault();
                  setMenuFileId(file.id);
                }}
                onTouchStart={() => {
                  longPressTriggered.current = false;
                  stopLongPress();
                  longPressTimer.current = setTimeout(() => showMenu(file.id), 550);
                }}
                onTouchEnd={stopLongPress}
                onTouchMove={stopLongPress}
              >
                <button
                  onClick={() => {
                    if (longPressTriggered.current) {
                      longPressTriggered.current = false;
                      return;
                    }
                    onOpen(file.id);
                  }}
                  className="group flex min-h-28 w-full items-start gap-3 rounded-xl border border-carbon-700 bg-carbon-900/70 p-4 text-left transition-colors hover:border-acid-500/50 hover:bg-carbon-850 active:scale-[0.99]"
                >
                  <span className="flex h-10 w-10 shrink-0 items-center justify-center rounded-lg border border-carbon-600 bg-carbon-800 text-acid-300">
                    <FileText size={18} />
                  </span>
                  <span className="min-w-0 flex-1">
                    <span className="block truncate font-display text-sm font-semibold text-white">
                      {file.name}.ordo
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-carbon-400">
                      {new Date(file.savedAt).toLocaleString("pt-BR")}
                    </span>
                    <span className="mt-1 block font-mono text-[10px] text-carbon-500">
                      {formatBytes(file.size)}
                    </span>
                  </span>
                </button>
                <button
                  onClick={() => setMenuFileId(menuFileId === file.id ? null : file.id)}
                  aria-label={`opções de ${file.name}`}
                  className="absolute right-2 top-2 flex h-8 w-8 items-center justify-center rounded-lg text-carbon-400 transition-colors hover:bg-carbon-700 hover:text-white"
                >
                  <MoreHorizontal size={17} />
                </button>
                {menuFileId === file.id && (
                  <div
                    role="menu"
                    className="absolute right-2 top-11 z-20 min-w-40 overflow-hidden rounded-xl border border-carbon-600 bg-carbon-800 p-1 shadow-xl"
                  >
                    <button
                      role="menuitem"
                      onClick={() => {
                        setRenameValue(file.name);
                        setRenamingFile(file);
                        setMenuFileId(null);
                      }}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-carbon-200 hover:bg-carbon-700"
                    >
                      <Pencil size={13} /> renomear
                    </button>
                    {showShare && (
                      <button
                        role="menuitem"
                        onClick={() => {
                          setMenuFileId(null);
                          void onShare(file.id).catch((shareError: unknown) =>
                            setActionError(shareError instanceof Error ? shareError.message : "não foi possível compartilhar o arquivo.")
                          );
                        }}
                        className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-carbon-200 hover:bg-carbon-700"
                      >
                        <Share2 size={13} /> compartilhar
                      </button>
                    )}
                    <button
                      role="menuitem"
                      onClick={() => void handleDelete(file)}
                      className="flex w-full items-center gap-2 rounded-lg px-3 py-2 text-left text-xs text-ember-300 hover:bg-ember-400/10"
                    >
                      <Trash2 size={13} /> excluir
                    </button>
                  </div>
                )}
              </article>
            ))}
          </div>
        )}
      </main>

      {renamingFile && (
        <div className="fixed inset-0 z-30 flex items-center justify-center bg-carbon-950/80 p-4 backdrop-blur-sm">
          <form
            onSubmit={(event) => {
              event.preventDefault();
              void handleRename();
            }}
            className="w-full max-w-sm rounded-2xl border border-carbon-600 bg-carbon-850 p-5 shadow-2xl"
          >
            <h2 className="font-display text-base font-bold text-white">renomear arquivo</h2>
            <label className="mt-4 block font-mono text-[10px] uppercase tracking-wider text-carbon-400">
              nome
              <input
                autoFocus
                value={renameValue}
                onChange={(event) => setRenameValue(event.target.value)}
                className="mt-2 w-full rounded-lg border border-carbon-600 bg-carbon-900 px-3 py-2 font-sans text-sm text-white outline-none focus:border-acid-500"
              />
            </label>
            <div className="mt-5 flex justify-end gap-2">
              <button
                type="button"
                onClick={() => setRenamingFile(null)}
                className="rounded-lg px-3 py-2 text-xs text-carbon-300 hover:bg-carbon-700"
              >
                cancelar
              </button>
              <button
                type="submit"
                className="rounded-lg bg-acid-400 px-3 py-2 text-xs font-bold text-carbon-950 hover:bg-acid-300"
              >
                salvar nome
              </button>
            </div>
          </form>
        </div>
      )}

      <input
        ref={inputRef}
        type="file"
        accept="*/*,.ordo"
        className="hidden"
        onChange={(event) => {
          const file = event.target.files?.[0];
          if (file) onImport(file);
          event.target.value = "";
        }}
      />
    </div>
  );
}
