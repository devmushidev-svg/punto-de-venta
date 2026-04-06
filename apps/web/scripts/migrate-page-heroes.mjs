/**
 * One-shot: reemplaza héroes duplicados por <PageHero>. Ejecutar desde apps/web:
 *   node scripts/migrate-page-heroes.mjs
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pagesDir = path.join(__dirname, "../src/pages");

const divRe =
  /<div className="(?:min-w-0 )?rounded-3xl border border-white\/50 bg-gradient-to-br from-white\/90 via-.+? to-.+? px-4 py-4 shadow-lg shadow-orange-950\/\[0\.0[67]\] backdrop-blur-md(?: sm:max-w-2xl sm:flex-1)? sm:px-5">/;
const h1Re =
  /<h1 className="bg-gradient-to-r from-stone-900 via-.+? to-.+? bg-clip-text text-2xl font-extrabold(?: tracking-tight)? text-transparent sm:text-3xl">\s*([^<]+)\s*<\/h1>/;

const leadRe =
  /<p className="mt-1\.5 text-sm font-medium text-stone-800(?: max-w-2xl)?">/g;
const leadRe2 = /<p className="mt-2 text-sm font-medium text-stone-800 max-w-2xl">/g;
const leadRe3 = /<p className="mt-1\.5 text-sm font-medium text-stone-700 max-w-2xl">/g;
const leadRe4 = /<p className="mt-1\.5 text-sm font-medium text-stone-700">/g;
const leadRe5 = /<p className="text-sm font-medium text-stone-800 max-w-2xl">/g;
const leadRe6 = /<p className="text-sm font-medium text-stone-700">/g;

const mutedRe =
  /<p className="mt-2 text-xs leading-relaxed text-stone-600 max-w-2xl">/g;
const mutedRe2 = /<p className="mt-2 text-xs leading-relaxed text-stone-600">/g;
const mutedRe3 = /<p className="mt-1 text-xs leading-relaxed text-stone-600">/g;
const mutedRe4 = /<p className="mt-1 text-xs leading-relaxed text-stone-600 max-w-2xl">/g;
const mutedRe5 = /<p className="text-xs text-stone-500 max-w-2xl">/g;
const mutedRe6 = /<p className="text-xs text-stone-500 leading-relaxed max-w-2xl">/g;

const skip = new Set(["NewQuotePage.tsx"]);

for (const file of fs.readdirSync(pagesDir)) {
  if (!file.endsWith(".tsx") || skip.has(file)) continue;
  const fp = path.join(pagesDir, file);
  let s = fs.readFileSync(fp, "utf8");
  divRe.lastIndex = 0;
  if (!divRe.test(s)) continue;

  const hasImport = s.includes('from "../components/PageHero"') || s.includes("from '../components/PageHero'");
  divRe.lastIndex = 0;
  const open = s.search(divRe);
  if (open === -1) continue;
  const slice = s.slice(open);
  const divMatch = slice.match(divRe);
  if (!divMatch) continue;
  const constrained = divMatch[0].includes("sm:max-w-2xl");
  const rest = slice.slice(divMatch[0].length);
  const h1Match = rest.match(h1Re);
  if (!h1Match) {
    console.warn("skip (no h1 match):", file);
    continue;
  }
  const title = h1Match[1].trim();
  const afterH1 = rest.slice(h1Match[0].length);
  const closeIdx = afterH1.indexOf("</div>");
  if (closeIdx === -1) continue;
  const inner = afterH1.slice(0, closeIdx);
  const afterClose = afterH1.slice(closeIdx + 6);

  let innerStyled = inner
    .replace(leadRe, '<p className="pf-page-lead max-w-2xl">')
    .replace(leadRe2, '<p className="pf-page-lead max-w-2xl mt-2">')
    .replace(leadRe3, '<p className="pf-page-lead max-w-2xl">')
    .replace(leadRe4, '<p className="pf-page-lead">')
    .replace(leadRe5, '<p className="pf-page-lead max-w-2xl">')
    .replace(leadRe6, '<p className="pf-page-lead">')
    .replace(mutedRe, '<p className="pf-page-lead-muted max-w-2xl">')
    .replace(mutedRe2, '<p className="pf-page-lead-muted">')
    .replace(mutedRe3, '<p className="pf-page-lead-muted">')
    .replace(mutedRe4, '<p className="pf-page-lead-muted max-w-2xl">')
    .replace(mutedRe5, '<p className="pf-page-lead-muted max-w-2xl">')
    .replace(mutedRe6, '<p className="pf-page-lead-muted max-w-2xl">');

  const heroJsx = `<PageHero title={${JSON.stringify(title)}}${constrained ? " constrained" : ""}>${innerStyled}</PageHero>`;

  const before = s.slice(0, open);
  const rebuilt = before + heroJsx + afterClose;
  let out = rebuilt;
  if (!hasImport) {
    const reactImport = out.match(/^import .+ from "react";$/m);
    if (reactImport) {
      out = out.replace(reactImport[0], `${reactImport[0]}\nimport { PageHero } from "../components/PageHero";`);
    } else {
      out = `import { PageHero } from "../components/PageHero";\n` + out;
    }
  }
  fs.writeFileSync(fp, out);
  console.log("migrated:", file);
}
