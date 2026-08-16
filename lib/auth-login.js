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
