import type { LucideIcon } from "lucide-react";

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
}: {
  icon: LucideIcon;
  label: string;
  shortcut?: string;
  onClick: () => void;
  disabled?: boolean;
  title?: string;
  tone?: "default" | "primary" | "danger";
}) {
  const toneClass =
    tone === "primary"
      ? "border-transparent bg-pf-primary text-[color:var(--pf-primary-foreground)] hover:bg-pf-primary-hover"
      : tone === "danger"
        ? "border-pf-border text-pf-danger hover:bg-pf-danger-soft"
        : "border-pf-border text-pf-text-secondary hover:bg-pf-surface";
  return (
    <button
      type="button"
      title={title}
      onClick={onClick}
      disabled={disabled}
      className={`inline-flex h-9 shrink-0 items-center gap-2 rounded-lg border px-3 text-[13px] font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] disabled:pointer-events-none disabled:opacity-40 ${toneClass}`}
    >
      <Icon className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
      <span className="whitespace-nowrap">{label}</span>
      {shortcut ? (
        <kbd className="hidden rounded border border-current/25 px-1 font-sans text-[10px] font-semibold opacity-60 sm:inline">
          {shortcut}
        </kbd>
      ) : null}
    </button>
  );
}

export function ToolbarSeparator() {
  return <span className="mx-1 h-6 w-px shrink-0 bg-pf-border" aria-hidden />;
}
