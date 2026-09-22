import type { VercelRequest, VercelResponse } from "@vercel/node";
import { app } from "../src/index.js";

const MAX_REQUEST_BYTES = 20 * 1024 * 1024;

function requestTooLarge(req: VercelRequest) {
  const raw = req.headers["content-length"];
  const length = Number(Array.isArray(raw) ? raw[0] : raw);
  return Number.isFinite(length) && length > MAX_REQUEST_BYTES;
}

async function readBody(req: VercelRequest): Promise<Uint8Array | undefined> {
  if (["GET", "HEAD"].includes(req.method ?? "GET")) return undefined;
  if (Buffer.isBuffer(req.body)) {
    if (req.body.byteLength > MAX_REQUEST_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    return new Uint8Array(req.body);
  }
  if (typeof req.body === "string") {
    const body = Buffer.from(req.body);
    if (body.byteLength > MAX_REQUEST_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    return new Uint8Array(body);
  }
  if (req.body && typeof req.body === "object") {
    const body = Buffer.from(JSON.stringify(req.body));
    if (body.byteLength > MAX_REQUEST_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    return new Uint8Array(body);
  }

  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of req) {
    const buffer = Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk);
    size += buffer.byteLength;
    if (size > MAX_REQUEST_BYTES) throw new Error("PAYLOAD_TOO_LARGE");
    chunks.push(buffer);
  }
  return size ? new Uint8Array(Buffer.concat(chunks)) : undefined;
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (requestTooLarge(req)) return res.status(413).json({ error: "Solicitud demasiado grande." });
  try {
    const host = req.headers.host ?? "localhost";
    const protocol = req.headers["x-forwarded-proto"] === "https" ? "https" : "http";
    const url = new URL(req.url ?? "/", `${protocol}://${host}`);
    const payload = await readBody(req);
    const body = payload
      ? new Blob([
          payload.buffer.slice(payload.byteOffset, payload.byteOffset + payload.byteLength) as ArrayBuffer,
        ])
      : undefined;
    const request = new Request(url, {
      method: req.method,
      headers: req.headers as HeadersInit,
      body,
    });
    const response = await app.fetch(request);
    res.status(response.status);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.send(Buffer.from(await response.arrayBuffer()));
  } catch (error) {
    if (error instanceof Error && error.message === "PAYLOAD_TOO_LARGE") {
      return res.status(413).json({ error: "Solicitud demasiado grande." });
    }
    throw error;
  }
}
