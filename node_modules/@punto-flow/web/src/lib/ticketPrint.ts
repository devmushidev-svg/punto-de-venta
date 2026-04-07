import { absoluteAppUrl } from "./appUrl";

/** SaleTicketPage en iframe avisa al padre para retirar el iframe tras imprimir o cancelar el diálogo. */
export const PF_TICKET_PRINT_DONE = "PF_TICKET_PRINT_DONE";

/**
 * Carga el ticket en un iframe casi invisible y ejecuta impresión (cuadro de diálogo del navegador).
 * No abre pestañas ni navega fuera de Nueva venta / venta táctil.
 */
export function printSaleTicketInHiddenFrame(saleId: string): void {
  const iframe = document.createElement("iframe");
  iframe.setAttribute("title", "Impresión de ticket");
  iframe.setAttribute("aria-hidden", "true");
  Object.assign(iframe.style, {
    position: "fixed",
    right: "0",
    bottom: "0",
    width: "1px",
    height: "1px",
    border: "0",
    opacity: "0",
    pointerEvents: "none",
  });

  const url = absoluteAppUrl(
    `/ventas/${encodeURIComponent(saleId)}/ticket?print=1&embed=1`
  );

  let removed = false;
  const cleanup = () => {
    if (removed) return;
    removed = true;
    window.removeEventListener("message", onMsg);
    window.clearTimeout(failsafeTimer);
    iframe.remove();
  };

  const onMsg = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === PF_TICKET_PRINT_DONE) cleanup();
  };

  const failsafeTimer = window.setTimeout(cleanup, 120_000);

  window.addEventListener("message", onMsg);
  document.body.appendChild(iframe);
  iframe.src = url;
}
