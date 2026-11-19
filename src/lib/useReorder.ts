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
      "data-reorder-index": index,
      onMouseDown: (e: React.MouseEvent) => {
        const target = e.target as HTMLElement;
        if (e.button !== 0 || !target.closest("[data-reorder-handle]")) return;
        e.preventDefault();
        dragIdx.current = index;
        setOverIdx(index);

        const previousCursor = document.body.style.cursor;
        const previousUserSelect = document.body.style.userSelect;
        document.body.style.cursor = "grabbing";
        document.body.style.userSelect = "none";

        const onMouseMove = (moveEvent: MouseEvent) => {
          moveEvent.preventDefault();
          const element = document.elementFromPoint(moveEvent.clientX, moveEvent.clientY) as HTMLElement | null;
          const row = element?.closest("[data-reorder-index]") as HTMLElement | null;
          const targetIndex = row?.dataset.reorderIndex;
          setOverIdx(targetIndex !== undefined ? Number(targetIndex) : null);
        };

        const cleanup = () => {
          document.removeEventListener("mousemove", onMouseMove);
          document.removeEventListener("mouseup", onMouseUp);
          document.body.style.cursor = previousCursor;
          document.body.style.userSelect = previousUserSelect;
        };

        const onMouseUp = (upEvent: MouseEvent) => {
          upEvent.preventDefault();
          const element = document.elementFromPoint(upEvent.clientX, upEvent.clientY) as HTMLElement | null;
          const row = element?.closest("[data-reorder-index]") as HTMLElement | null;
          const targetIndex = row?.dataset.reorderIndex;
          if (dragIdx.current !== null && targetIndex !== undefined) {
            move(dragIdx.current, Number(targetIndex));
          }
          dragIdx.current = null;
          setOverIdx(null);
          cleanup();
        };

        document.addEventListener("mousemove", onMouseMove);
        document.addEventListener("mouseup", onMouseUp);
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
