function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function money(n: number, sym: string): string {
  const x = Number.isFinite(n) ? n : 0;
  return `${sym} ${x.toLocaleString("es-HN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

export type CashCloseDiaryShape = {
  session: {
    id: string;
    openedAt: Date;
    closedAt: Date | null;
    openingCash: number;
    closingCash: number | null;
    expectedCash: number | null;
  } | null;
  saleCount: number;
  contadoTotal: number;
  tarjetaTotal: number;
  efectivoVentasTotal: number;
  creditoTotal: number;
  creditoCobrado: number;
  creditoPendiente: number;
  ventasTotal: number;
  gastosSesion: number;
  movementNet: number;
  movements: { id: string; category: string; amount: number; hasVoucher: boolean; note: string | null; createdAt: Date }[];
  efectivoCajaSugerido: number;
  cashDifference: number | null;
  sales: {
    id: string;
    total: number;
    paid: number;
    terms: string;
    saleDate: Date;
    invoiceNumber: string | null;
  }[];
};

export function buildCashCloseReportHtml(input: {
  orgName: string;
  dateStr: string;
  userDisplay: string;
  currencySymbol: string;
  diary: CashCloseDiaryShape;
  autoPrint: boolean;
}): string {
  const { orgName, dateStr, userDisplay, currencySymbol: sym, diary: d, autoPrint } = input;
  const sess = d.session;
  const rows = d.movements
    .map(
      (m) =>
        `<tr><td>${esc(new Date(m.createdAt).toLocaleString("es-HN"))}</td><td>${esc(m.category)}</td><td class="r">${esc(
          money(m.amount, sym)
        )}</td><td>${m.hasVoucher ? "Sí" : ""}</td><td>${esc(m.note ?? "")}</td></tr>`
    )
    .join("");
  const saleRows = d.sales
    .map(
      (s) =>
        `<tr><td>${esc(new Date(s.saleDate).toLocaleString("es-HN"))}</td><td>${esc(s.invoiceNumber ?? "—")}</td><td>${esc(
          s.terms
        )}</td><td class="r">${esc(money(s.total, sym))}</td><td class="r">${esc(money(s.paid, sym))}</td></tr>`
    )
    .join("");

  const printScript = autoPrint ? `<script>addEventListener("load",()=>{setTimeout(()=>window.print(),200);});</script>` : "";

  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>${esc(`Cierre de caja ${dateStr}`)}</title>
<style>
  body{font-family:system-ui,Segoe UI,sans-serif;margin:1.2rem;color:#1c1917;font-size:13px;}
  h1{font-size:1.15rem;margin:0 0 .25rem;}
  .muted{color:#57534e;font-size:12px;margin-bottom:1rem;}
  table{border-collapse:collapse;width:100%;margin:.75rem 0;font-size:12px;}
  th,td{border:1px solid #d6d3d1;padding:6px 8px;text-align:left;}
  th{background:#f5f5f4;}
  .r{text-align:right;}
  .grid{display:grid;grid-template-columns:repeat(auto-fill,minmax(11rem,1fr));gap:.5rem;margin:.75rem 0;}
  .box{border:1px solid #d6d3d1;border-radius:8px;padding:8px 10px;background:#fafaf9;}
  .box label{display:block;font-size:10px;text-transform:uppercase;color:#78716c;font-weight:600;}
  .box .v{font-weight:700;margin-top:4px;}
  @media print{body{margin:.5cm;} .noprint{display:none;}}
</style>
</head>
<body>
<h1>Reporte de cierre de caja</h1>
<p class="muted">${esc(orgName)} · Fecha consulta: ${esc(dateStr)} · Cajero: ${esc(userDisplay)}</p>
<div class="grid">
  <div class="box"><label>Turno</label><div class="v">${sess ? esc(new Date(sess.openedAt).toLocaleString("es-HN")) + " — " + (sess.closedAt ? esc(new Date(sess.closedAt).toLocaleString("es-HN")) : "abierto") : "Sin sesión"}</div></div>
  <div class="box"><label>Fondo inicial</label><div class="v">${sess ? esc(money(sess.openingCash, sym)) : "—"}</div></div>
  <div class="box"><label>Efectivo contado al cierre</label><div class="v">${sess && sess.closingCash != null ? esc(money(sess.closingCash, sym)) : "—"}</div></div>
  <div class="box"><label>Efectivo esperado (sugerido)</label><div class="v">${esc(money(d.efectivoCajaSugerido, sym))}</div></div>
  <div class="box"><label>Diferencia caja</label><div class="v">${d.cashDifference != null ? esc(money(d.cashDifference, sym)) : "—"}</div></div>
  <div class="box"><label>Ventas (tickets)</label><div class="v">${d.saleCount}</div></div>
  <div class="box"><label>Total ventas</label><div class="v">${esc(money(d.ventasTotal, sym))}</div></div>
  <div class="box"><label>Contado / tarjeta / crédito</label><div class="v">${esc(money(d.contadoTotal, sym))} / ${esc(money(d.tarjetaTotal, sym))} / ${esc(
    money(d.creditoTotal, sym)
  )}</div></div>
  <div class="box"><label>Gastos sesión</label><div class="v">${esc(money(d.gastosSesion, sym))}</div></div>
  <div class="box"><label>Movimientos netos</label><div class="v">${esc(money(d.movementNet, sym))}</div></div>
</div>
<h2 style="font-size:1rem;margin-top:1.25rem;">Movimientos de caja</h2>
<table><thead><tr><th>Fecha</th><th>Categoría</th><th class="r">Monto</th><th>Compr.</th><th>Nota</th></tr></thead><tbody>${
    rows || `<tr><td colspan="5">Sin movimientos</td></tr>`
  }</tbody></table>
<h2 style="font-size:1rem;margin-top:1.25rem;">Ventas del periodo</h2>
<table><thead><tr><th>Fecha</th><th>Factura</th><th>Términos</th><th class="r">Total</th><th class="r">Pagado</th></tr></thead><tbody>${
    saleRows || `<tr><td colspan="5">Sin ventas</td></tr>`
  }</tbody></table>
<p class="muted noprint" style="margin-top:1.5rem;">Generado por MultiPOS · Use Imprimir del navegador para guardar PDF.</p>
${printScript}
</body>
</html>`;
}
