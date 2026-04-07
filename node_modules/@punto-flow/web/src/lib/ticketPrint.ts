/** Preferencia solo en este navegador: el usuario confirmó modo kiosco para impresión sin diálogo. */
export const TICKET_PRINT_KIOSK_MODE_KEY = "pf_ticket_print_kiosk_mode";

export function getTicketPrintKioskMode(): boolean {
  try {
    return localStorage.getItem(TICKET_PRINT_KIOSK_MODE_KEY) === "1";
  } catch {
    return false;
  }
}

export function setTicketPrintKioskMode(enabled: boolean): void {
  try {
    if (enabled) localStorage.setItem(TICKET_PRINT_KIOSK_MODE_KEY, "1");
    else localStorage.removeItem(TICKET_PRINT_KIOSK_MODE_KEY);
  } catch {
    /* */
  }
}

export const PF_TICKET_EMBED_PRINT_DONE = "PF_TICKET_EMBED_PRINT_DONE";

/**
 * Abre el ticket en un iframe oculto y dispara la impresión (el propio ticket llama a print).
 * Permanece en Nueva venta. Con Chrome iniciado con `--kiosk-printing`, suele enviarse directo
 * a la impresora predeterminada del sistema sin cuadro de diálogo.
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
  } satisfies Partial<CSSStyleDeclaration>);

  const url = new URL(`/ventas/${encodeURIComponent(saleId)}/ticket`, window.location.origin);
  url.searchParams.set("print", "1");
  url.searchParams.set("embed", "1");

  let removed = false;
  const remove = () => {
    if (removed) return;
    removed = true;
    window.removeEventListener("message", onMsg);
    window.clearTimeout(failsafeTimer);
    iframe.remove();
  };

  const onMsg = (e: MessageEvent) => {
    if (e.origin !== window.location.origin) return;
    if (e.data?.type === PF_TICKET_EMBED_PRINT_DONE) remove();
  };

  const failsafeTimer = window.setTimeout(remove, 120_000);

  window.addEventListener("message", onMsg);
  document.body.appendChild(iframe);
  iframe.src = url.toString();
}
