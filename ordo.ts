import type { OrdoDoc, OrdoFilePayload, OrdoMedia, OrdoNote } from "../types";

export const uid = (): string =>
  Math.random().toString(36).slice(2, 9) + Date.now().toString(36).slice(-4);

export const newNote = (title: string): OrdoNote => ({ id: uid(), title, content: "" });

export const emptyDoc = (): OrdoDoc => {
  const first = newNote("nota 01");
  return {
    name: "nova sessão",
    notes: [first],
    activeNoteId: first.id,
    audios: [],
    pdfs: [],
    activePdfId: null,
    videos: [],
    sfx: [],
    owlbearOpened: false,
  };
};



export const fileToDataURL = (file: File | Blob): Promise<string> =>
  new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(String(r.result));
    r.onerror = () => reject(r.error);
    r.readAsDataURL(file);
  });

export const dataURLToUint8 = (dataURL: string): Uint8Array => {
  const b64 = dataURL.slice(dataURL.indexOf(",") + 1);
  const bin = atob(b64);
  const u8 = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) u8[i] = bin.charCodeAt(i);
  return u8;
};

export const dataURLToObjectURL = (dataURL: string): string => {
  const u8 = dataURLToUint8(dataURL);
  const mime = dataURL.slice(5, dataURL.indexOf(";")) || "application/octet-stream";
  return URL.createObjectURL(new Blob([u8.buffer as ArrayBuffer], { type: mime }));
};

export const stripExt = (name: string): string => name.replace(/\.[^/.]+$/, "");

export const serializeDoc = (doc: OrdoDoc): string => {
  const payload: OrdoFilePayload = {
    ...doc,
    app: "ordo",
    version: 1,
    savedAt: new Date().toISOString(),
  };
  return JSON.stringify(payload);
};

const asMedia = (x: unknown): OrdoMedia | null => {
  if (typeof x !== "object" || x === null) return null;
  const m = x as Partial<OrdoMedia>;
  if (typeof m.id !== "string" || typeof m.data !== "string") return null;
  return {
    id: m.id,
    name: typeof m.name === "string" ? m.name : "arquivo",
    data: m.data,
    lastPage: typeof m.lastPage === "number" ? m.lastPage : undefined,
    source: m.source === "youtube" || m.source === "web" ? m.source : "file",
    videoId: typeof m.videoId === "string" ? m.videoId : undefined,
    url: typeof m.url === "string" ? m.url : undefined,
    volume: typeof m.volume === "number" ? m.volume : undefined,
    fadeIn: typeof m.fadeIn === "boolean" ? m.fadeIn : undefined,
    fadeOut: typeof m.fadeOut === "boolean" ? m.fadeOut : undefined,
  };
};

export const parseDoc = (raw: string): OrdoDoc | null => {
  try {
    const j = JSON.parse(raw) as Partial<OrdoFilePayload>;
    if (j.app !== "ordo" || !Array.isArray(j.notes) || j.notes.length === 0) return null;
    const notes: OrdoNote[] = j.notes
      .filter((n) => typeof n?.id === "string")
      .map((n) => ({
        id: n.id,
        title: typeof n.title === "string" ? n.title : "nota",
        content: typeof n.content === "string" ? n.content : "",
        mode: n.mode === "canvas" ? ("canvas" as const) : ("doc" as const),
        canvas: Array.isArray(n.canvas) ? n.canvas : [],
        view: n.view && typeof n.view === "object" ? n.view : undefined,
      }));
    if (notes.length === 0) return null;
    const activeNoteId =
      typeof j.activeNoteId === "string" && notes.some((n) => n.id === j.activeNoteId)
        ? j.activeNoteId
        : notes[0].id;
    const pdfs = (Array.isArray(j.pdfs) ? j.pdfs : [])
      .map(asMedia)
      .filter((m): m is OrdoMedia => m !== null);
    const activePdfId =
      typeof j.activePdfId === "string" && pdfs.some((p) => p.id === j.activePdfId)
        ? j.activePdfId
        : pdfs[0]?.id ?? null;
    return {
      name: typeof j.name === "string" && j.name.trim() ? j.name : "sessão importada",
      notes,
      activeNoteId,
      audios: (Array.isArray(j.audios) ? j.audios : [])
        .map(asMedia)
        .filter((m): m is OrdoMedia => m !== null),
      pdfs,
      activePdfId,
      videos: (Array.isArray(j.videos) ? j.videos : [])
        .map(asMedia)
        .filter((m): m is OrdoMedia => m !== null),
      sfx: (Array.isArray(j.sfx) ? j.sfx : [])
        .map(asMedia)
        .filter((m): m is OrdoMedia => m !== null),
      owlbearOpened: !!j.owlbearOpened,
    };
  } catch {
    return null;
  }
};

