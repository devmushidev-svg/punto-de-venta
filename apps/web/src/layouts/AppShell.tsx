import { useEffect, useState, type ReactNode } from "react";
import { SaleDocumentToolbarSetterContext } from "./SaleDocumentToolbarContext";
import type { LucideIcon } from "lucide-react";
import {
  ArrowLeftRight,
  BarChart3,
  Briefcase,
  Building2,
  Cloud,
  CloudOff,
  ClipboardList,
  CreditCard,
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
  UserSquare,
  FileSpreadsheet,
  ShoppingBag,
  SlidersHorizontal,
  CircleHelp,
  Truck,
  User,
  UserCog,
  Users,
  Wallet,
  Warehouse,
  X,
} from "lucide-react";
import { NavLink, Outlet, useLocation, useNavigate } from "react-router-dom";
import { useAuth, type UserInfo } from "../auth/AuthContext";
import { isSaleDocPath, isSaleDocumentPath, isSalesListPath, isVentasModulePath } from "../lib/appUrl";
import { hasPermission, PERMISSION_KEYS, type PermissionKey } from "../lib/permissions";
import { BrandLockup, BrandLogo } from "../components/BrandLogo";
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

type TabId = "inicio" | "facturacion" | "administracion" | "empresa";

type RibbonGroupDef = { title: string; items: NavItem[] };

/** Valores de `general.salesWorkflow` (Settings → Apariencia). */
type SalesWorkflow = "mixed" | "preorder_focus" | "pos_focus";

function normalizeSalesWorkflow(v: unknown): SalesWorkflow {
  if (v === "preorder_focus" || v === "pos_focus" || v === "mixed") return v;
  return "mixed";
}

/** Reordena el grupo Cotizaciones en la cinta Facturación según el manual Smart (PreVenta vs POS). */
function facturacionRibbonOrdered(workflow: SalesWorkflow): RibbonGroupDef[] {
  const base = RIBBON.facturacion;
  if (workflow === "mixed") return base;
  const cotIdx = base.findIndex((g) => g.title === "Cotizaciones");
  if (cotIdx < 0) return base;
  const arr = base.slice();
  const [cotGroup] = arr.splice(cotIdx, 1);
  if (workflow === "preorder_focus") {
    const posIdx = arr.findIndex((g) => g.title === "Punto de venta");
    arr.splice(posIdx >= 0 ? posIdx + 1 : 0, 0, cotGroup);
  } else {
    const cliIdx = arr.findIndex((g) => g.title === "Clientes y prov.");
    if (cliIdx >= 0) arr.splice(cliIdx, 0, cotGroup);
    else arr.push(cotGroup);
  }
  return arr;
}

function ribbonGroupsRaw(tabId: TabId, salesWorkflow: SalesWorkflow): RibbonGroupDef[] {
  if (tabId === "facturacion") return facturacionRibbonOrdered(salesWorkflow);
  return RIBBON[tabId];
}

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: "inicio", label: "Inicio", icon: Home },
  { id: "facturacion", label: "Facturación", icon: ShoppingBag },
  { id: "administracion", label: "Administración", icon: Briefcase },
  { id: "empresa", label: "Empresa", icon: Building2 },
];

