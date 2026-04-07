import { absoluteAppUrl } from "./appUrl";

/**
 * Abre el ticket en una pestaña nueva con ?print=1; SaleTicketPage llama a window.print()
 * y aparece el cuadro de impresión del navegador (comportamiento clásico).
 * @returns true si se abrió la ventana (si el navegador bloqueó popups, false).
 */
export function openSaleTicketPrintDialog(saleId: string): boolean {
  const url = absoluteAppUrl(`/ventas/${encodeURIComponent(saleId)}/ticket?print=1`);
  const win = window.open(url, "_blank", "noopener,noreferrer");
  return !!(win && !win.closed);
}
