import type { ReactNode } from "react";

type PageHeroProps = {
  title: ReactNode;
  /** En fila con botón: en sm+ limita ancho (max-w-2xl) y flex-1 */
  constrained?: boolean;
  className?: string;
  children?: ReactNode;
  /** Acciones a la derecha (p. ej. enlaces) en pantallas anchas */
  actions?: ReactNode;
};

/**
 * Bloque de título de página: estilos desde `src/index.css` (`:root` / `data-pf-theme`).
 */
export function PageHero({ title, constrained = false, className = "", children, actions }: PageHeroProps) {
  const panel = `pf-hero-panel${constrained ? " pf-hero-panel--stretch" : ""}${className ? ` ${className}` : ""}`;

  if (actions) {
    return (
      <div className={panel}>
        <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
          <div className="min-w-0">
            <h1 className="pf-hero-title">{title}</h1>
            {children}
          </div>
          <div className="flex flex-wrap gap-2 sm:shrink-0">{actions}</div>
        </div>
      </div>
    );
  }

  return (
    <div className={panel}>
      <h1 className="pf-hero-title">{title}</h1>
      {children}
    </div>
  );
}
