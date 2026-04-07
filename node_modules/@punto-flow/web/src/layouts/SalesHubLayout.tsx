import { NavLink, Outlet } from "react-router-dom";

export function VentasSectionNav() {
  return (
    <nav className="pf-hub-nav-shell" aria-label="Ventas y documentos previos">
      <NavLink
        to="/ventas"
        end
        className={({ isActive }) =>
          `pf-hub-nav-link ${isActive ? "pf-hub-nav-link-active" : "pf-hub-nav-link-idle"}`
        }
      >
        Ventas
      </NavLink>
      <NavLink
        to="/ventas/preventas"
        className={({ isActive }) =>
          `pf-hub-nav-link ${isActive ? "pf-hub-nav-link-active" : "pf-hub-nav-link-idle"}`
        }
      >
        PreVentas
      </NavLink>
      <NavLink
        to="/cotizaciones"
        className={({ isActive }) =>
          `pf-hub-nav-link ${isActive ? "pf-hub-nav-link-active" : "pf-hub-nav-link-idle"}`
        }
      >
        Cotizaciones
      </NavLink>
    </nav>
  );
}

export function SalesHubLayout() {
  return (
    <div className="space-y-4 pf-safe-page">
      <VentasSectionNav />
      <Outlet />
    </div>
  );
}
