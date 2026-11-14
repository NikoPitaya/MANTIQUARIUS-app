import { invoke } from "@tauri-apps/api/core";
import { useEffect, useRef, useState } from "react";

interface Props {
  mediaId: string;
  url: string;
  visible?: boolean;
  keepAlive?: boolean;
}

interface Bounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

function readBounds(element: HTMLElement): Bounds {
  const rect = element.getBoundingClientRect();
  const scale = window.devicePixelRatio || 1;
  return {
    x: Math.round(rect.left * scale),
    y: Math.round(rect.top * scale),
    width: Math.max(0, Math.round(rect.width * scale)),
    height: Math.max(0, Math.round(rect.height * scale)),
  };
}

export function CefBrowserSurface({
  mediaId,
  url,
  visible = true,
  keepAlive = false,
}: Props) {
  const surfaceRef = useRef<HTMLDivElement>(null);
  const visibleRef = useRef(visible);
  const syncBoundsRef = useRef<(() => void) | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  visibleRef.current = visible;

  useEffect(() => {
    syncBoundsRef.current?.();
  }, [visible]);

  useEffect(() => {
    const surface = surfaceRef.current;
    if (!surface) return;

    let disposed = false;
    let started = false;
    let starting = false;

    const syncBounds = async () => {
      const bounds = readBounds(surface);
      if (!visibleRef.current) {
        if (started) {
          void invoke("cef_resize_browser", {
            mediaId,
            ...bounds,
            width: 0,
            height: 0,
          }).catch(() => undefined);
        }
        return;
      }
      if (bounds.width === 0 || bounds.height === 0) {
        if (started) {
          void invoke("cef_resize_browser", { mediaId, ...bounds }).catch(() => undefined);
        }
        return;
      }

      if (started) {
        void invoke("cef_resize_browser", { mediaId, ...bounds }).catch((reason: unknown) => {
          if (!disposed) {
            setError(reason instanceof Error ? reason.message : "não foi possível redimensionar o Chromium.");
          }
        });
        return;
      }
      if (starting) return;

      starting = true;
      try {
        await invoke("cef_open_browser", { mediaId, url, ...bounds });
        if (disposed) {
          if (keepAlive) {
            void invoke("cef_resize_browser", {
              mediaId,
              ...bounds,
              width: 0,
              height: 0,
            }).catch(() => undefined);
          } else {
            void invoke("cef_close_browser", { mediaId }).catch(() => undefined);
          }
          return;
        }
        started = true;
        setReady(true);
        setError(null);
        void syncBounds();
      } catch (reason) {
        if (!disposed) {
          setError(reason instanceof Error ? reason.message : String(reason));
        }
      } finally {
        starting = false;
      }
    };

    syncBoundsRef.current = () => void syncBounds();
    const observer = new ResizeObserver(() => void syncBounds());
    observer.observe(surface);
    window.addEventListener("resize", syncBounds);
    void syncBounds();

    return () => {
      disposed = true;
      syncBoundsRef.current = null;
      observer.disconnect();
      window.removeEventListener("resize", syncBounds);
      if (keepAlive) {
        void invoke("cef_resize_browser", {
          mediaId,
          x: 0,
          y: 0,
          width: 0,
          height: 0,
        }).catch(() => undefined);
      } else {
        void invoke("cef_close_browser", { mediaId }).catch(() => undefined);
      }
    };
  }, [keepAlive, mediaId, url]);

  return (
    <div ref={surfaceRef} className="relative min-h-0 flex-1 bg-white">
      {error ? (
        <div className="absolute inset-0 flex items-center justify-center bg-carbon-950 p-5 text-center">
          <p className="max-w-md text-[12px] leading-relaxed text-ember-300">{error}</p>
        </div>
      ) : !ready ? (
        <div className="absolute inset-0 flex items-center justify-center bg-carbon-950">
          <span className="font-mono text-[10px] uppercase tracking-[0.16em] text-carbon-400">
            iniciando Chromium
          </span>
        </div>
      ) : null}
    </div>
  );
}
