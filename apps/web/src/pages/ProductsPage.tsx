import { FilterX, History, PackagePlus, Pencil, Plus, RefreshCw, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useState } from "react";
import { PageHero } from "../components/PageHero";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { Button, Card, Field, Input, Modal, Select, Textarea } from "../components/ui";
import { formatMoney } from "../lib/format";
import { parseVolumePricesJson } from "../lib/volumePrice";
import type { Product, ProductMovement, Supplier } from "../types";

const PRODUCT_TYPES = ["PRODUCTO", "SERVICIO", "INSUMO", "KIT"] as const;

type FormTab = "product" | "prices" | "notes" | "kit";

type KitRow = { componentId: string; sku: string; name: string; qty: string };

type VolumeTierRow = { minQty: string; price: string };

const emptyForm = {
  sku: "",
  name: "",
  description: "",
  unit: "UNIDAD",
  price: "",
  price2: "",
  price3: "",
  price4: "",
  cost: "",
  taxPercent: "15",
  stock: "0",
  minStock: "0",
  category: "",
  barcode: "",
  quickCode: "",
  location: "GENERAL",
  brand: "",
  imageUrl: "",
  productType: "PRODUCTO",
  supplierId: "",
  esGranel: false,
  volumeTiers: [] as VolumeTierRow[],
};

