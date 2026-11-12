import { Pencil, Trash2 } from "lucide-react";

interface Props {
  onRename: () => void;
  onRemove: () => void;
}

/**
 * Botões de renomear/excluir de cada item.
 * Sempre visíveis no celular (onde não existe clique direito) e
 * revelados no hover no desktop, para não poluir a lista.
 */
export function ItemActions({ onRename, onRemove }: Props) {
  return (
    <span className="ml-auto flex shrink-0 items-center gap-0.5 opacity-100 transition-opacity lg:opacity-0 lg:group-hover:opacity-100">
      <button
        title="renomear"
        aria-label="renomear"
        onClick={(e) => {
          e.stopPropagation();
          onRename();
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-carbon-400 transition-colors hover:bg-carbon-700 hover:text-white active:scale-90"
      >
        <Pencil size={13} />
      </button>
      <button
        title="excluir"
        aria-label="excluir"
        onClick={(e) => {
          e.stopPropagation();
          onRemove();
        }}
        className="flex h-7 w-7 items-center justify-center rounded-md text-carbon-400 transition-colors hover:bg-ember-400/15 hover:text-ember-400 active:scale-90"
      >
        <Trash2 size={13} />
      </button>
    </span>
  );
}
