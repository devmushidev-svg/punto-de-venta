/**
 * Copia apps/api/prisma/schema.prisma → docs/snapshots/schema.prisma
 * Ejecutar tras cambios en el modelo para mantener referencia (p. ej. migración a Supabase/Postgres).
 */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const apiRoot = path.resolve(__dirname, "..");
const repoRoot = path.resolve(apiRoot, "../..");
const src = path.join(apiRoot, "prisma", "schema.prisma");
const dest = path.join(repoRoot, "docs", "snapshots", "schema.prisma");

fs.mkdirSync(path.dirname(dest), { recursive: true });
fs.copyFileSync(src, dest);
console.log("Schema snapshot:", dest);
