import type { LucideIcon } from "lucide-react";
import type { ReactNode } from "react";

interface Props {
  index: string;
  title: string;
  icon: LucideIcon;
  actions?: ReactNode;
  children: ReactNode;
  className?: string;
}

export function PanelChrome({ index, title, icon: Icon, actions, children, className = "" }: Props) {
  return (
    <section
      className={`group/panel relative flex min-h-0 min-w-0 flex-col overflow-hidden rounded-xl border border-carbon-700/80 bg-carbon-900 shadow-[0_1px_0_rgba(255,255,255,0.03)_inset,0_12px_32px_-16px_rgba(0,0,0,0.6)] ${className}`}
    >
      <header className="flex h-9 shrink-0 items-center gap-2 border-b border-carbon-700/70 bg-carbon-850/70 px-3">
        <span className="font-mono text-[9.5px] font-medium tracking-widest text-carbon-500">
          {index}
        </span>
        <span className="h-3 w-px bg-carbon-600" />
        <Icon size={13} className="text-acid-400" strokeWidth={2.2} />
        <h2 className="font-mono text-[10px] font-semibold uppercase tracking-[0.18em] text-carbon-200">
          {title}
        </h2>
        <div className="ml-auto flex items-center gap-1">{actions}</div>
      </header>
      <div className="relative flex min-h-0 flex-1">{children}</div>
    </section>
  );
}

export function HeaderIconBtn({
  title,
  onClick,
  children,
  accent = false,
}: {
  title: string;
  onClick: () => void;
  children: ReactNode;
  accent?: boolean;
}) {
  return (
    <button
      title={title}
      onClick={onClick}
      className={`flex h-6 w-6 items-center justify-center rounded-md border transition-all active:scale-95 ${
        accent
          ? "border-acid-500/40 bg-acid-400/10 text-acid-300 hover:bg-acid-400/20"
          : "border-transparent text-carbon-300 hover:border-carbon-600 hover:bg-carbon-700/60 hover:text-white"
      }`}
    >
      {children}
    </button>
  );
}
