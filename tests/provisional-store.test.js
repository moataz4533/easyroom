import { beforeEach, describe, expect, it, vi } from "vitest";

// The paths in here only run when the connection has already failed once,
// so they would otherwise never be exercised until the night they matter.
const rpc = vi.fn();
vi.mock("../lib/supabase", () => ({ supabase: { rpc: (...args) => rpc(...args) } }));

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, String(v)),
  removeItem: (k) => store.delete(k),
};
globalThis.window = { addEventListener() {}, removeEventListener() {}, dispatchEvent() {} };
globalThis.Event = class { constructor(type) { this.type = type; } };
// Node exposes navigator as a getter-only property, so it is replaced whole.
const net = { onLine: true };
Object.defineProperty(globalThis, "navigator", { value: net, configurable: true, writable: true });

const {
  provisionalAdd, provisionalCount, provisionalFlush, provisionalList,
  provisionalRemove, provisionalRetry,
  queueAdd, queueClearOne, queueCount, queueFlush, queueStuck,
} = await import("../lib/offline");
const { newProvisional } = await import("../lib/provisional");

const record = (id, over = {}) => newProvisional({
  propertyId: "p1", guestName: `نزيل ${id}`, guestPhone: `+2010${id}`,
  checkIn: "2026-09-01", checkOut: "2026-09-03", rooms: { [`r${id}`]: 2 },
  ...over,
}, { now: Number(id), id });

const taken = () => Object.assign(new Error("conflicting key value"), { code: "23P01" });
const ok = (reference) => ({ data: { reference }, error: null });

beforeEach(() => {
  store.clear();
  rpc.mockReset();
  net.onLine = true;
});

describe("keeping them", () => {
  it("refuses to store one that could never be sent", () => {
    expect(() => provisionalAdd(record("1", { guestName: "  " }))).toThrow(/name/);
    expect(provisionalList()).toEqual([]);
  });

  it("keeps the guest who called first at the front", () => {
    provisionalAdd(record("3"));
    provisionalAdd(record("1"));
    expect(provisionalList().map((r) => r.id)).toEqual(["1", "3"]);
  });

  it("survives a corrupted store rather than taking the app down with it", () => {
    store.set("easyroom:provisional", "{not json");
    expect(provisionalList()).toEqual([]);
  });
});

