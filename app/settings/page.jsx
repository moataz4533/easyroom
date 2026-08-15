"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Shell, { useProperty, Toast, useToast, roleLabel } from "../../components/Shell";
import PinPrompt from "../../components/PinPrompt";
import BackupCard from "../../components/BackupCard";
import { supabase, egp, dayLabel } from "../../lib/supabase";
import { Dialog } from "../../components/ui";
import { localizedName } from "../../lib/locale";
import { useLocale, useTranslations } from "next-intl";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { isStaffUsername, normalizeStaffUsername } from "../../lib/auth-login";

export default function Page() {
  return (
    <Shell>
      {/* The setup checklist links straight to a tab, and reading which one
          needs the URL, which is not known while prerendering. */}
      <Suspense fallback={<div className="empty">…</div>}>
        <Settings />
      </Suspense>
    </Shell>
  );
}

const BANDS = ["#1E5F74", "#D99A2B", "#C96F5A", "#6E9075", "#6C6B9E"];
const OCC = { 1: "سنجل", 2: "دابل", 3: "تريبل", 4: "رباعي", 5: "خماسي", 6: "سداسي" };
const TABS = [
  ["rates", "الأسعار"],
  ["seasons", "المواسم"],
  ["rooms", "الغرف"],
  ["charges", "الإضافات"],
  ["staff", "الموظفين"],
  ["security", "كلمة مرور المدير"],
  ["backup", "نسخة احتياطية"],
  ["property", "بيانات الفندق"],
];

const TAB_IDS = TABS.map(([id]) => id);

function Settings() {
  const { property } = useProperty();
  const locale = useLocale();
  const params = useSearchParams();
  const requested = params.get("tab");
  const [tab, setTab] = useState(TAB_IDS.includes(requested) ? requested : "rates");
  const [toast, showToast] = useToast();

  const [types, setTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [rates, setRates] = useState({});
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [chargeItems, setChargeItems] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const [t, p, r, rm, st, ci] = await Promise.all([
      supabase.from("room_types").select("*").eq("property_id", property.id).order("sort_order"),
      supabase.from("rate_plans").select("*").eq("property_id", property.id).order("sort_order"),
      supabase.from("rates").select("*").eq("property_id", property.id).is("valid_from", null),
      supabase.from("rooms").select("*, room_types(name, name_en)").eq("property_id", property.id),
      supabase.from("property_members").select("*, profiles(full_name, phone)")
        .eq("property_id", property.id),
      supabase.from("charge_items").select("*").eq("property_id", property.id)
        .order("sort_order"),
    ]);
    setTypes(t.data || []);
    setPlans(p.data || []);
    setRates(Object.fromEntries(
      (r.data || []).map((x) => [`${x.room_type_id}|${x.rate_plan_id}|${x.occupancy}`, x.amount])
    ));
    setRooms((rm.data || []).sort((a, b) =>
      String(a.number).localeCompare(String(b.number), "en", { numeric: true })
    ));
    setStaff(st.data || []);
    setChargeItems(ci.data || []);
    setLoading(false);
  }, [property]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="empty">جارٍ التحميل…</div>;

  const shared = { property, types, plans, rates, rooms, staff, chargeItems, reload: load, showToast, locale };

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 10 }}>الإعدادات</h2>

      <div className="tabs" role="tablist">
        {TABS.map(([k, label]) => (
          <button key={k} className="tab" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}>
            {label}
          </button>
        ))}
      </div>

      {tab === "rates" && <Rates {...shared} />}
      {tab === "seasons" && <Seasons {...shared} />}
      {tab === "rooms" && <Rooms {...shared} />}
      {tab === "charges" && <ChargeItems {...shared} />}
      {tab === "staff" && <Staff {...shared} />}
      {tab === "security" && <Security {...shared} />}
      {tab === "backup" && <BackupCard property={property} />}
      {tab === "property" && <PropertyInfo {...shared} />}
    </>
  );
}


/* ------------------------------------------------------------------ */
// The price grid, shared by the standing prices and by each season. Same
// shape in both places on purpose: a season is the same question asked for
// a different stretch of the year.
export function rateKey(typeId, planId, occupancy) {
  return `${typeId}|${planId}|${occupancy}`;
}

