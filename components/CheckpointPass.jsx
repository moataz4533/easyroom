"use client";

import { useMemo } from "react";
import { useTranslations } from "next-intl";
import { Copy, MessageCircle, Printer, X } from "lucide-react";
import { whatsappLink } from "../lib/confirmation";
import { today } from "../lib/supabase";
import {
  PASS_FIELDS, PASS_WORDS, buildCheckpointPassText, checkpointPassModel,
  passDate, passGaps, passStatement,
} from "../lib/checkpoint-pass";

/**
 * The one stylesheet the document has. It is used for the panel on screen
 * *and* injected into the print window, so what reception approves is
 * exactly what comes out of the printer — the older proof keeps two copies
 * of its CSS and they have already drifted once.
 */
const PASS_CSS = `
.pass-paper{--ink:#10242b;--rule:#c9d6d3;--accent:#0b3a46;background:#fff;color:var(--ink);
  font-family:"Segoe UI",Tahoma,Arial,sans-serif;max-width:820px;margin:auto;padding:30px 32px;
  border:1px solid var(--rule)}
.pass-paper *{box-sizing:border-box}
.pass-top{display:flex;align-items:center;gap:18px;border-bottom:3px solid var(--accent);padding-bottom:16px}
.pass-logo{width:76px;height:76px;object-fit:contain;flex:none}
.pass-hotel{flex:1;min-width:0}
.pass-hotel h1{margin:0;font-size:23px;color:var(--accent);line-height:1.25}
.pass-hotel h2{margin:2px 0 0;font-size:14px;font-weight:600;color:#4a6169;letter-spacing:.02em}
.pass-hotel p{margin:6px 0 0;font-size:12px;color:#5d757c}
.pass-title{text-align:center;margin:18px 0 4px}
.pass-title strong{display:block;font-size:20px;color:var(--accent)}
.pass-title span{display:block;font-size:13px;color:#4a6169;letter-spacing:.03em}
.pass-title em{display:block;font-size:11px;color:#7b9198;font-style:normal;margin-top:4px}
.pass-en{direction:ltr;unicode-bidi:isolate}
.pass-ref{display:flex;justify-content:space-between;gap:16px;flex-wrap:wrap;
  background:#f3f7f6;border:1px solid var(--rule);padding:10px 14px;margin:16px 0}
.pass-ref div{font-size:12px;color:#5d757c}
.pass-ref b{display:block;font-size:16px;color:var(--ink);letter-spacing:.04em;
  font-family:"Courier New",monospace;direction:ltr;unicode-bidi:isolate}
.pass-grid{display:grid;grid-template-columns:1fr 1fr;border:1px solid var(--rule);border-bottom:0}
.pass-cell{padding:10px 13px;border-bottom:1px solid var(--rule);min-width:0}
.pass-cell:nth-child(odd){border-inline-end:1px solid var(--rule)}
.pass-cell span{display:flex;justify-content:space-between;gap:8px;font-size:10.5px;color:#7b9198;margin-bottom:4px}
.pass-cell span i{font-style:normal;direction:ltr;unicode-bidi:isolate}
.pass-cell strong{font-size:15px;font-weight:600;word-break:break-word}
.pass-cell strong.pass-code{font-family:"Courier New",monospace;letter-spacing:.05em;direction:ltr;unicode-bidi:isolate;display:inline-block}
.pass-cell strong.pass-blank{color:#a33;font-weight:500;font-size:13px}
.pass-statement{border:1px solid var(--rule);border-top:0;padding:14px;font-size:13px;line-height:1.75}
.pass-statement p{margin:0}
.pass-statement p+p{margin-top:8px;color:#4a6169;direction:ltr;text-align:left;font-size:12.5px}
.pass-verify{margin-top:16px;border:2px solid var(--accent);padding:12px 14px;text-align:center}
.pass-verify span{display:block;font-size:11.5px;color:#4a6169}
.pass-verify span+span{color:#7b9198;font-size:10.5px}
.pass-verify b{display:block;font-size:21px;letter-spacing:.06em;color:var(--accent);
  font-family:"Courier New",monospace;direction:ltr;unicode-bidi:isolate;margin-top:4px}
.pass-sign{margin-top:34px;display:flex;justify-content:flex-end}
.pass-sign div{width:260px;border-top:1px dotted #7b9198;padding-top:8px;text-align:center;font-size:11.5px;color:#5d757c}
.pass-sign div i{display:block;font-style:normal;font-size:10.5px;color:#93a7ad}
.pass-foot{margin-top:22px;border-top:1px solid var(--rule);padding-top:10px;
  display:flex;justify-content:space-between;gap:6px 12px;flex-wrap:wrap;font-size:10.5px;color:#7b9198}
.pass-foot span{display:block;unicode-bidi:isolate}
@media (max-width:640px){.pass-paper{padding:20px 16px}.pass-grid{grid-template-columns:1fr}
  .pass-cell:nth-child(odd){border-inline-end:0}.pass-top{gap:12px}.pass-logo{width:56px;height:56px}
  .pass-hotel h1{font-size:19px}.pass-sign{justify-content:stretch}.pass-sign div{width:100%}}
@media print{.pass-paper{border:0;max-width:none;padding:0}}
`;

function absolute(url) {
  if (!url) return "";
  if (/^https?:/i.test(url)) return url;
  try { return new URL(url, window.location.origin).href; } catch { return url; }
}

