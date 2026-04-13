import type { Customer, Organization, Product, Sale, SaleLine, User } from "@prisma/client";
import PDFDocument from "pdfkit";

export type SaleComprobanteModel = Sale & {
  customer: Customer | null;
  user: Pick<User, "displayName"> | null;
  lines: (SaleLine & { product: Product })[];
};

type ComprobanteCfg = { title?: string; showSku?: boolean };
type TicketCfg = { headerLine?: string; footerLine?: string; showTaxBreakdown?: boolean };
type SarCfg = { footerSar?: string };

function parseInvoice(invoice: Record<string, unknown>): { comp: ComprobanteCfg; ticket: TicketCfg; sar: SarCfg } {
  const ticket = (invoice.ticket as TicketCfg) ?? {};
  const sar = (invoice.sar as SarCfg) ?? {};
  const c = invoice.comprobante;
  const comp: ComprobanteCfg = {};
  if (c && typeof c === "object") {
    const o = c as Record<string, unknown>;
    if (typeof o.title === "string") comp.title = o.title;
    if (typeof o.showSku === "boolean") comp.showSku = o.showSku;
  }
  return { comp, ticket, sar };
}

function money(sym: string, n: number): string {
  return `${sym} ${n.toFixed(2)}`;
}

function fmtDate(d: Date): string {
  return d.toLocaleDateString("es-HN", { day: "2-digit", month: "short", year: "numeric" });
}

function safeLine(s: string, max = 120): string {
  return s.replace(/\r\n/g, "\n").replace(/[\x00-\x08\x0b\x0c\x0e-\x1f]/g, "").slice(0, max);
}

const LOGO_FETCH_MS = 8000;
const LOGO_FIT_W = 120;
const LOGO_FIT_H = 52;
const LEFT_COL_GAP = 8;

/** Carga PNG/JPEG (URL https o data URL) para incrustar en PDF. Falla en silencio si no aplica. */
async function loadLogoBufferForPdf(logoUrl: string | null | undefined): Promise<Buffer | null> {
  const raw = logoUrl?.trim();
  if (!raw) return null;
  try {
    if (raw.startsWith("data:image/")) {
      const m = raw.match(/^data:image\/[\w+.-]+;base64,(.+)$/i);
      if (!m) return null;
      return Buffer.from(m[1], "base64");
    }
    if (raw.startsWith("http://") || raw.startsWith("https://")) {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), LOGO_FETCH_MS);
      const res = await fetch(raw, { signal: ctrl.signal, redirect: "follow" });
      clearTimeout(t);
      if (!res.ok) return null;
      const ct = (res.headers.get("content-type") ?? "").split(";")[0].trim().toLowerCase();
      if (!ct.startsWith("image/")) return null;
      if (ct === "image/svg+xml") return null;
      return Buffer.from(await res.arrayBuffer());
    }
  } catch {
    return null;
  }
  return null;
}

