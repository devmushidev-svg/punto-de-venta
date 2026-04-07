import type { KeyboardEvent } from "react";

/**
 * Navegación rápida en formularios modales: **Enter** → siguiente campo, **Shift+Enter** → anterior.
 * En `<textarea>`, **Shift+Enter** deja el salto de línea; **Enter** solo avanza.
 */
export function handleEnterFieldNav(
  e: KeyboardEvent<HTMLElement>,
  order: readonly string[],
  fieldId: string,
  lastFocusSelector: string,
  options?: { textarea?: boolean }
): void {
  if (e.key !== "Enter" || e.nativeEvent.isComposing) return;
  if (e.ctrlKey || e.metaKey || e.altKey) return;

  const i = order.indexOf(fieldId);
  if (i < 0) return;

  if (options?.textarea) {
    if (e.shiftKey) return;
    e.preventDefault();
    if (i >= order.length - 1) {
      document.querySelector<HTMLElement>(lastFocusSelector)?.focus();
      return;
    }
    document.getElementById(order[i + 1])?.focus();
    return;
  }

  e.preventDefault();

  if (e.shiftKey) {
    if (i <= 0) return;
    document.getElementById(order[i - 1])?.focus();
    return;
  }

  if (i >= order.length - 1) {
    document.querySelector<HTMLElement>(lastFocusSelector)?.focus();
    return;
  }

  document.getElementById(order[i + 1])?.focus();
}
