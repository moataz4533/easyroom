import { describe, expect, it } from "vitest";
import { isOfflineSafe } from "../lib/offline-policy";

describe("offline queue policy", () => {
  it("allows idempotent housekeeping changes", () => {
    expect(isOfflineSafe({ kind: "room_status", room_id: "room-1", status: "clean" })).toBe(true);
  });
  it("rejects creating a booking while offline", () => {
    expect(isOfflineSafe({ kind: "rpc", fn: "create_booking", args: {} })).toBe(false);
  });
  it("allows supported operations on an existing booking", () => {
    expect(isOfflineSafe({ kind: "rpc", fn: "check_out_booking", args: { p_booking: "b-1" } })).toBe(true);
  });
});
