"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import { CheckCircle2, CircleAlert, CloudOff, Phone, RefreshCw, Trash2 } from "lucide-react";
import {
  provisionalList, provisionalRemove, provisionalRetry, useOffline,
} from "../lib/offline";
import { useProperty } from "./Shell";
import { FAILED, SENT, countByState, headCount, roomNumbers } from "../lib/provisional";
import { dayLabel } from "../lib/supabase";
import { countNights, joinList } from "../lib/format";

const REASON = {
  taken: "reasonTaken",
  unauthorised: "reasonUnauthorised",
  noRatePlan: "reasonNoRatePlan",
};

/**
 * Every booking taken with no connection, and what became of it.
 *
 * It sits on the screen staff open first because a provisional booking is a
 * promise the hotel has not kept yet: the room is not held, and if it was
 * refused somebody has to ring that guest back. Nothing here disappears on
 * its own except the ones that landed, and even those wait to be read.
 */
export default function ProvisionalBookings() {
  const locale = useLocale();
  const t = useTranslations("Provisional");
  const { property } = useProperty();
  const [all, setAll] = useState([]);
  const { online, syncing, sync } = useOffline();

  useEffect(() => {
    const read = () => setAll(provisionalList());
    read();
    window.addEventListener("easyroom:provisional", read);
    return () => window.removeEventListener("easyroom:provisional", read);
  }, []);

  // The hotels are separate, so this screen shows only the hotel it is in.
  // Anything recorded for another one is still sent when the connection
  // returns — it simply belongs on that hotel's screen, not this one.
  const list = all.filter((record) => record.propertyId === property?.id);
  if (list.length === 0) return null;

  const { pending, failed, sent } = countByState(list);

  return (
    <section className="provisional" data-failed={failed > 0}>
      <div className="provisional-head">
        {failed > 0 ? <CircleAlert size={20} /> : <CloudOff size={20} />}
        <div>
          <h2>{t("title")}</h2>
          {failed > 0 && <p>{t("leadFailed", { count: failed })}</p>}
          {pending > 0 && <p>{t("leadPending", { count: pending })}</p>}
          {pending === 0 && failed === 0 && sent > 0 && (
            <p>{t("leadSent", { count: sent })}</p>
          )}
        </div>
        {online && pending > 0 && (
          <button className="btn sm" onClick={sync} disabled={syncing}>
            <RefreshCw size={14} className={syncing ? "spin" : ""} />{t("sendNow")}
          </button>
        )}
      </div>

      <ul className="provisional-list">
        {list.map((record) => (
          <Row key={record.id} record={record} locale={locale} t={t} />
        ))}
      </ul>
    </section>
  );
}

function Row({ record, locale, t }) {
  const nights = countNights(record.checkIn, record.checkOut);
  const state = record.state === FAILED ? "stateFailed"
    : record.state === SENT ? "stateSent" : "statePending";

  return (
    <li data-state={record.state}>
      <div className="provisional-row">
        <div className="grow">
          <strong>{record.guestName}</strong>
          <span className="provisional-stay">
            {dayLabel(record.checkIn, locale)} ← {dayLabel(record.checkOut, locale)}
            {" · "}
            {t("stay", {
              nights,
              heads: headCount(record),
              rooms: joinList(roomNumbers(record), locale),
            })}
          </span>
          {record.state === SENT && record.reference && (
            <span className="provisional-ref code">
              {t("reference", { reference: record.reference })}
            </span>
          )}
        </div>
        <span className={`pill ${record.state === FAILED ? "bad"
          : record.state === SENT ? "ok" : "warn"}`}>
          {t(state)}
        </span>
      </div>

      {record.state === FAILED && (
        <p className="provisional-reason">
          {t(REASON[record.error?.kind] || "reasonOther", {
            message: record.error?.message || "",
          })}
        </p>
      )}

      <div className="provisional-actions">
        {record.state === FAILED && (
          <>
            {record.guestPhone && (
              <a className="btn sm" href={`tel:${record.guestPhone}`}>
                <Phone size={14} />{t("call")}
              </a>
            )}
            <button className="btn sm" onClick={() => provisionalRetry(record.id)}>
              <RefreshCw size={14} />{t("retry")}
            </button>
            <button className="btn sm danger" onClick={() => provisionalRemove(record.id)}>
              <Trash2 size={14} />{t("discard")}
            </button>
          </>
        )}
        {record.state === SENT && (
          <button className="btn sm" onClick={() => provisionalRemove(record.id)}>
            <CheckCircle2 size={14} />{t("dismiss")}
          </button>
        )}
      </div>
    </li>
  );
}
