import { useEffect, useRef, useState, type ReactNode } from "react";
import { SaleDocumentToolbarSetterContext } from "./SaleDocumentToolbarContext";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Building2,
  ChevronsLeft,
  ChevronsRight,
  CircleHelp,
  ClipboardList,
  Cloud,
  CloudOff,
  CreditCard,
  FileSpreadsheet,
  FileText,
  Home,
  Landmark,
  LayoutGrid,
  ListOrdered,
  Lock,
  LogOut,
  Menu,
  Package,
  PackageSearch,
  PlusCircle,
  Receipt,
  ScanSearch,
  SlidersHorizontal,
  Truck,
  User,
  UserCog,
  UserSquare,
  Users,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, type UserInfo } from "../auth/AuthContext";
import { isSaleDocPath, isSaleDocumentPath, isSalesListPath } from "../lib/appUrl";
import { hasPermission, PERMISSION_KEYS, type PermissionKey } from "../lib/permissions";
import { BrandLockup, BrandLogo } from "../components/BrandLogo";
import { AppAmbient } from "../components/AppAmbient";
import { Button } from "../components/ui";
import { OfflineBadge } from "../components/OfflineBadge";
import { apiFetch } from "../api/client";

type NavItem = {
  to: string;
  label: string;
  icon: LucideIcon;
  end?: boolean;
  admin?: boolean;
  permission?: PermissionKey;
  /** Si está definido, basta con uno de estos permisos (tiene prioridad sobre `permission`). */
  anyOfPermissions?: PermissionKey[];
  /** Administrador o cualquiera de estos permisos (p. ej. RH consulta). */
  adminOrAnyPermission?: PermissionKey[];
};

function canSeeNavItem(user: UserInfo | null | undefined, item: NavItem): boolean {
  if (item.adminOrAnyPermission?.length) {
    if (user?.role === "admin") return true;
    return item.adminOrAnyPermission.some((p) => hasPermission(user, p));
  }
  if (item.admin && user?.role !== "admin") return false;
  if (item.anyOfPermissions?.length) {
    return item.anyOfPermissions.some((p) => hasPermission(user, p));
  }
  if (item.permission && !hasPermission(user, item.permission)) return false;
  return true;
}

/** Valores de `general.salesWorkflow` (Settings → Apariencia). */
type SalesWorkflow = "mixed" | "preorder_focus" | "pos_focus";

function normalizeSalesWorkflow(v: unknown): SalesWorkflow {
  if (v === "preorder_focus" || v === "pos_focus" || v === "mixed") return v;
  return "mixed";
}

/** Acción global siempre disponible; se pinta como botón, no como enlace de lista. */
const NEW_SALE: NavItem = { to: "/venta", label: "Nueva venta", icon: PlusCircle, end: true };

/** Destinos de uso diario: sin etiqueta de grupo, siempre arriba. */
const PRIMARY_ITEMS: NavItem[] = [
  { to: "/", label: "Inicio", icon: Home, end: true },
  { to: "/ventas", label: "Ventas", icon: ListOrdered, end: true },
  { to: "/productos", label: "Productos", icon: Package },
  { to: "/caja", label: "Caja", icon: Wallet },
];

type NavSectionDef = { id: string; label: string; items: NavItem[] };

const QUOTE_ITEMS: NavItem[] = [
  { to: "/cotizaciones", label: "Cotizaciones", icon: FileText },
  { to: "/ventas/preventas", label: "PreVentas", icon: ClipboardList },
];

