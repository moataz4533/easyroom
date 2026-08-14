"use client";
import { useEffect, useState, useCallback } from "react";
import Shell, { useProperty, Toast, useToast, roleLabel } from "../../components/Shell";
import PinPrompt from "../../components/PinPrompt";
import { supabase, egp } from "../../lib/supabase";
import { Dialog } from "../../components/ui";
import { localizedName } from "../../lib/locale";
import { useLocale } from "next-intl";
import { ImagePlus, Trash2, Upload } from "lucide-react";
import { isStaffUsername, normalizeStaffUsername } from "../../lib/auth-login";

export default function Page() {
  return (
    <Shell>
      <Settings />
    </Shell>
  );
}

const BANDS = ["#1E5F74", "#D99A2B", "#C96F5A", "#6E9075", "#6C6B9E"];
const OCC = { 1: "سنجل", 2: "دابل", 3: "تريبل", 4: "رباعي", 5: "خماسي", 6: "سداسي" };
const TABS = [
  ["rates", "الأسعار"],
  ["rooms", "الغرف"],
  ["staff", "الموظفين"],
  ["security", "الباسورد"],
  ["property", "بيانات النادي"],
];

function Settings() {
  const { property } = useProperty();
  const locale = useLocale();
  const [tab, setTab] = useState("rates");
  const [toast, showToast] = useToast();

  const [types, setTypes] = useState([]);
  const [plans, setPlans] = useState([]);
  const [rates, setRates] = useState({});
  const [rooms, setRooms] = useState([]);
  const [staff, setStaff] = useState([]);
  const [loading, setLoading] = useState(true);

  const load = useCallback(async () => {
    if (!property) return;
    setLoading(true);
    const [t, p, r, rm, st] = await Promise.all([
      supabase.from("room_types").select("*").eq("property_id", property.id).order("sort_order"),
      supabase.from("rate_plans").select("*").eq("property_id", property.id).order("sort_order"),
      supabase.from("rates").select("*").eq("property_id", property.id).is("valid_from", null),
      supabase.from("rooms").select("*, room_types(name, name_en)").eq("property_id", property.id),
      supabase.from("property_members").select("*, profiles(full_name, phone)")
        .eq("property_id", property.id),
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
    setLoading(false);
  }, [property]);

  useEffect(() => { load(); }, [load]);

  if (loading) return <div className="empty">بيحمّل…</div>;

  const shared = { property, types, plans, rates, rooms, staff, reload: load, showToast, locale };

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
      {tab === "rooms" && <Rooms {...shared} />}
      {tab === "staff" && <Staff {...shared} />}
      {tab === "security" && <Security {...shared} />}
      {tab === "property" && <PropertyInfo {...shared} />}
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

  const t = types.find((x) => x.id === active);
  const key = (ty, pl, o) => `${ty}|${pl}|${o}`;
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
    showToast(`${rows.length} سعر اتحفظ`);
    reload();
  }

  if (!types.length) return <div className="empty">اعمل نوع غرفة الأول من تبويب الغرف.</div>;

  return (
    <>
      <p className="section-note">
        سعر الليلة للغرفة كاملة. الخانة الفاضية معناها إن التركيبة دي مش للبيع.
      </p>

      <div className="tabs" role="tablist">
        {types.map((x, i) => (
          <button key={x.id} className="tab" role="tab" aria-selected={active === x.id}
            onClick={() => setActive(x.id)}>
            <span className="dot" style={{ background: BANDS[i % BANDS.length] }} />
            {localizedName(x, locale)}
          </button>
        ))}
      </div>

      {t && (
        <div className="matrix-wrap">
          <table className="matrix">
            <thead>
              <tr>
                <th>عدد الأفراد</th>
                {plans.map((p) => <th key={p.id}>{localizedName(p, locale)}</th>)}
              </tr>
            </thead>
            <tbody>
              {Array.from({ length: t.max_occupancy }, (_, i) => i + 1).map((o) => (
                <tr key={o}>
                  <td className="occ">{OCC[o] || `${o} أفراد`}<small>{o} pax</small></td>
                  {plans.map((p) => (
                    <td key={p.id}>
                      <input
                        type="number" min="0" placeholder="—"
                        aria-label={`${OCC[o]} · ${localizedName(p, locale)}`}
                        value={draft[key(t.id, p.id, o)] ?? ""}
                        onChange={(e) => setDraft((d) => ({
                          ...d, [key(t.id, p.id, o)]: e.target.value === "" ? "" : Number(e.target.value),
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
            note="تغيير السعر بيأثر على كل حجز جديد، عشان كده محتاج باسورد المدير."
            confirmLabel="احفظ الأسعار"
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

  async function addType() {
    if (!typeName.trim() || !typeCode.trim()) return showToast("محتاج اسم وكود", true);
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
    showToast("النوع اتضاف"); reload();
  }

  async function addRoom() {
    const tId = newType || types[0]?.id;
    if (!newRoom.trim() || !tId) return showToast("اكتب رقم الغرفة", true);
    const { error } = await supabase.from("rooms").insert({
      property_id: property.id, room_type_id: tId, number: newRoom.trim(),
    });
    if (error) return showToast(error.message, true);
    setNewRoom(""); showToast("الغرفة اتضافت"); reload();
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
        <p className="section-note">«أقصى عدد» بيحدد صفوف مصفوفة الأسعار.</p>
        <div className="stack">
          {types.map((t, i) => (
            <div key={t.id} className="card spread">
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
      return showToast("محتاج الاسم واسم مستخدم إنجليزي بسيط من 3 حروف على الأقل", true);
    }
    if (form.password.length < 8) return showToast("الباسورد لازم 8 حروف على الأقل", true);
    if (form.password !== form.password_again) return showToast("الباسوردين مش متطابقين", true);

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
    showToast(`${form.full_name} اتضاف. اديله اسم المستخدم والباسورد.`);
    setForm({ full_name: "", username: "", phone: "", password: "", password_again: "", role: "reception" });
    setOpen(false);
    reload();
  }

  async function changeRole(m, role) {
    const out = await call({ action: "set_role", member_id: m.id, role });
    if (out.error) return showToast(out.error, true);
    showToast("الصلاحية اتغيرت");
    reload();
  }

  async function toggle(m) {
    const out = await call({ action: "set_active", member_id: m.id });
    if (out.error) return showToast(out.error, true);
    showToast(out.is_active ? "الحساب اتفعّل" : "الحساب اتوقف");
    reload();
  }

  async function resetPassword() {
    if (resetValue.length < 8) return showToast("الباسورد لازم 8 حروف على الأقل", true);
    if (resetValue !== resetAgain) return showToast("الباسوردين مش متطابقين", true);
    setBusy(true);
    const out = await call({ action: "reset_password", member_id: resetMember.id, password: resetValue });
    setBusy(false);
    if (out.error) return showToast(out.error, true);
    showToast("الباسورد اتغير. اديله الجديد.");
    setResetMember(null); setResetValue(""); setResetAgain("");
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
      <p className="section-note">
        كل موظف بيشوف اللي يخصه بس. الهاوس كيبينج مش بيشوف فلوس ولا بيانات نزلاء.
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
                <option value="reception">ريسبشن</option>
                <option value="housekeeping">هاوس كيبينج</option>
              </select>
            </div>
            <div className="row" style={{ marginTop: 10 }}>
              <button className="btn sm" onClick={() => { setResetMember(m); setResetValue(""); setResetAgain(""); }}>غيّر الباسورد</button>
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
          <div className="field"><label>اسم المستخدم (ده اللي هيدخل بيه)</label>
            <input dir="ltr" className="mono" style={{ textAlign: "left" }} autoComplete="off"
              value={form.username} onChange={set("username")} placeholder="ahmed" /></div>
          <p className="field-hint">3 حروف إنجليزية أو أرقام على الأقل، من غير مسافات. مثال: ahmed أو reception1</p>
          <div className="field"><label>رقم الموبايل</label>
            <input className="mono" dir="ltr" style={{ textAlign: "left" }}
              value={form.phone} onChange={set("phone")} /></div>
          <div className="field"><label>الباسورد المبدئي</label>
            <input type="password" autoComplete="new-password" dir="ltr" style={{ textAlign: "left" }} value={form.password}
              onChange={set("password")} placeholder="8 حروف على الأقل" /></div>
          <div className="field"><label>تأكيد الباسورد</label>
            <input type="password" autoComplete="new-password" dir="ltr" style={{ textAlign: "left" }} value={form.password_again}
              onChange={set("password_again")} placeholder="اكتب نفس الباسورد تاني" /></div>
          <div className="field"><label>الدور</label>
            <select value={form.role} onChange={set("role")}>
              <option value="reception">ريسبشن — يحجز ويسكّن ويقبض</option>
              <option value="housekeeping">هاوس كيبينج — النضافة بس</option>
              <option value="manager">مدير — كل حاجة والأسعار</option>
            </select></div>

          <div className="banner warn" style={{ margin: 0 }}>
            الموظف هيدخل باسم المستخدم والباسورد فقط، من غير إيميل. سلّمه الاتنين بنفسك.
          </div>

          <button className="btn primary wide" disabled={busy} onClick={create}>
            {busy ? "بيضيف…" : "إنشاء الحساب"}
          </button>
          <button className="btn wide" onClick={() => setOpen(false)}>إلغاء</button>
        </div>
      )}
      <Dialog
        open={!!resetMember}
        title={`باسورد جديد لـ ${resetMember?.profiles?.full_name || "الموظف"}`}
        description="اكتب 8 حروف على الأقل، ثم سلّم الباسورد للموظف بطريقة آمنة."
        onClose={() => { setResetMember(null); setResetValue(""); setResetAgain(""); }}
      >
        <div className="stack">
          <label className="field"><span>الباسورد الجديد</span>
            <input type="password" autoComplete="new-password" dir="ltr" value={resetValue} onChange={(e) => setResetValue(e.target.value)} />
          </label>
          <label className="field"><span>تأكيد الباسورد الجديد</span>
            <input type="password" autoComplete="new-password" dir="ltr" value={resetAgain} onChange={(e) => setResetAgain(e.target.value)} />
          </label>
          <div className="row">
            <button className="btn primary grow" disabled={busy || resetValue.length < 8 || resetAgain.length < 8} onClick={resetPassword}>{busy ? "بيتنفذ…" : "غيّر الباسورد"}</button>
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
    if (pin.length < 4) return showToast("لازم 4 أرقام على الأقل", true);
    if (pin !== again) return showToast("الباسورد مش متطابق", true);

    setBusy(true);
    const { error } = await supabase.rpc("set_action_pin", {
      p_property: property.id, p_pin: pin,
    });
    setBusy(false);
    if (error) return showToast(error.message, true);

    setPin(""); setAgain(""); setIsSet(true);
    showToast("الباسورد اتحفظ");
  }

  async function clear() {
    const { error } = await supabase.rpc("clear_action_pin", { p_property: property.id });
    if (error) return showToast(error.message, true);
    setIsSet(false);
    setConfirmClear(false);
    showToast("الباسورد اتشال");
  }

  return (
    <>
      <p className="section-note">
        باسورد بيتطلب قبل الإلغاء وعدم الحضور والخروج البدري وتغيير الأسعار.
      </p>

      <div className={`banner ${isSet ? "ok" : "warn"}`}>
        {isSet === null ? "بيحمّل…"
          : isSet
          ? "الباسورد مفعّل. الإجراءات دي محتاجة تأكيد."
          : "مفيش باسورد. أي حد ليه صلاحية يقدر يلغي من غير تأكيد."}
      </div>

      <div className="card stack">
        <div className="field">
          <label>{isSet ? "باسورد جديد" : "الباسورد"}</label>
          <input type="password" inputMode="numeric" className="mono" dir="ltr"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
            value={pin} onChange={(e) => setPin(e.target.value)} />
        </div>
        <div className="field">
          <label>اكتبه تاني</label>
          <input type="password" inputMode="numeric" className="mono" dir="ltr"
            style={{ textAlign: "center", fontSize: 20, letterSpacing: ".3em" }}
            value={again} onChange={(e) => setAgain(e.target.value)} />
        </div>

        <button className="btn primary wide" disabled={busy} onClick={save}>
          {busy ? "بيحفظ…" : isSet ? "غيّر الباسورد" : "فعّل الباسورد"}
        </button>

        {isSet && (
          <button className="btn wide danger" onClick={() => setConfirmClear(true)}>شيل الباسورد</button>
        )}
      </div>

      <div className="banner warn" style={{ marginTop: 14 }}>
        الباسورد متخزّن مشفّر — مش أنا ولا أي حد يقدر يقراه، فلو نسيته
        هتعمل واحد جديد من هنا. وبعد 5 محاولات غلط بيتقفل ربع ساعة.
      </div>
      <Dialog open={confirmClear} danger title="إزالة باسورد التأكيد؟" description="بعد الإزالة، إجراءات الإلغاء والـ no-show لن تطلب تأكيدًا إضافيًا." onClose={() => setConfirmClear(false)}>
        <div className="row">
          <button className="btn danger grow" onClick={clear}>نعم، شيل الباسورد</button>
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
    logo: "لوجو الفندق",
    logoHint: "PNG أو JPG أو WebP — بحد أقصى 5 ميجا.",
    choose: "اختيار صورة",
    remove: "حذف الصورة",
    alt: "معاينة لوجو الفندق",
    invalidType: "اختار صورة PNG أو JPG أو WebP.",
    tooLarge: "حجم الصورة لازم يكون 5 ميجا أو أقل.",
    saving: "بيرفع ويحفظ…",
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
    showToast("اتحفظ");
    reload();
  }

  const set = (k) => (e) => setForm((f) => ({ ...f, [k]: e.target.value }));

  return (
    <>
    <div className="card stack">
      <div className="field"><label>اسم النادي</label>
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
      <div className="field"><label>لون النادي</label>
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
    showToast("الترجمات الإنجليزية اتحفظت"); reload();
  }

  return (
    <section className="section" style={{ marginTop: 18 }}>
      <h2>المحتوى الإنجليزي</h2>
      <p className="section-note">الخانة الفارغة تعرض الاسم أو الوصف العربي تلقائيًا.</p>
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
      <button className="btn primary wide" style={{ marginTop: 12 }} disabled={saving} onClick={save}>{saving ? "بيحفظ…" : "حفظ المحتوى الإنجليزي"}</button>
    </section>
  );
}
