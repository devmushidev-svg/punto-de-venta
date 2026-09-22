import type { ReactNode } from "react";
import { PageHero } from "../components/PageHero";
import { Card } from "../components/ui";

function Section({ title, children }: { title: string; children: ReactNode }) {
  return (
    <Card className="pf-glass-card-panel space-y-2 p-4">
      <h2 className="text-base font-bold text-pf-text">{title}</h2>
      <div className="space-y-2 text-sm leading-relaxed text-pf-text-secondary">{children}</div>
    </Card>
  );
}

/** Contenido alineado con `docs/FAQ-INTERNO.md` (mantener ambos coherentes). */
export function HelpPage() {
  return (
    <div className="mx-auto max-w-3xl space-y-4 pf-safe-page">
      <PageHero title="Ayuda / FAQ">
        <p className="pf-page-lead">
          Respuestas breves para operación y soporte. No sustituye documentación comercial de terceros ni textos legales. La misma información sin
          iniciar sesión: <code className="rounded-lg bg-white/80 px-1.5 py-0.5 text-xs font-mono shadow-sm">/ayuda-publica</code> (enlace en la pantalla
          de login).
        </p>
      </PageHero>

      <Section title="Modo de operación (PreVenta / POS)">
        <p>
          En <strong>Configuración → Apariencia → Flujo de ventas</strong> puede elegir cómo se ordena la cinta <strong>Facturación</strong>:
        </p>
        <ul className="list-disc pl-5 space-y-1">
          <li>
            <strong>Mixto</strong>: orden estándar (nueva venta y cotizaciones en sus bloques habituales).
          </li>
          <li>
            <strong>Énfasis en PreVentas</strong>: el bloque <strong>Cotizaciones / PreVentas</strong> aparece justo después de <strong>Nueva venta</strong> para
            priorizar pedidos y preventas.
          </li>
          <li>
            <strong>Énfasis en caja</strong>: cotizaciones quedan al final de la cinta (siguen accesibles, pero el flujo principal favorece venta en caja).
          </li>
        </ul>
        <p className="text-xs text-pf-text-tertiary">
          Equivale a la clave <code className="rounded bg-stone-100 px-1 text-[11px]">salesWorkflow</code> en el JSON general del API.
        </p>
      </Section>

      <Section title="Impresión térmica (80 mm)">
        <p>
          Abra el ticket desde la <strong>lista de ventas</strong> (enlace en cada fila) o desde el comprobante carta. La ruta es{" "}
          <code className="rounded bg-stone-100 px-1 text-xs">/ventas/…/ticket</code>.
        </p>
        <p>
          El texto del ticket se configura en <strong>Configuración → Factura y ticket</strong> (JSON <code className="text-xs">invoice.ticket</code>
          : pie, cabecera, desglose ISV, etc.).
        </p>
        <p>
          Use <strong>Imprimir</strong> en el navegador y elija la impresora térmica. Debe estar instalada en Windows (u otro SO) como
          impresora del equipo; el servidor no instala drivers.
        </p>
      </Section>

      <Section title="Comprobante carta y PDF">
        <p>
          Vista HTML: <code className="rounded bg-stone-100 px-1 text-xs">/ventas/…/comprobante</code>. Use{" "}
          <strong>Imprimir / PDF (navegador)</strong> y “Guardar como PDF” si lo prefiere desde el navegador.
        </p>
        <p>
          <strong>Descargar PDF (servidor)</strong> en esa misma pantalla llama a la API y baja un PDF generado en el servidor (misma lógica de
          título, SKU e ISV que la configuración de factura). Si configuró un logo en <strong>Empresa</strong> (URL HTTPS o imagen en data URL PNG/JPEG),
          el PDF del servidor intenta mostrarlo en el encabezado cuando el servidor puede obtener la imagen.
        </p>
      </Section>

      <Section title="Copia de seguridad (backup)">
        <p>
          Solo <strong>administrador</strong>: en <strong>Configuración</strong> puede descargar un archivo <strong>JSON</strong> con los datos de la
          organización.
        </p>
        <p>
          <strong>Restaurar</strong> no está automatizado en la aplicación: guarde copias en un lugar seguro y siga el procedimiento interno de su
          equipo si necesita recuperación.
        </p>
      </Section>

      <Section title="Permisos y sesión (PERM_STALE)">
        <p>
          Si un administrador cambia el <strong>rol</strong> o la <strong>matriz de permisos</strong> de un usuario, el token anterior deja de ser
          válido: puede ver un cierre de sesión con código <strong>PERM_STALE</strong>. Debe <strong>iniciar sesión de nuevo</strong>.
        </p>
        <p>Lo que el menú no muestra debe responder con error 403 en la API si alguien llama la ruta directamente.</p>
      </Section>

      <Section title="PWA / “instalar app”">
        <p>
          En producción con <strong>HTTPS</strong> y manifest/service worker, el navegador puede ofrecer instalar la app. En desarrollo local suele
          bastar un favorito o acceso directo al URL. Depende del navegador (Chrome, Edge, etc.).
        </p>
      </Section>

      <Section title="Desarrollo y base de datos (equipo técnico)">
        <ul className="list-disc pl-5 space-y-1">
          <li>
            Esquema: <code className="text-xs">npm run db:push -w apps/api</code>
          </li>
          <li>
            Datos demo: <code className="text-xs">npm run db:seed -w apps/api</code>
          </li>
          <li>
            Compilar: <code className="text-xs">npm run verify</code> en la raíz del repositorio
          </li>
        </ul>
      </Section>

      <Section title="Caja y “efectivo sugerido”">
        <p>
          El diario usa ventas con <strong>fecha dentro de la sesión</strong> y gastos del mismo usuario en ese intervalo. La referencia de efectivo
          suma el abonado solo en facturas a crédito <strong>emitidas en ese turno</strong>. Un abono en CxC a una factura de otro día{" "}
          <strong>no</strong> entra al cálculo; si cobró en efectivo, ajústelo al arqueo. Ver detalle en la pantalla <strong>Caja</strong> (
          <code className="text-xs">/caja</code>).
        </p>
      </Section>
    </div>
  );
}
