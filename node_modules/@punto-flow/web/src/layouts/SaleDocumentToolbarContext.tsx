import { createContext, useContext, type Dispatch, type ReactNode, type SetStateAction } from "react";

/** Registra la cinta de acciones del documento de venta; AppShell la pinta bajo las pestañas. */
export const SaleDocumentToolbarSetterContext = createContext<Dispatch<SetStateAction<ReactNode | null>> | null>(
  null,
);

export function useSaleDocumentToolbarSetter() {
  return useContext(SaleDocumentToolbarSetterContext);
}
