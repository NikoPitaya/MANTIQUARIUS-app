import { LogIn, LogOut, Repeat } from "lucide-react";

const toggleClass = (on: boolean) =>
  `flex h-6 w-6 shrink-0 items-center justify-center rounded-md border transition-all active:scale-90 ${
    on
      ? "border-acid-500/50 bg-acid-400/15 text-acid-300"
      : "border-carbon-700 text-carbon-500 hover:border-carbon-500 hover:text-carbon-200"
  }`;

interface Props {
  fadeIn: boolean;
  fadeOut: boolean;
  onToggleIn: () => void;
  onToggleOut: () => void;
}

/** Par de botões de fade in / fade out de um item da lista. */
export function FadeToggles({ fadeIn, fadeOut, onToggleIn, onToggleOut }: Props) {
  return (
    <span className="flex shrink-0 items-center gap-1">
      <button
        title={`fade in ${fadeIn ? "ligado" : "desligado"} — clique para alternar`}
        aria-label="alternar fade in"
        onClick={(e) => {
          e.stopPropagation();
          onToggleIn();
        }}
        className={toggleClass(fadeIn)}
      >
        <LogIn size={11.5} />
      </button>
      <button
        title={`fade out ${fadeOut ? "ligado" : "desligado"} — clique para alternar`}
        aria-label="alternar fade out"
        onClick={(e) => {
          e.stopPropagation();
          onToggleOut();
        }}
        className={toggleClass(fadeOut)}
      >
        <LogOut size={11.5} />
      </button>
    </span>
  );
}

interface LoopToggleProps {
  loop: boolean;
  onToggle: () => void;
}

export function LoopToggle({ loop, onToggle }: LoopToggleProps) {
  return (
    <button
      title={`loop ${loop ? "ligado" : "desligado"} — clique para alternar`}
      aria-label={`alternar loop, atualmente ${loop ? "ligado" : "desligado"}`}
      aria-pressed={loop}
      onClick={(e) => {
        e.stopPropagation();
        onToggle();
      }}
      className={toggleClass(loop)}
    >
      <Repeat size={11.5} />
    </button>
  );
}
