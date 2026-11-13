import { BaseDirectory, documentDir, join } from "@tauri-apps/api/path";
import {
  exists as desktopFileExists,
  mkdir,
  remove as removeDesktopFile,
  writeFile as writeDesktopFile,
} from "@tauri-apps/plugin-fs";
import { revealItemInDir } from "@tauri-apps/plugin-opener";
import { exists as androidFileExists } from "@vnidrop/tauri-plugin-fs";
import {
  AndroidPickerInitialLocation,
  AndroidPublicGeneralPurposeDir,
  AndroidUriPermissionState,
  checkPersistedPickerUriPermission,
  createNewPublicFile,
  getMetadata,
  persistPickerUriPermission,
  readFile,
  removeFile,
  scanPublicFile,
  showOpenDirPicker,
  showOpenFilePicker,
  showShareFileDialog,
  showViewDirDialog,
  writeFile,
} from "@vnidrop/tauri-plugin-fs/android";
import { isAndroidRuntime, isNativeApp } from "./platform";

export interface LibraryFile {
  id: string;
  name: string;
  savedAt: string;
  size: number;
}

interface LibraryFileRecord extends LibraryFile {
  blob: Blob;
  externalName?: string;
  desktopPath?: string;
  androidUri?: { uri: string; documentTopTreeUri: string | null };
}

const DATABASE_NAME = "mantiquarius";
const STORE_NAME = "ordo-files";
const DATABASE_VERSION = 1;
const ANDROID_FOLDER_KEY = "ordo:library:android-folder";
const ANDROID_LIBRARY_FOLDER = "MANTIQUARIUS";
const LIBRARY_FOLDER = "MANTIQUARIUS";

let databasePromise: Promise<IDBDatabase> | null = null;

const isAndroidNative = (): boolean => isNativeApp() && isAndroidRuntime();
const isDesktopNative = (): boolean => isNativeApp() && !isAndroidRuntime();

const getDatabase = (): Promise<IDBDatabase> => {
  if (databasePromise) return databasePromise;
  databasePromise = new Promise((resolve, reject) => {
    const request = indexedDB.open(DATABASE_NAME, DATABASE_VERSION);
    request.onupgradeneeded = () => {
      const database = request.result;
      if (!database.objectStoreNames.contains(STORE_NAME)) {
        database.createObjectStore(STORE_NAME, { keyPath: "id" });
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      databasePromise = null;
      reject(request.error ?? new Error("não foi possível abrir a biblioteca de arquivos."));
    };
  });
  return databasePromise;
};

const runTransaction = async <T>(
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>
): Promise<T> => {
  const database = await getDatabase();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(STORE_NAME, mode);
    const request = operation(transaction.objectStore(STORE_NAME));
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error ?? new Error("não foi possível acessar a biblioteca."));
    transaction.onabort = () => reject(transaction.error ?? new Error("a operação na biblioteca foi cancelada."));
  });
};

const getAllRecords = (): Promise<LibraryFileRecord[]> =>
  runTransaction<LibraryFileRecord[]>("readonly", (store) => store.getAll());

const toMetadata = ({
  blob: _blob,
  externalName: _externalName,
  desktopPath: _desktopPath,
  androidUri: _androidUri,
  ...file
}: LibraryFileRecord): LibraryFile => file;

const safeFileName = (name: string): string => {
  const safeName = name
    .trim()
    .replace(/\.ordo$/i, "")
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, "-")
    .replace(/[. ]+$/g, "");
  return `${safeName || "sessão"}.ordo`;
};

const uniqueName = async (
  file: LibraryFileRecord,
  records: LibraryFileRecord[],
  existsOnDisk: (name: string) => Promise<boolean>
): Promise<string> => {
  const baseName = safeFileName(file.name);
  const otherNames = new Set(
    records
      .filter((record) => record.id !== file.id)
      .map((record) => record.externalName)
      .filter((name): name is string => !!name)
  );
  let candidate = baseName;
  let suffix = 2;
  while (
    (candidate !== file.externalName && otherNames.has(candidate)) ||
    (candidate !== file.externalName && await existsOnDisk(candidate))
  ) {
    candidate = `${baseName.slice(0, -5)} (${suffix++}).ordo`;
  }
  return candidate;
};

