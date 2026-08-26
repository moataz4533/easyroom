"use client";

import { useTranslations } from "next-intl";
import { currencyWord } from "../lib/hotel-settings";
import { Check, X } from "lucide-react";
import { dayLabel, egp, nights } from "../lib/supabase";
import { localizedName, useLocale } from "../lib/locale";

export default function BookingReview({
  open, draft, plan, account, addons = [], roomSubtotal,
  total, busy, onClose, onConfirm,
}) {
  const t = useTranslations("BookingReview");
  const common = useTranslations("Common");
  const locale = useLocale();
  if (!open) return null;

  const included = addons.filter((item) => item.is_included);
  const paid = addons.filter((item) => !item.is_included);
  const rooms = draft.rooms || [];
  const heads = rooms.reduce((sum, room) => sum + (Number(room.occupancy) || 0), 0);

  return (
    <div className="dialog-backdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget && !busy) onClose();
    }}>
      <div className="dialog-panel booking-review" role="dialog" aria-modal="true" aria-labelledby="booking-review-title">
        <div className="spread booking-review-heading">
          <div><span className="eyebrow">{t("eyebrow")}</span>
            <h2 id="booking-review-title">{t("title")}</h2><p>{t("note")}</p></div>
          <button className="icon-button" onClick={onClose} disabled={busy} aria-label={common("close")}><X size={18} /></button>
        </div>

        <div className="review-section">
          <h3>{t("guest")}</h3>
          <dl className="detail-grid">
            <div><dt>{t("name")}</dt><dd>{draft.name}</dd></div>
            <div><dt>{t("phone")}</dt><dd className="mono" dir="ltr">{draft.phone || "—"}</dd></div>
            <div><dt>{t("idNumber")}</dt><dd className="mono" dir="ltr">{draft.idNumber || "—"}</dd></div>
            <div><dt>{t("heads")}</dt><dd>{t("headCount", { count: heads })}</dd></div>
          </dl>
        </div>

        <div className="review-section">
          <h3>{t("stay")}</h3>
          <dl className="detail-grid">
            <div><dt>{t("dates")}</dt><dd>{dayLabel(draft.checkIn, locale)} — {dayLabel(draft.checkOut, locale)}</dd></div>
            <div><dt>{t("nights")}</dt><dd>{t("nightCount", { count: nights(draft.checkIn, draft.checkOut) })}</dd></div>
            <div><dt>{t("bookingType")}</dt><dd>{localizedName(plan, locale)}{account ? ` · ${account.name}` : ""}</dd></div>
            <div><dt>{t("source")}</dt><dd>{t(`source_${draft.source}`)}</dd></div>
          </dl>
          <div className="review-room-list">
            {rooms.map((room) => <div key={room.id}><strong>{room.number}</strong><span>{room.type}</span><small>{t("roomGuests", { count: room.occupancy })}</small></div>)}
          </div>
        </div>

        {(included.length > 0 || paid.length > 0) && (
          <div className="review-section">
            <h3>{t("services")}</h3>
            <div className="review-lines">
              {addons.map((item) => (
                <div key={item.rate_plan_addon_id || item.charge_item_id}>
                  <span><Check size={14} />{locale === "en" ? (item.name_en || item.name) : item.name}
                    <small>{t(`basis_${item.pricing_basis}`)} × {Number(item.quantity)}</small></span>
                  <strong>{item.is_included ? t("included") : `${egp(item.amount, locale)} ${currencyWord(locale)}`}</strong>
                </div>
              ))}
            </div>
          </div>
        )}

        {draft.notes && <div className="review-section"><h3>{t("notes")}</h3><p className="review-notes">{draft.notes}</p></div>}

        <div className="review-total">
          <div><span>{t("roomSubtotal")}</span><strong>{egp(roomSubtotal, locale)} {currencyWord(locale)}</strong></div>
          {paid.length > 0 && <div><span>{t("paidServices")}</span><strong>{egp(paid.reduce((sum, row) => sum + Number(row.amount || 0), 0), locale)} {currencyWord(locale)}</strong></div>}
          <div className="grand"><span>{t("total")}</span><strong>{egp(total, locale)} {currencyWord(locale)}</strong></div>
        </div>

        <div className="row booking-review-actions">
          <button className="btn grow" onClick={onClose} disabled={busy}>{t("back")}</button>
          <button className="btn primary grow" onClick={onConfirm} disabled={busy}>
            <Check size={17} />{busy ? t("recording") : t("confirm")}
          </button>
        </div>
      </div>
    </div>
  );
}