/** Cinta agrupada (estilo ERP): título debajo de cada bloque, fichas con icono encima. */
const RIBBON: Record<TabId, RibbonGroupDef[]> = {
  inicio: [],
  facturacion: [
    {
      title: "Punto de venta",
      items: [{ to: "/venta", label: "Nueva venta", icon: PlusCircle, end: true }],
    },
    {
      title: "Ventas",
      items: [
        { to: "/ventas", label: "Lista de ventas", icon: ListOrdered, end: true },
        { to: "/venta/tactil", label: "Venta táctil", icon: LayoutGrid },
        { to: "/cxc", label: "Cuentas por cobrar", icon: Landmark, permission: PERMISSION_KEYS.ACCOUNTS_RECEIVABLE },
        { to: "/reportes", label: "Reportes", icon: BarChart3, permission: PERMISSION_KEYS.REPORTS_VIEW },
      ],
    },
    {
      title: "Productos",
      items: [{ to: "/productos", label: "Productos", icon: Package }],
    },
    {
      title: "Compras",
      items: [
        {
          to: "/compras",
          label: "Compras",
          icon: Truck,
          anyOfPermissions: [PERMISSION_KEYS.PURCHASES_RECORD, PERMISSION_KEYS.PURCHASES_VIEW],
        },
      ],
    },
    {
      title: "Cotizaciones",
      items: [
        { to: "/cotizaciones", label: "Lista cotizaciones", icon: FileText, end: false },
        { to: "/ventas/preventas", label: "PreVentas", icon: ClipboardList, end: false },
      ],
    },
    {
      title: "Traslados",
      items: [{ to: "/traslados", label: "Traslado productos", icon: ArrowLeftRight, permission: PERMISSION_KEYS.INVENTORY_TRANSFERS }],
    },
    {
      title: "Pedidos",
      items: [{ to: "/pedidos-proveedor", label: "Lista de pedidos", icon: PackageSearch }],
    },
    {
      title: "Clientes y prov.",
      items: [
        { to: "/clientes", label: "Clientes", icon: Users },
        { to: "/proveedores", label: "Proveedores", icon: Warehouse },
      ],
    },
  ],
  administracion: [
    {
      title: "Tesorería",
      items: [
        { to: "/caja", label: "Caja", icon: Wallet },
        { to: "/cxp", label: "Cuentas por pagar", icon: CreditCard, permission: PERMISSION_KEYS.ACCOUNTS_PAYABLE },
      ],
    },
    {
      title: "Inventario",
      items: [{ to: "/auditoria-inventario", label: "Auditoría inventario", icon: ScanSearch, admin: true }],
    },
    {
      title: "RRHH",
      items: [
        { to: "/gastos", label: "Gastos", icon: Receipt, adminOrAnyPermission: [PERMISSION_KEYS.EXPENSES_VIEW] },
        { to: "/empleados", label: "Empleados", icon: UserSquare, admin: true },
        { to: "/planillas", label: "Planillas", icon: FileSpreadsheet, adminOrAnyPermission: [PERMISSION_KEYS.PAYROLL_VIEW] },
      ],
    },
    {
      title: "Usuarios",
      items: [{ to: "/usuarios", label: "Usuarios y permisos", icon: UserCog, admin: true }],
    },
  ],
  empresa: [
    {
      title: "Empresa",
      items: [
        { to: "/empresa", label: "Información empresa", icon: Building2 },
        { to: "/ayuda", label: "Ayuda y FAQ", icon: CircleHelp },
      ],
    },
    {
      title: "Configuración",
      items: [{ to: "/configuracion", label: "Configuración general", icon: SlidersHorizontal, admin: true }],
    },
  ],
};

function tabFromPath(pathname: string): TabId {
  if (pathname === "/") return "inicio";
  if (/^\/(empresa|configuracion|ayuda)(\/|$)/.test(pathname)) return "empresa";
  if (/^\/(caja|usuarios|cxp|auditoria-inventario|gastos|empleados|planillas)(\/|$)/.test(pathname)) {
    return "administracion";
  }
  if (isSaleDocumentPath(pathname)) return "facturacion";
  if (isVentasModulePath(pathname)) return "facturacion";
  return "facturacion";
}

function saleDocumentTabLabel(pathname: string): string {
  if (pathname === "/ventas") return "Ventas";
  if (/^\/ventas\/[^/]+\/editar$/.test(pathname)) return "Editar venta";
  if (pathname === "/venta/buscar-producto") return "Buscar producto";
  if (pathname === "/venta/tactil") return "Venta táctil";
  return "Venta";
}

const MAIN_TAB_ROW_BEFORE_ADMIN: TabId[] = ["inicio", "facturacion"];
const MAIN_TAB_ROW_AFTER_SALE_DOC: TabId[] = ["administracion", "empresa"];

const TAB_DEFAULT_PATH: Record<TabId, string> = {
  inicio: "/",
  facturacion: "/productos",
  administracion: "/caja",
  empresa: "/empresa",
};

function primaryTabButtonClasses(isActive: boolean, compact: boolean) {
  const sizing = compact
    ? "gap-1 rounded-md px-2 py-1.5 text-[11px]"
    : "gap-1 rounded-md px-2 py-2 text-xs sm:gap-1.5 sm:px-3 sm:text-sm";

  return `inline-flex shrink-0 items-center font-semibold transition-colors ${sizing} ${
    isActive
      ? "pf-top-tab-active"
      : "pf-top-tab-idle"
  }`;
}