const syncDesktopCopy = async (file: LibraryFileRecord): Promise<LibraryFileRecord> => {
  await mkdir(LIBRARY_FOLDER, { baseDir: BaseDirectory.Document, recursive: true });
  const records = await getAllRecords();
  const name = await uniqueName(file, records, (candidate) =>
    desktopFileExists(`${LIBRARY_FOLDER}/${candidate}`, { baseDir: BaseDirectory.Document })
  );
  const relativePath = `${LIBRARY_FOLDER}/${name}`;
  const bytes = new Uint8Array(await file.blob.arrayBuffer());
  await writeDesktopFile(relativePath, bytes, { baseDir: BaseDirectory.Document });

  if (file.desktopPath && file.desktopPath !== relativePath) {
    if (await desktopFileExists(file.desktopPath, { baseDir: BaseDirectory.Document })) {
      await removeDesktopFile(file.desktopPath, { baseDir: BaseDirectory.Document });
    }
  }
  file.desktopPath = relativePath;
  file.externalName = name;
  return file;
};

const syncAndroidCopy = async (file: LibraryFileRecord): Promise<LibraryFileRecord> => {
  const records = await getAllRecords();
  const name = await uniqueName(file, records, async () => false);
  const bytes = new Uint8Array(await file.blob.arrayBuffer());

  if (file.androidUri && file.externalName === name) {
    if (await androidFileExists(file.androidUri)) {
      await writeFile(file.androidUri, bytes);
      await scanPublicFile(file.androidUri);
      return file;
    }
  }

  const newUri = await createNewPublicFile(
    AndroidPublicGeneralPurposeDir.Documents,
    `${ANDROID_LIBRARY_FOLDER}/${name}`,
    "application/octet-stream"
  );
  await writeFile(newUri, bytes);
  await scanPublicFile(newUri);

  if (file.androidUri && await androidFileExists(file.androidUri)) {
    await removeFile(file.androidUri);
  }
  file.androidUri = newUri;
  file.externalName = await getMetadata(newUri).then((metadata) => metadata.name);
  return file;
};

const syncNativeCopy = async (file: LibraryFileRecord): Promise<LibraryFileRecord> => {
  if (isAndroidNative()) return syncAndroidCopy(file);
  if (isDesktopNative()) return syncDesktopCopy(file);
  return file;
};

export const listLibraryFiles = async (): Promise<LibraryFile[]> => {
  const records = await getAllRecords();
  return records
    .map(toMetadata)
    .sort((a, b) => b.savedAt.localeCompare(a.savedAt));
};

export const getLibraryFile = (id: string): Promise<LibraryFileRecord | undefined> =>
  runTransaction<LibraryFileRecord | undefined>("readonly", (store) => store.get(id));

export const getShareableLibraryFile = async (id: string): Promise<LibraryFileRecord> => {
  const file = await getLibraryFile(id);
  if (!file) throw new Error("o arquivo não foi encontrado na biblioteca.");
  if (!isAndroidNative()) return file;
  const synced = await syncNativeCopy(file);
  await runTransaction<IDBValidKey>("readwrite", (store) => store.put(synced));
  return synced;
};

export const saveLibraryFile = async (
  id: string | null,
  name: string,
  blob: Blob
): Promise<LibraryFile> => {
  const previous = id ? await getLibraryFile(id) : undefined;
  const file: LibraryFileRecord = {
    ...previous,
    id: id ?? crypto.randomUUID(),
    name: name.trim().replace(/\.ordo$/i, "") || "sessão",
    savedAt: new Date().toISOString(),
    size: blob.size,
    blob,
  };
  await runTransaction<IDBValidKey>("readwrite", (store) => store.put(file));
  const synced = await syncNativeCopy(file);
  if (synced !== file || isNativeApp()) {
    await runTransaction<IDBValidKey>("readwrite", (store) => store.put(synced));
  }
  return toMetadata(synced);
};