const SECTIONS: NavSectionDef[] = [
  {
    id: "facturacion",
    label: "Facturación",
    items: [
      { to: "/venta/tactil", label: "Venta táctil", icon: LayoutGrid },
      ...QUOTE_ITEMS,
      { to: "/cxc", label: "Cuentas por cobrar", icon: Landmark, permission: PERMISSION_KEYS.ACCOUNTS_RECEIVABLE },
      {
        to: "/compras",
        label: "Compras",
        icon: Truck,
        anyOfPermissions: [PERMISSION_KEYS.PURCHASES_RECORD, PERMISSION_KEYS.PURCHASES_VIEW],
      },
      { to: "/pedidos-proveedor", label: "Pedidos a proveedor", icon: PackageSearch },
      { to: "/traslados", label: "Traslados", icon: ArrowLeftRight, permission: PERMISSION_KEYS.INVENTORY_TRANSFERS },
    ],
  },
  {
    id: "directorio",
    label: "Directorio",
    items: [
      { to: "/clientes", label: "Clientes", icon: Users },
      { to: "/proveedores", label: "Proveedores", icon: Warehouse },
    ],
  },
  {
    id: "administracion",
    label: "Administración",
    items: [
      { to: "/cxp", label: "Cuentas por pagar", icon: CreditCard, permission: PERMISSION_KEYS.ACCOUNTS_PAYABLE },
      { to: "/gastos", label: "Gastos", icon: Receipt, adminOrAnyPermission: [PERMISSION_KEYS.EXPENSES_VIEW] },
      { to: "/reportes", label: "Reportes", icon: BarChart3, permission: PERMISSION_KEYS.REPORTS_VIEW },
      { to: "/auditoria-inventario", label: "Auditoría inventario", icon: ScanSearch, admin: true },
      { to: "/empleados", label: "Empleados", icon: UserSquare, admin: true },
      { to: "/planillas", label: "Planillas", icon: FileSpreadsheet, adminOrAnyPermission: [PERMISSION_KEYS.PAYROLL_VIEW] },
    ],
  },
  {
    id: "empresa",
    label: "Empresa",
    items: [
      { to: "/empresa", label: "Información empresa", icon: Building2 },
      { to: "/usuarios", label: "Usuarios y permisos", icon: UserCog, admin: true },
      { to: "/configuracion", label: "Configuración", icon: SlidersHorizontal, admin: true },
      { to: "/ayuda", label: "Ayuda y FAQ", icon: CircleHelp },
    ],
  },
];

/**
 * Respeta `general.salesWorkflow`: con foco en preventa las cotizaciones suben al
 * inicio de Facturación; con foco en POS bajan al final.
 */
function sectionsFor(workflow: SalesWorkflow): NavSectionDef[] {
  if (workflow === "mixed") return SECTIONS;
  return SECTIONS.map((section) => {
    if (section.id !== "facturacion") return section;
    const quoteTargets = new Set(QUOTE_ITEMS.map((i) => i.to));
    const quotes = section.items.filter((i) => quoteTargets.has(i.to));
    const rest = section.items.filter((i) => !quoteTargets.has(i.to));
    return { ...section, items: workflow === "preorder_focus" ? [...quotes, ...rest] : [...rest, ...quotes] };
  });
}

/** Rutas de detalle que no son un destino de la barra lateral. */
const EXTRA_TITLES: { match: RegExp; title: string }[] = [
  { match: /^\/venta\/buscar-producto$/, title: "Buscar producto" },
  { match: /^\/ventas\/[^/]+\/editar$/, title: "Editar venta" },
  { match: /^\/ventas\/[^/]+\/comprobante$/, title: "Comprobante" },
  { match: /^\/ventas\/[^/]+\/ticket$/, title: "Ticket" },
  { match: /^\/cotizaciones\/nueva$/, title: "Nueva cotización" },
];

const ALL_ITEMS: NavItem[] = [NEW_SALE, ...PRIMARY_ITEMS, ...SECTIONS.flatMap((s) => s.items)];

function pageTitle(pathname: string): string {
  const extra = EXTRA_TITLES.find((e) => e.match.test(pathname));
  if (extra) return extra.title;
  const exact = ALL_ITEMS.find((i) => i.to === pathname);
  if (exact) return exact.label;
  const prefix = ALL_ITEMS.filter((i) => i.to !== "/" && pathname.startsWith(i.to)).sort(
    (a, b) => b.to.length - a.to.length,
  )[0];
  return prefix?.label ?? "MultiPOS";
}

const SIDEBAR_STORAGE_KEY = "pf-sidebar-expanded";

function readSidebarExpanded(): boolean {
  try {
    const raw = localStorage.getItem(SIDEBAR_STORAGE_KEY);
    if (raw === "0") return false;
    if (raw === "1") return true;
  } catch {
    /* modo privado */
  }
  return true;
}