function NavIcon({ icon: Icon, className = "" }: { icon: LucideIcon; className?: string }) {
  return <Icon className={`h-4 w-4 shrink-0 ${className}`.trim()} strokeWidth={2} aria-hidden />;
}

function DesktopRibbonGroup({ title, children }: { title: string; children: ReactNode }) {
  return (
    <div className="pf-ribbon-group flex min-w-0 flex-col pl-2 first:border-l-0 first:pl-0 sm:pl-3">
      <div className="flex flex-row flex-wrap items-stretch gap-0.5 sm:gap-0">{children}</div>
      <p className="pf-ribbon-group-label mt-0.5 pt-0.5 text-center text-[10px] font-medium uppercase tracking-wide sm:text-[11px]">
        {title}
      </p>
    </div>
  );
}

function ribbonTileClassName(isActive: boolean) {
  return `group flex w-[6.25rem] shrink-0 flex-col items-stretch rounded-md border border-transparent p-0.5 transition-colors focus-visible:outline focus-visible:outline-2 focus-visible:outline-offset-1 focus-visible:outline-pf-primary sm:w-[7.25rem] ${
    isActive
      ? "pf-ribbon-tile-active"
      : "pf-ribbon-tile-idle"
  }`;
}

function DesktopRibbonNavTile({ item }: { item: NavItem }) {
  const Icon = item.icon;
  const inner = (
    <div className="flex flex-1 flex-col items-center gap-0.5 pb-1 pt-1.5">
      <span className="pf-ribbon-icon-shell flex size-10 shrink-0 items-center justify-center rounded-md [&>svg]:block [&>svg]:shrink-0">
        <Icon className="!size-5" strokeWidth={2} aria-hidden />
      </span>
      <span className="line-clamp-2 min-h-[2.25rem] w-full px-0.5 text-center text-[10px] font-semibold leading-tight text-pf-text sm:text-[11px]">
        {item.label}
      </span>
    </div>
  );
  return (
    <NavLink to={item.to} end={item.end ?? false} className={({ isActive }) => ribbonTileClassName(isActive)} title={item.label}>
      {inner}
    </NavLink>
  );
}

function RibbonLink({
  item,
  onNavigate,
  stack,
}: {
  item: NavItem;
  onNavigate?: () => void;
  stack?: boolean;
}) {
  const { user } = useAuth();
  if (!canSeeNavItem(user, item)) return null;
  const linkClass = (isActive: boolean) =>
    `${
      stack ? "flex w-full items-center gap-2.5" : "inline-flex shrink-0 items-center gap-2"
    } whitespace-nowrap rounded-xl px-3 py-2.5 text-sm font-medium transition-all duration-200 touch-manipulation md:rounded-md md:py-2 ${
      isActive
        ? "bg-gradient-to-r from-pf-primary-hover via-pf-primary to-[color:var(--pf-nav-pill-warm-to)] text-[color:var(--pf-text-on-brand)] shadow-md md:bg-gradient-to-r md:from-[color:var(--pf-nav-ink-from)] md:via-[color:var(--pf-nav-ink-via)] md:to-[color:var(--pf-nav-ink-to)] md:shadow-none"
        : "text-pf-text-secondary hover:bg-white/60 hover:text-pf-text active:scale-[0.99] md:text-pf-text-tertiary md:hover:bg-[color:var(--pf-surface-muted)]"
    }`;
  return (
    <NavLink
      to={item.to}
      end={item.end ?? false}
      onClick={onNavigate}
      className={({ isActive }) => linkClass(isActive)}
      title={item.label}
    >
      <NavIcon icon={item.icon} />
      {item.label}
    </NavLink>
  );
}

