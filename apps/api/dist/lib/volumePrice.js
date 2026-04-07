export function parseVolumePricesJson(raw) {
    if (raw == null || String(raw).trim() === "")
        return [];
    try {
        const j = JSON.parse(String(raw));
        if (!Array.isArray(j))
            return [];
        const out = [];
        for (const o of j) {
            if (!o || typeof o !== "object")
                continue;
            const minQty = Number(o.minQty);
            const price = Number(o.price);
            if (!Number.isFinite(minQty) || minQty <= 0 || !Number.isFinite(price) || price < 0)
                continue;
            out.push({ minQty, price });
        }
        out.sort((a, b) => a.minQty - b.minQty);
        return out;
    }
    catch {
        return [];
    }
}
export function priceForTier(p, tier) {
    if (tier === 2 && p.price2 != null)
        return p.price2;
    if (tier === 3 && p.price3 != null)
        return p.price3;
    if (tier === 4 && p.price4 != null)
        return p.price4;
    return p.price;
}
/** Lista 1–4 como base; si hay tramos por cantidad, el precio del mayor `minQty` que cumpla `qty` sustituye ese base. */
export function resolveProductUnitPrice(p, qty, tier) {
    const tiers = parseVolumePricesJson(p.volumePricesJson);
    let unit = priceForTier(p, tier);
    if (tiers.length === 0 || !Number.isFinite(qty) || qty <= 0)
        return unit;
    for (const t of tiers) {
        if (qty >= t.minQty)
            unit = t.price;
    }
    return unit;
}
function coerceVolumeInput(body) {
    if (typeof body === "string") {
        try {
            return JSON.parse(body);
        }
        catch {
            return [];
        }
    }
    return body;
}
/** Normaliza el cuerpo de API (string JSON o arreglo) a string JSON guardable en BD. */
export function normalizeVolumePricesPayload(body) {
    const raw = coerceVolumeInput(body);
    if (!Array.isArray(raw))
        return "[]";
    const out = [];
    for (const o of raw) {
        if (!o || typeof o !== "object")
            continue;
        const minQty = Number(o.minQty);
        const price = Number(o.price);
        if (!Number.isFinite(minQty) || minQty <= 0 || !Number.isFinite(price) || price < 0)
            continue;
        out.push({ minQty, price });
    }
    out.sort((a, b) => a.minQty - b.minQty);
    return JSON.stringify(out);
}
