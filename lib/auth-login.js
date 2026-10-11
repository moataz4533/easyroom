export const STAFF_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeStaffUsername(value = "") {
  return value.trim().toLowerCase();
}

export function isStaffUsername(value) {
  return STAFF_USERNAME_PATTERN.test(normalizeStaffUsername(value));
}

export function staffLoginEmail(propertySlug, username) {
  const slug = normalizeHotelSlug(propertySlug);
  return `${slug}.${normalizeStaffUsername(username)}@staff.easyroom.app`;
}

/**
 * Editing a staff member's card.
 *
 * The name and the phone are the two things that go stale — somebody was
 * added as "أحمد" and everyone calls him something else, or he changed his
 * number. The username is deliberately not in here: it is half of the
 * address that member signs in with (`{hotel}.{username}@…`), so changing
 * it locks them out of the login saved on their phone. Same reason the
 * branch code is fixed once it is created.
 *
 * Returns a message key, or null when the edit is fine to save.
 */
export function staffProfileProblem({ full_name, phone } = {}) {
  if (!String(full_name || "").trim()) return "needStaffName";
  const digits = String(phone || "").replace(/[^\d]/g, "");
  // Empty is allowed — plenty of staff have no number on file. A number
  // that is present but too short to dial is a typo worth catching.
  if (digits && digits.length < 7) return "phoneTooShort";
  return null;
}

// A hotel's slug is the part of a staff sign-in that says which hotel the
// username belongs to. Usernames are unique inside a hotel, not across them.
export const HOTEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

export function normalizeHotelSlug(value = "") {
  return String(value).trim().toLowerCase();
}

export function isHotelSlug(value) {
  return HOTEL_SLUG_PATTERN.test(normalizeHotelSlug(value));
}

/**
 * Each hotel's own sign-in link. Staff open it once and never meet the
 * word "code": the screen opens with their hotel's name and logo on it.
 * The path, not a subdomain, so one certificate and one DNS record serve
 * every hotel.
 */
export const PUBLIC_ORIGIN = "https://easyroom.app";

export function hotelLoginPath(slug) {
  const code = normalizeHotelSlug(slug);
  return code ? `/h/${code}` : "/login";
}

export function hotelLoginUrl(slug, origin = PUBLIC_ORIGIN) {
  return `${String(origin || PUBLIC_ORIGIN).replace(/\/+$/, "")}${hotelLoginPath(slug)}`;
}

/**
 * Which hotel the sign-in screen opens on. A hotel's own link wins over
 * what the device remembers — somebody who used to work at one hotel and
 * was just sent another's link means the new one. With neither, it opens
 * on no hotel at all rather than assuming the first one ever opened.
 */
export function openingHotel(linked, saved) {
  const fromLink = normalizeHotelSlug(linked || "");
  if (isHotelSlug(fromLink)) return fromLink;
  const remembered = normalizeHotelSlug(saved || "");
  return isHotelSlug(remembered) ? remembered : "";
}
