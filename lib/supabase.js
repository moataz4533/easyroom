"use client";
import { createClient } from "@supabase/supabase-js";
import { countNights, formatDate, formatNumber, shiftDate } from "./format";
import { hotelZone } from "./hotel-settings";

// The publishable key is designed to be shipped to the browser. All the
// protection lives in Row Level Security on the database, not in secrecy
// here. The service_role key must NEVER appear in this file.
const URL = "https://huvbguyvgptmplqbcbdp.supabase.co";
const KEY = "sb_publishable_77yb6RoRzX8tzkTiHw0LlA_uo3r-ft3";

export const supabase = createClient(URL, KEY, {
  auth: { persistSession: true, autoRefreshToken: true },
});

/**
 * Only the login screen still needs this, and only as a starting guess.
 *
 * A staff member signs in with a username rather than an email, and a
 * username is unique inside a hotel, not across them — so the login has to
 * know which hotel before anyone is signed in and the database can be asked.
 * Once signed in, the hotel comes from the account's memberships and this is
 * not consulted again.
 */
// The hotel this deployment opens on. One hotel's code was written into
// the source, so every other hotel's staff would have arrived at a login
// box already filled in with somebody else's branch. It belongs to the
// deployment, not to the code: set NEXT_PUBLIC_DEFAULT_HOTEL per Vercel
// project. The value below keeps this deployment working unchanged.
export const DEFAULT_PROPERTY_SLUG =
  process.env.NEXT_PUBLIC_DEFAULT_HOTEL || "greek-club-dahab";

export const egp = (n, locale = "ar") => formatNumber(n, locale, { maximumFractionDigits: 0 });

// Which day it is *at the hotel*, not on the device and not in Cairo. The
// zone comes from the property; see lib/hotel-settings.
export const today = () => new Intl.DateTimeFormat("en-CA", {
  timeZone: hotelZone(), year: "numeric", month: "2-digit", day: "2-digit",
}).format(new Date());

export const addDays = shiftDate;

export const nights = countNights;

export const dayLabel = (iso, locale = "ar", options) => formatDate(iso, locale, options);
