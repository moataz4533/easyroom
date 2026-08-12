"use client";
import { createClient } from "@supabase/supabase-js";

// The publishable key is designed to be shipped to the browser. All the
// protection lives in Row Level Security on the database, not in secrecy
// here. The service_role key must NEVER appear in this file.
const URL = "https://huvbguyvgptmplqbcbdp.supabase.co";
const KEY = "sb_publishable_77yb6RoRzX8tzkTiHw0LlA_uo3r-ft3";

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const PROPERTY_SLUG = "greek-club-dahab";

export const egp = (n) =>
  new Intl.NumberFormat("ar-EG", { maximumFractionDigits: 0 }).format(
    Number(n) || 0
  );

export const today = () => new Date().toISOString().slice(0, 10);

export const addDays = (iso, n) => {
  const d = new Date(iso + "T00:00:00");
  d.setDate(d.getDate() + n);
  return d.toISOString().slice(0, 10);
};

export const nights = (a, b) =>
  Math.round((new Date(b) - new Date(a)) / 86400000);

export const dayLabel = (iso) =>
  new Date(iso + "T00:00:00").toLocaleDateString("ar-EG", {
    day: "numeric",
    month: "short",
  });
