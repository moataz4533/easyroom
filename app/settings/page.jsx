"use client";
import { Suspense, useEffect, useState, useCallback } from "react";
import { useSearchParams } from "next/navigation";
import Shell, { useProperty, Toast, useToast } from "../../components/Shell";
import PinPrompt from "../../components/PinPrompt";
import BackupCard from "../../components/BackupCard";
import { supabase, egp, dayLabel } from "../../lib/supabase";
import { Dialog } from "../../components/ui";
import { localizedName } from "../../lib/locale";
import { useTranslations } from "next-intl";
import { useLocale } from "../../lib/locale";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { isStaffUsername, normalizeStaffUsername, staffProfileProblem } from "../../lib/auth-login";

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
// Hotels name occupancies rather than counting them: a double is a double.
const NAMED_OCCUPANCIES = [1, 2, 3, 4, 5, 6];

const TAB_IDS = [
  "rates", "seasons", "rooms", "charges", "staff", "security", "backup", "property",
];

function Settings() {
  const { property } = useProperty();
  const locale = useLocale();
  const t = useTranslations("Settings");
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

  if (loading) return <div className="empty">{t("loading")}</div>;

  const shared = { property, types, plans, rates, rooms, staff, chargeItems, reload: load, showToast, locale };

  return (
    <>
      <Toast {...(toast || {})} />
      <h2 style={{ marginBottom: 10 }}>{t("title")}</h2>

      <div className="tabs" role="tablist">
        {TAB_IDS.map((key) => (
          <button key={key} className="tab" role="tab" aria-selected={tab === key} onClick={() => setTab(key)}>
            {t(`tab_${key}`)}
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
  const t = useTranslations("Settings");
  const type = types.find((x) => x.id === active);
  const occupancyLabel = (o) =>
    NAMED_OCCUPANCIES.includes(o) ? t(`occ_${o}`) : t("occFallback", { count: o });
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
                <th>{t("occHeader")}</th>
                {plans.map((p) => <th key={p.id}>{localizedName(p, locale)}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: type.max_occupancy }, (_, i) => i + 1).map((o) => (
                <tr key={o}>
                  <td className="occ">{occupancyLabel(o)}<small>{o} pax</small></td>
                  {plans.map((p) => (
                    <td key={p.id}>
                      <input
                        type="number" min="0" placeholder="—"
                        aria-label={`${occupancyLabel(o)} · ${localizedName(p, locale)}`}
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
  const t = useTranslations("Settings");
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
    showToast(t("ratesSaved", { count: rows.length }));
    reload();
  }

  if (!types.length) return <div className="empty">{t("needTypeFirst")}</div>;

  return (
    <>
      <p className="section-note">{t("rateHint")}</p>

      <RateMatrix types={types} plans={plans} locale={locale}
        active={active} setActive={setActive} draft={draft} setDraft={setDraft} />

      {dirty && !asking && (
        <button className="btn primary wide" style={{ marginTop: 14 }}
          onClick={() => setAsking(true)}>
          {t("saveRates")}
        </button>
      )}

      {asking && (
        <div style={{ marginTop: 14 }}>
          <PinPrompt
            title={t("ratesPinTitle")}
            note={t("ratesPinNote")}
            confirmLabel={t("saveRates")}
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
  // `t` is a room type in this component's loops, so the catalogue is `ts`.
  const ts = useTranslations("Settings");
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
    if (!typeName.trim() || !typeCode.trim()) return showToast(ts("needNameAndCode"), true);
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
    showToast(ts("typeAdded")); reload();
  }

  /**
   * Renaming rather than replacing. A hotel does not have "a standard room
   * and also a sea-view room" — it has rooms it wants to call what they
   * actually are. Adding a second type and moving every room across one by
   * one is the same intent expressed as seven actions instead of one.
   */
  async function renameType(id) {
    const name = String(draftType.name || "").trim();
    if (!name) return showToast(ts("needName"), true);
    const { error } = await supabase.from("room_types").update({
      name,
      name_en: String(draftType.name_en || "").trim() || null,
      max_occupancy: Math.max(1, Math.min(6, Number(draftType.max_occupancy) || 2)),
    }).eq("id", id);
    if (error) return showToast(error.message, true);
    setEditing(null);
    showToast(ts("typeRenamed"));
    reload();
  }

  async function addRoom() {
    const tId = newType || types[0]?.id;
    if (!newRoom.trim() || !tId) return showToast(ts("needRoomNumber"), true);
    const { error } = await supabase.from("rooms").insert({
      property_id: property.id, room_type_id: tId, number: newRoom.trim(),
    });
    if (error) return showToast(error.message, true);
    setNewRoom(""); showToast(ts("roomAdded")); reload();
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
        <h2 style={{ fontSize: 14 }}>{ts("roomTypes")}</h2>
        <p className="section-note">{ts("roomTypesNote")}</p>
        <div className="stack">
          {types.map((t, i) => (
            <div key={t.id} className="card">
              {editing === t.id ? (
                <div className="stack">
                  <div className="row">
                    <div className="field grow"><label>{ts("name")}</label>
                      <input autoFocus value={draftType.name || ""} placeholder={ts("typeNamePlaceholder")}
                        onChange={(e) => setDraftType({ ...draftType, name: e.target.value })} /></div>
                    <div className="field grow"><label>{ts("nameEn")}</label>
                      <input value={draftType.name_en || ""} dir="ltr" placeholder="Sea View Room"
                        onChange={(e) => setDraftType({ ...draftType, name_en: e.target.value })} /></div>
                    <div className="field" style={{ width: 90 }}><label>{ts("maxOccupancy")}</label>
                      <input className="mono" type="number" min="1" max="6"
                        value={draftType.max_occupancy || 2}
                        onChange={(e) => setDraftType({ ...draftType, max_occupancy: e.target.value })} /></div>
                  </div>
                  <div className="row">
                    <button className="btn primary" onClick={() => renameType(t.id)}>{ts("save")}</button>
                    <button className="btn" onClick={() => setEditing(null)}>{ts("cancel")}</button>
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
                      {ts("typeSummary", {
                        rooms: rooms.filter((r) => r.room_type_id === t.id).length,
                        max: t.max_occupancy,
                      })}
                    </div>
                  </div>
                  <button className="btn sm" onClick={() => {
                    setEditing(t.id);
                    setDraftType({ name: t.name, name_en: t.name_en || "", max_occupancy: t.max_occupancy });
                  }}>{ts("renameType")}</button>
                </div>
              )}
            </div>
          ))}
        </div>

        <div className="card stack" style={{ marginTop: 10, background: "var(--paper)" }}>
          <div className="row">
            <div className="field grow"><label>{ts("name")}</label>
              <input value={typeName} placeholder={ts("typeNamePlaceholder")}
                onChange={(e) => setTypeName(e.target.value)} /></div>
            <div className="field grow"><label>{ts("nameEn")}</label>
              <input value={typeNameEn} placeholder="Sea View Room" dir="ltr"
                onChange={(e) => setTypeNameEn(e.target.value)} /></div>
            <div className="field grow"><label>{ts("description")}</label>
              <input value={typeDescription} onChange={(e) => setTypeDescription(e.target.value)} /></div>
            <div className="field grow"><label>{ts("descriptionEn")}</label>
              <input value={typeDescriptionEn} dir="ltr" onChange={(e) => setTypeDescriptionEn(e.target.value)} /></div>
            <div className="field" style={{ width: 100 }}><label>{ts("code")}</label>
              <input className="mono" value={typeCode} placeholder="SEA"
                onChange={(e) => setTypeCode(e.target.value)} /></div>
            <div className="field" style={{ width: 90 }}><label>{ts("maxOccupancy")}</label>
              <input className="mono" type="number" min="1" max="6" value={typeMax}
                onChange={(e) => setTypeMax(e.target.value)} /></div>
          </div>
          <button className="btn" onClick={addType}>{ts("addType")}</button>
        </div>
      </section>

      <section className="section">
        <h2 style={{ fontSize: 14 }}>{ts("rooms")}</h2>
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
          <div className="field grow"><label>{ts("newRoomNumber")}</label>
            <input className="mono" value={newRoom} placeholder="107"
              onChange={(e) => setNewRoom(e.target.value)} /></div>
          <div className="field grow"><label>{ts("roomType")}</label>
            <select value={newType || types[0]?.id || ""} onChange={(e) => setNewType(e.target.value)}>
              {types.map((t) => <option key={t.id} value={t.id}>{localizedName(t, locale)}</option>)}
            </select></div>
          <button className="btn" style={{ alignSelf: "flex-end" }} onClick={addRoom}>{ts("addRoom")}</button>
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
  const tset = useTranslations("Settings");
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
    const { data, error } = await supabase.from("rates").select("*")
      .eq("property_id", property.id).eq("valid_from", season.starts_on);

    // An empty grid and a grid we failed to load look identical, and one of
    // them invites the manager to type prices over prices that are already
    // there. So a failure does not open the season at all.
    if (error) {
      setSelected(null);
      return showToast(error.message, true);
    }

    setSelected(season);
    const map = Object.fromEntries((data || []).map((row) =>
      [rateKey(row.room_type_id, row.rate_plan_id, row.occupancy), row.amount]));
    setStored(map);
    setDraft(map);
  }, [property.id]); // eslint-disable-line react-hooks/exhaustive-deps

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

  if (!types.length) return <div className="empty">{tset("needTypeFirst")}</div>;

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
              <input value={form.name} placeholder={tset("seasonNamePlaceholder")}
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
  const tset = useTranslations("Settings");
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
            <input value={form.name} placeholder={tset("chargeNamePlaceholder")}
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
  const t = useTranslations("Settings");
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState(false);
  const [resetMember, setResetMember] = useState(null);
  const [resetValue, setResetValue] = useState("");
  const [resetAgain, setResetAgain] = useState("");
  // Which member's card is open for editing, and what is being typed into it.
  const [editing, setEditing] = useState(null);
  const [edit, setEdit] = useState({ full_name: "", phone: "" });
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
      return showToast(t("needStaffFields"), true);
    }
    if (form.password.length < 8) return showToast(t("passwordTooShort"), true);
    if (form.password !== form.password_again) return showToast(t("passwordsDiffer"), true);

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
    showToast(t("staffAdded", { name: form.full_name }));
    setForm({ full_name: "", username: "", phone: "", password: "", password_again: "", role: "reception" });
    setOpen(false);
    reload();
  }

  async function changeRole(m, role) {
    const out = await call({ action: "set_role", member_id: m.id, role });
    if (out.error) return showToast(out.error, true);
    showToast(t("roleChanged"));
    reload();
  }

  async function toggle(m) {
    const out = await call({ action: "set_active", member_id: m.id });
    if (out.error) return showToast(out.error, true);
    showToast(out.is_active ? t("activated") : t("deactivated"));
    reload();
  }

  function startEdit(m) {
    setEditing(m.id);
    setEdit({ full_name: m.profiles?.full_name || "", phone: m.profiles?.phone || "" });
  }

  async function saveProfile(m) {
    const problem = staffProfileProblem(edit);
    if (problem) return showToast(t(problem), true);

    setBusy(true);
    const out = await call({
      action: "update_profile",
      member_id: m.id,
      full_name: edit.full_name,
      phone: edit.phone,
    });
    setBusy(false);
    if (out.error) return showToast(out.error, true);
    setEditing(null);
    showToast(t("staffUpdated"));
    reload();
  }

  async function resetPassword() {
    if (resetValue.length < 8) return showToast(t("passwordTooShort"), true);
    if (resetValue !== resetAgain) return showToast(t("passwordsDiffer"), true);
    setBusy(true);
    const out = await call({ action: "reset_password", member_id: resetMember.id, password: resetValue });
    setBusy(false);
    if (out.error) return showToast(out.error, true);
    showToast(t("passwordChanged"));
    setResetMember(null); setResetValue(""); setResetAgain("");
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <p className="section-note">
        {t("staffNote")}
      </p>

      <div className="stack">
        {staff.map((m) => (
          <div key={m.id} className="card" style={{ opacity: m.is_active ? 1 : 0.55 }}>
            <div className="spread">
              <div className="grow">
                <div style={{ fontWeight: 600 }}>
                  {m.profiles?.full_name || "—"}
                  {!m.is_active && <span className="pill bad" style={{ marginInlineStart: 6 }}>{t("suspended")}</span>}
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
                {["owner", "manager", "reception", "housekeeping"].map((key) => (
                  <option key={key} value={key}>{t(`role_${key}`)}</option>
                ))}
              </select>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => startEdit(m)}>{t("editStaff")}</button>
              <button className="btn sm" onClick={() => { setResetMember(m); setResetValue(""); setResetAgain(""); }}>{t("changePassword")}</button>
              <button className="btn sm danger" onClick={() => toggle(m)}>
                {m.is_active ? t("deactivate") : t("activate")}
              </button>
            </div>

            {editing === m.id && (
              <div className="stack" style={{ marginTop: 10, paddingTop: 10, borderTop: "1px solid var(--line)" }}>
                <div className="field"><label htmlFor={`name-${m.id}`}>{t("name")}</label>
                  <input id={`name-${m.id}`} value={edit.full_name}
                    onChange={(e) => setEdit((c) => ({ ...c, full_name: e.target.value }))} /></div>
                <div className="field"><label htmlFor={`tel-${m.id}`}>{t("phone")}</label>
                  <input id={`tel-${m.id}`} className="mono" dir="ltr" style={{ textAlign: "left" }}
                    value={edit.phone}
                    onChange={(e) => setEdit((c) => ({ ...c, phone: e.target.value }))} /></div>
                {/* Said, not offered as a box that quietly locks somebody
                    out: the username is half the address they sign in with. */}
                <p className="field-hint">
                  {m.login_username
                    ? t("usernameFixed", { username: m.login_username })
                    : t("usernameFixedOwner")}
                </p>
                <button className="btn primary wide" disabled={busy} onClick={() => saveProfile(m)}>
                  {busy ? t("saving") : t("save")}
                </button>
                <button className="btn wide" onClick={() => setEditing(null)}>{t("cancel")}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {!open ? (
        <button className="btn ghost wide" style={{ marginTop: 12 }} onClick={() => setOpen(true)}>
          {t("addStaff")}
        </button>
      ) : (
        <div className="card stack" style={{ marginTop: 12, background: "var(--paper)" }}>
          <h2 style={{ fontSize: 14 }}>{t("newStaff")}</h2>
          <div className="field"><label>{t("name")}</label>
            <input value={form.full_name} onChange={set("full_name")} placeholder={t("staffNamePlaceholder")} /></div>
          <div className="field"><label>{t("username")}</label>
            <input dir="ltr" className="mono" style={{ textAlign: "left" }} autoComplete="off"
              value={form.username} onChange={set("username")} placeholder="ahmed" /></div>
          <p className="field-hint">{t("usernameHint")}</p>
          <div className="field"><label>{t("phone")}</label>
            <input className="mono" dir="ltr" style={{ textAlign: "left" }}
              value={form.phone} onChange={set("phone")} /></div>
          <div className="field"><label>{t("firstPassword")}</label>
            <input type="password" autoComplete="new-password" dir="ltr" style={{ textAlign: "left" }} value={form.password}
              onChange={set("password")} placeholder={t("passwordPlaceholder")} /></div>
          <div className="field"><label>{t("confirmPassword")}</label>
            <input type="password" autoComplete="new-password" dir="ltr" style={{ textAlign: "left" }} value={form.password_again}
              onChange={set("password_again")} placeholder={t("confirmPasswordPlaceholder")} /></div>
          <div className="field"><label>{t("role")}</label>
            <select value={form.role} onChange={set("role")}>
              {["reception", "housekeeping", "manager"].map((key) => (
                <option key={key} value={key}>{t(`roleOption_${key}`)}</option>
              ))}
            </select></div>

          <div className="banner warn" style={{ margin: 0 }}>
            {t("staffLoginNote")}
          </div>

          <button className="btn primary wide" disabled={busy} onClick={create}>
            {busy ? t("creating") : t("createAccount")}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>{t("cancel")}</button>
        </div>
      )}
      <Dialog
        open={!!resetMember}
        title={t("resetTitle", { name: resetMember?.profiles?.full_name || t("theStaffMember") })}
        description={t("resetDescription")}
        onClose={() => { setResetMember(null); setResetValue(""); setResetAgain(""); }}
      >
        <div className="stack">
          <label className="field"><span>{t("newPassword")}</span>
            <input type="password" autoComplete="new-password" dir="ltr" value={resetValue} onChange={(e) => setResetValue(e.target.value)} />
          </label>
          <label className="field"><span>{t("confirmNewPassword")}</span>
            <input type="password" autoComplete="new-password" dir="ltr" value={resetAgain} onChange={(e) => setResetAgain(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary grow" disabled={busy || resetValue.length < 8 || resetAgain.length < 8} onClick={resetPassword}>{busy ? t("applying") : t("changePassword")}</button>
            <button className="btn" onClick={() => { setResetMember(null); setResetAgain(""); }}>{t("cancel")}</button>
          </div>
        </div>
      </Dialog>
    </>
  );
}

/* ------------------------------------------------------------------ */
function Security({ property, showToast }) {
  const t = useTranslations("Settings");
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
    if (pin.length < 4) return showToast(t("pinTooShort"), true);
    if (pin !== again) return showToast(t("pinsDiffer"), true);

    setBusy(true);
    const { error } = await supabase.rpc("set_action_pin", {
      p_property: property.id, p_pin: pin,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);

    setPin(""); setAgain(""); setIsSet(true);
    showToast(t("pinSaved"));
  }

  async function clear() {
    const { error } = await supabase.rpc("clear_action_pin", { p_property: property.id });
    if (error) return showToast(error.message, true);
    setIsSet(false);
    setConfirmClear(false);
    showToast(t("pinCleared"));
  }

  return (
    <>
      <p className="section-note">
        {t("pinNote")}
      </p>

      <div className={`banner ${isSet ? "ok" : "warn"}`}>
        {isSet === null ? t("loading")
          : isSet
          ? t("pinOn")
          : t("pinOff")}
      </div>

      <div className="card stack">
        <div className="field">
          <label>{isSet ? t("pinNew") : t("pinLabel")}</label>
          <input type="password" inputMode="numeric" className="mono" dir="ltr"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
            value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
        <div className="field">
          <label>{t("pinAgain")}</label>
          <input type="password" inputMode="numeric" className="mono" dir="ltr"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
            value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>

        <button className="btn primary wide" disabled={busy} onClick={save}>
          {busy ? t("saving") : isSet ? t("pinChange") : t("pinEnable")}
        </button>

        {isSet && (
          <button className="btn wide danger" onClick={() => setConfirmClear(true)}>{t("pinRemove")}</button>
        )}
      </div>

      <div className="banner warn" style={{ marginTop: 14 }}>
        {t("pinForgotten")}
      </div>
      <Dialog open={confirmClear} danger title={t("pinClearTitle")} description={t("pinClearBody")} onClose={() => setConfirmClear(false)}>
        <div className="row">
          <button className="btn danger grow" onClick={clear}>{t("pinClearConfirm")}</button>
          <button className="btn" onClick={() => setConfirmClear(false)}>{t("back")}</button>
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
  const t = useTranslations("Settings");
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
      showToast(t("invalidType"), true);
      return;
    }
    if (file.size > MAX_LOGO_SIZE) {
      event.target.value = "";
      showToast(t("tooLarge"), true);
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
    showToast(t("saved"));
    reload();
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
    <div className="card stack">
      <div className="field"><label>{t("hotelName")}</label>
        <input value={form.name} onChange={set("name")} /></div>
      <div className="field"><label>{t("hotelNameEn")}</label>
        <input value={form.name_en} dir="ltr" onChange={set("name_en")} /></div>
      <div className="field">
        <label>{t("logo")}</label>
        <div className="logo-upload-card">
          <div className="logo-preview"><img src={logoPreview} alt={t("logoAlt")} />{/* eslint-disable-line @next/next/no-img-element */}</div>
          <div className="logo-upload-copy">
            <strong>{t("logo")}</strong>
            <span>{logoFile?.name || t("logoHint")}</span>
            <div className="row">
              <label className="btn sm logo-file-button" htmlFor="property-logo-input"><Upload size={16} />{t("chooseImage")}</label>
              <input id="property-logo-input" className="sr-only" type="file" accept="image/png,image/jpeg,image/webp,.png,.jpg,.jpeg,.webp" onChange={chooseLogo} />
              <button className="btn sm danger" type="button" onClick={() => { setLogoFile(null); setRemoveLogo(true); }} disabled={!property.logo_url && !logoFile}>
                <Trash2 size={16} />{t("removeImage")}
              </button>
            </div>
          </div>
          <ImagePlus className="logo-upload-icon" size={20} aria-hidden="true" />
        </div>
      </div>
      <div className="field"><label>{t("colour")}</label>
        <input type="color" value={form.primary_color} onChange={set("primary_color")}
          style={{ height: 44, padding: 4 }} /></div>
      <div className="field"><label>{t("whatsapp")}</label>
        <input className="mono" dir="ltr" style={{ textAlign: "left" }}
          value={form.whatsapp} placeholder="+2010…" onChange={set("whatsapp")} /></div>
      <div className="field"><label>{t("address")}</label>
        <input value={form.address} onChange={set("address")} /></div>
      <div className="field"><label>{t("policy")}</label>
        <input value={form.policy} onChange={set("policy")} /></div>
      {/* Sent as-is to foreign guests in the confirmation message, so it is
          written once here instead of being translated in a hurry. */}
      <div className="field"><label>{t("policyEn")}</label>
        <input dir="ltr" style={{ textAlign: "left" }}
          value={form.policy_en} onChange={set("policy_en")} /></div>
      <button className="btn primary wide" disabled={saving} onClick={save}>
        {saving ? t("uploading") : t("save")}
      </button>
    </div>
    <ManagedTranslations types={types} plans={plans} reload={reload} showToast={showToast} />
    </>
  );
}

/**
 * The hotel's own words, in English.
 *
 * The app's own text is translated; this is the part only the hotel can
 * write — what a room type is called, what a rate plan is called. It shows
 * up in the confirmation message a foreign guest reads, on their bill, and
 * on every screen when the app is in English, so an empty box here is a
 * guest reading Arabic they cannot read. The section says how many boxes
 * are still empty rather than leaving that to be discovered.
 *
 * The draft follows the rows: a type added on the Rooms tab appears here
 * without a reload, which the previous version could not do.
 */
function ManagedTranslations({ types, plans, reload, showToast }) {
  const t = useTranslations("Settings");
  const [edits, setEdits] = useState({});
  const [saving, setSaving] = useState(false);

  const groups = [
    { key: "types", table: "room_types", rows: types },
    { key: "plans", table: "rate_plans", rows: plans },
  ];

  const valueOf = (item, field) => edits[`${item.id}.${field}`] ?? item[field] ?? "";
  const change = (item, field, value) =>
    setEdits((current) => ({ ...current, [`${item.id}.${field}`]: value }));

  const blanks = groups.flatMap((group) => group.rows).filter((item) =>
    !String(valueOf(item, "name_en")).trim()).length;

  async function save() {
    setSaving(true);
    const results = await Promise.all(groups.flatMap((group) =>
      group.rows.map((item) => supabase.from(group.table).update({
        name_en: String(valueOf(item, "name_en")).trim() || null,
        description_en: String(valueOf(item, "description_en")).trim() || null,
      }).eq("id", item.id))
    ));
    setSaving(false);

    const failed = results.find((result) => result.error);
    if (failed) return showToast(failed.error.message, true);
    setEdits({});
    showToast(t("englishSaved"));
    reload();
  }

  return (
    <section className="section" style={{ marginTop: 18 }}>
      <h2>{t("englishContent")}</h2>
      <p className="section-note">{t("englishContentNote")}</p>

      <div className={`banner ${blanks > 0 ? "warn" : "ok"}`}>
        {blanks > 0 ? t("englishMissing", { count: blanks }) : t("englishComplete")}
      </div>

      <div className="stack">
        {groups.map((group) => (
          <div className="card stack" key={group.key}>
            <strong>{t(`englishGroup_${group.key}`)}</strong>
            {group.rows.map((item) => (
              <div className="card stack" key={item.id} style={{ background: "var(--surface-2)" }}>
                <span>{item.name}</span>
                <label className="field">
                  <span>{t("nameEn")}</span>
                  <input dir="ltr" value={valueOf(item, "name_en")}
                    onChange={(event) => change(item, "name_en", event.target.value)} />
                </label>
                <label className="field">
                  <span>{t("descriptionEn")}</span>
                  <input dir="ltr" value={valueOf(item, "description_en")}
                    onChange={(event) => change(item, "description_en", event.target.value)} />
                </label>
              </div>
            ))}
          </div>
        ))}
      </div>

      <button className="btn primary wide" style={{ marginTop: 12 }} disabled={saving} onClick={save}>
        {saving ? t("saving") : t("saveEnglish")}
      </button>
    </section>
  );
}
