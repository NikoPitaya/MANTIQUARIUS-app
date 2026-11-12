import { Volume1, Volume2, VolumeX } from "lucide-react";

interface Props {
  value: number; // 0..1
  onChange: (v: number) => void;
  title?: string;
}

export function VolumeSlider({ value, onChange, title = "volume" }: Props) {
  const pct = Math.round(value * 100);
  const Icon = value === 0 ? VolumeX : value < 0.5 ? Volume1 : Volume2;

  return (
    <div className="flex items-center gap-2" title={`${title}: ${pct}%`}>
      <button
        onClick={() => onChange(value === 0 ? 1 : 0)}
        title={value === 0 ? "reativar som" : "silenciar"}
        className={`flex h-5 w-5 shrink-0 items-center justify-center rounded transition-colors ${
          value === 0 ? "text-ember-400 hover:text-ember-400" : "text-carbon-400 hover:text-acid-300"
        }`}
      >
        <Icon size={13} strokeWidth={2} />
      </button>
      <input
        type="range"
        min={0}
        max={100}
        value={pct}
        onChange={(e) => onChange(Number(e.target.value) / 100)}
        className="vol-range h-1 min-w-0 flex-1 cursor-pointer appearance-none rounded-full bg-carbon-700 outline-none"
        style={{
          background: `linear-gradient(to right, var(--color-acid-400) ${pct}%, var(--color-carbon-700) ${pct}%)`,
        }}
      />
      <span className="w-7 shrink-0 text-right font-mono text-[9.5px] tabular-nums text-carbon-400">
        {pct}
      </span>
    </div>
  );
}
