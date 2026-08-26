"use client";

import { useMemo, useState } from "react";
import { GUEST_LOCALES, LANGUAGE_NAMES, isRtl } from "../lib/guest-locales";
import { currencyWord } from "../lib/hotel-settings";
import { useTranslations } from "next-intl";
import { Copy, MessageCircle, Printer, X } from "lucide-react";
import { dayLabel, egp } from "../lib/supabase";
import { useLocale } from "../lib/locale";
import { whatsappLink } from "../lib/confirmation";
import { buildReservationProofText, reservationProofModel } from "../lib/reservation-proof";

export default function ReservationProof({
  property, booking, allocations, charges, onClose, onCopied, onCopyFailed,
}) {
  const appLocale = useLocale();
  const t = useTranslations("ReservationProof");
  const common = useTranslations("Common");
  const [locale, setLocale] = useState(appLocale);
  const model = useMemo(
    () => reservationProofModel({ booking, allocations, charges, locale }),
    [booking, allocations, charges, locale]
  );
  const sourceLabel = t(`source_${model.source}`);
  const text = useMemo(
    () => buildReservationProofText({ property, booking, allocations, charges, locale, sourceLabel }),
    [property, booking, allocations, charges, locale, sourceLabel]
  );

  async function copy() {
    try { await navigator.clipboard.writeText(text); onCopied?.(); }
    catch { onCopyFailed?.(); }
  }

  function print() {
    const content = document.getElementById("reservation-proof-document")?.outerHTML;
    if (!content) return;
    const win = window.open("", "_blank", "width=920,height=980");
    if (!win) return;
    win.document.write(`<!doctype html><html dir="${isRtl(locale) ? "rtl" : "ltr"}" lang="${locale}">
<head><meta charset="utf-8"><title>${model.reference}</title><style>
body{font-family:Arial,Tahoma,sans-serif;margin:0;padding:28px;color:#102d34;background:#fff}*{box-sizing:border-box}
.proof-document{max-width:820px;margin:auto;border:1px solid #bdcfcc;padding:28px}.proof-header{display:flex;justify-content:space-between;gap:24px;border-bottom:3px solid #0b3a46;padding-bottom:18px;margin-bottom:20px}.proof-header h1{margin:0;color:#0b3a46;font-size:25px}.proof-header p{margin:6px 0 0;color:#647b80}.proof-reference{text-align:end}.proof-reference strong{display:block;color:#d18516;font-size:18px}.proof-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid #d9e3e1;margin-bottom:16px}.proof-field{padding:11px 13px;border-bottom:1px solid #d9e3e1}.proof-field:nth-child(odd){border-inline-end:1px solid #d9e3e1}.proof-field span{display:block;color:#647b80;font-size:11px;margin-bottom:4px}.proof-field strong{font-size:14px}.proof-table{width:100%;border-collapse:collapse;margin:12px 0 18px}.proof-table th,.proof-table td{border:1px solid #d9e3e1;padding:9px;text-align:start;font-size:13px}.proof-table th{background:#f4f7f6;color:#0b3a46}.proof-total td{font-weight:bold;background:#fff6df}.proof-section{margin:16px 0}.proof-section h2{font-size:15px;color:#0b3a46;margin:0 0 8px}.proof-chips{display:flex;gap:7px;flex-wrap:wrap}.proof-chip{border:1px solid #a8d1b6;background:#ebf6ef;padding:6px 10px;border-radius:20px;font-size:12px}.proof-notes{border:1px solid #d9e3e1;padding:12px;min-height:56px}.proof-signatures{display:grid;grid-template-columns:1fr 1fr;gap:40px;margin-top:46px;text-align:center}.proof-signatures div{border-top:1px dotted #647b80;padding-top:8px;color:#647b80;font-size:12px}.proof-footer{border-top:1px solid #d9e3e1;margin-top:30px;padding-top:12px;text-align:center;color:#647b80;font-size:11px}@media print{body{padding:0}.proof-document{border:0;max-width:none}}
</style></head><body>${content}</body></html>`);
    win.document.close(); win.focus(); win.print();
  }

  return (
    <div className="dialog-backdrop proof-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <div className="dialog-panel proof-panel" role="dialog" aria-modal="true">
        <div className="spread proof-toolbar">
          <div className="tabs" role="tablist" aria-label={t("language")}>
            {GUEST_LOCALES.map((option) => (
              <button key={option} className="tab" role="tab" aria-selected={locale === option}
                onClick={() => setLocale(option)}>{LANGUAGE_NAMES[option]}</button>
            ))}
          </div>
          <button className="icon-button" onClick={onClose} aria-label={common("close")}><X size={18} /></button>
        </div>

        <article id="reservation-proof-document" className="proof-document" dir={isRtl(locale) ? "rtl" : "ltr"}>
          <header className="proof-header">
            <div><h1>{locale === "en" ? (property?.name_en || property?.name) : property?.name}</h1>
              <p>{property?.settings?.address || t("hotelFallback")}</p></div>
            <div className="proof-reference"><span>{t("title")}</span><strong>{model.reference}</strong></div>
          </header>

          <div className="proof-grid">
            <ProofField label={t("guest")} value={model.guest} />
            <ProofField label={t("idNumber")} value={model.idNumber || "—"} mono />
            <ProofField label={t("phone")} value={model.phone || "—"} mono />
            <ProofField label={t("bookingType")} value={[model.plan, model.planCode && `(${model.planCode})`, model.company].filter(Boolean).join(" · ") || "—"} />
            <ProofField label={t("checkIn")} value={dayLabel(model.checkIn, locale)} />
            <ProofField label={t("checkOut")} value={dayLabel(model.checkOut, locale)} />
            <ProofField label={t("staySummary")} value={t("stayValue", { nights: model.nights, guests: model.guestCount })} />
            <ProofField label={t("source")} value={sourceLabel} />
          </div>

          <table className="proof-table">
            <thead><tr><th>{t("item")}</th><th>{t("details")}</th><th>{t("amount")}</th></tr></thead>
            <tbody>
              {model.rooms.map((room, index) => <tr key={`${room.number}-${index}`}>
                <td>{t("room")} {room.number}</td><td>{room.type} · {t("guestCount", { count: room.occupancy })}</td>
                {index === 0 ? <td rowSpan={model.rooms.length}>{egp(model.roomSubtotal, locale)} {currencyWord(locale)}</td> : null}
              </tr>)}
              {model.paidExtras.map((item, index) => <tr key={`${item.name}-${index}`}>
                <td>{item.name}</td><td>{t("quantity", { count: item.quantity })}</td><td>{egp(item.amount, locale)} {currencyWord(locale)}</td>
              </tr>)}
              <tr className="proof-total"><td colSpan="2">{t("total")}</td><td>{egp(model.total, locale)} {currencyWord(locale)}</td></tr>
            </tbody>
          </table>

          {model.included.length > 0 && <section className="proof-section"><h2>{t("included")}</h2>
            <div className="proof-chips">{model.included.map((item, index) => <span className="proof-chip" key={`${item.name}-${index}`}>{item.name} × {item.quantity}</span>)}</div></section>}
          <section className="proof-section"><h2>{t("notes")}</h2><div className="proof-notes">{model.notes || t("noNotes")}</div></section>
          <div className="proof-signatures"><div>{t("hotelStamp")}</div><div>{t("guestSignature")}</div></div>
          <footer className="proof-footer">{t("footer", { reference: model.reference })}</footer>
        </article>

        <div className="row proof-actions">
          <button className="btn primary grow" onClick={print}><Printer size={16} />{t("printPdf")}</button>
          <button className="btn grow" onClick={copy}><Copy size={16} />{t("copy")}</button>
          {model.phone && <a className="btn grow" target="_blank" rel="noreferrer" href={whatsappLink(model.phone, text)}>
            <MessageCircle size={16} />{t("whatsapp")}</a>}
        </div>
      </div>
    </div>
  );
}

function ProofField({ label, value, mono = false }) {
  return <div className="proof-field"><span>{label}</span><strong className={mono ? "mono" : ""}>{value}</strong></div>;
}