function RateMatrix({ types, plans, locale, active, setActive, draft, setDraft }) {
  const type = types.find((x) => x.id === active);
  return (
    <>
      <div className="tabs" role="tablist">
        {types.map((x, i) => (
          <button key={x.id} className="tab" role="tab" aria-selected={active === x.id}
            onClick={() => setActive(x.id)}>
            <span className="dot" style={{ background: BANDS[i % BANDS.length] }} />
            {localizedName(x, locale)}
          </button>
        ))}
      </div>

      {type && (
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>عدد الأفراد</th>
                {plans.map((p) => <th key={p.id}>{localizedName(p, locale)}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: type.max_occupancy }, (_, i) => i + 1).map((o) => (
                <tr key={o}>
                  <td className="occ">{OCC[o] || `${o} أفراد`}<small>{o} pax</small></td>
                  {plans.map((p) => (
                    <td key={p.id}>
                      <input
                        type="number" min="0" placeholder="—"
                        aria-label={`${OCC[o]} · ${localizedName(p, locale)}`}
                        value={draft[rateKey(type.id, p.id, o)] ?? ""}
                        onChange={(e) => setDraft((d) => ({
                          ...d, [rateKey(type.id, p.id, o)]: e.target.value === "" ? "" : Number(e.target.value),
                        }))}
                      />
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
function Rates({ property, types, plans, rates, reload, showToast, locale }) {
  const [active, setActive] = useState(types[0]?.id);
  const [draft, setDraft] = useState(rates);
  const [saving, setSaving] = useState(false);
  const [asking, setAsking] = useState(false);

  useEffect(() => setDraft(rates), [rates]);
  useEffect(() => { if (!active && types[0]) setActive(types[0].id); }, [types, active]);

  const dirty = JSON.stringify(draft) !== JSON.stringify(rates);

  // Writes go through save_rates: direct writes to the rates table are
  // closed, because a policy can't take a password as an argument.
  async function save(pin) {
    setSaving(true);

    const rows = Object.entries(draft)
      .filter(([k, v]) => v !== rates[k])
      .map(([k, v]) => {
        const [room_type_id, rate_plan_id, occupancy] = k.split("|");
        return {
          room_type_id, rate_plan_id,
          occupancy: Number(occupancy),
          amount: v === "" || v === null || v === undefined ? null : Number(v),
        };
      });

    const { error } = await supabase.rpc("save_rates", {
      p_property: property.id, p_rows: rows, p_pin: pin,
    });

    setSaving(false);
    if (error) return showToast(error.message, true);

    setAsking(false);
    showToast(`${rows.length} سعر تم الحفظ`);
    reload();
  }

  if (!types.length) return <div className="empty">أضف نوع غرفة أولاً من تبويب الغرف.</div>;

  return (
    <>
      <p className="section-note">
        سعر الليلة للغرفة كاملة. الخانة الفارغة تعني أن هذه التركيبة غير معروضة للبيع.
      </p>

      <RateMatrix types={types} plans={plans} locale={locale}
        active={active} setActive={setActive} draft={draft} setDraft={setDraft} />

      {dirty && !asking && (
        <button className="btn primary wide" style={{ marginTop: 14 }}
          onClick={() => setAsking(true)}>
          حفظ الأسعار
        </button>
      )}

      {asking && (
        <div style={{ marginTop: 14 }}>
          <PinPrompt
            title="تأكيد تغيير الأسعار"
            note="تغيير السعر يؤثر على كل حجز جديد، ولذلك يتطلب كلمة مرور المدير."
            confirmLabel="حفظ الأسعار"
            busy={saving}
            onCancel={() => setAsking(false)}
            onConfirm={save}
          />
        </div>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
function Rooms({ property, types, rooms, reload, showToast, locale }) {
  const [newRoom, setNewRoom] = useState("");
  const [newType, setNewType] = useState("");
  const [typeName, setTypeName] = useState("");
  const [typeNameEn, setTypeNameEn] = useState("");
  const [typeDescription, setTypeDescription] = useState("");
  const [typeDescriptionEn, setTypeDescriptionEn] = useState("");
  const [typeCode, setTypeCode] = useState("");
  const [typeMax, setTypeMax] = useState(2);
  const [editing, setEditing] = useState(null);   // the type being renamed
  const [draftType, setDraftType] = useState({});

  async function addType() {
    if (!typeName.trim() || !typeCode.trim()) return showToast("الاسم والكود مطلوبان", true);
    const { error } = await supabase.from("room_types").insert({
      property_id: property.id,
      code: typeCode.trim().toUpperCase(),
      name: typeName.trim(),
      name_en: typeNameEn.trim() || null,
      description: typeDescription.trim() || null,
      description_en: typeDescriptionEn.trim() || null,
      max_occupancy: Number(typeMax),
      base_occupancy: Math.min(2, Number(typeMax)),
      sort_order: types.length + 1,
    });
    if (error) return showToast(error.message, true);
    setTypeName(""); setTypeNameEn(""); setTypeDescription(""); setTypeDescriptionEn(""); setTypeCode(""); setTypeMax(2);
    showToast("تمت إضافة النوع"); reload();
  }

  /**
   * Renaming rather than replacing. A hotel does not have "a standard room
   * and also a sea-view room" — it has rooms it wants to call what they
   * actually are. Adding a second type and moving every room across one by
   * one is the same intent expressed as seven actions instead of one.
   */
  async function renameType(id) {
    const name = String(draftType.name || "").trim();
    if (!name) return showToast("الاسم مطلوب", true);
    const { error } = await supabase.from("room_types").update({
      name,
      name_en: String(draftType.name_en || "").trim() || null,
      max_occupancy: Math.max(1, Math.min(6, Number(draftType.max_occupancy) || 2)),
    }).eq("id", id);
    if (error) return showToast(error.message, true);
    setEditing(null);
    showToast("تم تعديل النوع");
    reload();
  }

  async function addRoom() {
    const tId = newType || types[0]?.id;
    if (!newRoom.trim() || !tId) return showToast("أدخل رقم الغرفة", true);
    const { error } = await supabase.from("rooms").insert({
      property_id: property.id, room_type_id: tId, number: newRoom.trim(),
    });
    if (error) return showToast(error.message, true);
    setNewRoom(""); showToast("تمت إضافة الغرفة"); reload();
  }

  async function setRoomType(roomId, typeId) {
    const { error } = await supabase.rpc("update_room_admin", {
      p_room: roomId, p_room_type: typeId,
    });
    if (error) return showToast(error.message, true);
    reload();
  }

  return (
    <>
      <section className="section">
        <h2 style={{ fontSize: 14 }}>أنواع الغرف</h2>
        <p className="section-note">لكل نوع سعره الخاص. إذا كانت غرفك كلها بنفس المستوى فنوع واحد يكفي — عدّل اسمه ليصف غرفك بدل إضافة نوع جديد. «أقصى عدد» يحدد صفوف مصفوفة الأسعار.</p>
        <div className="stack">
          {types.map((t, i) => (
            <div key={t.id} className="card">
              {editing === t.id ? (
                <div className="stack">
                  <div className="row">
                    <div className="field grow"><label>الاسم</label>
                      <input autoFocus value={draftType.name || ""} placeholder="غرفة بحرية"
                        onChange={(e) => setDraftType({ ...draftType, name: e.target.value })} /></div>
                    <div className="field grow"><label>الاسم بالإنجليزية</label>
                      <input value={draftType.name_en || ""} dir="ltr" placeholder="Sea View Room"
                        onChange={(e) => setDraftType({ ...draftType, name_en: e.target.value })} /></div>
                    <div className="field" style={{ width: 90 }}><label>أقصى عدد</label>
                      <input className="mono" type="number" min="1" max="6"
                        value={draftType.max_occupancy || 2}
                        onChange={(e) => setDraftType({ ...draftType, max_occupancy: e.target.value })} /></div>
                  </div>
                  <div className="row">
                    <button className="btn primary" onClick={() => renameType(t.id)}>حفظ</button>
                    <button className="btn" onClick={() => setEditing(null)}>إلغاء</button>
                  </div>
                </div>
              ) : (
                <div className="spread">
                  <div className="grow">
                    <div style={{ fontWeight: 600 }}>
                      <span className="dot" style={{ background: BANDS[i % BANDS.length],
                        display: "inline-block", marginInlineEnd: 6 }} />
                      {localizedName(t, locale)} <span className="code">{t.code}</span>
                    </div>
                    <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                      {rooms.filter((r) => r.room_type_id === t.id).length} غرفة · لحد {t.max_occupancy} أفراد
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => {
                    setEditing(t.id);
                    setDraftType({ name: t.name, name_en: t.name_en || "", max_occupancy: t.max_occupancy });
                  }}>تعديل الاسم</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card stack" style={{ marginTop: 10, background: "var(--paper)" }}>
          <div className="row">
            <div className="field grow"><label>الاسم</label>
              <input value={typeName} placeholder="غرفة بحرية"
                onChange={(e) => setTypeName(e.target.value)} /></div>
            <div className="field grow"><label>الاسم بالإنجليزية</label>
              <input value={typeNameEn} placeholder="Sea View Room" dir="ltr"
                onChange={(e) => setTypeNameEn(e.target.value)} /></div>
            <div className="field grow"><label>الوصف</label>
              <input value={typeDescription} onChange={(e) => setTypeDescription(e.target.value)} /></div>
            <div className="field grow"><label>الوصف بالإنجليزية</label>
              <input value={typeDescriptionEn} dir="ltr" onChange={(e) => setTypeDescriptionEn(e.target.value)} /></div>
            <div className="field" style={{ width: 100 }}><label>الكود</label>
              <input className="mono" value={typeCode} placeholder="SEA"
                onChange={(e) => setTypeCode(e.target.value)} /></div>
            <div className="field" style={{ width: 90 }}><label>أقصى عدد</label>
              <input className="mono" type="number" min="1" max="6" value={typeMax}
                onChange={(e) => setTypeMax(e.target.value)} /></div>
          </div>
          <button className="btn" onClick={addType}>إضافة نوع</button>
        </div>
      </section>

      <section className="section">
        <h2 style={{ fontSize: 14 }}>الغرف</h2>
        <div className="stack">
          {rooms.map((r) => (
            <div key={r.id} className="card spread">
              <span className="mono" style={{ fontSize: 20, fontWeight: 600 }}>{r.number}</span>
              <select style={{ maxWidth: 200 }} value={r.room_type_id}
                onChange={(e) => setRoomType(r.id, e.target.value)}>
                {types.map((t) => <option key={t.id} value={t.id}>{localizedName(t, locale)}</option>)}
              </select>
            </div>
          ))}
        </div>

        <div className="card row" style={{ marginTop: 10, background: "var(--paper)" }}>
          <div className="field grow"><label>رقم غرفة جديدة</label>
            <input className="mono" value={newRoom} placeholder="107"
              onChange={(e) => setNewRoom(e.target.value)} /></div>
          <div className="field grow"><label>النوع</label>
            <select value={newType || types[0]?.id || ""} onChange={(e) => setNewType(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{localizedName(t, locale)}</option>)}
            </select></div>
          <button className="btn" style={{ alignSelf: "flex-end" }} onClick={addRoom}>إضافة</button>
        </div>
      </section>
    </>
  );
}

/* ------------------------------------------------------------------ */
// Seasonal prices.
//
// The database has always priced night by night, so a stay crossing a season
// boundary is charged correctly on each side without anything here knowing
// about it. All this screen does is write the dated rows.
function Seasons({ property, types, plans, showToast, locale }) {
  const t = useTranslations("Seasons");
  const [seasons, setSeasons] = useState([]);
  const [selected, setSelected] = useState(null);
  const [stored, setStored] = useState({});
  const [draft, setDraft] = useState({});
  const [active, setActive] = useState(types[0]?.id);
  const [form, setForm] = useState({ name: "", name_en: "", from: "", to: "" });
  const [asking, setAsking] = useState(null); // "save" | "delete"
  const [busy, setBusy] = useState(false);

  const loadSeasons = useCallback(async () => {
    const { data, error } = await supabase.rpc("list_seasons", { p_property: property.id });
    if (error) return showToast(error.message, true);
    setSeasons(data || []);
  }, [property.id]); // eslint-disable-line react-hooks/exhaustive-deps

  useEffect(() => { loadSeasons(); }, [loadSeasons]);
  useEffect(() => { if (!active && types[0]) setActive(types[0].id); }, [types, active]);

  // A season's prices are the rate rows stamped with its start date.
  const openSeason = useCallback(async (season) => {
    setSelected(season);
    const { data } = await supabase.from("rates").select("*")
      .eq("property_id", property.id).eq("valid_from", season.starts_on);
    const map = Object.fromEntries((data || []).map((row) =>
      [rateKey(row.room_type_id, row.rate_plan_id, row.occupancy), row.amount]));
    setStored(map);
    setDraft(map);
  }, [property.id]);

  function createSeason() {
    if (!form.name.trim()) return showToast(t("needName"), true);
    if (!form.from || !form.to) return showToast(t("needDates"), true);
    if (form.to < form.from) return showToast(t("badDates"), true);
    setSelected({ name: form.name.trim(), name_en: form.name_en.trim(), starts_on: form.from, ends_on: form.to, rate_count: 0 });
    setStored({});
    setDraft({});
  }

  async function save(pin) {
    setBusy(true);
    // Only what changed, so an untouched season is not rewritten wholesale.
    const rows = Object.entries(draft)
      .filter(([key, value]) => value !== stored[key])
      .map(([key, value]) => {
        const [room_type_id, rate_plan_id, occupancy] = key.split("|");
        return {
          room_type_id, rate_plan_id, occupancy: Number(occupancy),
          amount: value === "" || value === null || value === undefined ? null : Number(value),
        };
      });

    const { error } = await supabase.rpc("save_season_rates", {
      p_property: property.id,
      p_from: selected.starts_on,
      p_to: selected.ends_on,
      p_name: selected.name,
      p_name_en: selected.name_en || null,
      p_rows: rows,
      p_pin: pin,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);

    setAsking(null);
    showToast(t("saved", { count: rows.length }));
    setForm({ name: "", name_en: "", from: "", to: "" });
    setStored(draft);
    loadSeasons();
  }

  async function remove(pin) {
    setBusy(true);
    const { error } = await supabase.rpc("delete_season", {
      p_property: property.id, p_from: selected.starts_on, p_pin: pin,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);
    setAsking(null);
    setSelected(null);
    showToast(t("deleted"));
    loadSeasons();
  }

  if (!types.length) return <div className="empty">أضف نوع غرفة أولاً من تبويب الغرف.</div>;

  const dirty = JSON.stringify(draft) !== JSON.stringify(stored);

  return (
    <>
      <p className="section-note">{t("note")}</p>

      {seasons.length > 0 && (
        <div className="stack" style={{ marginBottom: 14 }}>
          {seasons.map((season) => (
            <button key={season.id || season.starts_on} className="card spread"
              style={{ textAlign: "start", cursor: "pointer", width: "100%",
                fontFamily: "inherit", color: "inherit",
                borderColor: selected?.starts_on === season.starts_on ? "var(--sea)" : undefined }}
              onClick={() => openSeason(season)}>
              <div className="grow">
                <div className="row" style={{ gap: 8 }}>
                  <span style={{ fontWeight: 600 }}>{localizedName(season, locale)}</span>
                  {season.is_current && <span className="pill ok">{t("current")}</span>}
                  {Number(season.rate_count) === 0 && <span className="pill warn">{t("noPrices")}</span>}
                </div>
                <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginTop: 3 }}>
                  {dayLabel(season.starts_on, locale)} ← {dayLabel(season.ends_on, locale)}
                  {" · "}{t("priceCount", { count: Number(season.rate_count) })}
                </div>
              </div>
            </button>
          ))}
        </div>
      )}

      {!selected ? (
        <div className="card stack" style={{ background: "var(--paper)" }}>
          <h2 style={{ fontSize: 14, margin: 0 }}>{t("addTitle")}</h2>
          <div className="row">
            <div className="field grow"><label>{t("name")}</label>
              <input value={form.name} placeholder="صيف ٢٠٢٦"
                onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} /></div>
            <div className="field grow"><label>{t("nameEn")}</label>
              <input value={form.name_en} placeholder="Summer 2026" dir="ltr"
                onChange={(e) => setForm((c) => ({ ...c, name_en: e.target.value }))} /></div>
          </div>
          <div className="row">
            <div className="field grow"><label>{t("from")}</label>
              <input type="date" className="mono" value={form.from}
                onChange={(e) => setForm((c) => ({ ...c, from: e.target.value }))} /></div>
            <div className="field grow"><label>{t("to")}</label>
              <input type="date" className="mono" value={form.to} min={form.from}
                onChange={(e) => setForm((c) => ({ ...c, to: e.target.value }))} /></div>
          </div>
          <button className="btn" onClick={createSeason}>{t("addConfirm")}</button>
        </div>
      ) : (
        <>
          <div className="spread" style={{ marginBottom: 10 }}>
            <div>
              <h2 style={{ fontSize: 15, margin: 0 }}>{localizedName(selected, locale) || selected.name}</h2>
              <div className="mono" style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>
                {dayLabel(selected.starts_on, locale)} ← {dayLabel(selected.ends_on, locale)}
              </div>
            </div>
            <button className="btn sm" onClick={() => { setSelected(null); setAsking(null); }}>
              {t("back")}
            </button>
          </div>

          <p className="section-note">{t("emptyMeansStanding")}</p>

          <RateMatrix types={types} plans={plans} locale={locale}
            active={active} setActive={setActive} draft={draft} setDraft={setDraft} />

          {asking === "save" ? (
            <div style={{ marginTop: 14 }}>
              <PinPrompt title={t("confirmSave")} note={t("confirmSaveNote")}
                confirmLabel={t("saveButton")} busy={busy}
                onCancel={() => setAsking(null)} onConfirm={save} />
            </div>
          ) : asking === "delete" ? (
            <div style={{ marginTop: 14 }}>
              <PinPrompt title={t("confirmDelete")} note={t("confirmDeleteNote")}
                confirmLabel={t("deleteButton")} danger busy={busy}
                onCancel={() => setAsking(null)} onConfirm={remove} />
            </div>
          ) : (
            <div className="stack" style={{ marginTop: 14 }}>
              <button className="btn primary wide" disabled={!dirty && Number(selected.rate_count) > 0}
                onClick={() => setAsking("save")}>
                {t("saveButton")}
              </button>
              {selected.id && (
                <button className="btn wide danger" onClick={() => setAsking("delete")}>
                  {t("deleteButton")}
                </button>
              )}
            </div>
          )}
        </>
      )}
    </>
  );
}

/* ------------------------------------------------------------------ */
// The catalogue behind the extras. Its whole job is that the same breakfast
// costs the same on every shift; reception can still override one line.
function ChargeItems({ property, chargeItems, reload, showToast, locale }) {
  const t = useTranslations("Charges");
  const [form, setForm] = useState({ name: "", name_en: "", amount: "" });
  const [busy, setBusy] = useState(false);

  async function add() {
    if (!form.name.trim()) return showToast(t("itemNeedName"), true);
    setBusy(true);
    const { error } = await supabase.from("charge_items").insert({
      property_id: property.id,
      name: form.name.trim(),
      name_en: form.name_en.trim() || null,
      default_amount: Number(form.amount) || 0,
      sort_order: chargeItems.length + 1,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);
    setForm({ name: "", name_en: "", amount: "" });
    showToast(t("itemSaved"));
    reload();
  }

  async function update(id, patch) {
    const { error } = await supabase.from("charge_items").update(patch).eq("id", id);
    if (error) return showToast(error.message, true);
    reload();
  }

  return (
    <section className="section">
      <h2 style={{ fontSize: 14 }}>{t("settingsTitle")}</h2>
      <p className="section-note">{t("settingsNote")}</p>

      {chargeItems.length === 0 ? (
        <div className="empty">{t("noItems")}</div>
      ) : (
        <div className="stack">
          {chargeItems.map((item) => (
            <div key={item.id} className="card spread" style={{ opacity: item.is_active ? 1 : .6 }}>
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {localizedName(item, locale)}
                  {!item.is_active && <span className="pill" style={{ marginInlineStart: 8 }}>{t("itemHidden")}</span>}
                </div>
                <div style={{ fontSize: 12, color: "var(--muted)", marginTop: 2 }}>{item.name_en || "—"}</div>
              </div>
              <div className="field" style={{ width: 120 }}>
                <label htmlFor={`amount-${item.id}`}>{t("itemAmount")}</label>
                <input id={`amount-${item.id}`} type="number" min="0" className="mono"
                  defaultValue={item.default_amount}
                  onBlur={(event) => {
                    const next = Number(event.target.value) || 0;
                    if (next !== Number(item.default_amount)) update(item.id, { default_amount: next });
                  }} />
              </div>
              <button className="btn sm" style={{ marginInlineStart: 8 }}
                onClick={() => update(item.id, { is_active: !item.is_active })}>
                {item.is_active ? t("itemDeactivate") : t("itemActivate")}
              </button>
            </div>
          ))}
        </div>
      )}

      <div className="card stack" style={{ marginTop: 10, background: "var(--paper)" }}>
        <div className="row">
          <div className="field grow"><label>{t("itemName")}</label>
            <input value={form.name} placeholder="فطار"
              onChange={(e) => setForm((c) => ({ ...c, name: e.target.value }))} /></div>
          <div className="field grow"><label>{t("itemNameEn")}</label>
            <input value={form.name_en} placeholder="Breakfast" dir="ltr"
              onChange={(e) => setForm((c) => ({ ...c, name_en: e.target.value }))} /></div>
          <div className="field" style={{ width: 110 }}><label>{t("itemAmount")}</label>
            <input className="mono" type="number" min="0" value={form.amount}
              onChange={(e) => setForm((c) => ({ ...c, amount: e.target.value }))} /></div>
        </div>
        <button className="btn" disabled={busy} onClick={add}>{t("itemAdd")}</button>
      </div>
    </section>
  );
}

/* ------------------------------------------------------------------ */
function Staff({ property, staff, reload, showToast }) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetMember, setResetMember] = useState(null);
  const [resetValue, setResetValue] = useState("");
  const [resetAgain, setResetAgain] = useState("");
  const [form, setForm] = useState({
    full_name: "", username: "", phone: "", password: "", password_again: "", role: "reception",
  });

  // Staff admin runs server-side: creating a login needs a secret key that
  // must never reach the browser.
  async function call(payload) {
    const { data: { session } } = await supabase.auth.getSession();
    const res = await fetch(
      "https://huvbguyvgptmplqbcbdp.supabase.co/functions/v1/staff-admin",
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${session?.access_token}`,
        },
        body: JSON.stringify({ property_id: property.id, ...payload }),
      }
    );
    return res.json();
  }

  async function create() {
    if (!form.full_name.trim() || !isStaffUsername(form.username)) {
      return showToast("الاسم واسم المستخدم بالإنجليزية مطلوبان، بحد أدنى 3 أحرف", true);
    }
    if (form.password.length < 8) return showToast("كلمة المرور يجب أن تكون 8 أحرف على الأقل", true);
    if (form.password !== form.password_again) return showToast("كلمتا المرور غير متطابقتين", true);

    setBusy(true);
    const out = await call({
      action: "create",
      full_name: form.full_name,
      username: normalizeStaffUsername(form.username),
      phone: form.phone,
      password: form.password,
      role: form.role,
    });
    setBusy(false);

    if (out.error) return showToast(out.error, true);
    showToast(`تمت إضافة ${form.full_name}. سلّمه اسم المستخدم وكلمة المرور.`);
    setForm({ full_name: "", username: "", phone: "", password: "", password_again: "", role: "reception" });
    setOpen(false);
    reload();
  }

  async function changeRole(m, role) {
    const out = await call({ action: "set_role", member_id: m.id, role });
    if (out.error) return showToast(out.error, true);
    showToast("تم تغيير الصلاحية");
    reload();
  }

  async function toggle(m) {
    const out = await call({ action: "set_active", member_id: m.id });
    if (out.error) return showToast(out.error, true);
    showToast(out.is_active ? "تم تفعيل الحساب" : "تم إيقاف الحساب");
    reload();
  }

  async function resetPassword() {
    if (resetValue.length < 8) return showToast("كلمة المرور يجب أن تكون 8 أحرف على الأقل", true);
    if (resetValue !== resetAgain) return showToast("كلمتا المرور غير متطابقتين", true);
    setBusy(true);
    const out = await call({ action: "reset_password", member_id: resetMember.id, password: resetValue });
    setBusy(false);
    if (out.error) return showToast(out.error, true);
    showToast("تم تغيير كلمة المرور. سلّمه الكلمة الجديدة.");
    setResetMember(null); setResetValue(""); setResetAgain("");
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <p className="section-note">
        كل موظف يرى ما يخصه فقط. موظف النظافة لا يرى المبالغ ولا بيانات النزلاء.
      </p>

      <div className="stack">
        {staff.map((m) => (
          <div key={m.id} className="card" style={{ opacity: m.is_active ? 1 : 0.55 }}>
            <div className="spread">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {m.profiles?.full_name || "—"}
                  {!m.is_active && <span className="pill bad" style={{ marginInlineStart: 6 }}>موقوف</span>}
                </div>
                {m.profiles?.phone && (
                  <div className="mono" style={{ fontSize: 12, color: "var(--muted)" }}>
                    {m.profiles.phone}
                  </div>
                )}
                {m.login_username && <div className="staff-username mono">@{m.login_username}</div>}
              </div>
              <select
                style={{ width: "auto", minWidth: 120 }}
                value={m.role}
                onChange={(e) => changeRole(m, e.target.value)}
              >
                <option value="owner">المالك</option>
                <option value="manager">مدير</option>
                <option value="reception">استقبال</option>
                <option value="housekeeping">نظافة</option>
              </select>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => { setResetMember(m); setResetValue(""); setResetAgain(""); }}>تغيير كلمة المرور</button>
              <button className="btn sm danger" onClick={() => toggle(m)}>
                {m.is_active ? "إيقاف الحساب" : "تفعيل الحساب"}
              </button>
            </div>
          </div>
        ))}
      </div>

      {!open ? (
        <button className="btn ghost wide" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
          ＋ إضافة موظف
        </button>
      ) : (
        <div className="card stack" style={{ marginTop: 12, background: "var(--paper)" }}>
          <h2 style={{ fontSize: 14 }}>موظف جديد</h2>
          <div className="field"><label>الاسم</label>
            <input value={form.full_name} onChange={set("full_name")} placeholder="أحمد محمود" /></div>
          <div className="field"><label>اسم المستخدم (يُستخدم لتسجيل الدخول)</label>
            <input dir="ltr" className="mono" style={{ textAlign: "left" }} autoComplete="off"
              value={form.username} onChange={set("username")} placeholder="ahmed" /></div>
          <p className="field-hint">3 أحرف إنجليزية أو أرقام على الأقل، دون مسافات. مثال: ahmed أو reception1</p>
          <div className="field"><label>رقم الهاتف</label>
            <input className="mono" dir="ltr" style={{ textAlign: "left" }}
              value={form.phone} onChange={set("phone")} /></div>
          <div className="field"><label>كلمة المرور المبدئية</label>
            <input type="password" autoComplete="new-password" dir="ltr" style={{ textAlign: "left" }} value={form.password}
              onChange={set("password")} placeholder="8 أحرف على الأقل" /></div>
          <div className="field"><label>تأكيد كلمة المرور</label>
            <input type="password" autoComplete="new-password" dir="ltr" style={{ textAlign: "left" }} value={form.password_again}
              onChange={set("password_again")} placeholder="أعد إدخال كلمة المرور" /></div>
          <div className="field"><label>الدور</label>
            <select value={form.role} onChange={set("role")}>
              <option value="reception">استقبال — يحجز ويسكّن ويقبض</option>
              <option value="housekeeping">نظافة — النظافة فقط</option>
              <option value="manager">مدير — كل شيء والأسعار</option>
            </select></div>

          <div className="banner warn" style={{ margin: 0 }}>
            يسجّل الموظف الدخول باسم المستخدم وكلمة المرور فقط، دون بريد إلكتروني. سلّمه الاثنين بنفسك.
          </div>

          <button className="btn primary wide" disabled={busy} onClick={create}>
            {busy ? "جارٍ الإضافة…" : "إنشاء الحساب"}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>
        </div>
      )}
      <Dialog
        open={!!resetMember}
        title={`كلمة مرور جديدة لـ ${resetMember?.profiles?.full_name || "الموظف"}`}
        description="أدخل 8 أحرف على الأقل، ثم سلّم كلمة المرور للموظف بطريقة آمنة."
        onClose={() => { setResetMember(null); setResetValue(""); setResetAgain(""); }}
      >
        <div className="stack">
          <label className="field"><span>كلمة المرور الجديدة</span>
            <input type="password" autoComplete="new-password" dir="ltr" value={resetValue} onChange={(e) => setResetValue(e.target.value)} />
          </label>
          <label className="field"><span>تأكيد كلمة المرور الجديدةة</span>
            <input type="password" autoComplete="new-password" dir="ltr" value={resetAgain} onChange={(e) => setResetAgain(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary grow" disabled={busy || resetValue.length < 8 || resetAgain.length < 8} onClick={resetPassword}>{busy ? "جارٍ التنفيذ…" : "تغيير كلمة المرور"}</button>
            <button className="btn" onClick={() => { setResetMember(null); setResetAgain(""); }}>إلغاء</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
function Security({ property, showToast }) {
  const [pin, setPin] = useState("");
  const [again, setAgain] = useState("");
  const [busy, setBusy] = useState(false);
  const [isSet, setIsSet] = useState(null);
  const [confirmClear, setConfirmClear] = useState(false);

  useEffect(() => {
    supabase.rpc("has_action_pin", { p_property: property.id })
      .then(({ data }) => setIsSet(!!data));
  }, [property.id]);

  async function save() {
    if (pin.length < 4) return showToast("4 أرقام على الأقل", true);
    if (pin !== again) return showToast("كلمة المرور غير متطابقة", true);

    setBusy(true);
    const { error } = await supabase.rpc("set_action_pin", {
      p_property: property.id, p_pin: pin,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);

    setPin(""); setAgain(""); setIsSet(true);
    showToast("تم حفظ كلمة المرور");
  }

  async function clear() {
    const { error } = await supabase.rpc("clear_action_pin", { p_property: property.id });
    if (error) return showToast(error.message, true);
    setIsSet(false);
    setConfirmClear(false);
    showToast("تمت إزالة كلمة المرور");
  }

  return (
    <>
      <p className="section-note">
        كلمة مرور تُطلب قبل الإلغاء وعدم الحضور والمغادرة المبكرة وتغيير الأسعار.
      </p>

      <div className={`banner ${isSet ? "ok" : "warn"}`}>
        {isSet === null ? "جارٍ التحميل…"
          : isSet
          ? "كلمة المرور مفعّلة. هذه الإجراءات تتطلب تأكيداً."
          : "لا توجد كلمة مرور. أي مستخدم لديه صلاحية يمكنه الإلغاء دون تأكيد."}
      </div>

      <div className="card stack">
        <div className="field">
          <label>{isSet ? "كلمة مرور جديدة" : "كلمة المرور"}</label>
          <input type="password" inputMode="numeric" className="mono" dir="ltr"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
            value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
        <div className="field">
          <label>أعد إدخاله</label>
          <input type="password" inputMode="numeric" className="mono" dir="ltr"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
            value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>

        <button className="btn primary wide" disabled={busy} onClick={save}>
          {busy ? "جارٍ الحفظ…" : isSet ? "تغيير كلمة المرور" : "تفعيل كلمة المرور"}
        </button>

        {isSet && (
          <button className="btn wide danger" onClick={() => setConfirmClear(true)}>إزالة كلمة المرور</button>
        )}
      </div>

      <div className="banner warn" style={{ marginTop: 14 }}>
        كلمة المرور متخزّن مشفّر — مش أنا ولا أي حد يقدر يقراه، فلو نسيته
        هتعمل واحد جديد من هنا. وبعد 5 محاولات غلط بيتقفل ربع ساعة.
      </div>
      <Dialog open={confirmClear} danger title="إزالة كلمة مرور التأكيد؟" description="بعد الإزالة، لن تطلب إجراءات الإلغاء وعدم الحضور تأكيداً إضافياً." onClose={() => setConfirmClear(false)}>
        <div className="row">
          <button className="btn danger grow" onClick={clear}>نعم، أزل كلمة المرور</button>
          <button className="btn" onClick={() => setConfirmClear(false)}>رجوع</button>
        </div>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
const LOGO_BUCKET = "property-branding";
const LOGO_TYPES = { "image/png": "png", "image/jpeg": "jpg", "image/webp": "webp" };
const MAX_LOGO_SIZE = 5 * 1024 * 1024;

function storedLogoPath(url) {
  const marker = `/storage/v1/object/public/${LOGO_BUCKET}/`;
  if (!url?.includes(marker)) return null;
  return decodeURIComponent(url.split(marker)[1].split("?")[0]);
}

function PropertyInfo({ property, types, plans, reload, showToast, locale }) {
  const [form, setForm] = useState({
    name: property.name || "",
    name_en: property.name_en || "",
    logo_url: property.logo_url || "",
    primary_color: property.primary_color || "#0B3A46",
    whatsapp: property.settings?.whatsapp_number || "",
    address: property.settings?.address || "",
    policy: property.settings?.cancellation_policy || "",
    policy_en: property.settings?.cancellation_policy_en || "",
  });
  const [saving, setSaving] = useState(false);
  const [logoFile, setLogoFile] = useState(null);
  const [removeLogo, setRemoveLogo] = useState(false);
  const [logoPreview, setLogoPreview] = useState(property.logo_url || "/easyroom-logo.png");

  const labels = locale === "en" ? {
    logo: "Hotel logo",
    logoHint: "PNG, JPG or WebP — up to 5MB.",
    choose: "Choose image",
    remove: "Remove image",
    alt: "Hotel logo preview",
    invalidType: "Choose a PNG, JPG or WebP image.",
    tooLarge: "The image must be 5MB or smaller.",
    saving: "Uploading and saving…",
  } : {
    logo: "شعار الفندق",
    logoHint: "PNG أو JPG أو WebP — بحد أقصى 5 ميجا.",
    choose: "اختيار صورة",
    remove: "حذف الصورة",
    alt: "معاينة شعار الفندق",
    invalidType: "اختر صورة PNG أو JPG أو WebP.",
    tooLarge: "حجم الصورة يجب ألا يتجاوز 5 ميجا.",
    saving: "جارٍ الرفع والحفظ…",
  };

  useEffect(() => {
    if (!logoFile) {
      setLogoPreview(removeLogo ? "/easyroom-logo.png" : form.logo_url || "/easyroom-logo.png");
      return undefined;
    }
    const objectUrl = URL.createObjectURL(logoFile);
    setLogoPreview(objectUrl);
    return () => URL.revokeObjectURL(objectUrl);
  }, [form.logo_url, logoFile, removeLogo]);

  function chooseLogo(event) {
    const file = event.target.files?.[0];
    if (!file) return;
    if (!LOGO_TYPES[file.type]) {
      event.target.value = "";
      showToast(labels.invalidType, true);
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      event.target.value = "";
      showToast(labels.tooLarge, true);
      return;
    }
    setLogoFile(file);
    setRemoveLogo(false);
  }

  async function save() {
    setSaving(true);
    let uploadedPath = null;
    let nextLogoUrl = removeLogo ? null : form.logo_url || null;

    if (logoFile) {
      const extension = LOGO_TYPES[logoFile.type];
      uploadedPath = `${property.id}/logo-${Date.now()}.${extension}`;
      const { error: uploadError } = await supabase.storage.from(LOGO_BUCKET).upload(uploadedPath, logoFile, {
        cacheControl: "3600",
        contentType: logoFile.type,
        upsert: false,
      });
      if (uploadError) {
        setSaving(false);
        showToast(uploadError.message, true);
        return;
      }
      nextLogoUrl = supabase.storage.from(LOGO_BUCKET).getPublicUrl(uploadedPath).data.publicUrl;
    }

    const { error } = await supabase.from("properties").update({
      name: form.name,
      name_en: form.name_en || null,
      logo_url: nextLogoUrl,
      primary_color: form.primary_color,
      settings: {
        ...property.settings,
        whatsapp_number: form.whatsapp,
        address: form.address,
        cancellation_policy: form.policy,
        cancellation_policy_en: form.policy_en,
      },
    }).eq("id", property.id);
    setSaving(false);
    if (error) {
      if (uploadedPath) await supabase.storage.from(LOGO_BUCKET).remove([uploadedPath]);
      return showToast(error.message, true);
    }
    const previousPath = storedLogoPath(property.logo_url);
    if (previousPath && previousPath !== uploadedPath && (uploadedPath || removeLogo)) {
      await supabase.storage.from(LOGO_BUCKET).remove([previousPath]);
    }
    setForm((current) => ({ ...current, logo_url: nextLogoUrl || "" }));
    setLogoFile(null);
    setRemoveLogo(false);
    showToast("تم الحفظ");
    reload();
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
    <div className="card stack">
      <div className="field"><label>اسم الفندق</label>
        <input value={form.name} onChange={set("name")} /></div>
      <div className="field"><label>اسم الفندق بالإنجليزية</label>
        <input value={form.name_en} dir="ltr" onChange={set("name_en")} /></div>
      <div className="field">
        <label>{labels.logo}</label>
        <div className="logo-upload-card">
          <div className="logo-preview"><img src={logoPreview} alt={labels.alt} />{/* eslint-disable-line @next/next/no-img-element */}</div>
          <div className="logo-upload-copy">
            <strong>{labels.logo}</strong>
            <span>{logoFile?.name || labels.logoHint}</span>
            <div className="row">
              <label className="btn sm logo-file-button" htmlFor="property-logo-input"><Upload size={16} />{labels.choose}</label>
              <input id="property-logo-input" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={chooseLogo} />
              <button className="btn sm danger" type="button" onClick={() => { setLogoFile(null); setRemoveLogo(true); }} disabled={!property.logo_url && !logoFile}>
                <Trash2 size={16} />{labels.remove}
              </button>
            </div>
          </div>
          <ImagePlus className="logo-upload-icon" size={20} aria-hidden="true" />
        </div>
      </div>
      <div className="field"><label>لون الفندق</label>
        <input type="color" value={form.primary_color} onChange={set("primary_color")}
          style={{ height: 44, padding: 4 }} /></div>
      <div className="field"><label>رقم الواتساب</label>
        <input className="mono" dir="ltr" style={{ textAlign: "left" }}
          value={form.whatsapp} placeholder="+2010…" onChange={set("whatsapp")} /></div>
      <div className="field"><label>العنوان</label>
        <input value={form.address} onChange={set("address")} /></div>
      <div className="field"><label>سياسة الإلغاء</label>
        <input value={form.policy} onChange={set("policy")} /></div>
      {/* Sent as-is to foreign guests in the confirmation message, so it is
          written once here instead of being translated in a hurry. */}
      <div className="field"><label>سياسة الإلغاء بالإنجليزي</label>
        <input dir="ltr" style={{ textAlign: "left" }}
          value={form.policy_en} onChange={set("policy_en")} /></div>
      <button className="btn primary wide" disabled={saving} onClick={save}>
        {saving ? labels.saving : "حفظ"}
      </button>
    </div>
    <ManagedTranslations types={types} plans={plans} reload={reload} showToast={showToast} />
    </>
  );
}

function ManagedTranslations({ types, plans, reload, showToast }) {
  const [draft, setDraft] = useState(() => ({
    types: Object.fromEntries(types.map((item) => [item.id, { name_en: item.name_en || "", description_en: item.description_en || "" }])),
    plans: Object.fromEntries(plans.map((item) => [item.id, { name_en: item.name_en || "", description_en: item.description_en || "" }])),
  }));
  const [saving, setSaving] = useState(false);

  function change(group, id, field, value) {
    setDraft((current) => ({ ...current, [group]: { ...current[group], [id]: { ...current[group][id], [field]: value } } }));
  }

  async function save() {
    setSaving(true);
    const updates = [
      ...types.map((item) => supabase.from("room_types").update({ name_en: draft.types[item.id].name_en || null, description_en: draft.types[item.id].description_en || null }).eq("id", item.id)),
      ...plans.map((item) => supabase.from("rate_plans").update({ name_en: draft.plans[item.id].name_en || null, description_en: draft.plans[item.id].description_en || null }).eq("id", item.id)),
    ];
    const results = await Promise.all(updates);
    setSaving(false);
    const failed = results.find((result) => result.error);
    if (failed) return showToast(failed.error.message, true);
    showToast("تم حفظ الترجمات الإنجليزية"); reload();
  }

  return (
    <section className="section" style={{ marginTop: 18 }}>
      <h2>المحتوى الإنجليزي</h2>
      <p className="section-note">الخانة الفارغة تعرض الاسم أو الوصف العربي تلقائياً.</p>
      <div className="stack">
        {[{ key: "types", label: "أنواع الغرف", rows: types }, { key: "plans", label: "جهات الحجز", rows: plans }].map((group) => (
          <div className="card stack" key={group.key}>
            <strong>{group.label}</strong>
            {group.rows.map((item) => (
              <div className="card stack" key={item.id} style={{ background: "var(--surface-2)" }}>
                <span>{item.name}</span>
                <label className="field"><span>الاسم بالإنجليزية</span><input dir="ltr" value={draft[group.key][item.id].name_en} onChange={(e) => change(group.key, item.id, "name_en", e.target.value)} /></label>
                <label className="field"><span>الوصف بالإنجليزية</span><input dir="ltr" value={draft[group.key][item.id].description_en} onChange={(e) => change(group.key, item.id, "description_en", e.target.value)} /></label>
              </div>
            ))}
          </div>
        ))}
      </div>
      <button className="btn primary wide" style={{ marginTop: 12 }} disabled={saving} onClick={save}>{saving ? "جارٍ الحفظ…" : "حفظ المحتوى الإنجليزي"}</button>
    </section>
  );
}
