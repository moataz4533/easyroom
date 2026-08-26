"use client";

import { useEffect, useMemo, useState } from "react";
import { useTranslations } from "next-intl";
import { Plus, SlidersHorizontal } from "lucide-react";
import PinPrompt from "./PinPrompt";
import { supabase } from "../lib/supabase";
import { localizedName } from "../lib/locale";

const BASES = [
  "per_booking", "per_night", "per_room", "per_guest",
  "per_room_night", "per_guest_night",
];

const EMPTY = {
  id: null, code: "", name: "", name_en: "", description: "",
  description_en: "", is_default: false, is_active: true,
  account_id: "", account_name: "", addons: [],
};

function formFor(plan, accounts, planAddons) {
  if (!plan) return { ...EMPTY, addons: [] };
  return {
    id: plan.id,
    code: plan.code || "",
    name: plan.name || "",
    name_en: plan.name_en || "",
    description: plan.description || "",
    description_en: plan.description_en || "",
    is_default: !!plan.is_default,
    is_active: plan.is_active !== false,
    account_id: accounts.find((account) => account.rate_plan_id === plan.id)?.id || "",
    account_name: "",
    addons: planAddons
      .filter((addon) => addon.rate_plan_id === plan.id)
      .map((addon) => ({
        charge_item_id: addon.charge_item_id,
        pricing_basis: addon.pricing_basis,
        is_included: addon.is_included,
        unit_amount: addon.unit_amount ?? "",
        notes: addon.notes || "",
        sort_order: addon.sort_order || 0,
      })),
  };
}

