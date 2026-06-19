import { useCallback, useEffect, useState } from "react";
import { RefreshCw, WifiOff } from "lucide-react";
import {
  OUTBOX_EVENT,
  drainOutbox,
  failedItems,
  outboxCount,
  startOfflineSync,
} from "../lib/offlineSales";

const getToken = () => localStorage.getItem("pf_token");

/** Indicador de estado offline: muestra sin-conexión, ventas pendientes y rechazadas. Arranca el reenvío automático. */
export function OfflineBadge() {
  const [online, setOnline] = useState(() => (typeof navigator === "undefined" ? true : navigator.onLine));
  const [pending, setPending] = useState(0);
  const [failed, setFailed] = useState(0);

  const refresh = useCallback(() => {
    outboxCount().then(setPending).catch(() => {});
    failedItems().then((f) => setFailed(f.length)).catch(() => {});
  }, []);

  useEffect(() => {
    const onOnline = () => setOnline(true);
    const onOffline = () => setOnline(false);
    window.addEventListener("online", onOnline);
    window.addEventListener("offline", onOffline);
    window.addEventListener(OUTBOX_EVENT, refresh);
    refresh();
    const stop = startOfflineSync(getToken);
    return () => {
      window.removeEventListener("online", onOnline);
      window.removeEventListener("offline", onOffline);
      window.removeEventListener(OUTBOX_EVENT, refresh);
      stop();
    };
  }, [refresh]);

  if (online && pending === 0 && failed === 0) return null;

  const tone = failed
    ? "border-red-400/40 bg-red-500/15 text-red-200"
    : !online
      ? "border-amber-400/40 bg-amber-500/15 text-amber-100"
      : "border-sky-400/40 bg-sky-500/15 text-sky-100";

  const label = !online ? "Sin conexión" : failed ? `${failed} rechazada(s)` : `Enviando ${pending}…`;
  const title = failed
    ? `${failed} venta(s) offline rechazadas por el servidor; requieren revisión`
    : !online
      ? "Sin conexión: las ventas se guardan y se enviarán al reconectar"
      : `${pending} venta(s) pendientes de enviar`;

  return (
    <span className={`inline-flex items-center gap-1.5 rounded-lg border px-2 py-1 text-xs font-semibold ${tone}`} title={title}>
      <WifiOff className="h-3.5 w-3.5 shrink-0" strokeWidth={2} aria-hidden />
      <span>{label}</span>
      {!online && pending > 0 ? <span className="opacity-80">· {pending}</span> : null}
      {online && (pending > 0 || failed > 0) ? (
        <button
          type="button"
          onClick={() => drainOutbox(getToken()).then(refresh).catch(() => {})}
          title="Reintentar envío ahora"
          className="ml-0.5 inline-flex"
        >
          <RefreshCw className="h-3 w-3" strokeWidth={2} aria-hidden />
        </button>
      ) : null}
    </span>
  );
}
