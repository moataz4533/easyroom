"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { CircleAlert, RefreshCw, Trash2 } from "lucide-react";
import { queueClearOne, queueStuck, useOffline } from "../lib/offline";
import { describeQueued } from "../lib/offline-policy";
import { useProperty } from "./Shell";

/**
 * The one action that will not go through, and why.
 *
 * The queue sends in order so that a check-out cannot overtake the check-in
 * before it — which means one refusal holds up everything behind it. Without
 * this the strip would count actions for ever, the cleaning statuses queued
 * behind them would never arrive, and nobody would be able to find out why.
 *
 * It renders nothing at all until something is actually stuck.
 */
export default function StuckActions() {
  const t = useTranslations("Queue");
  const { property } = useProperty();
  const [all, setAll] = useState([]);
  const { online, syncing, sync } = useOffline();

  useEffect(() => {
    const read = () => setAll(queueStuck());
    read();
    window.addEventListener("easyroom:queue", read);
    return () => window.removeEventListener("easyroom:queue", read);
  }, []);

  // Scoped to the hotel it is in, like everything else. An item queued
  // before hotels could be switched carries no hotel, and is shown rather
  // than hidden — an action nobody can see is an action nobody can clear.
  const stuck = all.filter((item) => !item.property_id || item.property_id === property?.id);
  if (stuck.length === 0) return null;

  return (
    <section className="provisional" data-failed="true">
      <div className="provisional-head">
        <CircleAlert size={20} />
        <div>
          <h2>{t("title")}</h2>
          <p>{t("lead")}</p>
        </div>
      </div>

      <ul className="provisional-list">
        {stuck.map((item) => (
          <li key={item.id} data-state="failed">
            <div className="provisional-row">
              <div className="grow">
                <strong>{t(describeQueued(item))}</strong>
                <span className="provisional-stay">
                  {item.error?.permanent ? t("permanent") : t("temporary")}
                </span>
              </div>
            </div>
            <p className="provisional-reason">{item.error?.message}</p>
            <div className="provisional-actions">
              {online && !item.error?.permanent && (
                <button className="btn sm" onClick={sync} disabled={syncing}>
                  <RefreshCw size={14} className={syncing ? "spin" : ""} />{t("retry")}
                </button>
              )}
              <button className="btn sm danger" onClick={() => queueClearOne(item.id)}>
                <Trash2 size={14} />{t("discard")}
              </button>
            </div>
          </li>
        ))}
      </ul>

      <p className="setup-foot">{t("discardNote")}</p>
    </section>
  );
}
