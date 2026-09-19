import fs from "node:fs";

/**
 * Extrae toda ruta declarada en index.ts junto con su guardia.
 * El patron acepta cualquier handler (async, arrow, con o sin guardia) a
 * proposito: una ruta que el extractor no vea es una ruta que el manifiesto
 * no protege.
 */
export function extractRoutes(source) {
  const re = /^(api|app)\.(get|post|patch|put|delete)\(\s*"([^"]+)"\s*,\s*/gm;
  const routes = {};
  let m;
  while ((m = re.exec(source))) {
    const [full, base, method, path] = m;
    const rest = source.slice(m.index + full.length, m.index + full.length + 240);
    let guard;
    if (/^requireAdmin\b/.test(rest)) guard = "admin";
    else if (/^requirePermission\(/.test(rest)) {
      const k = rest.match(/^requirePermission\(\s*([\s\S]*?)\s*\)\s*,/);
      guard = "perm:" + (k ? k[1].replace(/PERMISSION_KEYS\./g, "").replace(/\s+/g, " ").trim() : "?");
    } else guard = base === "api" ? "auth" : "public";
    routes[`${method.toUpperCase()} ${base === "api" ? "/api" : ""}${path}`] = guard;
  }
  return routes;
}

export function readSource() {
  return fs.readFileSync(new URL("../src/index.ts", import.meta.url), "utf8");
}
