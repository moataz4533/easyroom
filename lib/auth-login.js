export const STAFF_USERNAME_PATTERN = /^[a-z0-9][a-z0-9._-]{2,31}$/;

export function normalizeStaffUsername(value = "") {
  return value.trim().toLowerCase();
}

export function isStaffUsername(value) {
  return STAFF_USERNAME_PATTERN.test(normalizeStaffUsername(value));
}

export function staffLoginEmail(propertySlug, username) {
  const slug = String(propertySlug).trim().toLowerCase();
  return `${slug}.${normalizeStaffUsername(username)}@staff.easyroom.app`;
}