export const renameLibraryFile = async (id: string, name: string): Promise<void> => {
  const file = await getLibraryFile(id);
  if (!file) throw new Error("o arquivo não foi encontrado na biblioteca.");
  file.name = name.trim().replace(/\.ordo$/i, "") || file.name;
  file.savedAt = new Date().toISOString();
  const synced = await syncNativeCopy(file);
  await runTransaction<IDBValidKey>("readwrite", (store) => store.put(synced));
};

export const deleteLibraryFile = async (id: string): Promise<void> => {
  const file = await getLibraryFile(id);
  if (!file) return;
  if (isAndroidNative() && file.androidUri && await androidFileExists(file.androidUri)) {
    await removeFile(file.androidUri);
  } else if (isDesktopNative() && file.desktopPath) {
    if (await desktopFileExists(file.desktopPath, { baseDir: BaseDirectory.Document })) {
      await removeDesktopFile(file.desktopPath, { baseDir: BaseDirectory.Document });
    }
  }
  await runTransaction<undefined>("readwrite", (store) => store.delete(id));
};

export const pickOrdoFile = async (): Promise<File | null> => {
  if (!isAndroidNative()) return null;
  const [uri] = await showOpenFilePicker({ mimeTypes: ["*/*"], multiple: false });
  if (!uri) return null;
  const [bytes, metadata] = await Promise.all([readFile(uri), getMetadata(uri)]);
  return new File([bytes], metadata.name, { type: "application/octet-stream" });
};

export const shareLibraryFileOnAndroid = async (id: string): Promise<void> => {
  const file = await getShareableLibraryFile(id);
  if (!file.androidUri) throw new Error("não foi possível preparar o arquivo para compartilhamento.");
  await showShareFileDialog(file.androidUri);
};

const ensureAndroidLibraryFolder = async (): Promise<void> => {
  const marker = await createNewPublicFile(
    AndroidPublicGeneralPurposeDir.Documents,
    `${ANDROID_LIBRARY_FOLDER}/.mantiquarius`,
    "application/octet-stream"
  );
  await removeFile(marker);
};

const readStoredAndroidFolder = (): { uri: string; documentTopTreeUri: string | null } | null => {
  const stored = localStorage.getItem(ANDROID_FOLDER_KEY);
  if (!stored) return null;
  try {
    const value = JSON.parse(stored) as { uri?: unknown; documentTopTreeUri?: unknown };
    if (typeof value.uri !== "string") return null;
    return {
      uri: value.uri,
      documentTopTreeUri:
        typeof value.documentTopTreeUri === "string" ? value.documentTopTreeUri : null,
    };
  } catch {
    return null;
  }
};

export const openLibraryLocation = async (): Promise<void> => {
  if (isAndroidNative()) {
    const records = await getAllRecords();
    for (const record of records) {
      const synced = await syncAndroidCopy(record);
      await runTransaction<IDBValidKey>("readwrite", (store) => store.put(synced));
    }
    await ensureAndroidLibraryFolder();

    const storedFolder = readStoredAndroidFolder();
    if (storedFolder) {
      const hasPermission = await checkPersistedPickerUriPermission(
        storedFolder,
        AndroidUriPermissionState.Read
      );
      if (hasPermission) {
        await showViewDirDialog(storedFolder);
        return;
      }
      localStorage.removeItem(ANDROID_FOLDER_KEY);
    }

    const folder = await showOpenDirPicker({
      initialLocation: AndroidPickerInitialLocation.PublicDir(
        AndroidPublicGeneralPurposeDir.Documents,
        { relativePath: ANDROID_LIBRARY_FOLDER }
      ),
    });
    if (!folder) return;
    await persistPickerUriPermission(folder);
    localStorage.setItem(ANDROID_FOLDER_KEY, JSON.stringify(folder));
    await showViewDirDialog(folder);
    return;
  }

  if (isDesktopNative()) {
    const records = await getAllRecords();
    for (const record of records) {
      const synced = await syncDesktopCopy(record);
      await runTransaction<IDBValidKey>("readwrite", (store) => store.put(synced));
    }
    const documents = await documentDir();
    const folder = await join(documents, LIBRARY_FOLDER);
    await revealItemInDir(folder);
  }
};
