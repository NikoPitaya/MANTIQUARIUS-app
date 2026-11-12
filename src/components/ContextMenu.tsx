import { useCallback, useEffect, useState } from "react";
import type { LucideIcon } from "lucide-react";

export interface CtxItem {
  label: string;
  icon: LucideIcon;
  onClick: () => void;
  danger?: boolean;
}

export interface CtxState {
  x: number;
  y: number;
  items: CtxItem[];
}

export function useContextMenu() {
  const [menu, setMenu] = useState<CtxState | null>(null);
  const open = useCallback((e: React.MouseEvent, items: CtxItem[]) => {
    e.preventDefault();
    e.stopPropagation();
    const w = 200;
    const h = items.length * 40 + 12;
    setMenu({
      x: Math.min(e.clientX, window.innerWidth - w - 8),
      y: Math.min(e.clientY, window.innerHeight - h - 8),
      items,
    });
  }, []);
  const close = useCallback(() => setMenu(null), []);
  return { menu, open, close };
}

export function ContextMenuView({ menu, onClose }: { menu: CtxState | null; onClose: () => void }) {
  useEffect(() => {
    if (!menu) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    const onScroll = () => onClose();
    window.addEventListener("keydown", onKey);
    window.addEventListener("scroll", onScroll, true);
    window.addEventListener("resize", onScroll);
    return () => {
      window.removeEventListener("keydown", onKey);
      window.removeEventListener("scroll", onScroll, true);
      window.removeEventListener("resize", onScroll);
    };
  }, [menu, onClose]);

  if (!menu) return null;
  return (
    <div className="fixed inset-0 z-[90]" onMouseDown={onClose} onContextMenu={(e) => e.preventDefault()}>
      <div
        className="anim-pop-in absolute min-w-[190px] rounded-xl border border-carbon-600 bg-carbon-850/95 p-1.5 shadow-[0_12px_40px_rgba(0,0,0,0.6)] backdrop-blur-md"
        style={{ left: menu.x, top: menu.y }}
        onMouseDown={(e) => e.stopPropagation()}
      >
        {menu.items.map((it) => (
          <button
            key={it.label}
            onClick={() => {
              onClose();
              it.onClick();
            }}
            className={`flex w-full items-center gap-2.5 rounded-lg px-3 py-2 text-left text-[12.5px] font-medium transition-colors ${
              it.danger
                ? "text-ember-400 hover:bg-ember-400/10"
                : "text-carbon-200 hover:bg-carbon-700/70 hover:text-white"
            }`}
          >
            <it.icon size={14} strokeWidth={2} />
            {it.label}
          </button>
        ))}
      </div>
    </div>
  );
}
