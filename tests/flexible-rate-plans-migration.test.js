import { describe, expect, it } from "vitest";
import { readFileSync } from "fs";

const sql = readFileSync(
  new URL("../supabase/migrations/20260825120000_flexible_rate_plans_and_reservation_proofs.sql", import.meta.url),
  "utf8"
);
const cleanupSql = readFileSync(
  new URL("../supabase/migrations/20260825130000_rate_plan_addon_advisor_cleanup.sql", import.meta.url),
  "utf8"
);

describe("flexible rate-plan migration", () => {
  it("protects the new property table with both grants and row isolation", () => {
    expect(sql).toMatch(/alter table public\.rate_plan_addons enable row level security/i);
    expect(sql).toMatch(/using \(public\.is_member\(property_id\)\)/i);
    expect(sql).toMatch(/using \(public\.is_admin\(property_id\)\)/i);
    expect(sql).toMatch(/grant select, insert, update, delete on table public\.rate_plan_addons to authenticated/i);
  });

  it("uses the same quantity function when quoting and snapshotting services", () => {
    expect(sql.match(/rate_plan_addon_quantity\(/g)?.length).toBeGreaterThanOrEqual(4);
    expect(sql).toMatch(/source_rate_plan_id/i);
    expect(sql).toMatch(/from public\.quote_rate_plan_addons\(/i);
    expect(sql).toMatch(/q\.is_included/i);
  });

  it("keeps plan changes behind admin membership and the manager PIN", () => {
    const start = sql.indexOf("create or replace function public.save_rate_plan");
    const end = sql.indexOf("-- Latest create_booking", start);
    const fn = sql.slice(start, end);
    expect(fn).toMatch(/public\.is_admin\(p_property\)/i);
    expect(fn).toMatch(/public\.require_action_pin\(p_property, p_pin\)/i);
    expect(fn).toMatch(/delete from public\.rate_plan_addons where rate_plan_id = v_plan\.id/i);
  });

  it("includes plan services in backup export and restore order", () => {
    expect(sql).toMatch(/'rate_plan_addons', coalesce\(/i);
    expect(sql).toMatch(/'accounts', 'charge_items', 'rate_plan_addons', 'guests'/i);
  });

  it("keeps new foreign keys indexed and write policies out of SELECT", () => {
    expect(cleanupSql).toMatch(/rate_plan_addons_charge_item_idx/i);
    expect(cleanupSql).toMatch(/booking_charges_source_rate_plan_idx/i);
    expect(cleanupSql).toMatch(/drop policy rate_plan_addons_write/i);
    expect(cleanupSql).toMatch(/for insert to authenticated/i);
    expect(cleanupSql).toMatch(/for update to authenticated/i);
    expect(cleanupSql).toMatch(/for delete to authenticated/i);
  });
});
