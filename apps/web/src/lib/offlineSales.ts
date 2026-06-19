// Offline real para ventas: si no hay internet, la venta se guarda en IndexedDB y se reenvía
// al reconectar. El servidor deduplica por `clientRef` (idempotencia), así que un reenvío nunca duplica.
import { apiUrl } from "../api/client";
import { classifyDrainStatus, isOfflineError } from "./offlineSalesPolicy";

export { isOfflineError } from "./offlineSalesPolicy";

const DB_NAME = "pf-offline";
const STORE = "saleOutbox";
export const OUTBOX_EVENT = "pf-outbox-changed";

export type SaleBody = {
  clientRef?: string;
  customerId?: string | null;
  terms?: string;
  priceTier?: number;
  notes?: string;
  sellerName?: string;
  paid?: number;
  saleDate?: string;
  lines: { productId: string; qty: number; unitPrice?: number; discountPercent?: number }[];
};

type OutboxItem = {
  clientRef: string;
  body: SaleBody;
  createdAt: number;
  status: "pending" | "failed";
  error?: string;
};

export type OfflineSale = { id: string; invoiceNumber: null; _offline: true };

function newRef(): string {
  const c = globalThis.crypto;
  if (c && "randomUUID" in c) return c.randomUUID();
  return `r-${Date.now()}-${Math.floor(Math.random() * 1e9)}`; // fallback navegadores viejos
}

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: "clientRef" });
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function withStore<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  const db = await openDb();
  try {
    return await new Promise<T>((resolve, reject) => {
      const req = fn(db.transaction(STORE, mode).objectStore(STORE));
      req.onsuccess = () => resolve(req.result as T);
      req.onerror = () => reject(req.error);
    });
  } finally {
    db.close();
  }
}

const allItems = () => withStore<OutboxItem[]>("readonly", (s) => s.getAll());
const putItem = (it: OutboxItem) => withStore("readwrite", (s) => s.put(it));
const delItem = (ref: string) => withStore("readwrite", (s) => s.delete(ref));

function emit() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(OUTBOX_EVENT));
}

async function postSale(body: SaleBody, token: string | null): Promise<{ status: number; data: unknown }> {
  const headers = new Headers({ "Content-Type": "application/json" });
  if (token) headers.set("Authorization", `Bearer ${token}`);
  const res = await fetch(apiUrl("/api/sales"), { method: "POST", headers, body: JSON.stringify(body) });
  let data: unknown = null;
  try {
    data = await res.json();
  } catch {
    /* sin cuerpo */
  }
  return { status: res.status, data };
}

function errMsg(data: unknown, status: number): string {
  const m = (data as { error?: string } | null)?.error;
  return m || `Error ${status}`;
}

/**
 * Crea una venta resiliente: intenta enviarla; si no hay red, la encola y devuelve un comprobante
 * provisional. Un error de negocio del servidor (400) NO se encola: se propaga para mostrarlo.
 */
export async function submitSale<T>(
  body: SaleBody,
  token: string | null
): Promise<{ offline: false; sale: T } | { offline: true; sale: OfflineSale }> {
  const clientRef = body.clientRef ?? newRef();
  const withRef = { ...body, clientRef };
  try {
    const { status, data } = await postSale(withRef, token);
    if (status >= 200 && status < 300) return { offline: false, sale: data as T };
    throw new Error(errMsg(data, status)); // servidor accesible pero rechazó: no encolar
  } catch (e) {
    if (!isOfflineError(e)) throw e;
    await putItem({ clientRef, body: withRef, createdAt: Date.now(), status: "pending" });
    emit();
    return { offline: true, sale: { id: `offline:${clientRef}`, invoiceNumber: null, _offline: true } };
  }
}

/** Ventas pendientes de enviar (no incluye las marcadas como fallidas). */
export async function outboxCount(): Promise<number> {
  return (await allItems()).filter((i) => i.status === "pending").length;
}

/** Ventas offline que el servidor rechazó al reenviar (requieren atención del usuario). */
export async function failedItems(): Promise<OutboxItem[]> {
  return (await allItems()).filter((i) => i.status === "failed");
}

/** Reenvía las ventas pendientes. Se detiene si vuelve a fallar la red; marca las rechazadas por negocio. */
export async function drainOutbox(token: string | null): Promise<{ sent: number; failed: number }> {
  const pending = (await allItems()).filter((i) => i.status === "pending");
  let sent = 0;
  let failed = 0;
  for (const item of pending) {
    try {
      const { status, data } = await postSale(item.body, token);
      const action = classifyDrainStatus(status);
      if (action === "sent") {
        await delItem(item.clientRef);
        sent++;
      } else if (action === "failed") {
        await putItem({ ...item, status: "failed", error: errMsg(data, status) });
        failed++;
      } else {
        break; // retry: 401/403/5xx, reintentar luego (tras re-login o cuando el servidor se recupere)
      }
    } catch (e) {
      if (isOfflineError(e)) break; // sigue sin red
      await putItem({ ...item, status: "failed", error: e instanceof Error ? e.message : "Error" });
      failed++;
    }
  }
  if (sent || failed) emit();
  return { sent, failed };
}

/** Arranca el reenvío automático: al cargar, al volver la conexión y cada 30 s. Devuelve un limpiador. */
export function startOfflineSync(getToken: () => string | null): () => void {
  const run = () => {
    const t = getToken();
    if (t && navigator.onLine) void drainOutbox(t);
  };
  window.addEventListener("online", run);
  const id = window.setInterval(run, 30000);
  run();
  return () => {
    window.removeEventListener("online", run);
    window.clearInterval(id);
  };
}
