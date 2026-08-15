"use client";
import { useMemo, useState } from "react";
import { useLocale, useTranslations } from "next-intl";
import { CircleAlert, ClipboardPaste, X } from "lucide-react";
import { formatDate } from "../lib/format";
import { isWorthReviewing, parseMessage } from "../lib/whatsapp-parse";

/**
 * The message, read into the form.
 *
 * Nearly every booking here arrives on WhatsApp and gets retyped by hand.
 * This reads the message instead and hands reception a filled-in draft to
 * check — which is the whole design: it is never the last word. What it is
 * not certain about is marked, what it cannot find it leaves empty, and
 * nothing moves until somebody presses the button.
 */
export default function PasteMessage({ today, onUse, onClose }) {
  const locale = useLocale();
  const t = useTranslations("Paste");
  const [text, setText] = useState("");

  const draft = useMemo(
    () => (text.trim() ? parseMessage(text, { today }) : null),
    [text, today]
  );

  const rows = draft ? [
    ["name", t("name"), draft.name?.value],
    ["phone", t("phone"), draft.phone?.value],
    ["checkIn", t("checkIn"), draft.checkIn && formatDate(draft.checkIn.value, locale, { day: "numeric", month: "long" })],
    ["checkOut", t("checkOut"), draft.checkOut && formatDate(draft.checkOut.value, locale, { day: "numeric", month: "long" })],
    ["nights", t("nights"), draft.nights && t("nightCount", { count: draft.nights.value })],
    ["pax", t("pax"), draft.pax && t("paxCount", { count: draft.pax.value })],
    ["rooms", t("rooms"), draft.rooms && t("roomCount", { count: draft.rooms.value })],
  ] : [];

  const anything = draft && isWorthReviewing(draft);

  async function pasteFromClipboard() {
    try {
      setText(await navigator.clipboard.readText());
    } catch {
      // Reading the clipboard needs permission the browser may refuse; the
      // box is right there and pasting into it by hand always works.
    }
  }

  return (
    <div className="sheet-backdrop" onClick={onClose}>
      <div className="card sheet" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 10 }}>
          <h2 style={{ fontSize: 17 }}>{t("title")}</h2>
          <button className="btn sm" onClick={onClose} aria-label={t("close")}>
            <X size={16} />
          </button>
        </div>

        <p className="section-note">{t("intro")}</p>

        <textarea
          className="paste-box" rows={6} value={text} autoFocus
          placeholder={t("placeholder")}
          onChange={(event) => setText(event.target.value)}
        />

        <button className="btn ghost wide" onClick={pasteFromClipboard} style={{ marginTop: 8 }}>
          <ClipboardPaste size={16} />{t("fromClipboard")}
        </button>

        {text.trim() && !anything && (
          <div className="banner warn" style={{ marginTop: 12 }}>{t("nothingFound")}</div>
        )}

        {anything && (
          <>
            <div className="read-list">
              {rows.map(([key, label, shown]) => (
                <div key={key} className="read-row" data-unsure={draft[key]?.sure === false}>
                  <span className="read-label">{label}</span>
                  {shown ? (
                    <span className="read-value">
                      {shown}
                      {draft[key]?.sure === false && <CircleAlert size={14} />}
                    </span>
                  ) : (
                    <span className="read-value empty">{t("notInMessage")}</span>
                  )}
                </div>
              ))}
            </div>

            <p className="section-note" style={{ marginTop: 10 }}>{t("checkIt")}</p>

            <button className="btn primary wide" onClick={() => onUse(draft)}>
              {t("use")}
            </button>
          </>
        )}
      </div>
    </div>
  );
}
