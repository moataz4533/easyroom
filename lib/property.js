/**
 * Which hotel the app is currently working inside.
 *
 * The hotels are separate, completely. Switching picks one and works entirely
 * within it — no screen shows two, no report adds their numbers together, no
 * guest is shared. That is not politeness, it is enforced in the database:
 * every policy is written against the property, so a screen that asked for
 * another hotel's rows would simply be handed nothing.
 *
 * What is left for this file is the small question the database cannot
 * answer: of the hotels this person belongs to, which one are they in now.
 */

export const SAVED_KEY = "easyroom:property";

export function sortProperties(properties) {
  return [...(properties || [])].sort((a, b) =>
    String(a?.name || "").localeCompare(String(b?.name || ""), "ar")
  );
}

/**
 * The hotel to open. The one they chose last, if they are still a member of
 * it — a staff member removed from a hotel must not land back inside it —
 * otherwise the only one, otherwise the first by name.
 */
export function pickProperty(properties, savedId) {
  const list = sortProperties(properties);
  if (list.length === 0) return null;
  return list.find((p) => p.id === savedId) || list[0];
}

export function needsSwitcher(properties) {
  return (properties || []).length > 1;
}

/**
 * A role is per hotel, not per person: the same account can be an owner in
 * one and reception in another, and gets exactly the screens of whichever
 * hotel is open.
 */
export function roleIn(memberships, propertyId) {
  if (!propertyId) return null;
  const row = (memberships || []).find(
    (m) => m.property_id === propertyId && m.is_active !== false
  );
  return row?.role || null;
}

/** Everything held on the device for a hotel that is not this one. */
export function foreignCacheKeys(keys, propertyId) {
  return (keys || []).filter((key) =>
    key.startsWith("easyroom:cache:") && !key.includes(String(propertyId))
  );
}