/** Genera PDF tipo carta alineado a la vista web del comprobante. */
export async function buildSaleComprobantePdf(
  org: Organization,
  sale: SaleComprobanteModel,
  invoiceJson: Record<string, unknown>
): Promise<Buffer> {
  const { comp, ticket, sar } = parseInvoice(invoiceJson);
  const title = comp.title?.trim() || "Comprobante de venta";
  const showSku = comp.showSku !== false;
  const showTax = ticket.showTaxBreakdown !== false;
  const sym = org.currencySymbol || "L";
  const balance = sale.total - sale.paid;
  const docNo = sale.invoiceNumber ?? sale.id.slice(0, 8);
  const addrLine = [org.address, org.city, org.department, org.zip].filter(Boolean).join(", ");

  const logoBuf = await loadLogoBufferForPdf(org.logoUrl);

  return new Promise((resolve, reject) => {
    const doc = new PDFDocument({ margin: 48, size: "LETTER", bufferPages: true });
    const chunks: Buffer[] = [];
    doc.on("data", (chunk: Buffer) => chunks.push(chunk));
    doc.on("end", () => resolve(Buffer.concat(chunks)));
    doc.on("error", reject);

    const pageBottom = 720;
    const ensureSpace = (need: number) => {
      if (doc.y + need > pageBottom) doc.addPage();
    };

    const rightX = doc.page.width - 48 - 200;
    const topY = 48;
    let leftColX = 48;
    if (logoBuf) {
      try {
        doc.image(logoBuf, 48, topY, { fit: [LOGO_FIT_W, LOGO_FIT_H] });
        leftColX = 48 + LOGO_FIT_W + LEFT_COL_GAP;
      } catch {
        leftColX = 48;
      }
    }
    const leftColW = Math.max(80, rightX - leftColX - LEFT_COL_GAP);

    doc.fontSize(8).font("Helvetica-Bold").text(title.toUpperCase(), rightX, topY, { width: 200, align: "right" });
    doc.font("Helvetica").fontSize(11);
    doc.text(`No. ${docNo}`, rightX, topY + 16, { width: 200, align: "right" });
    doc.fontSize(9).text(fmtDate(sale.saleDate), rightX, topY + 34, { width: 200, align: "right" });
    doc.text(`Términos: ${safeLine(sale.terms, 40)}`, rightX, topY + 50, { width: 200, align: "right" });
    if (sale.dueDate) {
      doc.text(`Vence: ${fmtDate(sale.dueDate)}`, rightX, topY + 64, { width: 200, align: "right" });
    }

    doc.fontSize(16).font("Helvetica-Bold").text(safeLine(org.name), leftColX, topY, { width: leftColW });
    doc.x = leftColX;
    doc.moveDown(0.25);
    doc.fontSize(9).font("Helvetica");
    if (org.slogan) doc.text(safeLine(org.slogan), { width: leftColW });
    if (ticket.headerLine) doc.text(safeLine(ticket.headerLine, 400), { width: Math.min(320, leftColW) });
    if (addrLine) doc.text(safeLine(addrLine), { width: leftColW });
    if (org.taxId) doc.text(`${org.taxIdType ?? "RTN"} ${org.taxId}`);
    if (org.phone) doc.text(`Tel. ${safeLine(org.phone, 40)}`);
    if (org.email) doc.text(safeLine(org.email, 60), { width: leftColW });

    const headerFloor = Math.max(topY + 88, topY + (logoBuf ? LOGO_FIT_H : 0) + 4);
    doc.y = Math.max(doc.y, headerFloor);
    doc.moveDown(1);
    doc.moveTo(48, doc.y).lineTo(doc.page.width - 48, doc.y).strokeColor("#cccccc").stroke();
    doc.moveDown(0.75);

    doc.fontSize(9).font("Helvetica-Bold").text("CLIENTE");
    doc.moveDown(0.35);
    doc.font("Helvetica");
    if (sale.customer) {
      doc.font("Helvetica-Bold").text(safeLine(sale.customer.name));
      doc.font("Helvetica");
      if (sale.customer.taxId) doc.text(`ID fiscal: ${safeLine(sale.customer.taxId)}`);
      const cx = [sale.customer.address, sale.customer.phone].filter(Boolean).join(" · ");
      if (cx) doc.text(safeLine(cx, 200));
    } else {
      doc.fillColor("#666666").text("Consumidor final / sin cliente registrado");
      doc.fillColor("#000000");
    }
    doc.moveDown(1);

    const left = 48;
    const right = doc.page.width - 48;
    const w = right - left;
    const colSku = left;
    const colDesc = showSku ? left + 58 : left;
    const colQty = left + w * 0.52;
    const colUnit = left + w * 0.6;
    const colDisc = left + w * 0.72;
    const colTax = left + w * 0.8;
    const colTot = left + w * 0.86;
    const rowH = 13;

    ensureSpace(36);
    const headerY = doc.y;
    doc.fontSize(8).font("Helvetica-Bold");
    if (showSku) doc.text("Código", colSku, headerY, { width: 54 });
    doc.text("Descripción", colDesc, headerY, { width: colQty - colDesc - 4 });
    doc.text("Cant.", colQty, headerY, { width: 34, align: "right" });
    doc.text("P.unit.", colUnit, headerY, { width: 48, align: "right" });
    doc.text("%D", colDisc, headerY, { width: 22, align: "right" });
    doc.text("ISV", colTax, headerY, { width: 26, align: "right" });
    doc.text("Total", colTot, headerY, { width: right - colTot, align: "right" });
    doc.y = headerY + rowH;
    doc.moveTo(left, doc.y).lineTo(right, doc.y).strokeColor("#e5e5e5").stroke();
    doc.moveDown(0.35);

    doc.font("Helvetica").fontSize(8);
    for (const l of sale.lines) {
      ensureSpace(rowH + 6);
      const y0 = doc.y;
      const name = safeLine(l.product.name, 48);
      if (showSku) doc.text(safeLine(l.product.sku, 12), colSku, y0, { width: 54 });
      doc.text(name, colDesc, y0, { width: colQty - colDesc - 4 });
      doc.text(String(l.qty), colQty, y0, { width: 34, align: "right" });
      doc.text(money(sym, l.unitPrice), colUnit, y0, { width: 48, align: "right" });
      doc.text(l.discountPercent > 0 ? String(l.discountPercent) : "—", colDisc, y0, { width: 22, align: "right" });
      doc.text(l.taxPercent > 0 ? `${l.taxPercent}%` : "—", colTax, y0, { width: 26, align: "right" });
      doc.font("Helvetica-Bold").text(money(sym, l.lineTotal), colTot, y0, { width: right - colTot, align: "right" });
      doc.font("Helvetica");
      doc.y = y0 + rowH;
    }

    doc.moveDown(1);
    ensureSpace(100);
    const boxLeft = doc.page.width - 48 - 200;
    doc.font("Helvetica").fontSize(9);
    if (sale.user?.displayName) doc.text(`Vendedor: ${safeLine(sale.user.displayName)}`);
    if (sale.notes) doc.text(`Notas: ${safeLine(sale.notes, 300)}`, { width: boxLeft - 48 });

    doc.fontSize(9);
    let ty = doc.y;
    if (showTax) {
      doc.text("Subtotal", boxLeft, ty, { width: 100 });
      doc.text(money(sym, sale.subtotal), boxLeft + 100, ty, { width: 80, align: "right" });
      ty += 16;
      doc.text("Impuesto", boxLeft, ty, { width: 100 });
      doc.text(money(sym, sale.tax), boxLeft + 100, ty, { width: 80, align: "right" });
      ty += 16;
    }
    doc.font("Helvetica-Bold").text("Total", boxLeft, ty, { width: 100 });
    doc.text(money(sym, sale.total), boxLeft + 100, ty, { width: 80, align: "right" });
    ty += 18;
    doc.font("Helvetica").fillColor("#555555").text("Pagado", boxLeft, ty, { width: 100 });
    doc.text(money(sym, sale.paid), boxLeft + 100, ty, { width: 80, align: "right" });
    doc.fillColor("#000000");
    ty += 16;
    if (balance > 0.009) {
      doc.fillColor("#8b4513").font("Helvetica-Bold").text("Saldo", boxLeft, ty, { width: 100 });
      doc.text(money(sym, balance), boxLeft + 100, ty, { width: 80, align: "right" });
      doc.fillColor("#000000").font("Helvetica");
    }

    doc.moveDown(2);
    ensureSpace(36);
    const foot =
      ticket.footerLine?.trim() ||
      "Documento generado electrónicamente — válido como comprobante de operación.";
    doc.fontSize(8).fillColor("#666666").text(safeLine(foot, 500), 48, doc.y, {
      width: doc.page.width - 96,
      align: "center",
    });

    const sarFoot = sar.footerSar?.trim();
    if (sarFoot) {
      doc.moveDown(0.75);
      ensureSpace(28);
      doc.fontSize(7).fillColor("#555555").text(safeLine(sarFoot, 500), 48, doc.y, {
        width: doc.page.width - 96,
        align: "center",
      });
    }

    doc.end();
  });
}
