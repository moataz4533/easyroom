"use client";
import { useEffect, useState } from "react";
import { GUEST_LOCALES, LANGUAGE_NAMES, isRtl } from "../lib/guest-locales";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import { Copy, MessageCircle, X } from "lucide-react";
import { buildConfirmation, whatsappLink } from "../lib/confirmation";

/**
 * Shows the confirmation message before it is sent.
 *
 * Editable on purpose: the guest asked for a late arrival, or a bed for a
 * child, and reception knows things the booking record does not. What we
 * generate is a starting point, not the final word.
 */
export default function ConfirmationMessage({ property, booking, rooms, onClose, onCopied, onCopyFailed }) {
  const appLocale = useLocale();
  const t = useTranslations("Confirmation");
  const common = useTranslations("Common");
  const [locale, setLocale] = useState(appLocale);
  const [text, setText] = useState("");
  const [edited, setEdited] = useState(false);

  // Switching language rewrites the draft, unless the wording was changed by
  // hand — throwing away someone's edit would be worse than a mixed message.
  useEffect(() => {
    if (edited) return;
    setText(buildConfirmation({ property, booking, rooms, locale }));
  }, [property, booking, rooms, locale, edited]);

  const phone = booking.guests?.phone;
  const link = whatsappLink(phone, text);

  async function copy() {
    try {
      await navigator.clipboard.writeText(text);
      onCopied?.();
    } catch {
      onCopyFailed?.();
    }
  }

  return (
    <div className="dialog-backdrop" onClick={onClose} role="presentation">
      <div className="dialog-panel" onClick={(event) => event.stopPropagation()}>
        <div className="spread" style={{ marginBottom: 14 }}>
          <h2 style={{ margin: 0, fontSize: 18 }}>{t("title")}</h2>
          <button className="btn sm" onClick={onClose} aria-label={common("close")}><X size={16} /></button>
        </div>

        <div className="field">
          <label htmlFor="confirmation-locale">{t("language")}</label>
          <div className="tabs" role="tablist" id="confirmation-locale">
            {GUEST_LOCALES.map((option) => (
              <button
                key={option} className="tab" role="tab" aria-selected={locale === option}
                onClick={() => { setLocale(option); setEdited(false); }}
              >
                {LANGUAGE_NAMES[option]}
              </button>
            ))}
          </div>
        </div>

        <div className="field">
          <label htmlFor="confirmation-text">{t("message")}</label>
          <textarea
            id="confirmation-text" className="confirmation-text" rows={14}
            dir={isRtl(locale) ? "rtl" : "ltr"} value={text}
            onChange={(event) => { setText(event.target.value); setEdited(true); }}
          />
        </div>

        <div className="stack">
          {link ? (
            <a className="btn primary wide" href={link} target="_blank" rel="noreferrer">
              <MessageCircle size={17} />{t("send")}
            </a>
          ) : (
            <div className="banner warn" style={{ margin: 0 }}>{t("noPhone")}</div>
          )}
          <button className="btn wide" onClick={copy}><Copy size={16} />{t("copy")}</button>
        </div>
      </div>
    </div>
  );
}
