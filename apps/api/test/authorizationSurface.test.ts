import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
// @ts-expect-error -- helper en JS puro, compartido con el generador del manifiesto
import { extractRoutes, readSource } from "./extractRoutes.mjs";

/**
 * La autorizacion se demuestra con la negacion, no con el permiso: estas
 * pruebas existen para fallar cuando alguien agrega una ruta sin decidir quien
 * puede llamarla. No comprueban que una ruta funcione; comprueban que nadie
 * publique una sin declararla.
 */

const manifest: Record<string, string> = JSON.parse(
  readFileSync(new URL("./authorizationManifest.json", import.meta.url), "utf8"),
);

const routes: Record<string, string> = extractRoutes(readSource());

describe("superficie de autorizacion", () => {
  it("no aparecen rutas nuevas sin declarar su guardia", () => {
    const nuevas = Object.keys(routes).filter((r) => !(r in manifest));
    expect(
      nuevas,
      `Rutas nuevas sin fila en authorizationManifest.json.\n` +
        `Decida quien puede llamarlas y agreguelas al manifiesto:\n  ${nuevas.join("\n  ")}`,
    ).toEqual([]);
  });

  it("el manifiesto no conserva rutas que ya no existen", () => {
    const viejas = Object.keys(manifest).filter((r) => !(r in routes));
    expect(viejas, `Rutas en el manifiesto que ya no estan en el codigo:\n  ${viejas.join("\n  ")}`).toEqual([]);
  });

  it("ninguna guardia se relajo respecto del manifiesto", () => {
    const cambios = Object.keys(routes)
      .filter((r) => r in manifest && routes[r] !== manifest[r])
      .map((r) => `${r}: manifiesto=${manifest[r]} codigo=${routes[r]}`);
    expect(cambios, `Guardias que cambiaron. Si es intencional, actualice el manifiesto:\n  ${cambios.join("\n  ")}`).toEqual(
      [],
    );
  });

  it("nada bajo /api queda publico", () => {
    const publicas = Object.entries(routes)
      .filter(([r, g]) => r.includes(" /api/") && g === "public")
      .map(([r]) => r);
    expect(publicas, `Rutas /api sin autenticacion:\n  ${publicas.join("\n  ")}`).toEqual([]);
  });

  it("las superficies sensibles exigen admin", () => {
    const sensibles = /\/(users|backup|admin|settings|employees|payroll-periods)\b/;
    const flojas = Object.entries(routes)
      .filter(([r, g]) => sensibles.test(r) && g === "auth")
      .map(([r, g]) => `${r} (${g})`);
    // GET /api/settings es lectura deliberada: la pantalla de venta tactil la
    // necesita para sus favoritos. Cualquier otra requiere decision explicita.
    const permitidas = new Set([
      // Lectura deliberada: venta tactil necesita los favoritos para cualquier usuario.
      "GET /api/settings (auth)",
      // Excepcion consciente, ver F-4: los favoritos son de toda la empresa y
      // cualquier usuario los puede cambiar. Se acepta hasta decidir si pasan a
      // ser por usuario o exigen permiso.
      "POST /api/settings/touch-favorites (auth)",
    ]);
    const inesperadas = flojas.filter((f) => !permitidas.has(f));
    expect(
      inesperadas,
      `Superficies sensibles con sola autenticacion:\n  ${inesperadas.join("\n  ")}`,
    ).toEqual([]);
  });
});
