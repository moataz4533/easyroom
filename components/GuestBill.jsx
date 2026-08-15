"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import { Copy, MessageCircle, Printer, X } from "lucide-react";
import { buildBillText } from "../lib/bill";
import { whatsappLink } from "../lib/confirmation";

/**
 * The bill, on the screen reception is already standing in front of.
 *
 * Three ways out, because guests ask for all three: printed on paper,
 * sent on WhatsApp, or copied. In the guest's language rather than the
 * one reception is working in — the two are rarely the same here.
 *
 * Built entirely from rows already loaded, so it opens with no connection.
 */
export default function GuestBill({ property, booking, allocations, charges, payments, onClose, onCopied, onCopyFailed }) {
  const appLocale = useLocale();
  const t = useTranslations("Bill");
  const common = useTranslations("Common");
  const [locale, setLocale] = useState(appLocale);
  const [text, setText] = useState("");

  useEffect(() => {
    setText(buildBillText({ property, booking, allocations, charges, payments, locale }));
  }, [property, booking, allocations, charges, payments, locale]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.();
    } catch {
      onCopyFailed?.();
    }
  }

  /**
   * Printed from a window of its own rather than by hiding the app with CSS:
   * a hotel prints this on whatever is plugged in at the desk, and a page
   * carrying none of the app's layout is the one most likely to come out
   * looking like a bill.
   */
  function print() {
    const win = window.open("", "_blank", "width=680,height=840");
    if (!win) return;
    win.document.write(`<!doctype html><html dir="${locale === "en" ? "ltr" : "rtl"}" lang="${locale}">
<head><meta charset="utf-8"><title>${booking?.reference || ""}</title>
<style>
  body { font-family: system-ui, sans-serif; margin: 32px; color: #102d34; }
  pre { font: inherit; font-size: 15px; line-height: 1.9; white-space: pre-wrap; margin: 0; }
  strong { font-weight: 700; }
</style></head>
<body><pre>${text.replace(/[&<>]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;" }[c]))
  .replace(/\*(.+?)\*/g, "<strong>$1</strong>")}</pre></body></html>`);
    win.document.close();
    win.focus();
    win.print();
  }

  return (
    <div className="dialog-backdrop" onClick={onClose}>
      <div className="dialog-panel" onClick={(e) => e.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 12 }}>
          <h2 style={{ fontSize: 17 }}>{t("title")}</h2>
          <button className="btn sm" onClick={onClose} aria-label={common("close")}>
            <X size={16} />
          </button>
        </div>

        <div className="tabs" role="tablist" aria-label={t("language")}>
          <button className="tab" role="tab" aria-selected={locale === "ar"}
            onClick={() => setLocale("ar")}>العربية</button>
          <button className="tab" role="tab" aria-selected={locale === "en"}
            onClick={() => setLocale("en")}>English</button>
        </div>

        <pre className="confirmation-text" dir={locale === "en" ? "ltr" : "rtl"}>{text}</pre>

        <div className="row" style={{ marginTop: 12 }}>
          <button className="btn primary grow" onClick={print}>
            <Printer size={16} />{t("print")}
          </button>
          <button className="btn grow" onClick={copy}>
            <Copy size={16} />{t("copy")}
          </button>
          {booking?.guests?.phone && (
            <a className="btn grow" target="_blank" rel="noreferrer"
              href={whatsappLink(booking.guests.phone, text)}>
              <MessageCircle size={16} />{t("send")}
            </a>
          )}
        </div>
      </div>
    </div>
  );
}