function SidebarLink({
  item,
  expanded,
  onNavigate,
}: {
  item: NavItem;
  expanded: boolean;
  onNavigate?: () => void;
}) {
  const { user } = useAuth();
  if (!canSeeNavItem(user, item)) return null;
  const Icon = item.icon;
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      title={expanded ? undefined : item.label}
      className={({ isActive }) =>
        `flex min-h-10 items-center gap-3 rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
          expanded ? "px-3 py-2" : "justify-center px-2 py-2"
        } ${isActive ? "pf-sidebar-item-active" : "pf-sidebar-item-idle"}`
      }
    >
      <Icon className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden />
      {expanded ? <span className="min-w-0 truncate">{item.label}</span> : <span className="sr-only">{item.label}</span>}
    </NavLink>
  );
}

function SidebarNav({
  expanded,
  salesWorkflow,
  onNavigate,
  onSaleDoc,
}: {
  expanded: boolean;
  salesWorkflow: SalesWorkflow;
  onNavigate?: () => void;
  onSaleDoc: boolean;
}) {
  const { user } = useAuth();
  const sections = sectionsFor(salesWorkflow)
    .map((s) => ({ ...s, items: s.items.filter((i) => canSeeNavItem(user, i)) }))
    .filter((s) => s.items.length > 0);

  return (
    <nav className="flex flex-col gap-5" aria-label="Navegación principal">
      <NavLink
        to={NEW_SALE.to}
        end
        onClick={onNavigate}
        title={expanded ? undefined : NEW_SALE.label}
        aria-current={onSaleDoc ? "page" : undefined}
        className={`flex min-h-11 items-center gap-2.5 rounded-lg px-3 text-sm font-semibold transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
          expanded ? "justify-start" : "justify-center px-2"
        } ${
          onSaleDoc
            ? "bg-pf-primary-soft text-[color:var(--pf-sidebar-active-ink)] shadow-[inset_0_0_0_1px_var(--pf-primary-mid)]"
            : "bg-pf-primary text-[color:var(--pf-primary-foreground)] hover:bg-pf-primary-hover"
        }`}
      >
        <PlusCircle className="h-[18px] w-[18px] shrink-0" strokeWidth={2} aria-hidden />
        {expanded ? <span className="truncate">{NEW_SALE.label}</span> : <span className="sr-only">{NEW_SALE.label}</span>}
      </NavLink>

      <div className="flex flex-col gap-0.5">
        {PRIMARY_ITEMS.map((item) => (
          <SidebarLink key={item.to} item={item} expanded={expanded} onNavigate={onNavigate} />
        ))}
      </div>

      {sections.map((section) => (
        <div key={section.id} className="flex flex-col gap-0.5">
          {expanded ? (
            <p className="pf-sidebar-section-label mb-1 px-3 text-[11px] font-semibold uppercase tracking-wider">
              {section.label}
            </p>
          ) : (
            <div className="mx-auto mb-1 h-px w-6 bg-[color:var(--pf-sidebar-border)]" aria-hidden />
          )}
          {section.items.map((item) => (
            <SidebarLink key={item.to} item={item} expanded={expanded} onNavigate={onNavigate} />
          ))}
        </div>
      ))}
    </nav>
  );
}