describe("sending them", () => {
  it("marks one that landed with its booking reference, and never sends it twice", async () => {
    provisionalAdd(record("1"));
    rpc.mockResolvedValueOnce(ok("GR26-0031"));

    expect(await provisionalFlush()).toMatchObject({ sent: 1, refused: 0 });
    expect(provisionalList()[0]).toMatchObject({ state: "sent", reference: "GR26-0031" });

    expect(await provisionalFlush()).toMatchObject({ sent: 0, refused: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("carries the device's own reference, so a lost answer cannot book twice", async () => {
    provisionalAdd(record("1"));
    rpc.mockResolvedValueOnce(ok("GR26-0031"));
    await provisionalFlush();
    expect(rpc.mock.calls[0][1]).toMatchObject({ p_client_ref: "1", p_property: "p1" });
  });

  it("does not let a refused booking hold up the ones behind it", async () => {
    provisionalAdd(record("1"));
    provisionalAdd(record("2"));
    provisionalAdd(record("3"));
    rpc.mockRejectedValueOnce(taken())
       .mockResolvedValueOnce(ok("GR26-0032"))
       .mockResolvedValueOnce(ok("GR26-0033"));

    const result = await provisionalFlush();
    expect(result).toMatchObject({ sent: 2, refused: 1 });
    expect(provisionalList().map((r) => r.state)).toEqual(["failed", "sent", "sent"]);
  });

  it("keeps a refusal with a reason reception can act on", async () => {
    provisionalAdd(record("1"));
    rpc.mockRejectedValueOnce(taken());
    await provisionalFlush();
    expect(provisionalList()[0].error).toMatchObject({ kind: "taken" });
  });

  it("does not retry a refusal on its own — that room is genuinely gone", async () => {
    provisionalAdd(record("1"));
    rpc.mockRejectedValueOnce(taken());
    await provisionalFlush();

    expect(provisionalCount()).toBe(0);
    expect(await provisionalFlush()).toMatchObject({ sent: 0, refused: 0 });
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("puts a refusal back in line when somebody asks for it", async () => {
    provisionalAdd(record("1"));
    rpc.mockRejectedValueOnce(taken());
    await provisionalFlush();

    provisionalRetry("1", { rooms: { r9: 2 } });
    expect(provisionalList()[0]).toMatchObject({ state: "pending", error: null });

    rpc.mockResolvedValueOnce(ok("GR26-0040"));
    await provisionalFlush();
    expect(rpc.mock.calls[1][1].p_rooms).toEqual([{ room_id: "r9", occupancy: 2 }]);
  });

  it("leaves the rest pending when the connection drops mid-send", async () => {
    provisionalAdd(record("1"));
    provisionalAdd(record("2"));
    rpc.mockImplementationOnce(async () => {
      net.onLine = false;
      throw new Error("Failed to fetch");
    });

    const result = await provisionalFlush();
    expect(result).toMatchObject({ sent: 0, refused: 0 });
    // Neither is marked failed: nothing was refused, the phone just left.
    expect(provisionalList().map((r) => r.state)).toEqual(["pending", "pending"]);
    expect(provisionalCount()).toBe(2);
  });

  it("counts only what is still waiting, so the strip does not nag about the past", async () => {
    provisionalAdd(record("1"));
    provisionalAdd(record("2"));
    rpc.mockResolvedValueOnce(ok("GR26-0050")).mockRejectedValueOnce(taken());
    await provisionalFlush();
    expect(provisionalCount()).toBe(0);
  });
});

describe("the ordered queue, when it jams", () => {
  it("writes the reason onto the item instead of stalling in silence", async () => {
    queueAdd({ kind: "rpc", fn: "check_out_booking", args: { p_booking: "b1" } });
    queueAdd({ kind: "room_status", room_id: "r1", status: "clean" });
    rpc.mockResolvedValueOnce({ error: { message: "booking is already checked out" } });

    await queueFlush();
    const [stuck] = queueStuck();
    expect(stuck).toMatchObject({ fn: "check_out_booking" });
    expect(stuck.error).toMatchObject({ permanent: true });
    // The cleaning status behind it was not sent, and not lost either.
    expect(queueCount()).toBe(2);
    expect(rpc).toHaveBeenCalledTimes(1);
  });

  it("lets the rest through once the stuck one is discarded", async () => {
    queueAdd({ kind: "rpc", fn: "check_out_booking", args: { p_booking: "b1" } });
    queueAdd({ kind: "room_status", room_id: "r1", status: "clean" });
    rpc.mockResolvedValueOnce({ error: { message: "booking is already checked out" } });
    await queueFlush();

    queueClearOne(queueStuck()[0].id);
    rpc.mockResolvedValueOnce({ error: null });
    expect(await queueFlush()).toMatchObject({ done: 1 });
    expect(queueCount()).toBe(0);
  });

  it("does not blame the item when the connection died mid-flush", async () => {
    queueAdd({ kind: "room_status", room_id: "r1", status: "clean" });
    rpc.mockImplementationOnce(async () => {
      net.onLine = false;
      throw new Error("Failed to fetch");
    });

    await queueFlush();
    expect(queueStuck()).toEqual([]);
    expect(queueCount()).toBe(1);
  });
});

describe("clearing them", () => {
  it("removes the one asked for and leaves the others", () => {
    provisionalAdd(record("1"));
    provisionalAdd(record("2"));
    provisionalRemove("1");
    expect(provisionalList().map((r) => r.id)).toEqual(["2"]);
  });
});
