/** Extrai o ID do vídeo a partir de qualquer formato de link do YouTube. */
export const parseYouTubeId = (input: string): string | null => {
  const raw = input.trim();
  if (!raw) return null;
  // já é um id puro
  if (/^[\w-]{11}$/.test(raw)) return raw;
  try {
    const url = new URL(raw.startsWith("http") ? raw : `https://${raw}`);
    const host = url.hostname.replace(/^www\./, "");
    if (host === "youtu.be") {
      const id = url.pathname.slice(1, 12);
      return /^[\w-]{11}$/.test(id) ? id : null;
    }
    if (host.endsWith("youtube.com") || host.endsWith("youtube-nocookie.com")) {
      const v = url.searchParams.get("v");
      if (v && /^[\w-]{11}$/.test(v)) return v;
      const m = url.pathname.match(/\/(embed|shorts|live|v)\/([\w-]{11})/);
      if (m) return m[2];
    }
  } catch {
    /* link inválido */
  }
  const loose = raw.match(/[?&]v=([\w-]{11})/) ?? raw.match(/([\w-]{11})/);
  return loose ? loose[1] : null;
};

export const thumbFor = (videoId: string): string =>
  `https://i.ytimg.com/vi/${videoId}/mqdefault.jpg`;

/** Busca o título público do vídeo (oEmbed, sem chave de API). */
export const fetchYouTubeTitle = async (videoId: string): Promise<string | null> => {
  try {
    const res = await fetch(
      `https://www.youtube.com/oembed?url=${encodeURIComponent(
        `https://www.youtube.com/watch?v=${videoId}`
      )}&format=json`
    );
    if (!res.ok) return null;
    const json = (await res.json()) as { title?: string };
    return typeof json.title === "string" ? json.title : null;
  } catch {
    return null;
  }
};

/* ------------------ IFrame Player API ------------------ */

export interface YTPlayer {
  playVideo: () => void;
  pauseVideo: () => void;
  stopVideo: () => void;
  seekTo: (s: number, allow: boolean) => void;
  setVolume: (v: number) => void;
  loadVideoById: (id: string) => void;
  cueVideoById: (id: string) => void;
  getPlayerState: () => number;
  destroy: () => void;
}

interface YTNamespace {
  Player: new (
    el: HTMLElement | string,
    opts: Record<string, unknown>
  ) => YTPlayer;
}

declare global {
  interface Window {
    YT?: YTNamespace & { loading?: number };
    onYouTubeIframeAPIReady?: () => void;
  }
}

let apiPromise: Promise<YTNamespace> | null = null;

export const loadYouTubeAPI = (): Promise<YTNamespace> => {
  if (apiPromise) return apiPromise;
  apiPromise = new Promise<YTNamespace>((resolve, reject) => {
    if (window.YT?.Player) {
      resolve(window.YT);
      return;
    }
    const prev = window.onYouTubeIframeAPIReady;
    window.onYouTubeIframeAPIReady = () => {
      prev?.();
      if (window.YT?.Player) resolve(window.YT);
      else reject(new Error("api do youtube indisponível"));
    };
    const tag = document.createElement("script");
    tag.src = "https://www.youtube.com/iframe_api";
    tag.async = true;
    tag.onerror = () => reject(new Error("não foi possível carregar o youtube"));
    document.head.appendChild(tag);
    setTimeout(() => {
      if (!window.YT?.Player) reject(new Error("tempo esgotado ao carregar o youtube"));
    }, 15000);
  }).catch((e) => {
    apiPromise = null;
    throw e;
  });
  return apiPromise;
};
