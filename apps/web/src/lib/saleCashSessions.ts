import { ApiError, apiFetch } from "../api/client";

type CashUser = { role: string; displayName: string; username: string };
type CashSession = { id: string; closedAt: string | null };
export type CashSessionOption = {
  id: string;
  user: { displayName: string; username: string };
};

async function currentSession(token: string, user: CashUser): Promise<CashSessionOption[]> {
  const session = await apiFetch<CashSession | null>("/api/cash-sessions/current", { token });
  return session && !session.closedAt ? [{ id: session.id, user }] : [];
}

export async function loadSaleCashSessions(token: string, user: CashUser): Promise<CashSessionOption[]> {
  if (user.role === "admin") {
    try {
      return await apiFetch<CashSessionOption[]>("/api/cash-sessions/open", { token });
    } catch (error) {
      // La API anterior ofrece la caja propia, pero no el listado de cajas.
      if (!(error instanceof ApiError) || error.status !== 404) throw error;
    }
  }
  return currentSession(token, user);
}

export async function openSaleCashSession(token: string, user: CashUser): Promise<CashSessionOption[]> {
  const current = await currentSession(token, user);
  if (current.length) return current;
  try {
    const session = await apiFetch<CashSession>("/api/cash-sessions/open", {
      method: "POST",
      token,
      body: JSON.stringify({ openingCash: 0 }),
    });
    return [{ id: session.id, user }];
  } catch (error) {
    // Otra ventana puede haber abierto la caja mientras esta esperaba.
    if (error instanceof ApiError && error.status === 400) {
      const opened = await currentSession(token, user);
      if (opened.length) return opened;
    }
    throw error;
  }
}
