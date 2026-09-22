import { Eraser, Plus, Save, Trash2 } from "lucide-react";
import { useCallback, useEffect, useMemo, useState } from "react";
import { apiFetch } from "../api/client";
import { useAuth } from "../auth/AuthContext";
import { handleEnterFieldNav } from "../lib/formFieldNav";
import { parseVolumePricesJson } from "../lib/volumePrice";
import { Button, Field, Input, Modal, Select, Textarea } from "./ui";
import type { Product, Supplier } from "../types";

const NP_SAVE_SELECTOR = "#new-product-modal-save";

/** Orden al pulsar Enter en la pestaña «Producto». */
const NP_PRODUCT_TAB_ORDER = [
  "np-f-sku",
  "np-f-barcode",
  "np-f-quickCode",
  "np-f-productType",
  "np-f-name",
  "np-f-cost",
  "np-f-margin",
  "np-f-tax",
  "np-f-price",
  "np-f-stock",
  "np-f-minStock",
  "np-f-esGranel",
  "np-f-imageUrl",
  "np-f-unit",
  "np-f-category",
  "np-f-location",
  "np-f-brand",
  "np-f-supplier",
] as const;

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

type Props = {
  open: boolean;
  onClose: () => void;
  /** Si está definido, el modal carga y actualiza ese producto (PATCH). */
  existingProductId?: string | null;
  /** Se llama con el producto creado (respuesta del POST). */
  onSaved?: (product: Product) => void;
  /** Se llama tras PATCH exitoso (p. ej. refrescar líneas de venta). */
  onUpdated?: (product: Product) => void;
};

function productFromApiToForm(p: Product) {
  return {
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
    productType: (p.productType || "PRODUCTO") as (typeof PRODUCT_TYPES)[number],
    supplierId: p.supplierId ?? "",
    esGranel: Boolean(p.esGranel),
    volumeTiers: parseVolumePricesJson(p.volumePricesJson).map((t) => ({
      minQty: String(t.minQty),
      price: String(t.price),
    })),
  };
}

function kitRowsFromProduct(p: Product): KitRow[] {
  if (p.productType !== "KIT" || !p.kitLines?.length) return [];
  return p.kitLines.map((kl) => ({
    componentId: kl.componentProductId,
    sku: kl.component.sku,
    name: kl.component.name,
    qty: String(kl.qty),
  }));
}

function fieldsetClass(title: string) {
  return (
    <legend className="px-1 text-[11px] font-bold uppercase tracking-wide text-pf-text-tertiary">{title}</legend>
  );
}

