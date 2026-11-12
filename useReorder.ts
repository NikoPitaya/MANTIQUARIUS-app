import { useCallback, useRef, useState } from "react";

/**
 * Reordenação por arraste para listas simples.
 * Funciona com mouse (HTML drag & drop) e devolve o índice sob o cursor
 * para desenhar a linha indicadora.
 */
export function useReorder<T>(items: T[], onReorder: (next: T[]) => void) {
  const [overIdx, setOverIdx] = useState<number | null>(null);
  const dragIdx = useRef<number | null>(null);

  const move = useCallback(
    (from: number, to: number) => {
      if (from === to || from < 0 || from >= items.length) return;
      const arr = [...items];
      const [it] = arr.splice(from, 1);
      arr.splice(Math.min(to, arr.length), 0, it);
      onReorder(arr);
    },
    [items, onReorder]
  );

  /** props para espalhar no elemento de cada item da lista */
  const dragProps = useCallback(
    (index: number) => ({
      draggable: true,
      onDragStart: (e: React.DragEvent) => {
        dragIdx.current = index;
        e.dataTransfer.effectAllowed = "move";
      },
      onDragOver: (e: React.DragEvent) => {
        e.preventDefault();
        e.dataTransfer.dropEffect = "move";
        setOverIdx(index);
      },
      onDragLeave: () => setOverIdx((v) => (v === index ? null : v)),
      onDrop: (e: React.DragEvent) => {
        e.preventDefault();
        e.stopPropagation();
        if (dragIdx.current !== null) move(dragIdx.current, index);
        dragIdx.current = null;
        setOverIdx(null);
      },
      onDragEnd: () => {
        dragIdx.current = null;
        setOverIdx(null);
      },
    }),
    [move]
  );

  /** classe da linha indicadora acima do item */
  const markerCls = useCallback(
    (index: number) =>
      overIdx === index
        ? "before:absolute before:-top-[3px] before:left-1 before:right-1 before:h-[2px] before:rounded before:bg-acid-400"
        : "",
    [overIdx]
  );

  return { dragProps, markerCls, move };
}
