import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

/**
 * The platform panel's privileged half.
 *
 * Everything here needs the service key, so everything here checks first
 * that the caller is in platform_admins — a table no signed-in user can
 * read. The check is one query, at the top, before the admin client is
 * built at all: there is no path below it that runs for a non-admin.
 *
 * What it deliberately never returns: a guest, a booking, a payment, a
 * note. The panel is about hotels and accounts. Row-level security still
 * governs hotel data, and being a platform admin grants no part of it.
 */

const cors = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { ...cors, "Content-Type": "application/json" },
  });

// A branch code becomes part of every staff login address for that hotel,
// so it has to survive being written into an email local part.
const slugPattern = /^[a-z0-9][a-z0-9-]{2,39}$/;
const emailPattern = /^[^\s@]+@[^\s@.]+\.[^\s@]+$/;
// The same shape the staff function and the database constraint accept.
const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const roles = ["owner", "manager", "reception", "housekeeping"];

Deno.serve(async (req: Request) => {
  if (req.method === "OPTIONS") return new Response("ok", { headers: cors });
  if (req.method !== "POST") return json({ error: "الطريقة غير مسموحة" }, 405);

  const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
  const ANON = Deno.env.get("SUPABASE_ANON_KEY")!;
  const SERVICE = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;

  const authHeader = req.headers.get("Authorization");
  if (!authHeader) return json({ error: "لازم تكون مسجل دخول" }, 401);

  const asCaller = createClient(SUPABASE_URL, ANON, {
    global: { headers: { Authorization: authHeader } },
  });
  const { data: { user }, error: userErr } = await asCaller.auth.getUser();
  if (userErr || !user) return json({ error: "الجلسة انتهت، سجل دخول تاني" }, 401);

  // The gate. Everything past this line assumes it passed.
  const { data: isAdmin } = await asCaller.rpc("is_platform_admin");
  if (isAdmin !== true) return json({ error: "مالكش صلاحية" }, 403);

  let body: Record<string, string | boolean>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  const action = String(body.action || "");

  /* ---------------------------------------------------------- overview */
  if (action === "overview") {
    const { data: properties } = await admin
      .from("properties")
      .select("id, slug, name, name_en, timezone, currency, is_active, created_at")
      .order("created_at");

    const { data: members } = await admin
      .from("property_members")
      .select("id, property_id, user_id, role, is_active, login_username, created_at");

    const { data: profiles } = await admin
      .from("profiles")
      .select("id, full_name, phone");

    // Counts only. The panel says how much a hotel has, never what it is.
    const counts: Record<string, Record<string, number>> = {};
    for (const table of ["rooms", "bookings", "guests", "payments"]) {
      const { data: rows } = await admin.from(table).select("property_id");
      for (const row of rows || []) {
        const id = (row as { property_id: string }).property_id;
        counts[id] = counts[id] || {};
        counts[id][table] = (counts[id][table] || 0) + 1;
      }
    }

    // Sign-in times come from auth, which the panel joins in by id.
    const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const seen: Record<string, { email: string | null; last_sign_in_at: string | null }> = {};
    for (const u of authList?.users || []) {
      seen[u.id] = { email: u.email ?? null, last_sign_in_at: u.last_sign_in_at ?? null };
    }

    const byId: Record<string, { full_name: string | null; phone: string | null }> = {};
    for (const p of profiles || []) {
      byId[p.id] = { full_name: p.full_name ?? null, phone: p.phone ?? null };
    }

    return json({
      ok: true,
      properties: (properties || []).map((p) => ({ ...p, counts: counts[p.id] || {} })),
      members: (members || []).map((m) => ({
        ...m,
        full_name: byId[m.user_id]?.full_name ?? null,
        phone: byId[m.user_id]?.phone ?? null,
        email: seen[m.user_id]?.email ?? null,
        last_sign_in_at: seen[m.user_id]?.last_sign_in_at ?? null,
      })),
    });
  }

  /* --------------------------------------------- open a hotel with its owner */
  if (action === "create_property") {
    const slug = String(body.slug || "").trim().toLowerCase();
    const name = String(body.name || "").trim();
    const ownerEmail = String(body.owner_email || "").trim().toLowerCase();
    const ownerName = String(body.owner_name || "").trim();
    const ownerPassword = String(body.owner_password || "");

    if (!slugPattern.test(slug)) {
      return json({ error: "رمز الفرع: حروف إنجليزية صغيرة وأرقام وشرطة، من 3 لـ 40 حرف" }, 400);
    }
    if (!name) return json({ error: "اسم الفندق مطلوب" }, 400);
    if (!emailPattern.test(ownerEmail)) return json({ error: "بريد المالك غير صحيح" }, 400);
    if (!ownerName) return json({ error: "اسم المالك مطلوب" }, 400);
    if (ownerPassword.length < 8) return json({ error: "الباسورد لازم 8 حروف على الأقل" }, 400);

    const { data: clash } = await admin
      .from("properties").select("id").eq("slug", slug).maybeSingle();
    if (clash) return json({ error: "رمز الفرع ده مستخدم قبل كده" }, 400);

    const { data: property, error: propErr } = await admin
      .from("properties")
      .insert({
        slug,
        name,
        name_en: String(body.name_en || "").trim() || null,
        timezone: String(body.timezone || "Africa/Cairo"),
      })
      .select()
      .single();
    if (propErr || !property) return json({ error: propErr?.message || "الفندق متعملش" }, 400);

    // From here on, anything that fails takes the hotel back out with it:
    // half an opened hotel is worse than none.
    const undo = async (message: string) => {
      await admin.from("properties").delete().eq("id", property.id);
      return json({ error: message }, 400);
    };

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email: ownerEmail,
      password: ownerPassword,
      email_confirm: true,
      user_metadata: { full_name: ownerName },
    });
    const ownerId = created?.user?.id;
    if (createErr || !ownerId) {
      const said = createErr?.message?.toLowerCase() || "";
      return undo(said.includes("registered") || said.includes("already")
        ? "البريد ده مستخدم قبل كده"
        : createErr?.message || "حساب المالك متعملش");
    }

    const { error: profileErr } = await admin.from("profiles")
      .upsert({ id: ownerId, full_name: ownerName });
    if (profileErr) {
      await admin.auth.admin.deleteUser(ownerId);
      return undo(profileErr.message);
    }

    const { error: memberErr } = await admin.from("property_members").insert({
      property_id: property.id,
      user_id: ownerId,
      role: "owner",
      is_active: true,
    });
    if (memberErr) {
      await admin.auth.admin.deleteUser(ownerId);
      return undo(memberErr.message);
    }

    await admin.from("activity_log").insert({
      property_id: property.id,
      actor_id: user.id,
      entity_type: "security",
      entity_id: property.id,
      action: "created",
      payload: { slug, owner_email: ownerEmail, by: "platform" },
    });

    return json({ ok: true, property_id: property.id, owner_id: ownerId, slug });
  }

  /* ------------------------------------------- switch a whole hotel on or off */
  if (action === "set_property_active") {
    const propertyId = String(body.property_id || "");
    if (!propertyId) return json({ error: "الفندق مش محدد" }, 400);

    const { data: property } = await admin
      .from("properties").select("is_active").eq("id", propertyId).maybeSingle();
    if (!property) return json({ error: "الفندق مش موجود" }, 404);

    const next = !property.is_active;
    const { error } = await admin
      .from("properties").update({ is_active: next }).eq("id", propertyId);
    if (error) return json({ error: error.message }, 400);

    await admin.from("activity_log").insert({
      property_id: propertyId,
      actor_id: user.id,
      entity_type: "security",
      entity_id: propertyId,
      action: next ? "room_unblocked" : "room_blocked",
      payload: { platform: true, is_active: next },
    });

    return json({ ok: true, is_active: next });
  }

  /* ------------------------------------------------- one account on or off */
  if (action === "set_member_active") {
    const memberId = String(body.member_id || "");
    if (!memberId) return json({ error: "الحساب مش محدد" }, 400);

    const { data: member } = await admin
      .from("property_members").select("user_id, is_active").eq("id", memberId).maybeSingle();
    if (!member) return json({ error: "الحساب مش موجود" }, 404);
    if (member.user_id === user.id) return json({ error: "مينفعش توقف حسابك بنفسك" }, 400);

    const next = !member.is_active;
    const { error } = await admin
      .from("property_members").update({ is_active: next }).eq("id", memberId);
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true, is_active: next });
  }

  /* --------------------------------------------------------- new password */
  if (action === "reset_password") {
    const memberId = String(body.member_id || "");
    const password = String(body.password || "");
    if (!memberId) return json({ error: "الحساب مش محدد" }, 400);
    if (password.length < 8) return json({ error: "الباسورد لازم 8 حروف على الأقل" }, 400);

    const { data: member } = await admin
      .from("property_members").select("user_id").eq("id", memberId).maybeSingle();
    if (!member) return json({ error: "الحساب مش موجود" }, 404);

    const { error } = await admin.auth.admin.updateUserById(member.user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  /* -------------------------------------- an account added to a hotel */
  /**
   * A manager, an owner, or anybody else, added to a hotel that already
   * exists — which used to mean asking that hotel's owner to do it from
   * their settings, and was impossible when the owner was the one missing.
   *
   * Two ways in, the same two the login screen has:
   *   - a username, which becomes `{code}.{username}@staff.easyroom.app`
   *     and signs in from "staff login" with the hotel code;
   *   - an email, for somebody who already has (or should have) a real
   *     address. If that address is already an account — the owner of
   *     another hotel, say — it is not created twice: the caller is told
   *     whose it is and has to say so again to add it, because its
   *     password stays the one its owner already has, and a password typed
   *     here would be silently ignored otherwise.
   */
  if (action === "add_member") {
    const propertyId = String(body.property_id || "");
    const role = String(body.role || "");
    const fullName = String(body.full_name || "").trim();
    const phone = String(body.phone || "").trim() || null;
    const login = String(body.login || "username");
    const password = String(body.password || "");

    if (!propertyId) return json({ error: "الفندق مش محدد" }, 400);
    if (!roles.includes(role)) return json({ error: "اختار دور صحيح" }, 400);
    if (!fullName) return json({ error: "اكتب الاسم" }, 400);

    const { data: property } = await admin
      .from("properties").select("id, slug").eq("id", propertyId).maybeSingle();
    if (!property) return json({ error: "الفندق مش موجود" }, 404);

    let email = "";
    let username: string | null = null;
    if (login === "username") {
      username = String(body.username || "").trim().toLowerCase();
      if (!usernamePattern.test(username)) {
        return json({ error: "اسم المستخدم: حروف إنجليزية صغيرة وأرقام، من 3 لـ 32 حرف" }, 400);
      }
      email = `${property.slug}.${username}@staff.easyroom.app`;
    } else if (login === "email") {
      email = String(body.email || "").trim().toLowerCase();
      if (!emailPattern.test(email)) return json({ error: "البريد غير صحيح" }, 400);
      // A staff address belongs to one hotel's login screen; reaching it
      // through the email door would make an account nobody can explain.
      if (email.endsWith("@staff.easyroom.app")) {
        return json({ error: "ده عنوان موظف — استخدم «اسم مستخدم» بدل البريد" }, 400);
      }
    } else {
      return json({ error: "طريقة الدخول غير معروفة" }, 400);
    }

    const { data: authList } = await admin.auth.admin.listUsers({ perPage: 1000 });
    const existing = (authList?.users || []).find((u) => (u.email || "").toLowerCase() === email);

    if (existing) {
      const { data: already } = await admin.from("property_members")
        .select("id, is_active").eq("property_id", propertyId).eq("user_id", existing.id).maybeSingle();
      if (already) {
        return json({
          error: already.is_active
            ? "الحساب ده موجود في الفندق ده قبل كده"
            : "الحساب ده موجود في الفندق بس موقوف — فعّله من قايمة الحسابات",
        }, 400);
      }
      if (login === "username") return json({ error: "اسم المستخدم ده مستخدم في الفندق" }, 400);

      const { data: profile } = await admin.from("profiles")
        .select("full_name").eq("id", existing.id).maybeSingle();
      if (body.link_existing !== true) {
        return json({
          error: "البريد ده لحساب موجود",
          code: "exists",
          name: profile?.full_name || existing.user_metadata?.full_name || email,
        }, 409);
      }

      if (!profile) {
        const { error: profileErr } = await admin.from("profiles")
          .insert({ id: existing.id, full_name: fullName, phone });
        if (profileErr) return json({ error: profileErr.message }, 400);
      }
      const { error: memberErr } = await admin.from("property_members").insert({
        property_id: propertyId, user_id: existing.id, role, is_active: true,
      });
      if (memberErr) return json({ error: memberErr.message }, 400);

      await logAdded(propertyId, existing.id, { role, email, linked: true });
      return json({ ok: true, user_id: existing.id, linked: true });
    }

    if (password.length < 8) return json({ error: "الباسورد لازم 8 حروف على الأقل" }, 400);

    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: fullName, phone },
    });
    const userId = created?.user?.id;
    if (createErr || !userId) return json({ error: createErr?.message || "الحساب متعملش" }, 400);

    // Anything failing past here takes the account back out: a sign-in
    // that leads to "no hotel" is worse than no account.
    const { error: profileErr } = await admin.from("profiles")
      .upsert({ id: userId, full_name: fullName, phone });
    if (profileErr) {
      await admin.auth.admin.deleteUser(userId);
      return json({ error: profileErr.message }, 400);
    }

    const { error: memberErr } = await admin.from("property_members").insert({
      property_id: propertyId, user_id: userId, role, is_active: true,
      login_username: username,
    });
    if (memberErr) {
      await admin.auth.admin.deleteUser(userId);
      return json({
        error: memberErr.code === "23505" ? "اسم المستخدم ده مستخدم في الفندق" : memberErr.message,
      }, 400);
    }

    await logAdded(propertyId, userId, { role, username, email: username ? null : email });
    return json({ ok: true, user_id: userId, linked: false, login_email: email });
  }

  /* ------------------------------------------------- one account's role */
  if (action === "set_member_role") {
    const memberId = String(body.member_id || "");
    const role = String(body.role || "");
    if (!memberId) return json({ error: "الحساب مش محدد" }, 400);
    if (!roles.includes(role)) return json({ error: "اختار دور صحيح" }, 400);

    const { data: member } = await admin.from("property_members")
      .select("property_id, user_id, role, is_active").eq("id", memberId).maybeSingle();
    if (!member) return json({ error: "الحساب مش موجود" }, 404);
    if (member.user_id === user.id) return json({ error: "مينفعش تغيّر دورك بنفسك" }, 400);
    if (member.role === role) return json({ ok: true, role });

    // A hotel with no active owner has nobody who can renew it, add staff
    // or set the manager password — so the last one cannot be demoted.
    if (member.role === "owner" && member.is_active) {
      const { count } = await admin.from("property_members")
        .select("id", { count: "exact", head: true })
        .eq("property_id", member.property_id).eq("role", "owner").eq("is_active", true);
      if ((count || 0) <= 1) {
        return json({ error: "ده آخر مالك في الفندق — ضيف مالك تاني الأول" }, 400);
      }
    }

    const { error } = await admin.from("property_members").update({ role }).eq("id", memberId);
    if (error) return json({ error: error.message }, 400);

    await admin.from("activity_log").insert({
      property_id: member.property_id,
      actor_id: user.id,
      entity_type: "staff",
      entity_id: member.user_id,
      action: "updated",
      payload: { role, previous_role: member.role, by: "platform" },
    });
    return json({ ok: true, role });
  }

  return json({ error: "إجراء غير معروف" }, 400);

  async function logAdded(propertyId: string, userId: string, payload: Record<string, unknown>) {
    await admin.from("activity_log").insert({
      property_id: propertyId,
      actor_id: user!.id,
      entity_type: "staff",
      entity_id: userId,
      action: "created",
      payload: { ...payload, by: "platform" },
    });
  }
});
