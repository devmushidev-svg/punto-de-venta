const base = () => localStorage.getItem("pf_api_base") || "";

export function setApiBase(url: string) {
  if (url.trim()) localStorage.setItem("pf_api_base", url.replace(/\/$/, ""));
  else localStorage.removeItem("pf_api_base");
}

export function getApiBase(): string {
  return base();
}

export function apiUrl(path: string): string {
  const b = base();
  if (b) return `${b}${path}`;
  return path;
}

export async function apiFetch<T>(
  path: string,
  options: RequestInit & { token?: string | null } = {}
): Promise<T> {
  const { token, headers: h, ...rest } = options;
  const headers = new Headers(h);
  if (!headers.has("Content-Type") && rest.body && typeof rest.body === "string") {
    headers.set("Content-Type", "application/json");
  }
  const t = token ?? localStorage.getItem("pf_token");
  if (t) headers.set("Authorization", `Bearer ${t}`);

  const res = await fetch(apiUrl(path), { ...rest, headers });
  if (!res.ok) {
    let err = res.statusText;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      if (j?.error) err = j.error;
      if (j?.code) code = j.code;
    } catch {
      /* ignore */
    }
    if (res.status === 401 && code === "PERM_STALE") {
      localStorage.removeItem("pf_token");
      window.dispatchEvent(new Event("pf-auth-stale"));
    }
    throw new Error(err);
  }
  if (res.status === 204) return undefined as T;
  return res.json() as Promise<T>;
}

export async function apiDownload(path: string, token?: string | null): Promise<Blob> {
  const headers = new Headers();
  const t = token ?? localStorage.getItem("pf_token");
  if (t) headers.set("Authorization", `Bearer ${t}`);
  const res = await fetch(apiUrl(path), { headers });
  if (!res.ok) {
    let err = res.statusText;
    let code: string | undefined;
    try {
      const j = (await res.json()) as { error?: string; code?: string };
      if (j?.error) err = j.error;
      if (j?.code) code = j.code;
    } catch {
      /* ignore */
    }
    if (res.status === 401 && code === "PERM_STALE") {
      localStorage.removeItem("pf_token");
      window.dispatchEvent(new Event("pf-auth-stale"));
    }
    throw new Error(err);
  }
  return res.blob();
}
