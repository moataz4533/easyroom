import { describe, expect, it } from "vitest";
import { describeQueued, isOfflineSafe, isPermanentFailure } from "../lib/offline-policy";

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
  it("permits nothing the database has never heard of", () => {
    // These two were on the list and are not functions that exist; queueing
    // one only guarantees a jam nobody asked for.
    expect(isOfflineSafe({ kind: "rpc", fn: "move_booking_room", args: {} })).toBe(false);
    expect(isOfflineSafe({ kind: "rpc", fn: "extend_booking", args: {} })).toBe(false);
  });
});

describe("explaining a queued action to whoever is at the desk", () => {
  it("names each kind the app actually queues", () => {
    expect(describeQueued({ kind: "room_status", room_id: "r", status: "clean" })).toBe("housekeeping");
    expect(describeQueued({ kind: "rpc", fn: "check_in_booking" })).toBe("checkIn");
    expect(describeQueued({ kind: "rpc", fn: "check_out_booking" })).toBe("checkOut");
    expect(describeQueued({ kind: "rpc", fn: "something_else" })).toBe("unknown");
    expect(describeQueued(null)).toBe("unknown");
  });
});

describe("whether trying again is worth anything", () => {
  it("calls a changed booking permanent, so the queue is not retried for ever", () => {
    expect(isPermanentFailure({ message: "booking is already checked out" })).toBe(true);
    expect(isPermanentFailure({ message: "not authorised for this property" })).toBe(true);
    expect(isPermanentFailure({ message: 'Could not find the function (PGRST202)' })).toBe(true);
  });
  it("calls a network problem temporary", () => {
    expect(isPermanentFailure({ message: "Failed to fetch" })).toBe(false);
    expect(isPermanentFailure({ message: "" })).toBe(false);
    expect(isPermanentFailure(null)).toBe(false);
  });
});
