/**
 * Extrae texto del PDF del manual para que el IDE / el asistente puedan buscarlo.
 * Uso:
 *   npm run manual:extract
 *   npm run manual:extract -- "C:\\Users\\...\\Manual.pdf" "docs\\salida.txt"
 */
const fs = require("fs");
const path = require("path");
const pdf = require("pdf-parse");

const root = path.join(__dirname, "..");
const defaultPdf = path.join(root, "Manual-de-Usuario-Smart-Punto-de-Venta.pdf");
const defaultOut = path.join(root, "docs", "manual-smart-texto-extraido.txt");

const pdfPath = process.argv[2] || defaultPdf;
const outPath = process.argv[3] || defaultOut;

async function main() {
  if (!fs.existsSync(pdfPath)) {
    console.error("No existe el PDF:", pdfPath);
    process.exit(1);
  }
  const buf = fs.readFileSync(pdfPath);
  const data = await pdf(buf);
  const header = [
    `--- extraído automáticamente; fuente: ${path.basename(pdfPath)} ---`,
    `páginas: ${data.numpages}`,
    `no editar a mano; regenerar con: npm run manual:extract`,
    "",
  ].join("\n");
  const body = header + data.text;
  fs.mkdirSync(path.dirname(outPath), { recursive: true });
  fs.writeFileSync(outPath, body, "utf8");
  console.log("OK →", outPath);
  console.log("Caracteres:", body.length);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
