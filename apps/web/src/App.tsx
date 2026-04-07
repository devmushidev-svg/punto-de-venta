import { lazy, Suspense, type ReactNode } from "react";
import { Navigate, Route, Routes } from "react-router-dom";
import { useAuth } from "./auth/AuthContext";
import { AppShell } from "./layouts/AppShell";
import { SalesHubLayout } from "./layouts/SalesHubLayout";
import { hasPermission, PERMISSION_KEYS, type PermissionKey } from "./lib/permissions";
import { HelpPage } from "./pages/HelpPage";
import { LoginPage } from "./pages/LoginPage";
import { PublicHelpPage } from "./pages/PublicHelpPage";

const DashboardPage = lazy(() => import("./pages/DashboardPage").then((m) => ({ default: m.DashboardPage })));
const ProductsPage = lazy(() => import("./pages/ProductsPage").then((m) => ({ default: m.ProductsPage })));
const NewSalePage = lazy(() => import("./pages/NewSalePage").then((m) => ({ default: m.NewSalePage })));
const SaleProductSearchPage = lazy(() =>
  import("./pages/SaleProductSearchPage").then((m) => ({ default: m.SaleProductSearchPage }))
);
const TouchSalePage = lazy(() => import("./pages/TouchSalePage").then((m) => ({ default: m.TouchSalePage })));
const QuotesListPage = lazy(() => import("./pages/QuotesListPage").then((m) => ({ default: m.QuotesListPage })));
const NewQuotePage = lazy(() => import("./pages/NewQuotePage").then((m) => ({ default: m.NewQuotePage })));
const SupplierOrdersPage = lazy(() => import("./pages/SupplierOrdersPage").then((m) => ({ default: m.SupplierOrdersPage })));
const StockTransfersPage = lazy(() => import("./pages/StockTransfersPage").then((m) => ({ default: m.StockTransfersPage })));
const InventoryAuditPage = lazy(() => import("./pages/InventoryAuditPage").then((m) => ({ default: m.InventoryAuditPage })));
const ExpensesPage = lazy(() => import("./pages/ExpensesPage").then((m) => ({ default: m.ExpensesPage })));
const EmployeesPage = lazy(() => import("./pages/EmployeesPage").then((m) => ({ default: m.EmployeesPage })));
const PayrollPage = lazy(() => import("./pages/PayrollPage").then((m) => ({ default: m.PayrollPage })));
const SalesPage = lazy(() => import("./pages/SalesPage").then((m) => ({ default: m.SalesPage })));
const SaleTicketPage = lazy(() => import("./pages/SaleTicketPage").then((m) => ({ default: m.SaleTicketPage })));
const SaleComprobantePage = lazy(() => import("./pages/SaleComprobantePage").then((m) => ({ default: m.SaleComprobantePage })));
const CustomersPage = lazy(() => import("./pages/CustomersPage").then((m) => ({ default: m.CustomersPage })));
const PurchasesPage = lazy(() => import("./pages/PurchasesPage").then((m) => ({ default: m.PurchasesPage })));
const SuppliersPage = lazy(() => import("./pages/SuppliersPage").then((m) => ({ default: m.SuppliersPage })));
const CashPage = lazy(() => import("./pages/CashPage").then((m) => ({ default: m.CashPage })));
const AccountsReceivablePage = lazy(() =>
  import("./pages/AccountsReceivablePage").then((m) => ({ default: m.AccountsReceivablePage }))
);
const AccountsPayablePage = lazy(() =>
  import("./pages/AccountsPayablePage").then((m) => ({ default: m.AccountsPayablePage }))
);
const ReportsPage = lazy(() => import("./pages/ReportsPage").then((m) => ({ default: m.ReportsPage })));
const SettingsPage = lazy(() => import("./pages/SettingsPage").then((m) => ({ default: m.SettingsPage })));
const CompanyInfoPage = lazy(() => import("./pages/CompanyInfoPage").then((m) => ({ default: m.CompanyInfoPage })));
const UsersPage = lazy(() => import("./pages/UsersPage").then((m) => ({ default: m.UsersPage })));
function RouteFallback() {
  return (
    <div className="flex min-h-[50vh] items-center justify-center text-sm text-pf-muted" aria-busy="true">
      Cargando vista…
    </div>
  );
}

function Protected({ children }: { children: ReactNode }) {
  const { token, loading } = useAuth();
  if (loading) {
    return (
      <div className="min-h-screen flex items-center justify-center bg-pf-surface text-pf-muted">
        Cargando…
      </div>
    );
  }
  if (!token) return <Navigate to="/login" replace />;
  return <>{children}</>;
}

