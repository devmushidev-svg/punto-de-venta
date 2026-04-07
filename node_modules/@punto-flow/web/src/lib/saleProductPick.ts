/** Mensaje y canal para devolver un producto desde la pestaña "Buscar producto" a Nueva venta. */

export const PF_PRODUCT_PICK_TYPE = "PF_PRODUCT_PICK";

export const PF_PRODUCT_PICK_CHANNEL = "pf-product-pick";

export type PfProductPickMessage = { type: typeof PF_PRODUCT_PICK_TYPE; productId: string };

export function postProductPick(productId: string): void {
  const payload: PfProductPickMessage = { type: PF_PRODUCT_PICK_TYPE, productId };
  try {
    const bc = new BroadcastChannel(PF_PRODUCT_PICK_CHANNEL);
    bc.postMessage({ productId });
    bc.close();
  } catch {
    /* p. ej. modo privado */
  }
  try {
    if (window.opener && !window.opener.closed) {
      window.opener.postMessage(payload, window.location.origin);
    }
  } catch {
    /* restricciones del navegador */
  }
}
