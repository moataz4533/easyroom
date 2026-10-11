"use client";
import { useEffect, useState } from "react";
import { useTranslations } from "next-intl";
import { Copy, Download, Link2, MessageCircle } from "lucide-react";
import { hotelLoginUrl } from "../lib/auth-login";

/**
 * A hotel's own sign-in link, and the QR code for it.
 *
 * This is how staff are meant to arrive: the owner sends the link once, or
 * prints the code for the desk, and the sign-in screen opens with the hotel
 * already named. Nobody is asked to remember a code.
 */
export default function HotelLoginLink({ slug, hotelName, compact = false, onCopied, onCopyFailed }) {
  const t = useTranslations("HotelLink");
  const url = hotelLoginUrl(slug);
  const [qr, setQr] = useState(null);

  // Drawn in the browser, so the code never depends on a third party and
  // works for a hotel whose link has never been opened.
  useEffect(() => {
    let alive = true;
    import("qrcode").then(({ default: QRCode }) =>
      QRCode.toDataURL(url, { margin: 1, width: 560, color: { dark: "#0b3a46", light: "#ffffff" } })
    ).then((data) => { if (alive) setQr(data); }).catch(() => { if (alive) setQr(null); });
    return () => { alive = false; };
  }, [url]);

  async function copy() {
    try {
      await navigator.clipboard.writeText(url);
      onCopied?.(t("copied"));
    } catch {
      onCopyFailed?.(t("copyFailed"));
    }
  }

  const share = `https://wa.me/?text=${encodeURIComponent(t("shareText", { hotel: hotelName || slug, url }))}`;

  return (
    <div className={`hotel-link ${compact ? "compact" : "card"}`}>
      <div className="hotel-link-body">
        {!compact && (
          <>
            <div className="row" style={{ gap: 8 }}>
              <Link2 size={18} />
              <strong>{t("title")}</strong>
            </div>
            <p className="section-note" style={{ margin: 0 }}>{t("note")}</p>
          </>
        )}
        <a className="hotel-link-url mono" dir="ltr" href={url} target="_blank" rel="noreferrer">{url}</a>
        <div className="row" style={{ flexWrap: "wrap", gap: 6 }}>
          <button type="button" className="btn sm" onClick={copy}><Copy size={14} />{t("copy")}</button>
          <a className="btn sm" href={share} target="_blank" rel="noreferrer"><MessageCircle size={14} />{t("share")}</a>
          {qr && (
            <a className="btn sm" href={qr} download={`easyroom-${slug}-qr.png`}><Download size={14} />{t("downloadQr")}</a>
          )}
        </div>
      </div>
      {qr && !compact && (
        <img className="hotel-link-qr" src={qr} alt={t("qrAlt", { hotel: hotelName || slug })} /> /* eslint-disable-line @next/next/no-img-element */
      )}
    </div>
  );
}
