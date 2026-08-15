"use client";
import { useEffect, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, Download, ShieldCheck } from "lucide-react";
import { supabase } from "../lib/supabase";
import { formatNumber } from "../lib/format";
import {
  BACKUP_TABLES, LAST_BACKUP_KEY, backupFileName, daysSince, isStale, problemWith, summarise,
} from "../lib/backup";

/**
 * Taking the copy, and saying plainly how old the last one is.
 *
 * The reminder matters more than the button. A backup nobody takes is the
 * same as no backup, and the way that happens is not refusal — it is a month
 * passing without anybody thinking about it.
 */
export default function BackupCard({ property }) {
  const locale = useLocale();
  const t = useTranslations("Backup");
  const [last, setLast] = useState(null);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState(null);
  const [error, setError] = useState(null);

  useEffect(() => {
    try { setLast(window.localStorage.getItem(LAST_BACKUP_KEY)); } catch { /* no storage */ }
  }, []);

  async function download() {
    setBusy(true); setError(null); setResult(null);
    const { data, error: rpcError } = await supabase.rpc("export_property_data", {
      p_property: property.id,
    });
    setBusy(false);
    if (rpcError) return setError(rpcError.message);

    // Checked before it is saved, so a file that would be no use is never
    // mistaken for cover.
    const problem = problemWith(data);
    if (problem) return setError(t(problem));

    const takenAt = data.taken_at || new Date().toISOString();
    const url = URL.createObjectURL(
      new Blob([JSON.stringify(data)], { type: "application/json" })
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = backupFileName(property?.name, takenAt);
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 1000);

    try { window.localStorage.setItem(LAST_BACKUP_KEY, takenAt); } catch { /* no storage */ }
    setLast(takenAt);
    setResult(summarise(data));
  }

  const stale = isStale(last);
  const days = daysSince(last);

  return (
    <section className="setup" data-blocking={stale}>
      <div className="setup-head">
        {stale ? <CircleAlert size={20} /> : <ShieldCheck size={20} />}
        <div>
          <h2>{t("title")}</h2>
          <p>
            {last === null ? t("never")
              : days === 0 ? t("today")
              : t("lastTaken", { days })}
          </p>
        </div>
      </div>

      <p className="section-note">{t("what")}</p>

      {error && <div className="banner bad">{error}</div>}

      {result && (
        <div className="banner ok">
          {t("saved")}{" "}
          {BACKUP_TABLES.filter((table) => result[table] > 0)
            .map((table) => `${t(table)} ${formatNumber(result[table], locale)}`)
            .join(locale === "ar" ? "، " : ", ")}
        </div>
      )}

      <button className="btn primary wide" onClick={download} disabled={busy || !property}>
        <Download size={17} />{busy ? t("taking") : t("take")}
      </button>

      <p className="setup-foot">{t("where")}</p>
      <p className="field-hint" style={{ marginTop: 8 }}>{t("notAReplacement")}</p>
    </section>
  );
}
