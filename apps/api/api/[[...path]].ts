import type { VercelRequest, VercelResponse } from "@vercel/node";
import { app } from "../src/index.js";

async function readBody(req: VercelRequest): Promise<Buffer | undefined> {
  if (["GET", "HEAD"].includes(req.method ?? "GET")) return undefined;
  if (Buffer.isBuffer(req.body)) return req.body;
  if (typeof req.body === "string") return Buffer.from(req.body);
  if (req.body && typeof req.body === "object") return Buffer.from(JSON.stringify(req.body));
  const chunks: Buffer[] = [];
  for await (const chunk of req) chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  return chunks.length ? Buffer.concat(chunks) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  const host = req.headers.host ?? "localhost";
  const protocol = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
  const url = new URL(req.url ?? "/", `${protocol}://${host}`);
  const body = await readBody(req);
  const request = new Request(url, {
    method: req.method,
    headers: req.headers as HeadersInit,
    body: body && body.length ? new Uint8Array(body) : undefined,
  });
  const response = await app.fetch(request);
  res.status(response.status);
  response.headers.forEach((value, key) => res.setHeader(key, value));
  res.send(Buffer.from(await response.arrayBuffer()));
}
