"use client";

import { useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, MessageCircle, Printer, X } from "lucide-react";
import { whatsappLink } from "../lib/confirmation";
import { today } from "../lib/supabase";
import {
  PASS_LOCALES, PASS_SECTIONS, buildCheckpointPassText, checkpointPassModel,
  passDate, passGaps, passValues, passWords,
} from "../lib/checkpoint-pass";

/**
 * The one stylesheet the document has. It is used for the panel on screen
 * *and* injected into the print window, so what reception approves is
 * exactly what comes out of the printer — the older proof keeps two copies
 * of its CSS and they have already drifted once.
 *
 * The look is a hotel's own stationery: a rule under the letterhead, small
 * caps section headings, generous leading, one accent colour. Nothing on
 * the page announces what the paper is for.
 */
const PASS_CSS = `
.pass-paper{--ink:#16232b;--soft:#6b7f88;--rule:#dfe6e4;--accent:#0d3b45;background:#fff;color:var(--ink);
  font-family:"Segoe UI",Tahoma,Arial,sans-serif;max-width:820px;margin:auto;padding:38px 40px 30px;
  border:1px solid var(--rule)}
.pass-paper *{box-sizing:border-box}
.pass-top{display:flex;align-items:center;gap:16px;padding-bottom:18px}
.pass-logo{width:64px;height:64px;object-fit:contain;flex:none}
.pass-brand{flex:1;min-width:0}
.pass-brand h1{margin:0;font-size:25px;font-weight:600;letter-spacing:.04em;color:var(--accent);
  line-height:1.2;unicode-bidi:isolate}
.pass-brand p{margin:5px 0 0;font-size:11.5px;color:var(--soft);letter-spacing:.02em}
/* A phone number split across two lines is a phone number nobody dials. */
.pass-contact{white-space:nowrap;unicode-bidi:isolate}
.pass-contact+.pass-contact::before{content:"  ·  ";white-space:pre}
.pass-rule{height:2px;background:var(--accent);opacity:.85}
.pass-head{display:flex;justify-content:space-between;align-items:flex-end;gap:16px;
  flex-wrap:wrap;margin:22px 0 6px}
.pass-head h2{margin:0;font-size:17px;font-weight:600;letter-spacing:.16em;text-transform:uppercase;
  color:var(--ink)}
.pass-meta{display:flex;gap:26px;flex-wrap:wrap;font-size:11px;color:var(--soft);text-align:start}
.pass-meta b{display:block;font-size:13.5px;font-weight:600;color:var(--ink);margin-top:2px;
  letter-spacing:.03em;unicode-bidi:isolate}
.pass-section{margin-top:24px}
.pass-section>h3{margin:0 0 10px;font-size:10.5px;font-weight:600;letter-spacing:.16em;
  text-transform:uppercase;color:var(--soft);border-bottom:1px solid var(--rule);padding-bottom:6px}
.pass-rows{display:grid;grid-template-columns:1fr 1fr;gap:12px 34px}
.pass-row{min-width:0}
.pass-row span{display:block;font-size:10.5px;color:var(--soft);letter-spacing:.03em;margin-bottom:3px}
.pass-row strong{font-size:14.5px;font-weight:600;word-break:break-word}
.pass-row strong.pass-code{font-variant-numeric:tabular-nums;letter-spacing:.04em;
  unicode-bidi:isolate}
.pass-row strong.pass-ltr{direction:ltr;unicode-bidi:isolate;display:inline-block}
.pass-row strong.pass-blank{color:#9aa8ad;font-weight:400;font-size:13.5px}
.pass-note{margin:24px 0 0;font-size:12.5px;line-height:1.8;color:#3c5058}
.pass-sign{margin-top:40px;display:flex;justify-content:flex-end}
.pass-sign div{width:250px;border-top:1px solid #b9c6c9;padding-top:7px;text-align:center;
  font-size:10.5px;letter-spacing:.08em;text-transform:uppercase;color:var(--soft)}
.pass-foot{margin-top:26px;border-top:1px solid var(--rule);padding-top:11px;text-align:center;
  font-size:10.5px;color:var(--soft);letter-spacing:.03em}
.pass-foot b{font-weight:600;color:#3c5058}
@media (max-width:640px){.pass-paper{padding:24px 18px}.pass-rows{grid-template-columns:1fr;gap:11px}
  .pass-brand h1{font-size:20px}.pass-logo{width:52px;height:52px}.pass-head h2{font-size:15px}
  .pass-meta{gap:18px}.pass-sign{justify-content:stretch}.pass-sign div{width:100%}}
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
  // English first: the guest driving down usually wants the paper that
  // reads the same to a checkpoint and to a hotel anywhere else.
  const [lang, setLang] = useState("en");
  const issuedOn = today();
  const model = useMemo(
    () => checkpointPassModel({ property, booking, allocations, issuedOn }),
    [property, booking, allocations, issuedOn]
  );
  const gaps = passGaps(model);
  const w = passWords(lang);
  const values = passValues(model, lang);
  const text = useMemo(
    () => buildCheckpointPassText({ property, booking, allocations, issuedOn, locale: lang }),
    [property, booking, allocations, issuedOn, lang]
  );
  // A passport number and a phone number are pure code and must run
  // left-to-right whatever the page does. A date is not: forcing it
  // left-to-right turns "12 أغسطس 2026" into "أغسطس 12 2026".
  const ltrFields = new Set(["idNumber", "phone"]);
  const codeFields = new Set(["checkIn", "checkOut", "nights", "party"]);
  const contact = [model.hotel.address, model.hotel.phone].filter(Boolean);

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
    const dir = lang === "ar" ? "rtl" : "ltr";
    win.document.write(`<!doctype html><html dir="${dir}" lang="${lang}"><head><meta charset="utf-8">`
      + `<title>${model.reference}</title>`
      + `<style>@page{size:A4;margin:16mm}body{margin:0;padding:20px;background:#fff}${PASS_CSS}</style>`
      + `</head><body>${html}</body></html>`);
    win.document.close();
    win.focus();
    // Give the logo a moment to arrive; printing the hotel's paper with a
    // hole where the letterhead should be is the one thing to avoid.
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

        <div className="tabs" role="tablist" style={{ marginBottom: 12 }}>
          {PASS_LOCALES.map((code) => (
            <button key={code} className="tab" role="tab" aria-selected={lang === code}
              onClick={() => setLang(code)}>{t(`lang_${code}`)}</button>
          ))}
        </div>

        {gaps.length > 0 && (
          <div className="banner warn" style={{ marginBottom: 12 }}>
            <strong>{t("gapsTitle")}</strong>
            <ul style={{ margin: "6px 0 0", paddingInlineStart: 18 }}>
              {gaps.map((gap) => <li key={gap}>{t(`gap_${gap}`)}</li>)}
            </ul>
          </div>
        )}

        <article id="checkpoint-pass-paper" className="pass-paper"
          dir={lang === "ar" ? "rtl" : "ltr"} lang={lang}>
          <header className="pass-top">
            {/* eslint-disable-next-line @next/next/no-img-element */}
            <img className="pass-logo" src={model.hotel.logo || "/easyroom-logo.png"} alt="" />
            <div className="pass-brand">
              <h1>{model.hotel.brand}</h1>
              {contact.length > 0 && (
                <p>{contact.map((line) => <span className="pass-contact" key={line}>{line}</span>)}</p>
              )}
            </div>
          </header>
          <div className="pass-rule" />

          <div className="pass-head">
            <h2>{w.title}</h2>
            <div className="pass-meta">
              <div>{w.reference}<b>{model.reference}</b></div>
              <div>{w.issuedOn}<b>{passDate(model.issuedOn, lang)}</b></div>
            </div>
          </div>

          {PASS_SECTIONS.map((section) => (
            <section className="pass-section" key={section.key}>
              <h3>{w[section.key]}</h3>
              <div className="pass-rows">
                {section.fields.map((field) => (
                  <div className="pass-row" key={field}>
                    <span>{w[field]}</span>
                    {values[field]
                      ? <strong className={ltrFields.has(field) ? "pass-code pass-ltr"
                          : codeFields.has(field) ? "pass-code" : ""}>{values[field]}</strong>
                      : <strong className="pass-blank">{w.missing}</strong>}
                  </div>
                ))}
              </div>
            </section>
          ))}

          <p className="pass-note">{w.statement}</p>

          <div className="pass-sign"><div>{w.stamp}</div></div>

          <footer className="pass-foot">
            <b className="pass-contact">{model.hotel.brand}</b>
            {contact.map((line) => <span className="pass-contact" key={line}>{line}</span>)}
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