export default function RatePlanManager({
  property, plans, accounts, planAddons, chargeItems, locale, reload, showToast,
}) {
  const t = useTranslations("RatePlans");
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState({ ...EMPTY, addons: [] });
  const [asking, setAsking] = useState(false);
  const [busy, setBusy] = useState(false);

  const activeItems = useMemo(
    () => chargeItems.filter((item) => item.is_active),
    [chargeItems]
  );

  useEffect(() => {
    if (!editing) return;
    const plan = plans.find((item) => item.id === editing);
    if (plan) setForm(formFor(plan, accounts, planAddons));
  }, [editing, plans, accounts, planAddons]);

  function open(plan = null) {
    setAsking(false);
    setEditing(plan?.id || "new");
    setForm(formFor(plan, accounts, planAddons));
  }

  function toggleAddon(item) {
    setForm((current) => {
      const exists = current.addons.some((addon) => addon.charge_item_id === item.id);
      return {
        ...current,
        addons: exists
          ? current.addons.filter((addon) => addon.charge_item_id !== item.id)
          : [...current.addons, {
              charge_item_id: item.id,
              pricing_basis: "per_guest_night",
              is_included: true,
              unit_amount: item.default_amount ?? 0,
              notes: "",
              sort_order: current.addons.length,
            }],
      };
    });
  }

  function patchAddon(itemId, patch) {
    setForm((current) => ({
      ...current,
      addons: current.addons.map((addon) =>
        addon.charge_item_id === itemId ? { ...addon, ...patch } : addon),
    }));
  }

  async function save(pin) {
    if (!form.name.trim() || !form.code.trim()) {
      setAsking(false);
      return showToast(t("needNameCode"), true);
    }
    setBusy(true);
    const { error } = await supabase.rpc("save_rate_plan", {
      p_property: property.id,
      p_plan: form.id,
      p_code: form.code,
      p_name: form.name,
      p_name_en: form.name_en || null,
      p_description: form.description || null,
      p_description_en: form.description_en || null,
      p_is_default: form.is_default,
      p_is_active: form.is_active,
      p_account: form.account_id || null,
      p_account_name: form.account_name || null,
      p_addons: form.addons.map((addon, index) => ({ ...addon, sort_order: index })),
      p_pin: pin,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);
    setAsking(false);
    setEditing(null);
    showToast(t("saved"));
    reload();
  }

  return (
    <section className="section rate-plan-manager">
      <div className="spread" style={{ marginBottom: 10 }}>
        <div>
          <h2 style={{ fontSize: 16, margin: 0 }}>{t("title")}</h2>
          <p className="section-note" style={{ margin: "3px 0 0" }}>{t("note")}</p>
        </div>
        <button className="btn sm" onClick={() => open()}>
          <Plus size={15} />{t("add")}
        </button>
      </div>

      <div className="rate-plan-list">
        {plans.map((plan) => {
          const linked = accounts.filter((account) => account.rate_plan_id === plan.id);
          const addons = planAddons.filter((addon) => addon.rate_plan_id === plan.id);
          return (
            <button key={plan.id} className="card rate-plan-card" onClick={() => open(plan)}>
              <div className="spread">
                <div className="grow">
                  <div className="row" style={{ gap: 7 }}>
                    <strong>{localizedName(plan, locale)}</strong>
                    <span className="code">{plan.code}</span>
                    {plan.is_default && <span className="pill dark">{t("default")}</span>}
                    {!plan.is_active && <span className="pill">{t("inactive")}</span>}
                  </div>
                  <div className="rate-plan-meta">
                    {linked.length ? linked.map((account) => account.name).join(" · ") : t("publicPlan")}
                    {" · "}{t("addonCount", { count: addons.length })}
                  </div>
                </div>
                <SlidersHorizontal size={17} />
              </div>
            </button>
          );
        })}
      </div>

      {editing && (
        <div className="card rate-plan-editor">
          <div className="spread">
            <h3>{form.id ? t("editTitle") : t("newTitle")}</h3>
            <button className="btn sm" onClick={() => { setEditing(null); setAsking(false); }}>
              {t("close")}
            </button>
          </div>

          <div className="form-grid two">
            <div className="field"><label htmlFor="plan-name">{t("name")}</label>
              <input id="plan-name" value={form.name}
                onChange={(event) => setForm((current) => ({ ...current, name: event.target.value }))} /></div>
            <div className="field"><label htmlFor="plan-name-en">{t("nameEn")}</label>
              <input id="plan-name-en" dir="ltr" value={form.name_en}
                onChange={(event) => setForm((current) => ({ ...current, name_en: event.target.value }))} /></div>
            <div className="field"><label htmlFor="plan-code">{t("code")}</label>
              <input id="plan-code" className="mono" dir="ltr" value={form.code}
                onChange={(event) => setForm((current) => ({ ...current, code: event.target.value }))} /></div>
            <div className="field"><label htmlFor="plan-account">{t("company")}</label>
              <select id="plan-account" value={form.account_id}
                onChange={(event) => setForm((current) => ({ ...current, account_id: event.target.value, account_name: "" }))}>
                <option value="">{t("noCompany")}</option>
                {accounts.map((account) => <option key={account.id} value={account.id}>{account.name}</option>)}
              </select></div>
          </div>

          {!form.account_id && (
            <div className="field"><label htmlFor="new-company">{t("newCompany")}</label>
              <input id="new-company" value={form.account_name} placeholder={t("newCompanyHint")}
                onChange={(event) => setForm((current) => ({ ...current, account_name: event.target.value }))} /></div>
          )}

          <div className="form-grid two">
            <div className="field"><label htmlFor="plan-description">{t("description")}</label>
              <input id="plan-description" value={form.description}
                onChange={(event) => setForm((current) => ({ ...current, description: event.target.value }))} /></div>
            <div className="field"><label htmlFor="plan-description-en">{t("descriptionEn")}</label>
              <input id="plan-description-en" dir="ltr" value={form.description_en}
                onChange={(event) => setForm((current) => ({ ...current, description_en: event.target.value }))} /></div>
          </div>

          <div className="row rate-plan-switches">
            <label className="check-row"><input type="checkbox" checked={form.is_active}
              onChange={(event) => setForm((current) => ({ ...current, is_active: event.target.checked }))} />
              <span>{t("active")}</span></label>
            <label className="check-row"><input type="checkbox" checked={form.is_default}
              onChange={(event) => setForm((current) => ({ ...current, is_default: event.target.checked }))} />
              <span>{t("makeDefault")}</span></label>
          </div>

          <div className="spread rate-plan-addon-heading">
            <div><h3>{t("services")}</h3><p>{t("servicesNote")}</p></div>
          </div>

          {!activeItems.length ? (
            <div className="banner warn">{t("needChargeItems")}</div>
          ) : (
            <div className="stack">
              {activeItems.map((item) => {
                const addon = form.addons.find((row) => row.charge_item_id === item.id);
                return (
                  <div key={item.id} className="rate-plan-addon" data-selected={!!addon}>
                    <label className="check-row rate-plan-addon-name">
                      <input type="checkbox" checked={!!addon} onChange={() => toggleAddon(item)} />
                      <span><strong>{localizedName(item, locale)}</strong>
                        <small>{t("cataloguePrice", { amount: Number(item.default_amount) || 0 })}</small></span>
                    </label>
                    {addon && (
                      <div className="rate-plan-addon-controls">
                        <select value={addon.pricing_basis}
                          aria-label={t("basis")}
                          onChange={(event) => patchAddon(item.id, { pricing_basis: event.target.value })}>
                          {BASES.map((basis) => <option key={basis} value={basis}>{t(`basis_${basis}`)}</option>)}
                        </select>
                        <select value={addon.is_included ? "included" : "paid"}
                          aria-label={t("chargeMode")}
                          onChange={(event) => patchAddon(item.id, { is_included: event.target.value === "included" })}>
                          <option value="included">{t("included")}</option>
                          <option value="paid">{t("paid")}</option>
                        </select>
                        {!addon.is_included && (
                          <input type="number" min="0" className="mono" value={addon.unit_amount}
                            aria-label={t("unitPrice")}
                            onChange={(event) => patchAddon(item.id, { unit_amount: event.target.value })} />
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </div>
          )}

          {asking ? (
            <PinPrompt title={t("pinTitle")} note={t("pinNote")} confirmLabel={t("save")}
              busy={busy} onCancel={() => setAsking(false)} onConfirm={save} />
          ) : (
            <button className="btn primary wide" onClick={() => setAsking(true)}>{t("save")}</button>
          )}
        </div>
      )}
    </section>
  );
}
