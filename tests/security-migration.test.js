import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync } from "node:fs";

const folder = new URL("../supabase/migrations/", import.meta.url);
const hardening = readFileSync(new URL("../supabase/migrations/20260813053716_bilingual_security_hardening.sql", import.meta.url), "utf8");
const logoStorage = readFileSync(new URL("../supabase/migrations/20260813134636_property_logo_storage.sql", import.meta.url), "utf8");
const staffLogin = readFileSync(new URL("../supabase/migrations/20260813135907_staff_username_login.sql", import.meta.url), "utf8");
const staffAdmin = readFileSync(new URL("../supabase/functions/staff-admin/index.ts", import.meta.url), "utf8");
const checkoutTimeline = readFileSync(new URL("../supabase/migrations/20260813185755_fix_checkout_and_activity_timeline.sql", import.meta.url), "utf8");

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
