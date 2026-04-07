import {
  forwardRef,
  type ButtonHTMLAttributes,
  type InputHTMLAttributes,
  type ReactNode,
  type SelectHTMLAttributes,
  type TextareaHTMLAttributes,
} from "react";

export function Card({
  className = "",
  id,
  children,
}: {
  className?: string;
  id?: string;
  children: ReactNode;
}) {
  return (
    <div id={id} className={`pf-card-surface ${className}`}>
      {children}
    </div>
  );
}

export function Button({
  variant = "primary",
  className = "",
  children,
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: "primary" | "secondary" | "ghost" | "danger" }) {
  const base =
    "inline-flex min-h-[44px] touch-manipulation items-center justify-center gap-2 rounded-xl px-4 py-2.5 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 disabled:pointer-events-none disabled:opacity-50 md:rounded-[var(--radius-pf)]";
  const styles = {
    primary: "pf-btn-primary-gradient focus-visible:outline-pf-primary",
    secondary: "pf-btn-secondary focus-visible:outline-pf-primary",
    ghost: "pf-btn-ghost focus-visible:outline-pf-primary",
    danger: "pf-btn-danger focus-visible:outline-pf-danger",
  };
  return (
    <button type="button" className={`${base} ${styles[variant]} ${className}`} {...props}>
      {children}
    </button>
  );
}

export function Field({
  label,
  error,
  children,
  className = "",
  compact = false,
}: {
  label: string;
  error?: string;
  children: ReactNode;
  className?: string;
  /** Encabezados densos (p. ej. nueva venta): menos altura entre etiqueta y control. */
  compact?: boolean;
}) {
  return (
    <label className={`block ${compact ? "space-y-0.5" : "space-y-1.5"} ${className}`}>
      <span
        className={`font-medium text-pf-text-secondary ${compact ? "text-[10px] leading-none" : "text-sm"}`}
      >
        {label}
      </span>
      {children}
      {error ? <span className="text-sm text-red-600">{error}</span> : null}
    </label>
  );
}

export const Input = forwardRef<HTMLInputElement, InputHTMLAttributes<HTMLInputElement>>(
  function Input({ className = "", ...props }, ref) {
    return (
      <input
        ref={ref}
        className={`pf-control-surface min-h-[48px] px-3.5 py-2.5 md:min-h-[44px] md:rounded-[var(--radius-pf)] ${className}`}
        {...props}
      />
    );
  }
);

export function Textarea({ className = "", ...props }: TextareaHTMLAttributes<HTMLTextAreaElement>) {
  return (
    <textarea
      rows={4}
      className={`pf-control-surface px-3.5 py-2.5 md:rounded-[var(--radius-pf)] ${className}`}
      {...props}
    />
  );
}

export const Select = forwardRef<HTMLSelectElement, SelectHTMLAttributes<HTMLSelectElement>>(
  function Select({ className = "", ...props }, ref) {
    return (
      <select
        ref={ref}
        className={`pf-control-surface min-h-[48px] px-3.5 py-2.5 md:min-h-[44px] md:rounded-[var(--radius-pf)] ${className}`}
        {...props}
      />
    );
  }
);
Select.displayName = "Select";

export function Modal({
  open,
  title,
  onClose,
  children,
  wide,
  maxWidthClass,
}: {
  open: boolean;
  title: string;
  onClose: () => void;
  children: ReactNode;
  wide?: boolean;
  /** Si se define, sustituye el ancho por defecto (p. ej. sm:max-w-5xl). */
  maxWidthClass?: string;
}) {
  if (!open) return null;
  const widthCls =
    maxWidthClass ?? (wide ? "sm:max-w-3xl" : "sm:max-w-md");
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center sm:items-center p-0 sm:p-4">
      <button
        type="button"
        className="absolute inset-0 bg-gradient-to-t from-[var(--pf-modal-scrim-from)] via-[var(--pf-modal-scrim-via)] to-[var(--pf-modal-scrim-to)] backdrop-blur-md"
        aria-label="Cerrar"
        onClick={onClose}
      />
      <div
        role="dialog"
        aria-modal
        aria-labelledby="modal-title"
        className={`relative z-10 max-h-[90vh] w-full overflow-y-auto rounded-t-3xl border border-[var(--pf-glass-border)] bg-[color:var(--pf-surface-overlay)] shadow-[var(--pf-shadow-warm-xl)] backdrop-blur-xl sm:rounded-2xl md:border-pf-border md:bg-pf-surface-elevated md:backdrop-blur-none md:shadow-xl ${widthCls}`}
      >
        <div className="sticky top-0 flex items-center justify-between border-b border-[var(--pf-border-soft)] bg-gradient-to-r from-[color:var(--pf-surface-elevated)] to-[color:var(--pf-primary-soft)]/25 px-4 py-3 backdrop-blur-md md:from-pf-surface-elevated md:to-pf-surface-elevated md:backdrop-blur-none">
          <h2 id="modal-title" className="text-lg font-semibold text-pf-text">
            {title}
          </h2>
          <button
            type="button"
            onClick={onClose}
            className="rounded-lg p-2 text-pf-text-soft hover:bg-pf-primary-soft hover:text-pf-text"
            aria-label="Cerrar diálogo"
          >
            ✕
          </button>
        </div>
        <div className="p-4">{children}</div>
      </div>
    </div>
  );
}