function MobileNavDrawer({ onNavigate, salesWorkflow }: { onNavigate: () => void; salesWorkflow: SalesWorkflow }) {
  const { user } = useAuth();
  return (
    <div className="flex flex-col gap-5 p-3">
      {TABS.map((tab) => {
        const TabIcon = tab.icon;
        if (tab.id === "inicio") {
          return (
            <div key={tab.id}>
              <p className="mb-2 flex items-center gap-2 rounded-lg bg-gradient-to-r from-pf-mint-soft/90 to-pf-sky-soft/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-pf-text-tertiary">
                <TabIcon className="h-3.5 w-3.5 text-pf-info" strokeWidth={2} aria-hidden />
                {tab.label}
              </p>
              <NavLink
                to="/"
                end
                onClick={onNavigate}
                className={({ isActive }) =>
                  `flex items-center gap-2.5 rounded-xl px-3 py-3 text-sm font-semibold touch-manipulation transition-all ${
                    isActive
                      ? "bg-gradient-to-r from-pf-primary-hover to-[color:var(--pf-nav-pill-warm-to)] text-[color:var(--pf-text-on-brand)] shadow-lg"
                      : "text-pf-text-secondary hover:bg-white/70 active:scale-[0.99]"
                  }`
                }
              >
                <Home className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Panel
              </NavLink>
            </div>
          );
        }
        const groups = ribbonGroupsRaw(tab.id, salesWorkflow)
          .map((g) => ({
            title: g.title,
            items: g.items.filter((item) => canSeeNavItem(user, item)),
          }))
          .filter((g) => g.items.length > 0);
        if (groups.length === 0) return null;
        return (
          <div key={tab.id}>
            <p className="mb-2 flex items-center gap-2 rounded-lg bg-gradient-to-r from-pf-mint-soft/90 to-pf-sky-soft/80 px-3 py-2 text-[10px] font-bold uppercase tracking-wider text-pf-text-tertiary">
              <TabIcon className="h-3.5 w-3.5 text-pf-info" strokeWidth={2} aria-hidden />
              {tab.label}
            </p>
            <div className="flex flex-col gap-3">
              {groups.map((g) => (
                <div key={g.title}>
                  <p className="mb-1 text-[10px] font-bold uppercase tracking-wide text-pf-muted">{g.title}</p>
                  <nav className="flex flex-col gap-1">
                    {g.items.map((item) => (
                      <RibbonLink key={item.to + item.label} item={item} onNavigate={onNavigate} stack />
                    ))}
                  </nav>
                </div>
              ))}
            </div>
          </div>
        );
      })}
    </div>
  );
}

