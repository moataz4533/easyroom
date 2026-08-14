/**
 * Getting back in when the owner has forgotten their password.
 *
 * Staff never need this: their password is reset by the owner from Settings,
 * and their sign-in name is not an email at all — it is turned into an
 * internal one that no message could ever reach. So this is for the owner
 * only, and saying so plainly is kinder than letting somebody wait for a
 * message that was never going to arrive.
 */

/** Whether this address could possibly receive anything. */
export function isReachableEmail(value) {
  const email = String(value || "").trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) return false;
  // The internal address a staff username becomes. No mailbox exists behind
  // it, so a reset sent there is a message into the void.
  return !email.endsWith("@staff.easyroom.app");
}

export const MIN_PASSWORD = 8;

/** Reasons this new password cannot be set, as codes the screen translates. */
export function validateNewPassword(password, again) {
  const problems = [];
  if (String(password || "").length < MIN_PASSWORD) problems.push("tooShort");
  if (password !== again) problems.push("mismatch");
  return problems;
}

/**
 * Whether the browser is holding a recovery link rather than an ordinary
 * visit. Supabase hands it back one of two ways depending on the flow, and
 * the page has to cope with both — the fragment never reaches the server, so
 * only the browser can answer this.
 */
export function recoveryFrom({ hash = "", search = "" } = {}) {
  const fragment = new URLSearchParams(String(hash).replace(/^#/, ""));
  const query = new URLSearchParams(String(search).replace(/^\?/, ""));

  const error = fragment.get("error_description") || query.get("error_description")
    || fragment.get("error") || query.get("error");
  if (error) return { kind: "error", message: error };

  const code = query.get("code");
  if (code) return { kind: "code", code };

  if (fragment.get("type") === "recovery" && fragment.get("access_token")) {
    return { kind: "token" };
  }
  return { kind: "none" };
}

/** Where the message should send them back to, keeping their language. */
export function resetRedirectTo(origin, locale) {
  return `${String(origin).replace(/\/$/, "")}/${locale === "en" ? "en" : "ar"}/reset-password`;
}
