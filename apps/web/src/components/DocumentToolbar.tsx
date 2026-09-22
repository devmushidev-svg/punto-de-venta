import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { MoreHorizontal, type LucideIcon } from "lucide-react";

/**
 * Boton de la franja de acciones que AppShell pinta bajo la cabecera.
 * Una fila compacta de acciones del documento: sin fichas grandes ni grupos.
 */
export function ToolbarButton({
  icon: Icon,
  label,
  shortcut,
  onClick,
  disabled,
  title,
  tone = "default",
  mobilePriority,
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger";
  /**
   * En teléfono la cinta sólo deja a la vista lo que se puede resolver en un
   * toque. Las acciones "overflow" siguen disponibles dentro de Más acciones.
   */
  mobilePriority?: "primary" | "quick" | "overflow";
}) {
  const resolvedMobilePriority = mobilePriority ?? (tone === "primary" ? "primary" : "quick");
  const toneClass =
    tone === "primary"
      ? "border-transparent bg-pf-primary text-[color:var(--pf-primary-foreground)] hover:bg-pf-primary-hover"
      : tone === "danger"
        ? "border-pf-border text-pf-danger hover:bg-pf-danger-soft"
        : "border-pf-border text-pf-text-secondary hover:bg-pf-surface";
  return (
    <button
      type="button"
      title={title ?? label}
      aria-label={label}
      onClick={onClick}
      disabled={disabled}
      data-mobile-priority={resolvedMobilePriority}
      className={`pf-document-toolbar-button inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] disabled:pointer-events-none disabled:opacity-40 ${toneClass}`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <span className="pf-document-toolbar-label whitespace-nowrap">{label}</span>
      {shortcut ? (
        <kbd className="hidden rounded border border-current/25 px-1 font-sans text-[10px] font-semibold opacity-60 sm:inline">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

export function ToolbarSeparator() {
  return <span className="pf-document-toolbar-separator mx-1 h-6 w-px shrink-0 bg-pf-border" aria-hidden />;
}

export type ToolbarMenuItem = {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  danger?: boolean;
};

/** Acciones poco frecuentes del documento, para que no ocupen la fila. */
const MENU_WIDTH = 240;

export function ToolbarMenu({ items, label = "Más acciones" }: { items: ToolbarMenuItem[]; label?: string }) {
  const [open, setOpen] = useState(false);
  const [pos, setPos] = useState<{ top: number; left: number } | null>(null);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const panelRef = useRef<HTMLDivElement>(null);

  /**
   * El panel se monta en body con posicion fija: la franja de acciones usa
   * overflow-x-auto, que recorta cualquier desplegable posicionado dentro.
   */
  const place = useCallback(() => {
    const r = triggerRef.current?.getBoundingClientRect();
    if (!r) return;
    const left = Math.max(8, Math.min(r.left, window.innerWidth - MENU_WIDTH - 8));
    setPos({ top: r.bottom + 6, left });
  }, []);

  useLayoutEffect(() => {
    if (!open) return;
    place();
  }, [open, place]);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (triggerRef.current?.contains(t) || panelRef.current?.contains(t)) return;
      setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    window.addEventListener("resize", place);
    window.addEventListener("scroll", place, true);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
      window.removeEventListener("resize", place);
      window.removeEventListener("scroll", place, true);
    };
  }, [open, place]);

  if (items.length === 0) return null;

  return (
    <>
      <button
        ref={triggerRef}
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        title={label}
        aria-label={label}
        className="pf-document-toolbar-button pf-document-toolbar-menu inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border border-pf-border px-3 text-[13px] font-semibold text-pf-text-secondary transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
      >
        <MoreHorizontal className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
        <span className="pf-document-toolbar-label whitespace-nowrap">{label}</span>
      </button>
      {open && pos
        ? createPortal(
            <div
              ref={panelRef}
              role="menu"
              aria-label={label}
              className="pf-menu-panel fixed z-[60] p-1.5"
              style={{ top: pos.top, left: pos.left, width: MENU_WIDTH }}
            >
              {items.map((item) => {
                const Icon = item.icon;
                return (
                  <button
                    key={item.label}
                    type="button"
                    role="menuitem"
                    disabled={item.disabled}
                    onClick={() => {
                      setOpen(false);
                      item.onClick();
                    }}
                    className={`pf-menu-item flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm disabled:pointer-events-none disabled:opacity-40 ${
                      item.danger ? "!text-pf-danger" : ""
                    }`}
                  >
                    <Icon className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
                    <span className="min-w-0 flex-1 truncate text-left">{item.label}</span>
                    {item.shortcut ? (
                      <kbd className="shrink-0 rounded border border-pf-border px-1 font-sans text-[10px] font-semibold text-pf-muted">
                        {item.shortcut}
                      </kbd>
                    ) : null}
                  </button>
                );
              })}
            </div>,
            document.body,
          )
        : null}
    </>
  );
}