export function ProductsPage() {
  const { token, user, organization } = useAuth();
  const sym = organization?.currencySymbol ?? "L";
  const admin = user?.role === "admin";
  const [q, setQ] = useState("");
  const [stockFilter, setStockFilter] = useState<"" | "with" | "without">("");
  const [supplierId, setSupplierId] = useState("");
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [list, setList] = useState<Product[]>([]);
  const [loading, setLoading] = useState(true);
  const [modal, setModal] = useState<"new" | "edit" | null>(null);
  const [formTab, setFormTab] = useState<FormTab>("product");
  const [editing, setEditing] = useState<Product | null>(null);
  const [form, setForm] = useState(emptyForm);
  const [kitRows, setKitRows] = useState<KitRow[]>([]);
  const [kitPickSearch, setKitPickSearch] = useState("");
  const [kitPickHits, setKitPickHits] = useState<Product[]>([]);
  const [err, setErr] = useState("");
  const [movementsFor, setMovementsFor] = useState<Product | null>(null);
  const [movements, setMovements] = useState<ProductMovement[]>([]);
  const [movementsLoading, setMovementsLoading] = useState(false);
  const [movementsErr, setMovementsErr] = useState("");

  useEffect(() => {
    if (!token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then(setSuppliers).catch(() => setSuppliers([]));
  }, [token]);

  const load = useCallback(async () => {
    if (!token) return;
    setLoading(true);
    try {
      const params = new URLSearchParams();
      if (q.trim()) params.set("q", q.trim());
      if (stockFilter) params.set("stock", stockFilter);
      if (supplierId) params.set("supplierId", supplierId);
      const qs = params.toString();
      const path = `/api/products${qs ? `?${qs}` : ""}`;
      const data = await apiFetch<Product[]>(path, { token });
      setList(data);
    } catch {
      setList([]);
    } finally {
      setLoading(false);
    }
  }, [token, q, stockFilter, supplierId]);

  useEffect(() => {
    const t = setTimeout(load, 250);
    return () => clearTimeout(t);
  }, [load]);

  useEffect(() => {
    if (!token || !movementsFor?.id) return;
    let cancelled = false;
    setMovementsLoading(true);
    setMovementsErr("");
    apiFetch<{ movements: ProductMovement[] }>(`/api/products/${movementsFor.id}/movements?limit=100`, { token })
      .then((r) => {
        if (!cancelled) setMovements(r.movements);
      })
      .catch((e) => {
        if (!cancelled) setMovementsErr(e instanceof Error ? e.message : "Error");
      })
      .finally(() => {
        if (!cancelled) setMovementsLoading(false);
      });
    return () => {
      cancelled = true;
    };
  }, [token, movementsFor?.id]);

  useEffect(() => {
    if (formTab === "kit" && form.productType !== "KIT") setFormTab("product");
  }, [form.productType, formTab]);

  useEffect(() => {
    if (!token || modal !== "edit" || !editing?.id) return;
    let cancelled = false;
    apiFetch<Product>(`/api/products/${editing.id}`, { token })
      .then((full) => {
        if (cancelled) return;
        if (full.productType === "KIT" && full.kitLines?.length) {
          setKitRows(
            full.kitLines.map((kl) => ({
              componentId: kl.componentProductId,
              sku: kl.component.sku,
              name: kl.component.name,
              qty: String(kl.qty),
            }))
          );
        } else {
          setKitRows([]);
        }
      })
      .catch(() => {});
    return () => {
      cancelled = true;
    };
  }, [token, modal, editing?.id]);

  const runKitPickSearch = useCallback(async () => {
    if (!token || !kitPickSearch.trim()) {
      setKitPickHits([]);
      return;
    }
    try {
      const data = await apiFetch<Product[]>(`/api/products?q=${encodeURIComponent(kitPickSearch.trim())}`, { token });
      const curId = editing?.id;
      setKitPickHits(
        data
          .filter(
            (p) =>
              p.active &&
              p.productType === "PRODUCTO" &&
              p.id !== curId &&
              !kitRows.some((r) => r.componentId === p.id)
          )
          .slice(0, 14)
      );
    } catch {
      setKitPickHits([]);
    }
  }, [token, kitPickSearch, editing?.id, kitRows]);

  useEffect(() => {
    const t = setTimeout(runKitPickSearch, 200);
    return () => clearTimeout(t);
  }, [runKitPickSearch]);

  function closeModal() {
    setModal(null);
    setKitPickSearch("");
    setKitPickHits([]);
  }

  function closeMovementsModal() {
    setMovementsFor(null);
    setMovements([]);
    setMovementsErr("");
  }

  function clearFilters() {
    setQ("");
    setStockFilter("");
    setSupplierId("");
  }

  function openNew() {
    setForm(emptyForm);
    setKitRows([]);
    setKitPickSearch("");
    setKitPickHits([]);
    setEditing(null);
    setFormTab("product");
    setErr("");
    setModal("new");
  }

  function openEdit(p: Product) {
    setEditing(p);
    setKitRows([]);
    setForm({
      sku: p.sku,
      name: p.name,
      description: p.description ?? "",
      unit: p.unit,
      price: String(p.price),
      price2: p.price2 != null ? String(p.price2) : "",
      price3: p.price3 != null ? String(p.price3) : "",
      price4: p.price4 != null ? String(p.price4) : "",
      cost: String(p.cost),
      taxPercent: String(p.taxPercent),
      stock: String(p.stock),
      minStock: String(p.minStock),
      category: p.category ?? "",
      barcode: p.barcode ?? "",
      quickCode: p.quickCode ?? "",
      location: p.location ?? "GENERAL",
      brand: p.brand ?? "",
      imageUrl: p.imageUrl ?? "",
      productType: p.productType || "PRODUCTO",
      supplierId: p.supplierId ?? "",
      esGranel: Boolean(p.esGranel),
      volumeTiers: parseVolumePricesJson(p.volumePricesJson).map((t) => ({
        minQty: String(t.minQty),
        price: String(t.price),
      })),
    });
    setFormTab("product");
    setErr("");
    setModal("edit");
  }

  async function save() {
    if (!token) return;
    setErr("");
    if (form.productType === "KIT") {
      if (kitRows.length === 0) {
        setErr("Agregue al menos un producto al combo (tipo PRODUCTO).");
        return;
      }
      for (const r of kitRows) {
        const q = Number(r.qty);
        if (!Number.isFinite(q) || q <= 0) {
          setErr("Cada componente debe tener cantidad mayor a cero.");
          return;
        }
      }
    }
    const payload = {
      sku: form.sku.trim(),
      name: form.name.trim(),
      description: form.description || undefined,
      unit: form.unit || "UND",
      price: Number(form.price),
      price2: form.price2 === "" ? undefined : Number(form.price2),
      price3: form.price3 === "" ? undefined : Number(form.price3),
      price4: form.price4 === "" ? undefined : Number(form.price4),
      cost: Number(form.cost),
      taxPercent: Number(form.taxPercent),
      stock: Number(form.stock),
      minStock: Number(form.minStock),
      category: form.category || undefined,
      barcode: form.barcode || undefined,
      quickCode: form.quickCode || undefined,
      location: form.location || undefined,
      brand: form.brand || undefined,
      imageUrl: form.imageUrl || undefined,
      productType: form.productType,
      supplierId: form.supplierId || null,
      esGranel: form.esGranel,
      volumePricesJson: JSON.stringify(
        form.volumeTiers
          .map((r) => ({ minQty: Number(r.minQty), price: Number(r.price) }))
          .filter(
            (t) =>
              Number.isFinite(t.minQty) &&
              t.minQty > 0 &&
              Number.isFinite(t.price) &&
              t.price >= 0
          )
          .sort((a, b) => a.minQty - b.minQty)
      ),
      ...(form.productType === "KIT"
        ? {
            kitLines: kitRows.map((r) => ({
              productId: r.componentId,
              qty: Number(r.qty),
            })),
          }
        : {}),
    };
    try {
      if (modal === "new") {
        await apiFetch("/api/products", { method: "POST", body: JSON.stringify(payload), token });
      } else if (editing) {
        await apiFetch(`/api/products/${editing.id}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
          token,
        });
      }
      closeModal();
      load();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error");
    }
  }

  const tabBtn = (id: FormTab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFormTab(id)}
      className={`-mb-px px-3 py-2 text-sm rounded-t-md transition-colors ${
        formTab === id
          ? "border-b-2 border-pf-text font-semibold text-pf-text tracking-tight"
          : "font-medium text-pf-muted hover:bg-[color:var(--pf-surface-soft)] hover:text-pf-text-secondary"
      }`}
    >
      {label}
    </button>
  );

  return (
    <div className="flex min-h-0 flex-col space-y-3 pf-safe-page sm:space-y-4">
      <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
        <PageHero title="Productos" constrained>
          <p className="pf-page-lead">
            Qué es: catálogo de artículos y servicios con existencias, precios (hasta cuatro listas), tipo (producto,
            servicio, insumo, combo) y datos para venta y compras.
          </p>
          <p className="pf-page-lead-muted">
            Use filtros y la tabla para localizar ítems; el administrador crea y edita desde el modal. Los movimientos de
            stock se consultan en Historial.
            {!admin ? " Usted puede buscar y consultar; alta y edición son del administrador." : null}
          </p>
        </PageHero>
        {admin ? (
          <Button type="button" onClick={openNew} className="min-h-[52px] w-full shrink-0 shadow-lg sm:w-auto sm:min-h-[48px]">
            <PackagePlus className="h-5 w-5 shrink-0 sm:h-4 sm:w-4" strokeWidth={2} aria-hidden />
            Nuevo producto
          </Button>
        ) : null}
      </div>

      <Card className="space-y-2.5 p-3 sm:p-3.5">
        <div className="grid gap-2 sm:gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <Input
            placeholder="Buscar nombre, SKU, código de barras o rápido…"
            value={q}
            onChange={(e) => setQ(e.target.value)}
            aria-label="Buscar productos"
          />
          <Select
            value={stockFilter}
            onChange={(e) => setStockFilter(e.target.value as "" | "with" | "without")}
            aria-label="Filtrar por existencia"
          >
            <option value="">Todas las existencias</option>
            <option value="with">Con existencia</option>
            <option value="without">Sin existencia</option>
          </Select>
          <Select
            value={supplierId}
            onChange={(e) => setSupplierId(e.target.value)}
            aria-label="Proveedor"
          >
            <option value="">Todos los proveedores</option>
            {suppliers.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </Select>
          <div className="flex flex-wrap items-center gap-2">
            <Button type="button" variant="secondary" className="min-h-[48px] sm:min-h-10" onClick={clearFilters}>
              <FilterX className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Limpiar
            </Button>
            <Button type="button" variant="secondary" className="min-h-[48px] sm:min-h-10" onClick={() => load()}>
              <RefreshCw className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
              Actualizar
            </Button>
          </div>
        </div>
        <p className="text-xs font-medium text-pf-text-soft">
          Mostrando <span className="font-bold text-pf-text">{list.length}</span> producto(s)
        </p>
      </Card>

      <Card className="pf-table-shell min-h-0 flex-1 overflow-hidden p-0">
        {loading ? (
          <p className="p-4 text-center font-medium text-pf-muted">Cargando…</p>
        ) : (
          <div className="max-h-[min(520px,calc(100vh-15rem))] overflow-auto overscroll-contain rounded-2xl md:rounded-none">
            <table className="w-full min-w-[980px] border-collapse text-sm">
            <thead className="sticky top-0 z-[1]">
              <tr className="pf-table-thead text-left">
                <th className="p-2 font-semibold">Código</th>
                <th className="p-2 font-semibold">Descripción</th>
                <th className="p-2 font-semibold">Und.</th>
                <th className="p-2 font-semibold text-right">Exist.</th>
                <th className="p-2 font-semibold text-right">Precio</th>
                <th className="p-2 font-semibold">Categoría</th>
                <th className="p-2 font-semibold">Ubic.</th>
                <th className="p-2 font-semibold">Cód. rápido</th>
                <th className="p-2 font-semibold text-right">ISV %</th>
                <th className="p-2 font-semibold">Tipo</th>
                <th className="p-2 font-semibold">Granel</th>
                <th className="p-2 w-24 font-semibold">Historial</th>
                {admin ? <th className="p-2 w-20" /> : null}
              </tr>
            </thead>
            <tbody className="pf-table-body">
              {list.map((p) => (
                <tr
                  key={p.id}
                  className="pf-table-row pf-table-row-hoverable"
                >
                  <td className="p-2 font-mono text-xs">{p.sku}</td>
                  <td className="p-2 max-w-[220px]">
                    <span className={p.active ? "" : "text-pf-muted line-through"}>{p.name}</span>
                    {p.barcode ? <span className="block text-[10px] text-pf-muted">BC {p.barcode}</span> : null}
                  </td>
                  <td className="p-2">{p.unit}</td>
                  <td className="p-2 text-right font-medium">{p.stock}</td>
                  <td className="p-2 text-right whitespace-nowrap">{formatMoney(sym, p.price)}</td>
                  <td className="p-2 truncate max-w-[100px]">{p.category ?? "—"}</td>
                  <td className="p-2 truncate max-w-[80px]">{p.location ?? "—"}</td>
                  <td className="p-2 font-mono text-xs">{p.quickCode ?? "—"}</td>
                  <td className="p-2 text-right">{p.taxPercent}%</td>
                  <td className="p-2 text-xs">{p.productType}</td>
                  <td className="p-2 text-xs">{p.esGranel ? "Sí" : "—"}</td>
                  <td className="p-2">
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-0 py-1 px-2 text-xs"
                      onClick={() => setMovementsFor(p)}
                      aria-label={`Movimientos de ${p.name}`}
                    >
                      <History className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                      Mov.
                    </Button>
                  </td>
                  {admin ? (
                    <td className="p-2">
                      <Button type="button" variant="ghost" className="min-h-0 py-1 px-2" onClick={() => openEdit(p)}>
                        <Pencil className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                        Editar
                      </Button>
                    </td>
                  ) : null}
                </tr>
              ))}
            </tbody>
          </table>
          </div>
        )}
      </Card>

      <Modal
        open={movementsFor !== null}
        title={movementsFor ? `Movimientos: ${movementsFor.name}` : "Movimientos"}
        onClose={closeMovementsModal}
        wide
      >
        {movementsLoading ? (
          <p className="text-sm text-pf-muted py-6 text-center">Cargando historial…</p>
        ) : movementsErr ? (
          <p className="text-sm text-red-600">{movementsErr}</p>
        ) : movements.length === 0 ? (
          <p className="text-sm text-pf-muted py-4">No hay movimientos registrados para este producto.</p>
        ) : (
          <div className="pf-table-shell max-h-[min(60vh,420px)] overflow-y-auto overflow-x-auto rounded-lg">
            <table className="w-full min-w-[640px] text-sm">
              <thead className="sticky top-0 z-10">
                <tr className="pf-table-thead text-left">
                  <th className="p-2 font-semibold">Fecha</th>
                  <th className="p-2 font-semibold">Tipo</th>
                  <th className="p-2 font-semibold text-right">Cambio</th>
                  <th className="p-2 font-semibold">Ref.</th>
                  <th className="p-2 font-semibold">Detalle</th>
                  <th className="p-2 font-semibold">Usuario</th>
                </tr>
              </thead>
              <tbody className="pf-table-body">
                {movements.map((m, i) => (
                  <tr key={`${m.at}-${m.ref}-${i}`} className="pf-table-row pf-table-row-hoverable">
                    <td className="p-2 text-xs whitespace-nowrap">
                      {new Date(m.at).toLocaleString("es-HN", { dateStyle: "short", timeStyle: "short" })}
                    </td>
                    <td className="p-2 text-xs">{m.typeLabel}</td>
                    <td
                      className={`p-2 text-right font-mono tabular-nums font-medium ${
                        m.qtyDelta > 0 ? "text-pf-success" : m.qtyDelta < 0 ? "text-pf-danger" : ""
                      }`}
                    >
                      {m.qtyDelta > 0 ? "+" : ""}
                      {m.qtyDelta}
                    </td>
                    <td className="p-2 text-xs font-mono">{m.ref}</td>
                    <td className="p-2 text-xs text-pf-muted max-w-[200px]">{m.detail}</td>
                    <td className="p-2 text-xs text-pf-muted">{m.userName ?? "—"}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        )}
        <div className="mt-3 flex justify-end">
          <Button type="button" variant="secondary" onClick={closeMovementsModal}>
            Cerrar
          </Button>
        </div>
      </Modal>

      <Modal
        open={modal !== null}
        title={modal === "new" ? "Nuevo producto" : "Editar producto"}
        onClose={closeModal}
        wide
      >
        <nav className="mb-4 flex flex-wrap gap-1 border-b border-[var(--pf-border-soft)] pb-px" aria-label="Secciones del producto">
          {tabBtn("product", "Producto")}
          {tabBtn("prices", "Precios")}
          {form.productType === "KIT" ? tabBtn("kit", "Combo") : null}
          {tabBtn("notes", "Notas")}
        </nav>

        {formTab === "product" ? (
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Código (SKU)">
              <Input value={form.sku} onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))} />
            </Field>
            <Field label="Código de barras">
              <Input value={form.barcode} onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))} />
            </Field>
            <Field label="Código rápido">
              <Input value={form.quickCode} onChange={(e) => setForm((f) => ({ ...f, quickCode: e.target.value }))} />
            </Field>
            <Field label="Tipo">
              <Select
                value={form.productType}
                onChange={(e) => {
                  const v = e.target.value;
                  setForm((f) => ({
                    ...f,
                    productType: v,
                    stock: v === "KIT" ? "0" : f.stock,
                    esGranel: v === "KIT" ? false : f.esGranel,
                  }));
                  if (v !== "KIT") setKitRows([]);
                }}
              >
                {PRODUCT_TYPES.map((t) => (
                  <option key={t} value={t}>
                    {t}
                  </option>
                ))}
              </Select>
            </Field>
            {form.productType !== "KIT" ? (
              <label className="flex items-center gap-2 sm:col-span-2 cursor-pointer">
                <input
                  type="checkbox"
                  checked={form.esGranel}
                  onChange={(e) => setForm((f) => ({ ...f, esGranel: e.target.checked }))}
                  className="h-4 w-4 rounded border-pf-border"
                />
                <span className="text-sm font-medium text-pf-text-secondary">
                  Venta a granel (cantidades decimales en venta táctil)
                </span>
              </label>
            ) : (
              <p className="sm:col-span-2 text-xs text-pf-muted">
                KIT / combo: precio e ISV de la línea; el inventario se descuenta de cada componente (solo productos tipo
                PRODUCTO).
              </p>
            )}
            <Field label="Nombre" className="sm:col-span-2">
              <Input value={form.name} onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))} />
            </Field>
            <Field label="Unidad de medida">
              <Input value={form.unit} onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))} />
            </Field>
            <Field label="Proveedor">
              <Select
                value={form.supplierId}
                onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
              >
                <option value="">— Ninguno —</option>
                {suppliers.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name}
                  </option>
                ))}
              </Select>
            </Field>
            <Field label="Costo">
              <Input
                type="number"
                step="any"
                value={form.cost}
                onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
              />
            </Field>
            <Field label="ISV %">
              <Input
                type="number"
                step="any"
                value={form.taxPercent}
                onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))}
              />
            </Field>
            <Field label="Precio venta (lista 1)">
              <Input
                type="number"
                step="any"
                value={form.price}
                onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
              />
            </Field>
            <Field label="Existencia actual">
              <Input
                type="number"
                step="any"
                value={form.productType === "KIT" ? "0" : form.stock}
                readOnly={form.productType === "KIT"}
                className={form.productType === "KIT" ? "bg-pf-surface-muted text-pf-muted" : undefined}
                onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
              />
            </Field>
            <Field label="Existencia mínima">
              <Input
                type="number"
                step="any"
                value={form.minStock}
                onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))}
              />
            </Field>
            <Field label="Categoría">
              <Input value={form.category} onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))} />
            </Field>
            <Field label="Ubicación en bodega">
              <Input value={form.location} onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))} />
            </Field>
            <Field label="Marca">
              <Input value={form.brand} onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))} />
            </Field>
            <Field label="URL imagen" className="sm:col-span-2">
              <Input value={form.imageUrl} onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))} />
            </Field>
            {form.imageUrl ? (
              <div className="sm:col-span-2 flex justify-center">
                <img
                  src={form.imageUrl}
                  alt=""
                  className="max-h-32 rounded-lg border border-pf-border object-contain"
                />
              </div>
            ) : null}
            <p className="sm:col-span-2 text-xs text-pf-muted">
              SERVICIO: no descuenta inventario. INSUMO: no aparece en ventas POS. KIT: defina componentes en la pestaña «Combo».
            </p>
          </div>
        ) : null}

        {formTab === "prices" ? (
          <div className="space-y-4">
            <p className="text-sm text-pf-muted">
              Cuatro listas de precio (1–4). Si define tramos por cantidad, en venta se usa el precio del mayor mínimo
              alcanzado; si la cantidad no alcanza ningún mínimo, se aplica la lista elegida en la factura.
            </p>
            <div className="grid gap-3 sm:grid-cols-2">
              <Field label="Precio 1 (principal)">
                <Input
                  type="number"
                  step="any"
                  value={form.price}
                  onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                />
              </Field>
              <Field label="Precio 2">
                <Input
                  type="number"
                  step="any"
                  value={form.price2}
                  onChange={(e) => setForm((f) => ({ ...f, price2: e.target.value }))}
                />
              </Field>
              <Field label="Precio 3">
                <Input
                  type="number"
                  step="any"
                  value={form.price3}
                  onChange={(e) => setForm((f) => ({ ...f, price3: e.target.value }))}
                />
              </Field>
              <Field label="Precio 4">
                <Input
                  type="number"
                  step="any"
                  value={form.price4}
                  onChange={(e) => setForm((f) => ({ ...f, price4: e.target.value }))}
                />
              </Field>
            </div>
            <div className="space-y-3 rounded-lg border border-pf-border bg-pf-surface-soft p-3">
              <div className="flex flex-wrap items-center justify-between gap-2">
                <p className="text-sm font-medium text-pf-text">Precios por volumen (opcional)</p>
                <Button
                  type="button"
                  variant="secondary"
                  className="min-h-9 text-xs"
                  onClick={() =>
                    setForm((f) => ({ ...f, volumeTiers: [...f.volumeTiers, { minQty: "", price: "" }] }))
                  }
                >
                  <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                  Añadir tramo
                </Button>
              </div>
              {form.volumeTiers.length === 0 ? (
                <p className="text-xs text-pf-muted">Sin tramos. Solo se usarán las listas 1–4 según la venta.</p>
              ) : (
                <ul className="space-y-2">
                  {form.volumeTiers.map((row, idx) => (
                    <li key={idx} className="flex flex-wrap items-end gap-2">
                      <Field label="Cant. mínima" className="min-w-[120px] flex-1">
                        <Input
                          type="number"
                          step="any"
                          min={1}
                          value={row.minQty}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.volumeTiers];
                              next[idx] = { ...next[idx], minQty: e.target.value };
                              return { ...f, volumeTiers: next };
                            })
                          }
                        />
                      </Field>
                      <Field label="Precio unitario" className="min-w-[120px] flex-1">
                        <Input
                          type="number"
                          step="any"
                          min={0}
                          value={row.price}
                          onChange={(e) =>
                            setForm((f) => {
                              const next = [...f.volumeTiers];
                              next[idx] = { ...next[idx], price: e.target.value };
                              return { ...f, volumeTiers: next };
                            })
                          }
                        />
                      </Field>
                      <Button
                        type="button"
                        variant="ghost"
                        className="min-h-10 shrink-0 text-pf-danger hover:bg-pf-danger-soft"
                        aria-label="Quitar tramo"
                        onClick={() =>
                          setForm((f) => ({
                            ...f,
                            volumeTiers: f.volumeTiers.filter((_, j) => j !== idx),
                          }))
                        }
                      >
                        <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                      </Button>
                    </li>
                  ))}
                </ul>
              )}
            </div>
          </div>
        ) : null}

        {formTab === "kit" ? (
          <div className="space-y-3">
            <p className="text-sm text-pf-muted">
              Por cada unidad vendida del combo se descuenta del inventario la cantidad indicada de cada componente.
            </p>
            <Field label="Buscar producto (solo tipo PRODUCTO)">
              <Input
                value={kitPickSearch}
                onChange={(e) => setKitPickSearch(e.target.value)}
                placeholder="Nombre o SKU…"
              />
            </Field>
            {kitPickHits.length > 0 ? (
              <ul className="max-h-36 overflow-y-auto rounded-lg border border-pf-border divide-y divide-pf-border text-sm">
                {kitPickHits.map((p) => (
                  <li key={p.id}>
                    <button
                      type="button"
                      className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-pf-primary-soft/50"
                      onClick={() => {
                        setKitRows((rows) => [
                          ...rows,
                          { componentId: p.id, sku: p.sku, name: p.name, qty: "1" },
                        ]);
                        setKitPickSearch("");
                        setKitPickHits([]);
                      }}
                    >
                      <span className="font-medium truncate">{p.name}</span>
                      <span className="shrink-0 text-xs text-pf-muted font-mono">{p.sku}</span>
                    </button>
                  </li>
                ))}
              </ul>
            ) : null}
            {kitRows.length === 0 ? (
              <p className="text-xs text-pf-muted">Agregue componentes con la búsqueda.</p>
            ) : (
              <ul className="space-y-2">
                {kitRows.map((row, idx) => (
                  <li
                    key={row.componentId}
                    className="flex flex-wrap items-end gap-2 rounded-lg border border-pf-border bg-pf-surface-soft p-2"
                  >
                    <div className="flex-1 min-w-[160px]">
                      <p className="text-xs text-pf-muted">Componente</p>
                      <p className="text-sm font-medium">
                        {row.sku} — {row.name}
                      </p>
                    </div>
                    <Field label="Cant. por kit" className="w-32">
                      <Input
                        type="number"
                        step="any"
                        min={0.0001}
                        value={row.qty}
                        onChange={(e) =>
                          setKitRows((rows) => {
                            const next = [...rows];
                            next[idx] = { ...next[idx], qty: e.target.value };
                            return next;
                          })
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-10 text-red-600 shrink-0"
                      aria-label="Quitar componente"
                      onClick={() => setKitRows((rows) => rows.filter((_, j) => j !== idx))}
                    >
                      <Trash2 className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
                    </Button>
                  </li>
                ))}
              </ul>
            )}
          </div>
        ) : null}

        {formTab === "notes" ? (
          <Field label="Descripción / notas internas">
            <Textarea
              rows={6}
              value={form.description}
              onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            />
          </Field>
        ) : null}

        {err ? <p className="mt-3 text-sm text-red-600">{err}</p> : null}
        <div className="mt-4 flex justify-end gap-2">
          <Button variant="secondary" type="button" onClick={closeModal}>
            Cancelar
          </Button>
          <Button type="button" onClick={save}>
            <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Guardar
          </Button>
        </div>
      </Modal>
    </div>
  );
}