function UserMenu({ onLock, onLogout, buildVersion }: { onLock: () => void; onLogout: () => void; buildVersion: string }) {
  const { user } = useAuth();
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") setOpen(false);
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  return (
    <div className="relative" ref={ref}>
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        aria-expanded={open}
        aria-haspopup="menu"
        aria-label="Abrir menú de usuario"
        title="Menú de usuario"
        className="flex min-h-11 items-center gap-2 rounded-lg border border-pf-border px-2.5 py-1.5 text-sm font-medium text-pf-text-secondary md:min-h-9 transition-colors hover:bg-pf-surface focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)]"
      >
        <User className="h-4 w-4 shrink-0 text-pf-muted" strokeWidth={1.9} aria-hidden />
        <span className="hidden max-w-[120px] truncate lg:inline">{user?.displayName ?? "Usuario"}</span>
      </button>
      {open ? (
        <div role="menu" className="pf-menu-panel absolute right-0 top-[calc(100%+0.375rem)] z-40 w-56 p-1.5">
          <div className="border-b border-pf-border px-2.5 pb-2 pt-1.5">
            <p className="truncate text-sm font-semibold text-pf-text">{user?.displayName ?? "Usuario"}</p>
            <p className="truncate text-xs text-pf-muted">{user?.username}</p>
          </div>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLock();
            }}
            className="pf-menu-item mt-1 flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm"
          >
            <Lock className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
            Bloquear pantalla
          </button>
          <button
            type="button"
            role="menuitem"
            onClick={() => {
              setOpen(false);
              onLogout();
            }}
            className="pf-menu-item flex min-h-10 w-full items-center gap-2.5 rounded-md px-2.5 text-sm"
          >
            <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
            Cerrar sesión
          </button>
          {buildVersion ? (
            <p className="border-t border-pf-border px-2.5 pb-1 pt-2 font-mono text-[10px] text-pf-muted">{buildVersion}</p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}

/** Chip de documento abierto: conserva el acceso a una venta en curso sin ocupar una fila entera. */
function OpenDocChip({
  label,
  active,
  onOpen,
  onClose,
}: {
  label: string;
  active: boolean;
  onOpen: () => void;
  onClose: () => void;
}) {
  return (
    <div
      className={`inline-flex shrink-0 items-stretch overflow-hidden rounded-lg border text-xs font-semibold ${
        active ? "border-[color:var(--pf-primary-mid)] bg-pf-primary-soft text-[color:var(--pf-sale-tab-ink)]" : "border-pf-border text-pf-text-tertiary"
      }`}
    >
      <button type="button" onClick={onOpen} className="min-h-11 max-w-[10rem] truncate px-2.5 py-1.5">
        {label}
      </button>
      <button
        type="button"
        onClick={onClose}
        aria-label={`Cerrar ${label}`}
        className="flex min-h-11 min-w-11 items-center justify-center px-1.5 transition-colors hover:bg-[color:var(--pf-surface-muted)]"
      >
        <X className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      </button>
    </div>
  );
}

function saleDocumentTabLabel(pathname: string): string {
  if (/^\/ventas\/[^/]+\/editar$/.test(pathname)) return "Editar venta";
  if (pathname === "/venta/buscar-producto") return "Buscar producto";
  if (pathname === "/venta/tactil") return "Venta táctil";
  return "Venta";
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { token, user, organization, branch, device, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [sidebarExpanded, setSidebarExpanded] = useState(readSidebarExpanded);
  const [screenLocked, setScreenLocked] = useState(false);
  const [lockPw, setLockPw] = useState("");
  const [lockErr, setLockErr] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const buildVersion = import.meta.env.VITE_APP_BUILD?.trim() || "";
  const [saleToolbarSlot, setSaleToolbarSlot] = useState<ReactNode>(null);
  const [salesListTabOpen, setSalesListTabOpen] = useState(false);
  const [saleDocTabOpen, setSaleDocTabOpen] = useState(false);
  const [salesWorkflow, setSalesWorkflow] = useState<SalesWorkflow>("mixed");
  const [syncStatus, setSyncStatus] = useState<{
    pendingEvents: number;
    failedEvents: number;
    cloudConfigured: boolean;
    mode: string;
  } | null>(null);

  useEffect(() => {
    try {
      localStorage.setItem(SIDEBAR_STORAGE_KEY, sidebarExpanded ? "1" : "0");
    } catch {
      /* modo privado */
    }
  }, [sidebarExpanded]);

  useEffect(() => {
    if (!token) {
      setSyncStatus(null);
      return;
    }
    let cancelled = false;
    const loadSync = () => {
      apiFetch<{ pendingEvents: number; failedEvents: number; cloudConfigured: boolean; mode: string }>(
        "/api/sync/status",
        { token },
      )
        .then((s) => {
          if (!cancelled) setSyncStatus(s);
        })
        .catch(() => {
          if (!cancelled) setSyncStatus(null);
        });
    };
    loadSync();
    const id = window.setInterval(loadSync, 30000);
    return () => {
      cancelled = true;
      window.clearInterval(id);
    };
  }, [token]);

  useEffect(() => {
    if (!token) return;
    apiFetch<{ general?: { salesWorkflow?: unknown } }>("/api/settings", { token })
      .then((s) => setSalesWorkflow(normalizeSalesWorkflow(s.general?.salesWorkflow)))
      .catch(() => setSalesWorkflow("mixed"));
  }, [token]);

  useEffect(() => {
    if (isSalesListPath(location.pathname)) setSalesListTabOpen(true);
    if (isSaleDocPath(location.pathname)) setSaleDocTabOpen(true);
  }, [location.pathname]);

  useEffect(() => {
    if (!menuOpen) return;
    const previousOverflow = document.body.style.overflow;
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setMenuOpen(false);
    };
    document.body.style.overflow = "hidden";
    document.addEventListener("keydown", onKeyDown);
    return () => {
      document.body.style.overflow = previousOverflow;
      document.removeEventListener("keydown", onKeyDown);
    };
  }, [menuOpen]);

  const saleDoc = isSaleDocumentPath(location.pathname);
  const onSalesList = isSalesListPath(location.pathname);
  const onSaleDoc = isSaleDocPath(location.pathname);

  useEffect(() => {
    if (!saleDoc) setSaleToolbarSlot(null);
  }, [saleDoc]);

  const hideChromeForPrint = /^\/ventas\/[^/]+\/comprobante$/.test(location.pathname);
  /** Documento de venta: menos margen lateral para dejar el ancho a los productos. */
  const saleDocWideLayout = onSaleDoc && !hideChromeForPrint;
  const showAmbient = !hideChromeForPrint;
  const title = pageTitle(location.pathname);

  async function unlockScreen() {
    if (!token) return;
    setLockErr("");
    setLockBusy(true);
    try {
      const r = await apiFetch<{ ok: boolean }>("/api/auth/verify-password", {
        method: "POST",
        body: JSON.stringify({ password: lockPw }),
        token,
      });
      if (r.ok) {
        setScreenLocked(false);
        setLockPw("");
      } else {
        setLockErr("Contraseña incorrecta.");
      }
    } catch {
      setLockErr("No se pudo verificar.");
    } finally {
      setLockBusy(false);
    }
  }

  function doLogout() {
    logout();
    navigate("/login");
  }

  const syncLabel = syncStatus
    ? syncStatus.failedEvents > 0
      ? `${syncStatus.failedEvents} error sync`
      : syncStatus.pendingEvents > 0
        ? `${syncStatus.pendingEvents} pendientes`
        : syncStatus.cloudConfigured
          ? "Nube lista"
          : "Local activo"
    : "Local";
  const SyncIcon = syncStatus?.cloudConfigured ? Cloud : CloudOff;
  const syncInk = syncStatus?.failedEvents
    ? "text-pf-danger"
    : syncStatus?.pendingEvents
      ? "text-pf-warning"
      : "text-pf-success";

  /**
   * Franja de acciones del documento de venta (contrato con NewSalePage vía
   * SaleDocumentToolbarSetterContext). Se pinta una sola vez para escritorio y móvil.
   */
  const saleToolbarStrip =
    saleDoc && saleToolbarSlot && !hideChromeForPrint ? (
      <div className="pf-ribbon-shell print:hidden">
        <div className="overflow-x-auto overscroll-x-contain [scrollbar-width:none]">
          <div className="pf-document-toolbar-actions flex min-h-11 flex-row items-center gap-1 px-1.5 py-1 lg:px-3" role="toolbar" aria-label="Acciones del documento de venta">
            {saleToolbarSlot}
          </div>
        </div>
      </div>
    ) : null;

  const openDocChips = (
    <>
      {salesListTabOpen ? (
        <OpenDocChip
          label="Lista de ventas"
          active={onSalesList}
          onOpen={() => navigate("/ventas")}
          onClose={() => {
            setSalesListTabOpen(false);
            if (onSalesList) navigate(saleDocTabOpen ? "/venta" : "/");
          }}
        />
      ) : null}
      {saleDocTabOpen ? (
        <OpenDocChip
          label={onSaleDoc ? saleDocumentTabLabel(location.pathname) : "Venta"}
          active={onSaleDoc}
          onOpen={() => navigate("/venta")}
          onClose={() => {
            setSaleDocTabOpen(false);
            if (onSaleDoc) navigate(salesListTabOpen ? "/ventas" : "/");
          }}
        />
      ) : null}
    </>
  );

  return (
    <SaleDocumentToolbarSetterContext.Provider value={setSaleToolbarSlot}>
      <div className={`relative isolate flex min-h-screen min-h-dvh${hideChromeForPrint ? " print:bg-white" : ""}`}>
        {showAmbient ? <AppAmbient className="print:hidden" /> : null}
        {/* Barra lateral (escritorio) */}
        <aside
          className={`pf-sidebar-shell fixed inset-y-0 left-0 z-30 hidden h-dvh shrink-0 flex-col md:flex print:hidden ${
            sidebarExpanded ? "w-60" : "w-16"
          }`}
        >
          <div className={`flex h-12 shrink-0 items-center border-b border-[color:var(--pf-sidebar-border)] ${sidebarExpanded ? "px-3" : "justify-center px-2"}`}>
            <NavLink
              to="/"
              className="flex min-w-0 items-center rounded-lg outline-none focus-visible:ring-2 focus-visible:ring-pf-primary focus-visible:ring-offset-2"
              aria-label="Ir al inicio"
            >
              {sidebarExpanded ? <BrandLockup size={28} /> : <BrandLogo size={26} />}
            </NavLink>
          </div>

          <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3 [scrollbar-width:thin]">
            <SidebarNav expanded={sidebarExpanded} salesWorkflow={salesWorkflow} onSaleDoc={onSaleDoc} />
          </div>

          <div className="shrink-0 border-t border-[color:var(--pf-sidebar-border)] p-2">
            <button
              type="button"
              onClick={() => setSidebarExpanded((v) => !v)}
              aria-label={sidebarExpanded ? "Contraer menú" : "Expandir menú"}
              title={sidebarExpanded ? "Contraer menú" : "Expandir menú"}
              className={`pf-sidebar-item-idle flex min-h-9 w-full items-center gap-2.5 rounded-lg text-sm font-medium transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-2 focus-visible:outline-[color:var(--pf-primary-mid)] ${
                sidebarExpanded ? "px-3" : "justify-center px-2"
              }`}
            >
              {sidebarExpanded ? (
                <>
                  <ChevronsLeft className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden />
                  <span>Contraer</span>
                </>
              ) : (
                <ChevronsRight className="h-[18px] w-[18px] shrink-0" strokeWidth={1.9} aria-hidden />
              )}
            </button>
          </div>
        </aside>

        <div className={`relative z-10 flex min-w-0 flex-1 flex-col ${sidebarExpanded ? "md:ml-60" : "md:ml-16"}`}>
          {/* Cabecera compacta */}
          <header
            className={`pf-app-shell-header sticky top-0 z-20 print:hidden${hideChromeForPrint ? " print:hidden" : ""}`}
          >
            <div className="flex h-14 items-center gap-2 px-3 md:h-14 md:gap-4 md:px-5">
              <button
                type="button"
                className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-pf-border text-pf-text-secondary transition-colors hover:bg-pf-surface md:hidden"
                onClick={() => setMenuOpen(true)}
                aria-expanded={menuOpen}
                aria-controls="mobile-navigation"
                aria-label="Abrir menú principal"
              >
                <Menu className="h-5 w-5 shrink-0" strokeWidth={1.9} aria-hidden />
              </button>

              <div className="flex min-w-0 flex-1 items-center gap-3">
                <h1 className="min-w-0 shrink-0 truncate text-base font-bold tracking-tight text-pf-text">{title}</h1>
                <div className="hidden min-w-0 items-center gap-1.5 overflow-x-auto [scrollbar-width:none] md:flex">
                  {openDocChips}
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-2">
                <div
                  className="hidden items-center gap-1.5 text-xs font-medium text-pf-text-tertiary lg:flex"
                  title={`${organization?.name ?? ""} · ${branch?.name ?? "Sucursal local"} / ${device?.name ?? "Dispositivo local"}`}
                >
                  <Building2 className="h-3.5 w-3.5 shrink-0 text-pf-muted" strokeWidth={1.9} aria-hidden />
                  <span className="max-w-[150px] truncate">{organization?.name}</span>
                  <span className="text-pf-border-strong" aria-hidden>
                    ·
                  </span>
                  <span className="max-w-[110px] truncate">
                    {branch?.code ?? "LOCAL"}/{device?.code ?? "CAJA"}
                  </span>
                </div>
                <span
                  className={`hidden items-center gap-1.5 text-xs font-semibold xl:inline-flex ${syncInk}`}
                  title={`Estado de sincronización: ${syncLabel}`}
                >
                  <SyncIcon className="h-3.5 w-3.5 shrink-0" strokeWidth={1.9} aria-hidden />
                  {syncLabel}
                </span>
                <OfflineBadge />
                <UserMenu onLock={() => { setScreenLocked(true); setLockPw(""); setLockErr(""); }} onLogout={doLogout} buildVersion={buildVersion} />
              </div>
            </div>

            <div className="flex items-center gap-1.5 overflow-x-auto border-t border-pf-border px-3 py-1.5 [scrollbar-width:none] md:hidden empty:hidden">
              {openDocChips}
            </div>

            {saleToolbarStrip}
          </header>

          <main
            className={`min-w-0 flex-1 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:py-6 md:pb-8 ${
              hideChromeForPrint
                ? "px-4 md:px-6 print:bg-white print:p-4 md:print:px-8"
                : saleDocWideLayout
                  ? "px-2 sm:px-3 md:px-4 lg:px-5"
                  : "px-4 md:px-6"
            }`}
          >
            {children ?? <Outlet />}
          </main>
        </div>

        {/* Menú móvil */}
        {menuOpen ? (
          <div className="fixed inset-0 z-40 md:hidden">
            <button
              type="button"
              className="pf-mobile-menu-scrim absolute inset-0"
              aria-label="Cerrar menú"
              onClick={() => setMenuOpen(false)}
            />
            <aside
              id="mobile-navigation"
              role="dialog"
              aria-modal="true"
              aria-label="Menú principal"
              className="pf-sidebar-shell absolute left-0 top-0 flex h-full w-[min(86vw,17rem)] flex-col pt-[env(safe-area-inset-top)]"
            >
              <div className="flex h-14 shrink-0 items-center justify-between border-b border-[color:var(--pf-sidebar-border)] px-3">
                <BrandLockup size={28} />
                <button
                  type="button"
                  className="inline-flex min-h-11 min-w-11 items-center justify-center rounded-lg border border-pf-border text-pf-text-secondary"
                  onClick={() => setMenuOpen(false)}
                  aria-label="Cerrar"
                >
                  <X className="h-5 w-5" strokeWidth={1.9} aria-hidden />
                </button>
              </div>
              <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-2 py-3">
                <SidebarNav expanded salesWorkflow={salesWorkflow} onNavigate={() => setMenuOpen(false)} onSaleDoc={onSaleDoc} />
              </div>
              <div className="shrink-0 space-y-2 border-t border-[color:var(--pf-sidebar-border)] p-3 pb-[max(0.75rem,env(safe-area-inset-bottom))]">
                <p className="truncate text-xs text-pf-muted">{user?.displayName}</p>
                <Button variant="secondary" className="w-full" onClick={doLogout}>
                  <LogOut className="h-4 w-4 shrink-0" strokeWidth={1.9} aria-hidden />
                  Salir
                </Button>
              </div>
            </aside>
          </div>
        ) : null}

        {screenLocked ? (
          <div className="fixed inset-0 z-[100] flex items-center justify-center bg-[color:var(--pf-modal-scrim-from)] px-4 print:hidden">
            <div className="w-full max-w-sm rounded-[var(--radius-pf)] border border-pf-border bg-pf-surface-elevated p-5 shadow-[var(--pf-shadow-warm-xl)]">
              <p className="text-center text-sm font-bold text-pf-text">Pantalla bloqueada</p>
              <p className="mt-1 text-center text-xs text-pf-muted">Ingrese su contraseña para continuar.</p>
              <input
                type="password"
                autoComplete="current-password"
                className="mt-4 w-full rounded-lg border border-pf-border bg-pf-surface-elevated px-3 py-2.5 text-sm text-pf-text"
                placeholder="Contraseña"
                value={lockPw}
                onChange={(e) => setLockPw(e.target.value)}
                onKeyDown={(e) => {
                  if (e.key === "Enter") void unlockScreen();
                }}
              />
              {lockErr ? <p className="mt-2 text-center text-xs font-medium text-pf-danger">{lockErr}</p> : null}
              <Button type="button" className="mt-4 w-full min-h-11" disabled={lockBusy} onClick={() => void unlockScreen()}>
                {lockBusy ? "Verificando…" : "Desbloquear"}
              </Button>
            </div>
          </div>
        ) : null}
      </div>
    </SaleDocumentToolbarSetterContext.Provider>
  );
}
