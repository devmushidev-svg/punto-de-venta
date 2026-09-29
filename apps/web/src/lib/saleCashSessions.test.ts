import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { loadSaleCashSessions, openSaleCashSession } from "./saleCashSessions";

const admin = { role: "admin", displayName: "Administrador", username: "admin" };
const cashier = { ...admin, role: "user", username: "cajero" };
const session = { id: "own-session", closedAt: null };
const fetchMock = vi.fn<typeof fetch>();
const reply = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status });

beforeEach(() => {
  fetchMock.mockReset();
  vi.stubGlobal("localStorage", { getItem: () => null });
  vi.stubGlobal("fetch", fetchMock);
});
afterEach(() => vi.unstubAllGlobals());

describe("sale cash sessions", () => {
  it("recognizes an admin's existing box when the deployed list endpoint is absent", async () => {
    fetchMock.mockResolvedValueOnce(new Response("404 Not Found", { status: 404 }));
    fetchMock.mockResolvedValueOnce(reply(session));
    expect(await loadSaleCashSessions("token", admin)).toEqual([{ id: session.id, user: admin }]);
    expect(fetchMock.mock.calls.map(([url]) => url)).toEqual([
      "/api/cash-sessions/open", "/api/cash-sessions/current",
    ]);
  });

  it("keeps the company box list when the API supports it", async () => {
    const sessions = [{ id: "other-session", user: cashier }];
    fetchMock.mockResolvedValueOnce(reply(sessions));
    expect(await loadSaleCashSessions("token", admin)).toEqual(sessions);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("only consults the cashier's own box", async () => {
    fetchMock.mockResolvedValueOnce(reply(session));
    expect(await loadSaleCashSessions("token", cashier)).toEqual([{ id: session.id, user: cashier }]);
    expect(fetchMock.mock.calls[0][0]).toBe("/api/cash-sessions/current");
  });

  it("blocks sales when there is no current box", async () => {
    fetchMock.mockResolvedValueOnce(reply(null));
    expect(await loadSaleCashSessions("token", cashier)).toEqual([]);
  });

  it.each([401, 403, 500])("does not disguise HTTP %i as a missing box", async (status) => {
    fetchMock.mockResolvedValueOnce(reply({ error: "Server error" }, status));
    await expect(loadSaleCashSessions("token", admin)).rejects.toMatchObject({ status });
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("reuses the current box without posting a duplicate opening", async () => {
    fetchMock.mockResolvedValueOnce(reply(session));
    expect(await openSaleCashSession("token", admin)).toEqual([{ id: session.id, user: admin }]);
    expect(fetchMock).toHaveBeenCalledTimes(1);
  });

  it("uses the new box directly from the opening response", async () => {
    fetchMock.mockResolvedValueOnce(reply(null)).mockResolvedValueOnce(reply(session, 201));
    expect(await openSaleCashSession("token", admin)).toEqual([{ id: session.id, user: admin }]);
    expect(fetchMock.mock.calls[1][1]?.method).toBe("POST");
  });

  it("recovers if another window opens the box at the same time", async () => {
    fetchMock.mockResolvedValueOnce(reply(null));
    fetchMock.mockResolvedValueOnce(reply({ error: "Ya tiene caja abierta" }, 400));
    fetchMock.mockResolvedValueOnce(reply(session));
    expect(await openSaleCashSession("token", admin)).toEqual([{ id: session.id, user: admin }]);
  });
});
