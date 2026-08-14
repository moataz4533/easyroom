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

// A hotel's slug is the part of a staff sign-in that says which hotel the
// username belongs to. Usernames are unique inside a hotel, not across them.
export const HOTEL_SLUG_PATTERN = /^[a-z0-9][a-z0-9-]{1,47}$/;

export function normalizeHotelSlug(value = "") {
  return String(value).trim().toLowerCase();
}

export function isHotelSlug(value) {
  return HOTEL_SLUG_PATTERN.test(normalizeHotelSlug(value));
}
