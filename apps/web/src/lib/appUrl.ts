/** URL absoluta a una ruta de la SPA (respeta `import.meta.env.BASE_URL`). */
export function absoluteAppUrl(path: string): string {
  const rawBase = import.meta.env.BASE_URL ?? "/";
  const baseNoSlash = rawBase.replace(/\/$/, "");
  const p = path.startsWith("/") ? path : `/${path}`;
  const pathPart = `${baseNoSlash}${p}`;
  if (typeof window === "undefined") return pathPart;
  return `${window.location.origin}${pathPart}`;
}

/** Lista de ventas (pestaña dinámica «Ventas»). */
export function isSalesListPath(pathname: string): boolean {
  return pathname === "/ventas";
}

/** Documento de venta individual (pestaña dinámica «Venta» / «Editar venta»). */
export function isSaleDocPath(pathname: string): boolean {
  if (pathname === "/venta" || pathname === "/venta/buscar-producto") return true;
  return /^\/ventas\/[^/]+\/editar$/.test(pathname);
}

/** Cualquier ruta con pestaña dinámica (oculta la cinta de módulos). */
export function isSaleDocumentPath(pathname: string): boolean {
  return isSalesListPath(pathname) || isSaleDocPath(pathname);
}

/** Rutas de lista/táctil/CxC/reportes/preventas (cinta bajo Facturación, sin pestaña propia). */
export function isVentasModulePath(pathname: string): boolean {
  if (/^\/(cxc|reportes)(\/|$)/.test(pathname)) return true;
  if (pathname === "/venta/tactil") return true;
  if (pathname.startsWith("/ventas/preventas")) return true;
  if (/^\/ventas\/[^/]+\/(ticket|comprobante)$/.test(pathname)) return true;
  return false;
}
