"use client";
import { useState } from "react";
import { useTranslations } from "next-intl";

/**
 * Asks for the manager PIN before a destructive action.
 *
 * This is a convenience, not the protection: the database refuses these
 * actions without a valid PIN regardless of what the browser sends. The
 * dialog exists so staff get a clear prompt instead of a raw error.
 */
/**
 * `disabled` is for what the screen still needs before the PIN is worth
 * asking for — a cancellation with no reason chosen, say. The PIN itself is
 * never the only thing standing in the way.
 */
export default function PinPrompt({
  title, note, confirmLabel, danger, busy, disabled, onConfirm, onCancel,
}) {
  const t = useTranslations("Settings");
  const [pin, setPin] = useState("");

  return (
    <div className="card stack" style={{ background: "var(--paper)" }}>
      <h2 style={{ fontSize: 14 }}>{title}</h2>
      {note && <p className="section-note" style={{ margin: 0 }}>{note}</p>}

      <div className="field">
        <label htmlFor="pin">{t("tab_security")}</label>
        <input
          id="pin"
          type="password"
          inputMode="numeric"
          autoComplete="off"
          className="mono"
          dir="ltr"
          style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
          value={pin}
          autoFocus
          onChange={(e) => setPin(e.target.value)}
          onKeyDown={(e) => { if (e.key === "Enter" && pin && !disabled) onConfirm(pin); }}
        />
      </div>

      <button
        className={`btn wide ${danger ? "danger" : "primary"}`}
        disabled={busy || !pin || disabled}
        onClick={() => onConfirm(pin)}
      >
        {busy ? t("applying") : confirmLabel}
      </button>
      <button className="btn wide" onClick={onCancel}>{t("back")}</button>
    </div>
  );
}