function RequirePermission({ permission, children }: { permission: PermissionKey; children: ReactNode }) {
  const { user } = useAuth();
  if (!hasPermission(user, permission)) return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAdmin({ children }: { children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role !== "admin") return <Navigate to="/" replace />;
  return <>{children}</>;
}

function RequireAnyPermission({ permissions, children }: { permissions: PermissionKey[]; children: ReactNode }) {
  const { user } = useAuth();
  const ok = permissions.some((p) => hasPermission(user, p));
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}

/** Administrador o al menos uno de los permisos (p. ej. RH solo lectura). */
function RequireAdminOrAnyPermission({ permissions, children }: { permissions: PermissionKey[]; children: ReactNode }) {
  const { user } = useAuth();
  if (user?.role === "admin") return <>{children}</>;
  const ok = permissions.some((p) => hasPermission(user, p));
  if (!ok) return <Navigate to="/" replace />;
  return <>{children}</>;
}

export default function App() {
  return (
    <Routes>
      <Route path="/ayuda-publica" element={<PublicHelpPage />} />
      <Route path="/login" element={<LoginPage />} />
      <Route
        path="/"
        element={
          <Protected>
            <Suspense fallback={<RouteFallback />}>
              <AppShell />
            </Suspense>
          </Protected>
        }
      >
        <Route index element={<DashboardPage />} />
        <Route path="productos" element={<ProductsPage />} />
        <Route path="venta" element={<NewSalePage />} />
        <Route path="venta/buscar-producto" element={<SaleProductSearchPage />} />
        <Route
          path="ventas/:id/editar"
          element={
            <RequireAdmin>
              <NewSalePage />
            </RequireAdmin>
          }
        />
        <Route path="venta/tactil" element={<TouchSalePage />} />
        <Route path="venta/preventas" element={<Navigate to="/ventas/preventas" replace />} />
        <Route path="venta/preventas/nueva" element={<Navigate to="/ventas/preventas/nueva" replace />} />
        <Route path="cotizaciones" element={<QuotesListPage variant="full" />} />
        <Route path="cotizaciones/nueva" element={<NewQuotePage backTo="/cotizaciones" titleNew="Nueva cotización" />} />
        <Route
          path="cotizaciones/:quoteId/editar"
          element={<NewQuotePage backTo="/cotizaciones" titleNew="Nueva cotización" titleEdit="Editar cotización" />}
        />
        <Route path="pedidos-proveedor" element={<SupplierOrdersPage />} />
        <Route path="traslados" element={<StockTransfersPage />} />
        <Route path="ventas" element={<SalesPage />} />
        <Route path="ventas/preventas" element={<SalesHubLayout />}>
          <Route index element={<QuotesListPage variant="preventas" />} />
          <Route
            path="nueva"
            element={<NewQuotePage backTo="/ventas/preventas" titleNew="Nueva PreVenta" />}
          />
          <Route
            path=":quoteId/editar"
            element={
              <NewQuotePage backTo="/ventas/preventas" titleNew="Nueva PreVenta" titleEdit="Editar PreVenta" />
            }
          />
        </Route>
        <Route path="ventas/:id/comprobante" element={<SaleComprobantePage />} />
        <Route path="ventas/:id/ticket" element={<SaleTicketPage />} />
        <Route path="clientes" element={<CustomersPage />} />
        <Route
          path="compras"
          element={
            <RequireAnyPermission
              permissions={[PERMISSION_KEYS.PURCHASES_RECORD, PERMISSION_KEYS.PURCHASES_VIEW]}
            >
              <PurchasesPage />
            </RequireAnyPermission>
          }
        />
        <Route path="proveedores" element={<SuppliersPage />} />
        <Route path="caja" element={<CashPage />} />
        <Route
          path="cxc"
          element={
            <RequirePermission permission={PERMISSION_KEYS.ACCOUNTS_RECEIVABLE}>
              <AccountsReceivablePage />
            </RequirePermission>
          }
        />
        <Route
          path="cxp"
          element={
            <RequirePermission permission={PERMISSION_KEYS.ACCOUNTS_PAYABLE}>
              <AccountsPayablePage />
            </RequirePermission>
          }
        />
        <Route path="reportes" element={<ReportsPage />} />
        <Route path="auditoria-inventario" element={<InventoryAuditPage />} />
        <Route
          path="gastos"
          element={
            <RequireAdminOrAnyPermission permissions={[PERMISSION_KEYS.EXPENSES_VIEW]}>
              <ExpensesPage />
            </RequireAdminOrAnyPermission>
          }
        />
        <Route path="empleados" element={<EmployeesPage />} />
        <Route
          path="planillas"
          element={
            <RequireAdminOrAnyPermission permissions={[PERMISSION_KEYS.PAYROLL_VIEW]}>
              <PayrollPage />
            </RequireAdminOrAnyPermission>
          }
        />
        <Route path="configuracion" element={<SettingsPage />} />
        <Route path="ayuda" element={<HelpPage />} />
        <Route path="empresa" element={<CompanyInfoPage />} />
        <Route path="usuarios" element={<UsersPage />} />
      </Route>
      <Route path="*" element={<Navigate to="/" replace />} />
    </Routes>
  );
}