export function AppShell({ children }: { children?: ReactNode }) {
  const { token, user, organization, branch, device, logout } = useAuth();
  const location = useLocation();
  const navigate = useNavigate();
  const [menuOpen, setMenuOpen] = useState(false);
  const [screenLocked, setScreenLocked] = useState(false);
  const [lockPw, setLockPw] = useState("");
  const [lockErr, setLockErr] = useState("");
  const [lockBusy, setLockBusy] = useState(false);
  const buildVersion = import.meta.env.VITE_APP_BUILD?.trim() || "";
  const [activeTab, setActiveTab] = useState<TabId>(() => tabFromPath(location.pathname));
  const [saleToolbarSlot, setSaleToolbarSlot] = useState<ReactNode>(null);
  const [salesListTabOpen, setSalesListTabOpen] = useState(false);
  const [saleDocTabOpen, setSaleDocTabOpen] = useState(false);
  const [syncStatus, setSyncStatus] = useState<{
    pendingEvents: number;
    failedEvents: number;
    cloudConfigured: boolean;
    mode: string;
  } | null>(null);

  useEffect(() => {
    if (!token) {
      setSyncStatus(null);
      return;
    }
    let cancelled = false;
    const loadSync = () => {
      apiFetch<{ pendingEvents: number; failedEvents: number; cloudConfigured: boolean; mode: string }>("/api/sync/status", { token })
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

  const [salesWorkflow, setSalesWorkflow] = useState<SalesWorkflow>("mixed");

  useEffect(() => {
    if (!token) return;
    apiFetch<{ general?: { salesWorkflow?: unknown } }>("/api/settings", { token })
      .then((s) => setSalesWorkflow(normalizeSalesWorkflow(s.general?.salesWorkflow)))
      .catch(() => setSalesWorkflow("mixed"));
  }, [token]);

  useEffect(() => {
    setActiveTab(tabFromPath(location.pathname));
    if (isSalesListPath(location.pathname)) setSalesListTabOpen(true);
    if (isSaleDocPath(location.pathname)) setSaleDocTabOpen(true);
  }, [location.pathname]);

  const saleDoc = isSaleDocumentPath(location.pathname);
  const onSalesList = isSalesListPath(location.pathname);
  const onSaleDoc = isSaleDocPath(location.pathname);

  useEffect(() => {
    if (!saleDoc) setSaleToolbarSlot(null);
  }, [saleDoc]);
  const ribbonGroupsFiltered = ribbonGroupsRaw(activeTab, salesWorkflow)
    .map((g) => ({
      title: g.title,
      items: g.items.filter((item) => canSeeNavItem(user, item)),
    }))
    .filter((g) => g.items.length > 0);
  const showRibbon = !saleDoc && activeTab !== "inicio" && ribbonGroupsFiltered.length > 0;
  const hideChromeForPrint = /^\/ventas\/[^/]+\/comprobante$/.test(location.pathname);
  /** Nueva venta / editar / buscar producto: menos margen lateral para aprovechar el monitor. */
  const saleDocWideLayout = isSaleDocPath(location.pathname) && !hideChromeForPrint;

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

  const saleToolbarStrip =
    saleDoc && saleToolbarSlot ? (
      <div className="pf-ribbon-shell">
        <div className="overflow-x-auto [scrollbar-width:thin]">
          <nav
            className="flex min-h-[4.5rem] flex-row items-end gap-0 px-1 py-1 sm:min-h-[4.75rem] sm:px-2 sm:pb-1.5 sm:pt-1 lg:px-3"
            aria-label="Acciones del documento de venta"
          >
            {saleToolbarSlot}
          </nav>
        </div>
      </div>
    ) : null;
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

  return (
    <SaleDocumentToolbarSetterContext.Provider value={setSaleToolbarSlot}>
    <div
      className={`min-h-screen min-h-dvh flex flex-col bg-transparent${hideChromeForPrint ? " print:bg-white" : ""}`}
    >
      {/* Móvil */}
      <header
        className={`pf-mobile-shell-header flex items-center justify-between gap-2 px-3 py-3 md:hidden print:hidden pt-[max(0.35rem,env(safe-area-inset-top))]${hideChromeForPrint ? " print:hidden" : ""}`}
      >
        <div className="flex min-w-0 items-center gap-3">
          <BrandLogo size={40} withShadow className="ring-2 ring-white/80 shadow-lg shadow-[var(--pf-shadow-btn-soft)]" />
          <div className="min-w-0">
            <p className="truncate text-sm font-bold tracking-tight text-pf-text">MultiPOS</p>
            <p className="truncate text-xs font-medium text-pf-text-tertiary">
              {[organization?.name, branch?.code, device?.code].filter(Boolean).join(" / ")}
            </p>
          </div>
        </div>
        <div className="flex shrink-0 items-center gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-xl border border-[var(--pf-glass-border)] bg-[color:var(--pf-surface-overlay)] px-3 py-2.5 text-sm font-semibold text-pf-text-secondary shadow-[var(--pf-shadow-btn-soft)] backdrop-blur-md touch-manipulation"
            onClick={() => {
              setScreenLocked(true);
              setLockPw("");
              setLockErr("");
            }}
            title="Bloquear pantalla"
          >
            <Lock className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          </button>
          <button
            type="button"
            className="inline-flex items-center gap-2 rounded-xl border border-[var(--pf-glass-border)] bg-[color:var(--pf-surface-overlay)] px-3.5 py-2.5 text-sm font-semibold text-pf-text-secondary shadow-[var(--pf-shadow-btn-soft)] backdrop-blur-md transition active:scale-95 touch-manipulation"
            onClick={() => setMenuOpen(true)}
            aria-expanded={menuOpen}
          >
            <Menu className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Menú
          </button>
        </div>
      </header>

      {!hideChromeForPrint ? (
        <div className="pf-top-tabs-mobile-shell md:hidden print:hidden">
          <nav
            className="flex max-w-full items-center gap-0.5 overflow-x-auto px-1 py-1 [scrollbar-width:thin]"
            aria-label="Sección principal"
          >
            {MAIN_TAB_ROW_BEFORE_ADMIN.map((tid) => {
              const tab = TABS.find((t) => t.id === tid)!;
              const TabIcon = tab.icon;
              const staticActive = activeTab === tab.id && !saleDoc;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    navigate(TAB_DEFAULT_PATH[tab.id]);
                  }}
                  className={primaryTabButtonClasses(staticActive, true)}
                >
                  <TabIcon className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  {tab.label}
                </button>
              );
            })}
            {salesListTabOpen ? (
              <div className={`inline-flex shrink-0 items-stretch rounded-md pl-2 pr-0.5 ${onSalesList ? "pf-sale-doc-tab" : "pf-top-tab-idle"}`}>
                <button
                  type="button"
                  onClick={() => navigate("/ventas")}
                  className="inline-flex max-w-[9rem] items-center truncate px-1 py-1.5 text-center text-[11px] font-semibold"
                >
                  Lista de ventas
                </button>
                <button
                  type="button"
                  className="flex items-center rounded-md px-1 text-current hover:bg-white/35"
                  aria-label="Cerrar lista de ventas"
                  onClick={(e) => {
                    e.preventDefault();
                    setSalesListTabOpen(false);
                    if (onSalesList) navigate(saleDocTabOpen ? "/venta" : "/productos");
                  }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ) : null}
            {saleDocTabOpen ? (
              <div className={`inline-flex shrink-0 items-stretch rounded-md pl-2 pr-0.5 ${onSaleDoc ? "pf-sale-doc-tab" : "pf-top-tab-idle"}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (location.pathname === "/venta/buscar-producto") navigate("/venta");
                    else if (!onSaleDoc) navigate("/venta");
                  }}
                  className="inline-flex max-w-[9rem] items-center truncate px-1 py-1.5 text-center text-[11px] font-semibold"
                >
                  {onSaleDoc ? saleDocumentTabLabel(location.pathname) : "Venta"}
                </button>
                <button
                  type="button"
                  className="flex items-center rounded-md px-1 text-current hover:bg-white/35"
                  aria-label="Cerrar documento de venta"
                  onClick={(e) => {
                    e.preventDefault();
                    setSaleDocTabOpen(false);
                    if (onSaleDoc) navigate(salesListTabOpen ? "/ventas" : "/productos");
                  }}
                >
                  <X className="h-3.5 w-3.5" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ) : null}
            {MAIN_TAB_ROW_AFTER_SALE_DOC.map((tid) => {
              const tab = TABS.find((t) => t.id === tid)!;
              const TabIcon = tab.icon;
              const staticActive = activeTab === tab.id && !saleDoc;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    navigate(TAB_DEFAULT_PATH[tab.id]);
                  }}
                  className={primaryTabButtonClasses(staticActive, true)}
                >
                  <TabIcon className="h-3.5 w-3.5 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  {tab.label}
                </button>
              );
            })}
          </nav>
          {saleToolbarStrip}
        </div>
      ) : null}

      {menuOpen ? (
        <div className="fixed inset-0 z-40 md:hidden">
          <button
            type="button"
            className="pf-mobile-menu-scrim absolute inset-0"
            aria-label="Cerrar menú"
            onClick={() => setMenuOpen(false)}
          />
          <aside className="pf-mobile-drawer-shell absolute right-0 top-0 flex h-full w-[min(100%,320px)] flex-col pt-[env(safe-area-inset-top)]">
            <div className="pf-mobile-drawer-head flex items-center justify-between px-4 py-3.5 backdrop-blur-md">
              <span className="pf-drawer-title">Menú</span>
              <button
                type="button"
                className="rounded-xl border border-[var(--pf-border-soft)] bg-[color:var(--pf-surface-overlay)] p-2 text-pf-text-soft shadow-[var(--pf-shadow-btn-soft)] backdrop-blur-sm transition active:scale-95"
                onClick={() => setMenuOpen(false)}
                aria-label="Cerrar"
              >
                <X className="h-5 w-5" strokeWidth={2} />
              </button>
            </div>
            <div className="flex-1 overflow-y-auto overscroll-contain">
              <MobileNavDrawer onNavigate={() => setMenuOpen(false)} salesWorkflow={salesWorkflow} />
            </div>
            <div className="pf-mobile-drawer-foot p-4 pb-[max(0.75rem,env(safe-area-inset-bottom))] space-y-2 backdrop-blur-sm">
              <p className="truncate text-xs text-pf-muted">{user?.displayName}</p>
              <Button
                variant="secondary"
                className="w-full"
                onClick={() => {
                  logout();
                  navigate("/login");
                }}
              >
                <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                Salir
              </Button>
            </div>
          </aside>
        </div>
      ) : null}

      {/* Escritorio */}
      <header
        className={`pf-app-shell-header sticky top-0 z-20 max-md:hidden print:hidden${hideChromeForPrint ? " print:hidden" : ""}`}
      >
        <div className="flex h-11 items-center gap-4 px-3 lg:gap-6 lg:px-5">
          <NavLink
            to="/"
            className="shrink-0 rounded-lg outline-none transition-opacity hover:opacity-90 focus-visible:ring-2 focus-visible:ring-pf-primary focus-visible:ring-offset-2"
          >
            <BrandLockup size={34} />
          </NavLink>

          <nav
            className="pf-top-tabs-shell flex min-w-0 flex-1 items-center gap-0.5 overflow-x-auto rounded-lg px-0.5 py-1 [scrollbar-width:thin] sm:px-1"
            aria-label="Sección principal"
          >
            {MAIN_TAB_ROW_BEFORE_ADMIN.map((tid) => {
              const tab = TABS.find((t) => t.id === tid)!;
              const TabIcon = tab.icon;
              const staticActive = activeTab === tab.id && !saleDoc;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    navigate(TAB_DEFAULT_PATH[tab.id]);
                  }}
                  className={primaryTabButtonClasses(staticActive, false)}
                >
                  <TabIcon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  {tab.label}
                </button>
              );
            })}
            {salesListTabOpen ? (
              <div className={`inline-flex shrink-0 items-stretch rounded-md py-0.5 pl-2 pr-0.5 ${onSalesList ? "pf-sale-doc-tab" : "pf-top-tab-idle"}`}>
                <button
                  type="button"
                  onClick={() => navigate("/ventas")}
                  className="inline-flex max-w-[11rem] items-center truncate px-1 py-1.5 text-xs font-semibold sm:text-sm"
                >
                  Lista de ventas
                </button>
                <button
                  type="button"
                  className="flex items-center rounded-md px-1.5 text-current hover:bg-white/35"
                  aria-label="Cerrar lista de ventas"
                  onClick={(e) => {
                    e.preventDefault();
                    setSalesListTabOpen(false);
                    if (onSalesList) navigate(saleDocTabOpen ? "/venta" : "/productos");
                  }}
                >
                  <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ) : null}
            {saleDocTabOpen ? (
              <div className={`inline-flex shrink-0 items-stretch rounded-md py-0.5 pl-2 pr-0.5 ${onSaleDoc ? "pf-sale-doc-tab" : "pf-top-tab-idle"}`}>
                <button
                  type="button"
                  onClick={() => {
                    if (location.pathname === "/venta/buscar-producto") navigate("/venta");
                    else if (!onSaleDoc) navigate("/venta");
                  }}
                  className="inline-flex max-w-[11rem] items-center truncate px-1 py-1.5 text-xs font-semibold sm:text-sm"
                >
                  {onSaleDoc ? saleDocumentTabLabel(location.pathname) : "Venta"}
                </button>
                <button
                  type="button"
                  className="flex items-center rounded-md px-1.5 text-current hover:bg-white/35"
                  aria-label="Cerrar documento de venta"
                  onClick={(e) => {
                    e.preventDefault();
                    setSaleDocTabOpen(false);
                    if (onSaleDoc) navigate(salesListTabOpen ? "/ventas" : "/productos");
                  }}
                >
                  <X className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                </button>
              </div>
            ) : null}
            {MAIN_TAB_ROW_AFTER_SALE_DOC.map((tid) => {
              const tab = TABS.find((t) => t.id === tid)!;
              const TabIcon = tab.icon;
              const staticActive = activeTab === tab.id && !saleDoc;
              return (
                <button
                  key={tab.id}
                  type="button"
                  onClick={() => {
                    setActiveTab(tab.id);
                    navigate(TAB_DEFAULT_PATH[tab.id]);
                  }}
                  className={primaryTabButtonClasses(staticActive, false)}
                >
                  <TabIcon className="h-4 w-4 shrink-0 opacity-90" strokeWidth={2} aria-hidden />
                  {tab.label}
                </button>
              );
            })}
          </nav>

          <div className="hidden shrink-0 items-center gap-2 text-sm font-medium text-slate-200 lg:flex">
            <Building2 className="h-4 w-4 shrink-0 text-slate-300" strokeWidth={2} aria-hidden />
            <span className="max-w-[160px] truncate" title={organization?.name}>
              {organization?.name}
            </span>
          </div>
          <div
            className="hidden shrink-0 items-center gap-1.5 rounded-lg border border-white/15 bg-white/10 px-2 py-1 text-xs font-semibold text-slate-100 shadow-sm xl:inline-flex"
            title={`${branch?.name ?? "Sucursal local"} / ${device?.name ?? "Dispositivo local"}`}
          >
            <SyncIcon className="h-3.5 w-3.5 shrink-0 text-slate-300" strokeWidth={2} aria-hidden />
            <span className="max-w-[130px] truncate">{branch?.code ?? "LOCAL"} / {device?.code ?? "CAJA"}</span>
            <span className={syncStatus?.failedEvents ? "text-red-300" : syncStatus?.pendingEvents ? "text-amber-300" : "text-emerald-300"}>
              {syncLabel}
            </span>
          </div>
          <div className="flex shrink-0 items-center gap-2 border-l border-white/15 pl-2 lg:pl-3">
            <OfflineBadge />
            {buildVersion ? (
              <span className="hidden text-[10px] font-mono text-pf-text-tertiary xl:inline" title="Versión de compilación">
                {buildVersion}
              </span>
            ) : null}
            <button
              type="button"
              className="inline-flex items-center gap-1 rounded-lg border border-pf-border/60 bg-pf-surface-soft px-2 py-1 text-xs font-semibold text-pf-text-secondary hover:bg-pf-surface-muted"
              title="Bloquear pantalla"
              onClick={() => {
                setScreenLocked(true);
                setLockPw("");
                setLockErr("");
              }}
            >
              <Lock className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
              Bloquear
            </button>
            <span
              className="hidden max-w-[100px] items-center gap-1.5 truncate text-sm text-pf-text-soft min-[1100px]:inline-flex lg:max-w-[120px]"
              title={user?.displayName}
            >
              <User className="h-4 w-4 shrink-0 text-pf-muted" strokeWidth={2} aria-hidden />
              <span className="truncate">{user?.displayName}</span>
            </span>
            <button
              type="button"
              className="inline-flex items-center gap-1.5 text-sm font-medium text-pf-text-soft hover:text-pf-text"
              onClick={() => {
                logout();
                navigate("/login");
              }}
            >
              <LogOut className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Salir
            </button>
          </div>
        </div>

        {saleToolbarStrip}

        {showRibbon ? (
          <div className="pf-ribbon-shell">
            <div className="overflow-x-auto [scrollbar-width:thin]">
              <nav
                className="flex min-h-[4.5rem] flex-row items-end gap-0 px-1 py-1 sm:min-h-[4.75rem] sm:px-2 sm:pb-1.5 sm:pt-1 lg:px-3"
                aria-label={`Accesos ${activeTab}`}
              >
                {ribbonGroupsFiltered.map((g) => (
                  <DesktopRibbonGroup key={g.title} title={g.title}>
                    {g.items.map((item) => (
                      <DesktopRibbonNavTile key={item.to + item.label} item={item} />
                    ))}
                  </DesktopRibbonGroup>
                ))}
              </nav>
            </div>
          </div>
        ) : null}
      </header>

      {screenLocked ? (
        <div className="fixed inset-0 z-[100] flex items-center justify-center bg-stone-900/75 px-4 backdrop-blur-sm print:hidden">
          <div className="w-full max-w-sm rounded-2xl border border-white/20 bg-white p-5 shadow-2xl">
            <p className="text-center text-sm font-bold text-stone-800">Pantalla bloqueada</p>
            <p className="mt-1 text-center text-xs text-stone-500">Ingrese su contraseña para continuar.</p>
            <input
              type="password"
              autoComplete="current-password"
              className="mt-4 w-full rounded-xl border border-stone-200 px-3 py-2.5 text-sm"
              placeholder="Contraseña"
              value={lockPw}
              onChange={(e) => setLockPw(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === "Enter") void unlockScreen();
              }}
            />
            {lockErr ? <p className="mt-2 text-center text-xs font-medium text-red-600">{lockErr}</p> : null}
            <Button type="button" className="mt-4 w-full min-h-11" disabled={lockBusy} onClick={() => void unlockScreen()}>
              {lockBusy ? "Verificando…" : "Desbloquear"}
            </Button>
          </div>
        </div>
      ) : null}

      <div className="flex min-w-0 flex-1 flex-col">
        <main
          className={`flex-1 min-w-0 py-5 pb-[max(1.25rem,env(safe-area-inset-bottom))] md:py-6 md:pb-6 ${
            hideChromeForPrint
              ? "px-4 md:px-6 print:p-4 print:bg-white md:print:px-8"
              : saleDocWideLayout
                ? "px-2 sm:px-3 md:px-4 lg:px-5 xl:px-6 2xl:px-8"
                : "px-4 md:px-6"
          }`}
        >
          {children ?? <Outlet />}
        </main>
      </div>
    </div>
    </SaleDocumentToolbarSetterContext.Provider>
  );
}
