"use client";
import { createClient } from "@supabase/supabase-js";
import { countNights, formatDate, formatNumber } from "./format";

// The publishable key is designed to be shipped to the browser. All the
// protection lives in Row Level Security on the database, not in secrecy
// here. The service_role key must NEVER appear in this file.
const URL = "https://huvbguyvgptmplqbcbdp.supabase.co";
const KEY = "sb_publishable_77yb6RoRzX8tzkTiHw0LlA_uo3r-ft3";

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

export const PROPERTY_SLUG = "greek-club-dahab";

export const egp = (n, locale = "ar") => formatNumber(n, locale, { maximumFractionDigits: 0 });

export const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: "Africa/Cairo", year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export const addDays = (iso, n) => {
  const [year, month, day] = iso.split("-").map(Number);
  const d = new Date(Date.UTC(year, month - 1, day + n));
  return d.toISOString().slice(0, 10);
};

export const nights = countNights;

export const dayLabel = (iso, locale = "ar") => formatDate(iso, locale);
