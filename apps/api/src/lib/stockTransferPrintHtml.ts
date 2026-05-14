function esc(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

type Line = { product: { sku: string; name: string; unit: string }; qty: number };

export function buildStockTransferPrintHtml(input: {
  orgName: string;
  transferNumber: string | null;
  status: string;
  fromName: string;
  toName: string;
  notes: string | null;
  lines: Line[];
  autoPrint: boolean;
}): string {
  const rows = input.lines
    .map(
      (l) =>
        `<tr><td>${esc(l.product.sku)}</td><td>${esc(l.product.name)}</td><td>${esc(l.product.unit)}</td><td class="r">${esc(
          String(l.qty)
        )}</td></tr>`
    )
    .join("");
  const printScript = input.autoPrint
    ? `<script>addEventListener("load",()=>{setTimeout(()=>window.print(),200);});</script>`
    : "";
  return `<!DOCTYPE html>
<html lang="es">
<head>
<meta charset="utf-8"/>
<title>${esc(`Traslado ${input.transferNumber ?? ""}`)}</title>
<style>
body{font-family:system-ui,sans-serif;margin:1rem;font-size:13px;}
h1{font-size:1.1rem;}
table{border-collapse:collapse;width:100%;margin-top:1rem;font-size:12px;}
th,td{border:1px solid #ccc;padding:6px;}
th{background:#f4f4f5;}
.r{text-align:right;}
.muted{color:#666;font-size:12px;}
</style>
</head>
<body>
<h1>Traslado de inventario</h1>
<p class="muted">${esc(input.orgName)}</p>
<p><strong>Estado:</strong> ${esc(input.status)} · <strong>No.:</strong> ${esc(input.transferNumber ?? "—")}</p>
<p><strong>Origen:</strong> ${esc(input.fromName)} → <strong>Destino:</strong> ${esc(input.toName)}</p>
${input.notes ? `<p><strong>Notas:</strong> ${esc(input.notes)}</p>` : ""}
<table><thead><tr><th>SKU</th><th>Producto</th><th>Unidad</th><th class="r">Cantidad</th></tr></thead><tbody>${rows}</tbody></table>
${printScript}
</body>
</html>`;
}
