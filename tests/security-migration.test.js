import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const folder = new URL("../supabase/migrations/", import.meta.url);
const hardening = readFileSync(new URL("../supabase/migrations/20260813053716_bilingual_security_hardening.sql", import.meta.url), "utf8");
const logoStorage = readFileSync(new URL("../supabase/migrations/20260813134636_property_logo_storage.sql", import.meta.url), "utf8");
const staffLogin = readFileSync(new URL("../supabase/migrations/20260813135907_staff_username_login.sql", import.meta.url), "utf8");
const staffAdmin = readFileSync(new URL("../supabase/functions/staff-admin/index.ts", import.meta.url), "utf8");
const checkoutTimeline = readFileSync(new URL("../supabase/migrations/20260813185755_fix_checkout_and_activity_timeline.sql", import.meta.url), "utf8");
const checkoutBill = readFileSync(new URL("../supabase/migrations/20260814220000_recalc_bill_on_checkout.sql", import.meta.url), "utf8");
const earlyDeparture = readFileSync(new URL("../supabase/migrations/20260814231500_early_departure_choice.sql", import.meta.url), "utf8");
const managerPassword = readFileSync(new URL("../supabase/migrations/20260815001500_stronger_manager_password.sql", import.meta.url), "utf8");

describe("database hardening migration", () => {
  it("contains the exact recovered production history before the new migration", () => {
    const files = readdirSync(folder).filter((file) => file.endsWith(".sql"));
    expect(files.filter((file) => file < "20260813053716")).toHaveLength(24);
  });
  it("removes broad room/task updates and exposes narrow RPCs", () => {
    expect(hardening).toContain("drop policy if exists rooms_update");
    expect(hardening).toContain("drop policy if exists tasks_update");
    expect(hardening).toContain("set_housekeeping_status");
    expect(hardening).toContain("update_room_admin");
  });
  it("keeps housekeeping away from guests, bookings, prices and staff", () => {
    expect(hardening).toMatch(/guests_select[\s\S]*can_manage/);
    expect(hardening).toMatch(/bookings_select[\s\S]*can_manage/);
    expect(hardening).toMatch(/rate_plans_select[\s\S]*can_manage/);
    expect(hardening).toMatch(/members_select[\s\S]*is_admin/);
    expect(hardening).toContain("list_housekeeping_rooms");
  });

  it("makes checkout idempotent and exposes a manager-only activity timeline", () => {
    expect(checkoutTimeline).toContain("if v_booking.status = 'checked_out' then");
    expect(checkoutTimeline).toMatch(/if v_booking\.status = 'checked_out'[\s\S]*return v_booking;/);
    expect(checkoutTimeline).toContain("released_at = now()");
    expect(checkoutTimeline).toContain("self-healing");
    expect(checkoutTimeline).toContain("list_activity_timeline");
    expect(checkoutTimeline).toContain("not public.is_admin(p_property)");
    expect(checkoutTimeline).toContain("revoke all on function public.list_activity_timeline");
  });
  it("bills a guest who leaves early for the nights they slept", () => {
    // Both paths shorten the stay, so both have to reprice it — otherwise the
    // reports and the guest's bill give different answers for one stay.
    expect(checkoutBill.match(/perform public\.recalc_booking_total\(p_booking\)/g)).toHaveLength(2);
    expect(checkoutBill).toMatch(/recalc_booking_total[\s\S]*select \* into v_booking from public\.bookings/);
    // Cancelling is not the same thing, and is deliberately left alone —
    // this migration redefines one function and no others.
    expect(checkoutBill.match(/create or replace function/gi)).toHaveLength(1);
    expect(checkoutBill).toContain("create or replace function public.check_out_booking");
  });
  it("leaves the hotel the early-departure decision, without inventing nights", () => {
    // One check-out in the database, not two: the old single-argument version
    // is dropped so nothing can reach a version that cannot be told what to do.
    expect(earlyDeparture).toContain("drop function if exists public.check_out_booking(uuid)");
    expect(earlyDeparture).toContain("p_charge_unstayed boolean default false");
    // Billing the whole stay is a line on the bill, never an extra night.
    expect(earlyDeparture).toMatch(/if p_charge_unstayed and v_booked > v_stayed then[\s\S]*add_booking_charge/);
    expect(earlyDeparture).not.toMatch(/insert into public\.allocation_nights/);
    // A replayed check-out must not bill the fee a second time.
    expect(earlyDeparture).toMatch(/if v_booking\.status = 'checked_out' then[\s\S]*?return v_booking;/);
    expect(earlyDeparture.split("return v_booking;")[0]).not.toContain("add_booking_charge");
    expect(earlyDeparture).toContain("grant execute on function public.check_out_booking(uuid, boolean) to authenticated");
  });
  it("refuses a manager password anybody would guess first", () => {
    expect(managerPassword).toContain("length(v_pin) < 6");
    expect(managerPassword).toContain("^(.)\\1+$");          // one character repeated
    expect(managerPassword).toContain("01234567890123456789"); // a run upwards
    expect(managerPassword).toContain("98765432109876543210"); // and downwards
    // The lockout underneath is untouched: five tries, fifteen minutes.
    expect(managerPassword).toContain("failed_attempts + 1 >= 5");
    expect(managerPassword).toContain("interval '15 minutes'");
    // Only setting is affected. Verifying still compares against the stored
    // hash, so a password already in use is not invalidated by the new rule.
    expect(managerPassword).toMatch(/verify_action_pin[\s\S]*crypt\(coalesce\(p_pin, ''\), v_hash\)/);
    expect(managerPassword).not.toMatch(/verify_action_pin[\s\S]*length\(v_pin\) < 6/);
  });
  it("limits hotel logo uploads to admin images no larger than 5MB", () => {
    expect(logoStorage).toContain("5242880");
    expect(logoStorage).toContain("image/png");
    expect(logoStorage).toContain("image/jpeg");
    expect(logoStorage).toContain("image/webp");
    expect(logoStorage).toContain("member.role in ('owner', 'manager')");
  });
  it("keeps staff usernames unique inside each hotel", () => {
    expect(staffLogin).toContain("login_username");
    expect(staffLogin).toContain("property_members_property_login_username_key");
    expect(staffLogin).toContain("property_id, lower(login_username)");
  });
  it("scopes every staff mutation to the caller's hotel", () => {
    expect(staffAdmin.match(/\.eq\("property_id", property_id\)/g)?.length).toBeGreaterThanOrEqual(6);
    expect(staffAdmin).toContain("asCaller.auth.getUser()");
  });
});