export default function CheckpointPass({
  property, booking, allocations = [], onClose, onCopied, onCopyFailed,
}) {
  const t = useTranslations("CheckpointPass");
  const common = useTranslations("Common");
  const issuedOn = today();
  const model = useMemo(
    () => checkpointPassModel({ property, booking, allocations, issuedOn }),
    [property, booking, allocations, issuedOn]
  );
  const gaps = passGaps(model);
  const text = useMemo(
    () => buildCheckpointPassText({ property, booking, allocations, issuedOn }),
    [property, booking, allocations, issuedOn]
  );

  const values = {
    guest: model.guest,
    idNumber: model.idNumber,
    nationality: model.nationality,
    phone: model.phone,
    checkIn: passDate(model.checkIn),
    checkOut: passDate(model.checkOut),
    nights: model.nights ? String(model.nights) : "",
    party: model.party ? String(model.party) : "",
    rooms: model.rooms.map((room) => [room.number, room.typeAr].filter(Boolean).join(" ")).join(" · "),
  };
  // Anything that reads as digits and separators is isolated left-to-right.
  // Left to the page direction, "12 / 08 / 2026" comes out of an RTL
  // renderer as "2026 / 08 / 12" — a date a checkpoint would read wrong.
  const codeFields = new Set(["idNumber", "phone", "checkIn", "checkOut"]);

  async function copy() {
    try { await navigator.clipboard.writeText(text); onCopied?.(); }
    catch { onCopyFailed?.(); }
  }

  function print() {
    const paper = document.getElementById("checkpoint-pass-paper");
    if (!paper) return;
    const win = window.open("", "_blank", "width=920,height=1000");
    if (!win) return onCopyFailed?.();
    const html = paper.outerHTML.replace(
      /src="([^"]*)"/g,
      (whole, src) => `src="${absolute(src)}"`
    );
    win.document.write(`<!doctype html><html dir="rtl" lang="ar"><head><meta charset="utf-8">`
      + `<title>${model.reference}</title>`
      + `<style>@page{size:A4;margin:14mm}body{margin:0;padding:20px;background:#fff}${PASS_CSS}</style>`
      + `</head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    // Give the logo a moment to arrive; printing a pass with a hole where
    // the letterhead should be is the one thing this screen exists to avoid.
    win.setTimeout(() => win.print(), 350);
  }

  return (
    <div className="dialog-backdrop proof-backdrop" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose?.();
    }}>
      <div className="dialog-panel proof-panel" role="dialog" aria-modal="true">
        <style>{PASS_CSS}</style>

        <div className="spread proof-toolbar">
          <div>
            <strong style={{ fontSize: 15 }}>{t("title")}</strong>
            <div style={{ fontSize: 12, color: "var(--muted)" }}>{t("subtitle")}</div>
          </div>
          <button className="icon-button" onClick={onClose} aria-label={common("close")}><X size={18} /></button>
        </div>

        {gaps.length > 0 && (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            <strong>{t("gapsTitle")}</strong>
            <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
              {gaps.map((gap) => <li key={gap}>{t(`gap_${gap}`)}</li>)}
            </ul>
          </div>
        )}

        <article id="checkpoint-pass-paper" className="pass-paper" dir="rtl" lang="ar">
          <header className="pass-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pass-logo" src={model.hotel.logo || "/easyroom-logo.png"} alt="" />
            <div className="pass-hotel">
              <h1>{model.hotel.name}</h1>
              {model.hotel.nameEn !== model.hotel.name && <h2>{model.hotel.nameEn}</h2>}
              {model.hotel.address && <p>{model.hotel.address}</p>}
            </div>
          </header>

          <div className="pass-title">
            <strong>{PASS_WORDS.title.ar}</strong>
            <span>{PASS_WORDS.title.en}</span>
            <em>{PASS_WORDS.purpose.ar}</em>
            <em className="pass-en">{PASS_WORDS.purpose.en}</em>
          </div>

          <div className="pass-ref">
            <div>{PASS_WORDS.reference.ar} / {PASS_WORDS.reference.en}<b>{model.reference}</b></div>
            <div>{PASS_WORDS.issuedOn.ar} / {PASS_WORDS.issuedOn.en}<b>{passDate(model.issuedOn)}</b></div>
          </div>

          <div className="pass-grid">
            {PASS_FIELDS.map((field) => (
              <div className="pass-cell" key={field}>
                <span>{PASS_WORDS[field].ar}<i>{PASS_WORDS[field].en}</i></span>
                {values[field]
                  ? <strong className={codeFields.has(field) ? "pass-code" : ""}>{values[field]}</strong>
                  : <strong className="pass-blank">{PASS_WORDS.missing.ar} / {PASS_WORDS.missing.en}</strong>}
              </div>
            ))}
          </div>

          <div className="pass-statement">
            <p>{passStatement(model.hotel.name, model.guest, { locale: "ar" })}</p>
            <p dir="ltr">{passStatement(model.hotel.nameEn, model.guest, { locale: "en" })}</p>
          </div>

          {model.hotel.phone && (
            <div className="pass-verify">
              <span>{PASS_WORDS.verify.ar}</span>
              <span className="pass-en">{PASS_WORDS.verify.en}</span>
              <b>{model.hotel.phone}</b>
            </div>
          )}

          <div className="pass-sign">
            <div>{PASS_WORDS.stamp.ar}<i>{PASS_WORDS.stamp.en}</i></div>
          </div>

          <footer className="pass-foot">
            <div>
              <span>{PASS_WORDS.noMoney.ar}</span>
              <span className="pass-en">{PASS_WORDS.noMoney.en}</span>
            </div>
            <span className="pass-en">{model.reference}</span>
          </footer>
        </article>

        <div className="row proof-actions">
          <button className="btn primary grow" onClick={print}><Printer size={16} />{t("print")}</button>
          <button className="btn grow" onClick={copy}><Copy size={16} />{t("copy")}</button>
          {model.phone && (
            <a className="btn grow" target="_blank" rel="noreferrer" href={whatsappLink(model.phone, text)}>
              <MessageCircle size={16} />{t("whatsapp")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
