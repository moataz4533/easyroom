"use client";
import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import { useTranslations } from "next-intl";
import { useLocale } from "../lib/locale";
import { ArrowLeft, ArrowRight, CheckCircle2, CircleAlert, Info } from "lucide-react";
import { supabase } from "../lib/supabase";
import { localePath } from "../lib/locale";
import { BLOCKING, countByLevel, outstandingSetup } from "../lib/setup";

/**
 * What is still missing, on the screen staff open first.
 *
 * It disappears on its own once the hotel is set up, so it costs nothing
 * afterwards — and until then it is the only place anyone needs to look to
 * know what is left.
 */
export default function SetupChecklist({ property, role }) {
  const locale = useLocale();
  const t = useTranslations("Setup");
  const [state, setState] = useState(null);
  const propertyId = property?.id;
  const settings = property?.settings;

  const load = useCallback(async () => {
    if (!propertyId) return;
    const [rates, types, staff, pin] = await Promise.all([
      supabase.from("rates").select("id", { count: "exact", head: true }).eq("property_id", propertyId),
      supabase.from("room_types").select("name").eq("property_id", propertyId),
      supabase.from("property_members").select("id", { count: "exact", head: true })
        .eq("property_id", propertyId).eq("is_active", true),
      supabase.rpc("has_action_pin", { p_property: propertyId }),
    ]);

    setState({
      rateCount: rates.count || 0,
      types: types.data || [],
      staffCount: staff.count || 0,
      hasPin: pin.data === true,
      settings: settings || {},
    });
  }, [propertyId, settings]);

  useEffect(() => { load(); }, [load]);

  // Only the people who can act on it are shown it.
  if (!["owner", "manager"].includes(role)) return null;
  if (!state) return null;

  const items = outstandingSetup(state);
  if (items.length === 0) return null;

  const { blocking } = countByLevel(items);
  const Arrow = locale === "ar" ? ArrowLeft : ArrowRight;

  return (
    <section className="setup" data-blocking={blocking > 0}>
      <div className="setup-head">
        {blocking > 0 ? <CircleAlert size={20} /> : <Info size={20} />}
        <div>
          <h2>{t("title")}</h2>
          <p>{blocking > 0 ? t("blockingNote", { count: blocking }) : t("advisoryNote")}</p>
        </div>
      </div>

      <ol className="setup-list">
        {items.map((item) => (
          <li key={item.id} data-level={item.level}>
            <div>
              <strong>{t(`${item.id}.title`)}</strong>
              <span>{t(`${item.id}.why`)}</span>
            </div>
            <Link className="btn sm" href={localePath(`/settings?tab=${item.tab}`, locale)}>
              {t("fix")}<Arrow size={14} />
            </Link>
          </li>
        ))}
      </ol>

      <p className="setup-foot"><CheckCircle2 size={14} />{t("disappears")}</p>
    </section>
  );
}