export const formatBytes = (bytes: number): string => {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(0)} KB`;
  if (bytes < 1024 * 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  return `${(bytes / 1024 / 1024 / 1024).toFixed(2)} GB`;
};

export const inIframe = (): boolean => {
  try {
    return window.self !== window.top;
  } catch {
    return true;
  }
};

export const fileNameFor = (doc: OrdoDoc): string => {
  const base =
    doc.name
      .trim()
      .replace(/\.ordo$/i, "")
      .replace(/[\\/:*?"<>|]/g, "-") || "ordo";
  return `${base}.ordo`;
};

export interface ExportBundle {
  fileName: string;
  blob: Blob;
  url: string;
  size: number;
  originalSize: number;
}

let activeBlobUrl: string | null = null;

const BINARY_MAGIC = "ORDO2BIN";
const BINARY_HEADER_SIZE = 12;

interface BinaryMedia {
  id: string;
  name: string;
  mime: string;
  size: number;
  lastPage?: number;
  source?: "file" | "youtube" | "web";
  videoId?: string;
  url?: string;
  volume?: number;
  fadeIn?: boolean;
  fadeOut?: boolean;
}

interface BinaryManifest {
  app: "ordo";
  version: 2;
  format: "binary";
  savedAt: string;
  name: string;
  notes: OrdoNote[];
  activeNoteId: string;
  activePdfId: string | null;
  owlbearOpened: boolean;
  sfx: BinaryMedia[];
  audios: BinaryMedia[];
  pdfs: BinaryMedia[];
  videos: BinaryMedia[];
}

const nextPaint = (): Promise<void> =>
  new Promise((resolve) => setTimeout(resolve, 0));

const parseDataUrl = (data: string): { mime: string; dataStart: number; base64: boolean } => {
  const comma = data.indexOf(",");
  if (comma < 0 || !data.startsWith("data:")) {
    throw new Error("mídia inválida dentro da sessão");
  }
  const header = data.slice(5, comma);
  return {
    mime: header.split(";")[0] || "application/octet-stream",
    dataStart: comma + 1,
    base64: /;base64(?:;|$)/i.test(header),
  };
};

/** Decodifica Base64 em partes para não criar um ArrayBuffer gigante de uma vez. */
const dataUrlToBlobChunked = async (
  data: string,
  onChunk: (processedChars: number) => void
): Promise<{ blob: Blob; mime: string }> => {
  const { mime, dataStart, base64 } = parseDataUrl(data);
  const payloadLength = data.length - dataStart;
  if (!base64) {
    const decoded = decodeURIComponent(data.slice(dataStart));
    onChunk(payloadLength);
    return { blob: new Blob([decoded], { type: mime }), mime };
  }

  const parts: BlobPart[] = [];
  const chunkSize = 1024 * 1024; // divisível por 4, preserva blocos Base64
  for (let offset = 0; offset < payloadLength; offset += chunkSize) {
    const encoded = data.slice(
      dataStart + offset,
      dataStart + Math.min(offset + chunkSize, payloadLength)
    );
    const binary = atob(encoded);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    parts.push(bytes.buffer as ArrayBuffer);
    onChunk(encoded.length);
    // Libera o thread principal entre blocos e permite atualizar a barra de progresso.
    await nextPaint();
  }
  return { blob: new Blob(parts, { type: mime }), mime };
};

export const prepareOrdoExport = async (
  doc: OrdoDoc,
  onProgress?: (progress: number, label: string) => void
): Promise<ExportBundle> => {
  const sfxList = doc.sfx ?? [];
  const all = [...doc.audios, ...doc.pdfs, ...doc.videos, ...sfxList];
  const totalChars = Math.max(1, all.reduce((sum, media) => sum + media.data.length, 0));
  let processedChars = 0;
  const blobParts: BlobPart[] = [];
  const audioMeta: BinaryMedia[] = [];
  const pdfMeta: BinaryMedia[] = [];
  const videoMeta: BinaryMedia[] = [];
  const sfxMeta: BinaryMedia[] = [];

  onProgress?.(0.02, "preparando manifesto");
  await nextPaint();

  const appendGroup = async (
    group: OrdoMedia[],
    target: BinaryMedia[],
    kind: string
  ): Promise<void> => {
    for (let i = 0; i < group.length; i++) {
      const media = group[i];
      onProgress?.(
        0.04 + (processedChars / totalChars) * 0.9,
        `processando ${kind} ${i + 1} de ${group.length}`
      );
      if (media.source === "youtube" && media.videoId) {
        target.push({
          id: media.id,
          name: media.name,
          mime: "application/x-youtube-link",
          size: 0,
          source: "youtube",
          videoId: media.videoId,
          volume: media.volume,
          fadeIn: media.fadeIn,
          fadeOut: media.fadeOut,
        });
        continue;
      }
      if (media.source === "web" && media.url) {
        target.push({
          id: media.id,
          name: media.name,
          mime: "application/x-web-link",
          size: 0,
          source: "web",
          url: media.url,
        });
        continue;
      }
      const result = await dataUrlToBlobChunked(media.data, (chars) => {
        processedChars += chars;
        onProgress?.(
          0.04 + (processedChars / totalChars) * 0.9,
          `processando ${kind} ${i + 1} de ${group.length}`
        );
      });
      target.push({
        id: media.id,
        name: media.name,
        mime: result.mime,
        size: result.blob.size,
        lastPage: media.lastPage,
        source: "file",
        volume: media.volume,
        fadeIn: media.fadeIn,
        fadeOut: media.fadeOut,
      });
      blobParts.push(result.blob);
    }
  };

  await appendGroup(doc.audios, audioMeta, "áudio");
  await appendGroup(doc.pdfs, pdfMeta, "pdf");
  await appendGroup(doc.videos, videoMeta, "vídeo");
  await appendGroup(sfxList, sfxMeta, "ambiente");

  const manifest: BinaryManifest = {
    app: "ordo",
    version: 2,
    format: "binary",
    savedAt: new Date().toISOString(),
    name: doc.name,
    notes: doc.notes,
    activeNoteId: doc.activeNoteId,
    activePdfId: doc.activePdfId,
    owlbearOpened: doc.owlbearOpened,
    sfx: sfxMeta,
    audios: audioMeta,
    pdfs: pdfMeta,
    videos: videoMeta,
  };
  const encoder = new TextEncoder();
  const manifestBytes = encoder.encode(JSON.stringify(manifest));
  const header = new Uint8Array(BINARY_HEADER_SIZE);
  header.set(encoder.encode(BINARY_MAGIC), 0);
  new DataView(header.buffer).setUint32(8, manifestBytes.byteLength, true);

  onProgress?.(0.96, "montando arquivo final");
  await nextPaint();
  const blob = new Blob([header.buffer, manifestBytes.buffer, ...blobParts], {
    type: "application/octet-stream",
  });
  if (activeBlobUrl) URL.revokeObjectURL(activeBlobUrl);
  const url = URL.createObjectURL(blob);
  activeBlobUrl = url;
  onProgress?.(1, "arquivo pronto para baixar");

  return {
    fileName: fileNameFor(doc),
    blob,
    url,
    size: blob.size,
    originalSize: totalChars,
  };
};

const validBinaryMedia = (value: unknown): value is BinaryMedia => {
  if (!value || typeof value !== "object") return false;
  const media = value as Partial<BinaryMedia>;
  return (
    typeof media.id === "string" &&
    typeof media.name === "string" &&
    typeof media.mime === "string" &&
    typeof media.size === "number" &&
    Number.isSafeInteger(media.size) &&
    media.size >= 0
  );
};

const parseBinaryFile = async (file: File): Promise<OrdoDoc | null> => {
  try {
    const header = await file.slice(0, BINARY_HEADER_SIZE).arrayBuffer();
    const view = new DataView(header);
    const manifestLength = view.getUint32(8, true);
    if (manifestLength <= 0 || BINARY_HEADER_SIZE + manifestLength > file.size) return null;
    const manifestRaw = await file.slice(
      BINARY_HEADER_SIZE,
      BINARY_HEADER_SIZE + manifestLength
    ).text();
    const manifest = JSON.parse(manifestRaw) as Partial<BinaryManifest>;
    if (
      manifest.app !== "ordo" ||
      manifest.version !== 2 ||
      manifest.format !== "binary" ||
      !Array.isArray(manifest.notes) ||
      manifest.notes.length === 0 ||
      !Array.isArray(manifest.audios) ||
      !Array.isArray(manifest.pdfs) ||
      !Array.isArray(manifest.videos) ||
      !manifest.audios.every(validBinaryMedia) ||
      !manifest.pdfs.every(validBinaryMedia) ||
      !manifest.videos.every(validBinaryMedia)
    ) return null;

    let offset = BINARY_HEADER_SIZE + manifestLength;
    const readGroup = async (group: BinaryMedia[]): Promise<OrdoMedia[]> => {
      const result: OrdoMedia[] = [];
      for (const media of group) {
        if (offset + media.size > file.size) throw new Error("arquivo incompleto");
        const data = media.source === "youtube" || media.source === "web"
          ? ""
          : await fileToDataURL(file.slice(offset, offset + media.size, media.mime));
        offset += media.size;
        result.push({
          id: media.id,
          name: media.name,
          data,
          lastPage: media.lastPage,
          source: media.source === "youtube" || media.source === "web" ? media.source : "file",
          videoId: media.videoId,
          url: media.url,
          volume: typeof media.volume === "number" ? media.volume : undefined,
          fadeIn: typeof media.fadeIn === "boolean" ? media.fadeIn : undefined,
          fadeOut: typeof media.fadeOut === "boolean" ? media.fadeOut : undefined,
        });
      }
      return result;
    };

    const audios = await readGroup(manifest.audios);
    const pdfs = await readGroup(manifest.pdfs);
    const videos = await readGroup(manifest.videos);
    const notes = manifest.notes.filter(
      (note): note is OrdoNote =>
        !!note &&
        typeof note.id === "string" &&
        typeof note.title === "string" &&
        typeof note.content === "string"
    );
    if (notes.length === 0) return null;
    const activeNoteId =
      typeof manifest.activeNoteId === "string" &&
      notes.some((note) => note.id === manifest.activeNoteId)
        ? manifest.activeNoteId
        : notes[0].id;
    const activePdfId =
      typeof manifest.activePdfId === "string" &&
      pdfs.some((pdf) => pdf.id === manifest.activePdfId)
        ? manifest.activePdfId
        : pdfs[0]?.id ?? null;

    return {
      name: typeof manifest.name === "string" ? manifest.name : "sessão importada",
      notes,
      activeNoteId,
      audios,
      pdfs,
      activePdfId,
      videos,
      sfx: await readGroup(Array.isArray(manifest.sfx) ? manifest.sfx : []),
      owlbearOpened: !!manifest.owlbearOpened,
    };
  } catch {
    return null;
  }
};

/** Abre tanto o formato binário v2 quanto os arquivos JSON v1 existentes. */
export const parseOrdoFile = async (file: File): Promise<OrdoDoc | null> => {
  const magic = await file.slice(0, BINARY_MAGIC.length).text();
  if (magic === BINARY_MAGIC) return parseBinaryFile(file);
  return parseDoc(await file.text());
};

export const savePreparedViaPicker = async (bundle: ExportBundle): Promise<boolean> => {
  const p = (window as unknown as { showSaveFilePicker?: (opts: unknown) => Promise<any> }).showSaveFilePicker;
  if (typeof p !== "function") return false;
  try {
    const handle = await p({
      suggestedName: bundle.fileName,
      types: [{ description: "Arquivo ORDO", accept: { "application/octet-stream": [".ordo"] } }],
    });
    const writable = await handle.createWritable();
    await writable.write(bundle.blob);
    await writable.close();
    return true;
  } catch {
    return false;
  }
};

export const requestPreparedDownload = (bundle: ExportBundle): void => {
  const anchor = document.createElement("a");
  anchor.href = bundle.url;
  anchor.download = bundle.fileName;
  anchor.rel = "noopener";
  anchor.style.display = "none";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
};
