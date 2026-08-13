export const SUPPORTED_LOCALES = ["ar", "en"];

export function localePath(path, locale) {
  if (!path || /^(https?:|tel:|mailto:|#)/.test(path)) return path;
  const clean = path.replace(/^\/(ar|en)(?=\/|$)/, "") || "/";
  return `/${locale}${clean === "/" ? "" : clean}`;
}

export function barePath(path) {
  return (path || "/").replace(/^\/(ar|en)(?=\/|$)/, "") || "/";
}

export function localizedName(row, locale = "ar") {
  if (!row) return "";
  return locale === "en" ? (row.name_en || row.name || "") : (row.name || row.name_en || "");
}
