import { useId } from "react";

type BrandLogoProps = {
  /** Tamaño en px (cuadrado) */
  size?: number;
  className?: string;
  /** Texto para accesibilidad; vacío = decorativo */
  title?: string;
  /** Sombra suave bajo el icono */
  withShadow?: boolean;
};

/**
 * Isotipo MultiPOS (punto + líneas “flujo”). Misma geometría que /favicon.svg y /brand-logo.svg.
 * Para usar un logo de Photoshop: sustituye `public/brand-logo.svg` o cambia este componente a `<img src="/brand-logo.svg" alt="..." />`.
 */
export function BrandLogo({ size = 40, className = "", title, withShadow = false }: BrandLogoProps) {
  const uid = useId().replace(/:/g, "");
  const gradId = `pf-logo-grad-${uid}`;

  return (
    <svg
      width={size}
      height={size}
      viewBox="0 0 48 48"
      className={`shrink-0 ${withShadow ? "drop-shadow-md" : ""} ${className}`.trim()}
      role={title ? "img" : "presentation"}
      aria-label={title}
    >
      {title ? <title>{title}</title> : null}
      <defs>
        <linearGradient id={gradId} x1="8" y1="4" x2="42" y2="46" gradientUnits="userSpaceOnUse">
          <stop stopColor="#f8b890" />
          <stop offset="1" stopColor="#e8955a" />
        </linearGradient>
      </defs>
      <rect width="48" height="48" rx="14" fill={`url(#${gradId})`} />
      <circle cx="16" cy="24" r="5" fill="#fffdf9" />
      <path
        d="M24 18h12a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H24M24 26h10a2 2 0 0 1 2 2v2a2 2 0 0 1-2 2H24"
        stroke="#fffdf9"
        strokeWidth="2.25"
        strokeLinecap="round"
        strokeLinejoin="round"
      />
    </svg>
  );
}

/** Lockup horizontal: isotipo + nombre (cabecera escritorio) */
export function BrandLockup({
  size = 36,
  className = "",
  showTagline = false,
}: {
  size?: number;
  className?: string;
  showTagline?: boolean;
}) {
  return (
    <span className={`inline-flex items-center gap-2.5 min-w-0 ${className}`.trim()}>
      <BrandLogo size={size} withShadow />
      <span className="flex min-w-0 flex-col leading-tight">
        <span className="text-[15px] font-bold tracking-tight text-stone-900 truncate">MultiPOS</span>
        {showTagline ? (
          <span className="text-[10px] font-medium uppercase tracking-wider text-pf-muted truncate">
            Punto de venta
          </span>
        ) : null}
      </span>
    </span>
  );
}