export function NewProductModal({ open, onClose, existingProductId = null, onSaved, onUpdated }: Props) {
  const { token } = useAuth();
  const [suppliers, setSuppliers] = useState<Supplier[]>([]);
  const [formTab, setFormTab] = useState<FormTab>("product");
  const [form, setForm] = useState(emptyForm);
  const [kitRows, setKitRows] = useState<KitRow[]>([]);
  const [kitPickSearch, setKitPickSearch] = useState("");
  const [kitPickHits, setKitPickHits] = useState<Product[]>([]);
  const [err, setErr] = useState("");
  const [saving, setSaving] = useState(false);
  const [loadingProduct, setLoadingProduct] = useState(false);

  const pricesTabEnterOrder = useMemo(() => {
    const keys = ["price", "price2", "price3", "price4"] as const;
    const row: string[] = [];
    for (const k of keys) {
      row.push(`np-pr-${k}`, `np-pr-${k}-margin`);
    }
    for (let i = 0; i < form.volumeTiers.length; i++) {
      row.push(`np-vol-${i}-min`, `np-vol-${i}-price`);
    }
    return row;
  }, [form.volumeTiers.length]);

  const kitTabEnterOrder = useMemo(
    () => ["np-kit-search", ...kitRows.map((_, i) => `np-kit-qty-${i}`)],
    [kitRows.length]
  );

  useEffect(() => {
    if (!token) return;
    apiFetch<Supplier[]>("/api/suppliers", { token }).then(setSuppliers).catch(() => setSuppliers([]));
  }, [token]);

  useEffect(() => {
    if (!open || !token) return;
    if (!existingProductId) {
      setForm(emptyForm);
      setKitRows([]);
      setKitPickSearch("");
      setKitPickHits([]);
      setFormTab("product");
      setErr("");
      setLoadingProduct(false);
      return;
    }
    let cancelled = false;
    setLoadingProduct(true);
    setErr("");
    setKitPickSearch("");
    setKitPickHits([]);
    setFormTab("product");
    apiFetch<Product>(`/api/products/${existingProductId}`, { token })
      .then((full) => {
        if (cancelled) return;
        setForm({ ...emptyForm, ...productFromApiToForm(full) });
        setKitRows(kitRowsFromProduct(full));
      })
      .catch((e) => {
        if (!cancelled) setErr(e instanceof Error ? e.message : "No se pudo cargar el producto");
      })
      .finally(() => {
        if (!cancelled) setLoadingProduct(false);
      });
    return () => {
      cancelled = true;
    };
  }, [open, existingProductId, token]);

  useEffect(() => {
    if (formTab === "kit" && form.productType !== "KIT") setFormTab("product");
  }, [form.productType, formTab]);

  const runKitPickSearch = useCallback(async () => {
    if (!token || !kitPickSearch.trim()) {
      setKitPickHits([]);
      return;
    }
    try {
      const data = await apiFetch<Product[]>(`/api/products?q=${encodeURIComponent(kitPickSearch.trim())}`, { token });
      setKitPickHits(
        data
          .filter(
            (p) =>
              p.active &&
              p.productType === "PRODUCTO" &&
              p.id !== existingProductId &&
              !kitRows.some((r) => r.componentId === p.id)
          )
          .slice(0, 14)
      );
    } catch {
      setKitPickHits([]);
    }
  }, [token, kitPickSearch, kitRows, existingProductId]);

  useEffect(() => {
    const t = setTimeout(runKitPickSearch, 200);
    return () => clearTimeout(t);
  }, [runKitPickSearch]);

  function clearForm() {
    setErr("");
    if (!existingProductId) {
      setForm(emptyForm);
      setKitRows([]);
      setKitPickSearch("");
      setKitPickHits([]);
      setFormTab("product");
      return;
    }
    if (!token) return;
    setLoadingProduct(true);
    apiFetch<Product>(`/api/products/${existingProductId}`, { token })
      .then((full) => {
        setForm({ ...emptyForm, ...productFromApiToForm(full) });
        setKitRows(kitRowsFromProduct(full));
        setKitPickSearch("");
        setKitPickHits([]);
        setFormTab("product");
      })
      .catch((e) => setErr(e instanceof Error ? e.message : "No se pudo recargar"))
      .finally(() => setLoadingProduct(false));
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
              Number.isFinite(t.minQty) && t.minQty > 0 && Number.isFinite(t.price) && t.price >= 0
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
    setSaving(true);
    try {
      if (existingProductId) {
        const updated = await apiFetch<Product>(`/api/products/${existingProductId}`, {
          method: "PATCH",
          body: JSON.stringify(payload),
          token,
        });
        onUpdated?.(updated);
      } else {
        const created = await apiFetch<Product>("/api/products", {
          method: "POST",
          body: JSON.stringify(payload),
          token,
        });
        onSaved?.(created);
      }
      onClose();
    } catch (e) {
      setErr(e instanceof Error ? e.message : "Error al guardar");
    } finally {
      setSaving(false);
    }
  }

  const tabBtn = (id: FormTab, label: string) => (
    <button
      key={id}
      type="button"
      onClick={() => setFormTab(id)}
      className={`-mb-px px-3 py-2 text-xs font-semibold uppercase tracking-wide sm:text-sm rounded-t-md transition-colors ${
        formTab === id
          ? "border-b-2 border-pf-primary text-pf-text bg-pf-primary-soft/40"
          : "text-pf-muted hover:bg-pf-primary-soft/25 hover:text-pf-text"
      }`}
    >
      {label}
    </button>
  );

  const modalTitle = existingProductId
    ? `Editar producto${form.name ? ` — ${form.name}` : ""}`
    : "Nuevo producto";

  return (
    <Modal
      open={open}
      title={modalTitle}
      onClose={onClose}
      wide
      maxWidthClass="sm:max-w-5xl lg:max-w-6xl"
    >
      {loadingProduct ? (
        <p className="mb-4 text-sm text-pf-muted">Cargando datos del producto…</p>
      ) : null}
      <nav className="mb-4 flex flex-wrap gap-0.5 border-b border-pf-border" aria-label="Secciones">
        {tabBtn("product", "Producto")}
        {tabBtn("prices", "Precios")}
        {form.productType === "KIT" ? tabBtn("kit", "Kits o paquetes") : null}
        {tabBtn("notes", "Notas")}
      </nav>

      {loadingProduct ? null : formTab === "product" ? (
        <div className="grid gap-4 lg:grid-cols-3 lg:gap-5">
          <div className="space-y-4 lg:col-span-2">
            <fieldset className="rounded-xl border border-pf-border bg-pf-surface-elevated/50 px-3 py-3 sm:px-4">
              {fieldsetClass("Producto")}
              <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
                <Field label="Código del producto (SKU)">
                  <Input
                    id="np-f-sku"
                    value={form.sku}
                    onChange={(e) => setForm((f) => ({ ...f, sku: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-sku", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Código de barra">
                  <Input
                    id="np-f-barcode"
                    value={form.barcode}
                    onChange={(e) => setForm((f) => ({ ...f, barcode: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-barcode", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Código rápido">
                  <Input
                    id="np-f-quickCode"
                    value={form.quickCode}
                    onChange={(e) => setForm((f) => ({ ...f, quickCode: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-quickCode", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Tipo de producto">
                  <Select
                    id="np-f-productType"
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
                    onKeyDown={(e) =>
                      handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-productType", NP_SAVE_SELECTOR)
                    }
                  >
                    {PRODUCT_TYPES.map((t) => (
                      <option key={t} value={t}>
                        {t}
                      </option>
                    ))}
                  </Select>
                </Field>
                <Field label="Nombre del producto / servicio" className="sm:col-span-2 lg:col-span-4">
                  <Input
                    id="np-f-name"
                    value={form.name}
                    onChange={(e) => setForm((f) => ({ ...f, name: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-name", NP_SAVE_SELECTOR)}
                  />
                </Field>
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-pf-border bg-pf-surface-elevated/50 px-3 py-3 sm:px-4">
              {fieldsetClass("Precios")}
              <div className="mt-2 grid gap-3 sm:grid-cols-3">
                <Field label="Costo">
                  <Input
                    id="np-f-cost"
                    type="number"
                    step="any"
                    value={form.cost}
                    onChange={(e) => setForm((f) => ({ ...f, cost: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-cost", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Utilidad %">
                  <Input
                    id="np-f-margin"
                    type="number"
                    step="any"
                    value={
                      Number(form.cost) > 0
                        ? (((Number(form.price) || 0) - Number(form.cost)) / Number(form.cost) * 100).toFixed(2)
                        : ""
                    }
                    onChange={(e) => {
                      const pct = Number(e.target.value) || 0;
                      const c = Number(form.cost) || 0;
                      const newPrice = c > 0 ? +(c * (1 + pct / 100)).toFixed(4) : 0;
                      setForm((f) => ({ ...f, price: String(newPrice) }));
                    }}
                    className="text-emerald-700 font-semibold"
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-margin", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="ISV %">
                  <Input
                    id="np-f-tax"
                    type="number"
                    step="any"
                    value={form.taxPercent}
                    onChange={(e) => setForm((f) => ({ ...f, taxPercent: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-tax", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Precio de venta (lista 1)">
                  <Input
                    id="np-f-price"
                    type="number"
                    step="any"
                    value={form.price}
                    onChange={(e) => setForm((f) => ({ ...f, price: e.target.value }))}
                    className="font-semibold"
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-price", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Utilidad">
                  <div className={`flex min-h-[42px] items-center rounded-[var(--radius-pf)] border border-pf-border px-3 text-sm font-bold tabular-nums shadow-[var(--pf-control-shadow)] ${
                    (Number(form.price) || 0) - (Number(form.cost) || 0) >= 0 ? "bg-emerald-50 text-emerald-700" : "bg-red-50 text-red-600"
                  }`}>
                    {((Number(form.price) || 0) - (Number(form.cost) || 0)).toFixed(2)}
                  </div>
                </Field>
                <Field label="Precio con ISV">
                  <div className="flex min-h-[42px] items-center rounded-[var(--radius-pf)] border border-pf-border bg-pf-primary-soft/25 px-3 text-sm font-bold tabular-nums text-pf-text shadow-[var(--pf-control-shadow)]">
                    {((Number(form.price) || 0) * (1 + (Number(form.taxPercent) || 0) / 100)).toFixed(2)}
                  </div>
                </Field>
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-pf-border bg-pf-surface-elevated/50 px-3 py-3 sm:px-4">
              {fieldsetClass("Existencia almacén")}
              <div className="mt-2 grid gap-3 sm:grid-cols-2">
                <Field label="Existencia inicial">
                  <Input
                    id="np-f-stock"
                    type="number"
                    step="any"
                    value={form.productType === "KIT" ? "0" : form.stock}
                    readOnly={form.productType === "KIT"}
                    className={form.productType === "KIT" ? "bg-pf-primary-soft/40 text-pf-muted" : undefined}
                    onChange={(e) => setForm((f) => ({ ...f, stock: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-stock", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Existencia mínima">
                  <Input
                    id="np-f-minStock"
                    type="number"
                    step="any"
                    value={form.minStock}
                    onChange={(e) => setForm((f) => ({ ...f, minStock: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-minStock", NP_SAVE_SELECTOR)}
                  />
                </Field>
              </div>
              {form.productType !== "KIT" ? (
                <label className="mt-3 flex cursor-pointer items-center gap-2">
                  <input
                    id="np-f-esGranel"
                    type="checkbox"
                    checked={form.esGranel}
                    onChange={(e) => setForm((f) => ({ ...f, esGranel: e.target.checked }))}
                    className="h-4 w-4 rounded border-pf-border"
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-esGranel", NP_SAVE_SELECTOR)}
                  />
                  <span className="text-sm font-medium text-pf-text-secondary">Venta a granel (cantidades decimales)</span>
                </label>
              ) : (
                <p className="mt-2 text-xs text-pf-muted">
                  KIT: el inventario se descuenta por componentes (pestaña «Kits o paquetes»).
                </p>
              )}
            </fieldset>
          </div>

          <div className="space-y-4">
            <fieldset className="rounded-xl border border-pf-border bg-pf-surface-elevated/50 px-3 py-3 sm:px-4">
              {fieldsetClass("Imagen")}
              <div className="mt-2">
                <Field label="URL de imagen">
                  <Input
                    id="np-f-imageUrl"
                    value={form.imageUrl}
                    onChange={(e) => setForm((f) => ({ ...f, imageUrl: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-imageUrl", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <div className="mt-2 flex min-h-[120px] items-center justify-center rounded-lg border border-dashed border-pf-border bg-pf-primary-soft/20 p-2">
                  {form.imageUrl ? (
                    <img src={form.imageUrl} alt="" className="max-h-28 max-w-full object-contain" />
                  ) : (
                    <span className="text-xs text-pf-muted">Sin imagen</span>
                  )}
                </div>
              </div>
            </fieldset>

            <fieldset className="rounded-xl border border-pf-border bg-pf-surface-elevated/50 px-3 py-3 sm:px-4">
              {fieldsetClass("Categorías")}
              <div className="mt-2 space-y-3">
                <Field label="Unidad de medida">
                  <Input
                    id="np-f-unit"
                    value={form.unit}
                    onChange={(e) => setForm((f) => ({ ...f, unit: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-unit", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Categoría">
                  <Input
                    id="np-f-category"
                    value={form.category}
                    onChange={(e) => setForm((f) => ({ ...f, category: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-category", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Ubicación en bodega">
                  <Input
                    id="np-f-location"
                    value={form.location}
                    onChange={(e) => setForm((f) => ({ ...f, location: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-location", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Marca del producto">
                  <Input
                    id="np-f-brand"
                    value={form.brand}
                    onChange={(e) => setForm((f) => ({ ...f, brand: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-brand", NP_SAVE_SELECTOR)}
                  />
                </Field>
                <Field label="Proveedor">
                  <Select
                    id="np-f-supplier"
                    value={form.supplierId}
                    onChange={(e) => setForm((f) => ({ ...f, supplierId: e.target.value }))}
                    onKeyDown={(e) => handleEnterFieldNav(e, NP_PRODUCT_TAB_ORDER, "np-f-supplier", NP_SAVE_SELECTOR)}
                  >
                    <option value="">— Ninguno —</option>
                    {suppliers.map((s) => (
                      <option key={s.id} value={s.id}>
                        {s.name}
                      </option>
                    ))}
                  </Select>
                </Field>
              </div>
            </fieldset>
          </div>
        </div>
      ) : null}

      {loadingProduct ? null : formTab === "prices" ? (
        <div className="space-y-4">
          <div className="rounded-xl border border-pf-border bg-pf-surface-elevated/50 px-3 py-3 sm:px-4">
            <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-pf-text-tertiary">
              Costo: {Number(form.cost) || 0} · ISV: {form.taxPercent}%
            </p>
            <div className="overflow-x-auto">
              <table className="w-full min-w-[540px] text-sm">
                <thead>
                  <tr className="border-b border-pf-border text-left text-[11px] font-bold uppercase tracking-wide text-pf-text-tertiary">
                    <th className="px-2 py-2">Lista</th>
                    <th className="px-2 py-2 text-right">Precio</th>
                    <th className="px-2 py-2 text-right">Utilidad %</th>
                    <th className="px-2 py-2 text-right">Utilidad</th>
                    <th className="px-2 py-2 text-right">Precio con ISV</th>
                  </tr>
                </thead>
                <tbody>
                  {([
                    { key: "price" as const, label: "Precio 1 (principal)" },
                    { key: "price2" as const, label: "Precio 2" },
                    { key: "price3" as const, label: "Precio 3" },
                    { key: "price4" as const, label: "Precio 4" },
                  ] as const).map(({ key, label }) => {
                    const c = Number(form.cost) || 0;
                    const p = Number(form[key]) || 0;
                    const margin = c > 0 ? ((p - c) / c * 100) : 0;
                    const profit = p - c;
                    const withTax = p * (1 + (Number(form.taxPercent) || 0) / 100);
                    return (
                      <tr key={key} className="border-b border-pf-border/50 last:border-0">
                        <td className="px-2 py-2 text-xs font-medium text-pf-text">{label}</td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            id={`np-pr-${key}`}
                            type="number"
                            step="any"
                            className="min-h-9 py-1 text-right font-semibold"
                            value={form[key]}
                            onChange={(e) => setForm((f) => ({ ...f, [key]: e.target.value }))}
                            onKeyDown={(e) =>
                              handleEnterFieldNav(e, pricesTabEnterOrder, `np-pr-${key}`, NP_SAVE_SELECTOR)
                            }
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <Input
                            id={`np-pr-${key}-margin`}
                            type="number"
                            step="any"
                            className="min-h-9 py-1 text-right text-emerald-700 font-semibold"
                            value={c > 0 && form[key] !== "" ? margin.toFixed(2) : ""}
                            onChange={(e) => {
                              const pct = Number(e.target.value) || 0;
                              const newPrice = c > 0 ? +(c * (1 + pct / 100)).toFixed(4) : 0;
                              setForm((f) => ({ ...f, [key]: String(newPrice) }));
                            }}
                            onKeyDown={(e) =>
                              handleEnterFieldNav(e, pricesTabEnterOrder, `np-pr-${key}-margin`, NP_SAVE_SELECTOR)
                            }
                          />
                        </td>
                        <td className={`px-2 py-2 text-right tabular-nums font-bold ${profit >= 0 ? "text-emerald-600" : "text-red-600"}`}>
                          {form[key] !== "" ? profit.toFixed(2) : "—"}
                        </td>
                        <td className="px-2 py-2 text-right tabular-nums font-medium text-pf-text-secondary">
                          {form[key] !== "" ? withTax.toFixed(2) : "—"}
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
          <div className="rounded-xl border border-pf-border bg-pf-primary-soft/15 p-3 space-y-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <p className="text-sm font-medium text-pf-text">Precios por volumen (opcional)</p>
              <Button
                type="button"
                variant="secondary"
                className="min-h-9 text-xs"
                onClick={() => setForm((f) => ({ ...f, volumeTiers: [...f.volumeTiers, { minQty: "", price: "" }] }))}
              >
                <Plus className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
                Añadir tramo
              </Button>
            </div>
            {form.volumeTiers.length === 0 ? (
              <p className="text-xs text-pf-muted">Sin tramos adicionales.</p>
            ) : (
              <ul className="space-y-2">
                {form.volumeTiers.map((row, idx) => (
                  <li key={idx} className="flex flex-wrap items-end gap-2">
                    <Field label="Cant. mínima" className="min-w-[120px] flex-1">
                      <Input
                        id={`np-vol-${idx}-min`}
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
                        onKeyDown={(e) =>
                          handleEnterFieldNav(e, pricesTabEnterOrder, `np-vol-${idx}-min`, NP_SAVE_SELECTOR)
                        }
                      />
                    </Field>
                    <Field label="Precio unitario" className="min-w-[120px] flex-1">
                      <Input
                        id={`np-vol-${idx}-price`}
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
                        onKeyDown={(e) =>
                          handleEnterFieldNav(e, pricesTabEnterOrder, `np-vol-${idx}-price`, NP_SAVE_SELECTOR)
                        }
                      />
                    </Field>
                    <Button
                      type="button"
                      variant="ghost"
                      className="min-h-10 shrink-0 text-red-600 hover:bg-red-50"
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

      {loadingProduct ? null : formTab === "kit" ? (
        <div className="space-y-3">
          <p className="text-sm text-pf-muted">
            Por cada unidad vendida del combo se descuenta del inventario la cantidad indicada de cada componente (solo
            productos tipo PRODUCTO).
          </p>
          <Field label="Buscar producto">
            <Input
              id="np-kit-search"
              value={kitPickSearch}
              onChange={(e) => setKitPickSearch(e.target.value)}
              placeholder="Nombre o SKU…"
              onKeyDown={(e) =>
                handleEnterFieldNav(e, kitTabEnterOrder, "np-kit-search", NP_SAVE_SELECTOR)
              }
            />
          </Field>
          {kitPickHits.length > 0 ? (
            <ul className="max-h-36 divide-y divide-pf-border overflow-y-auto rounded-lg border border-pf-border text-sm">
              {kitPickHits.map((p) => (
                <li key={p.id}>
                  <button
                    type="button"
                    className="flex w-full justify-between gap-2 px-3 py-2 text-left hover:bg-pf-primary-soft/50"
                    onClick={() => {
                      setKitRows((rows) => [...rows, { componentId: p.id, sku: p.sku, name: p.name, qty: "1" }]);
                      setKitPickSearch("");
                      setKitPickHits([]);
                    }}
                  >
                    <span className="truncate font-medium">{p.name}</span>
                    <span className="shrink-0 font-mono text-xs text-pf-muted">{p.sku}</span>
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
                  className="flex flex-wrap items-end gap-2 rounded-lg border border-pf-border bg-pf-primary-soft/10 p-2"
                >
                  <div className="min-w-[160px] flex-1">
                    <p className="text-xs text-pf-muted">Componente</p>
                    <p className="text-sm font-medium">
                      {row.sku} — {row.name}
                    </p>
                  </div>
                  <Field label="Cant. por kit" className="w-32">
                    <Input
                      id={`np-kit-qty-${idx}`}
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
                      onKeyDown={(e) =>
                        handleEnterFieldNav(e, kitTabEnterOrder, `np-kit-qty-${idx}`, NP_SAVE_SELECTOR)
                      }
                    />
                  </Field>
                  <Button
                    type="button"
                    variant="ghost"
                    className="min-h-10 shrink-0 text-red-600"
                    aria-label="Quitar"
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

      {loadingProduct ? null : formTab === "notes" ? (
        <Field label="Descripción / notas">
          <Textarea
            id="np-notes-desc"
            rows={6}
            value={form.description}
            onChange={(e) => setForm((f) => ({ ...f, description: e.target.value }))}
            onKeyDown={(e) =>
              handleEnterFieldNav(e, ["np-notes-desc"], "np-notes-desc", NP_SAVE_SELECTOR, { textarea: true })
            }
          />
        </Field>
      ) : null}

      {err ? <p className="mt-3 text-sm font-medium text-red-600">{err}</p> : null}

      <div className="mt-6 flex flex-wrap items-center justify-between gap-3 border-t border-pf-border pt-4">
        <Button
          type="button"
          variant="secondary"
          className="min-h-11 gap-2"
          onClick={() => void clearForm()}
          disabled={saving || loadingProduct}
        >
          <Eraser className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
          Limpiar
        </Button>
        <div className="flex flex-wrap gap-2">
          <Button type="button" variant="secondary" onClick={onClose} disabled={saving || loadingProduct}>
            Cancelar
          </Button>
          <Button
            id="new-product-modal-save"
            type="button"
            className="min-h-11 gap-2"
            onClick={() => void save()}
            disabled={saving || loadingProduct}
          >
            <Save className="h-4 w-4 shrink-0" strokeWidth={2} aria-hidden />
            Guardar y cerrar
          </Button>
        </div>
      </div>
    </Modal>
  );
}
