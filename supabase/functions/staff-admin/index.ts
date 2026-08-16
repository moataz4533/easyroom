import "jsr:@supabase/functions-js/edge-runtime.d.ts";
import { createClient } from "npm:@supabase/supabase-js@2";

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

const usernamePattern = /^[a-z0-9][a-z0-9._-]{2,31}$/;
const normalizeUsername = (value = "") => value.trim().toLowerCase();
const internalStaffEmail = (slug: string, username: string) =>
  `${slug}.${username}@staff.easyroom.app`;

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

  let body: Record<string, string>;
  try {
    body = await req.json();
  } catch {
    return json({ error: "طلب غير صالح" }, 400);
  }

  const { action, property_id, password, full_name, phone, role, member_id } = body;
  if (!property_id) return json({ error: "الفندق مش محدد" }, 400);

  const { data: caller } = await asCaller
    .from("property_members")
    .select("role")
    .eq("property_id", property_id)
    .eq("user_id", user.id)
    .eq("is_active", true)
    .maybeSingle();
  if (!caller || !["owner", "manager"].includes(caller.role)) {
    return json({ error: "مالكش صلاحية تدير الموظفين" }, 403);
  }

  const admin = createClient(SUPABASE_URL, SERVICE, {
    auth: { autoRefreshToken: false, persistSession: false },
  });

  if (action === "create") {
    const username = normalizeUsername(body.username);
    if (!usernamePattern.test(username) || !password || !full_name?.trim() || !role) {
      return json({ error: "محتاج اسم الموظف واسم مستخدم صحيح وباسورد ودور" }, 400);
    }
    if (password.length < 8) return json({ error: "الباسورد لازم 8 حروف على الأقل" }, 400);
    if (!["manager", "reception", "housekeeping"].includes(role)) {
      return json({ error: "اختار دور موظف صحيح" }, 400);
    }

    const { data: property } = await admin
      .from("properties")
      .select("slug")
      .eq("id", property_id)
      .maybeSingle();
    if (!property) return json({ error: "الفندق مش موجود" }, 404);

    const email = internalStaffEmail(property.slug, username);
    const { data: created, error: createErr } = await admin.auth.admin.createUser({
      email,
      password,
      email_confirm: true,
      user_metadata: { full_name: full_name.trim(), phone: phone || null },
    });
    const userId = created?.user?.id;
    if (createErr || !userId) {
      const normalizedError = createErr?.message?.toLowerCase() || "";
      const message = normalizedError.includes("registered") || normalizedError.includes("already")
        ? "اسم المستخدم ده مستخدم قبل كده"
        : createErr?.message || "الحساب متعملش";
      return json({ error: message }, 400);
    }

    const { error: profileErr } = await admin.from("profiles").upsert({
      id: userId,
      full_name: full_name.trim(),
      phone: phone || null,
    });
    if (profileErr) {
      await admin.auth.admin.deleteUser(userId);
      return json({ error: profileErr.message }, 400);
    }

    const { error: memberErr } = await admin.from("property_members").insert({
      property_id,
      user_id: userId,
      role,
      is_active: true,
      login_username: username,
    });
    if (memberErr) {
      await admin.auth.admin.deleteUser(userId);
      const message = memberErr.code === "23505" ? "اسم المستخدم ده مستخدم في الفندق" : memberErr.message;
      return json({ error: message }, 400);
    }

    await admin.from("activity_log").insert({
      property_id,
      actor_id: user.id,
      entity_type: "staff",
      entity_id: userId,
      action: "created",
      payload: { username, role },
    });
    return json({ ok: true, user_id: userId, username });
  }

  if (action === "set_role") {
    if (!member_id || !role) return json({ error: "ناقص بيانات" }, 400);
    const { data: target } = await admin.from("property_members").select("user_id, role").eq("id", member_id).eq("property_id", property_id).maybeSingle();
    if (!target) return json({ error: "الموظف مش موجود" }, 404);
    if (target.user_id === user.id) return json({ error: "مينفعش تغير دورك بنفسك" }, 400);
    if ((target.role === "owner" || role === "owner") && caller.role !== "owner") return json({ error: "المالك بس اللي يقدر يعدل صلاحيات المالك" }, 403);
    await admin.from("property_members").update({ role }).eq("id", member_id).eq("property_id", property_id);
    return json({ ok: true });
  }

  if (action === "set_active") {
    if (!member_id) return json({ error: "ناقص بيانات" }, 400);
    const { data: target } = await admin.from("property_members").select("user_id, role, is_active").eq("id", member_id).eq("property_id", property_id).maybeSingle();
    if (!target) return json({ error: "الموظف مش موجود" }, 404);
    if (target.user_id === user.id) return json({ error: "مينفعش توقف حسابك بنفسك" }, 400);
    if (target.role === "owner" && caller.role !== "owner") return json({ error: "المالك بس اللي يقدر يوقف مالك" }, 403);
    const isActive = !target.is_active;
    await admin.from("property_members").update({ is_active: isActive }).eq("id", member_id).eq("property_id", property_id);
    return json({ ok: true, is_active: isActive });
  }

  /**
   * Fixing a staff member's name or number.
   *
   * Not the username: it is half the address they sign in with, so changing
   * it would lock them out of the login saved on their phone. The card in
   * the app says so rather than offering a box that quietly breaks things.
   */
  if (action === "update_profile") {
    if (!member_id) return json({ error: "ناقص بيانات" }, 400);
    const name = (full_name || "").trim();
    if (!name) return json({ error: "اكتب اسم الموظف" }, 400);

    const { data: target } = await admin.from("property_members")
      .select("user_id, role").eq("id", member_id).eq("property_id", property_id).maybeSingle();
    if (!target) return json({ error: "الموظف مش موجود" }, 404);
    if (target.role === "owner" && caller.role !== "owner" && target.user_id !== user.id) {
      return json({ error: "المالك بس اللي يقدر يعدل بيانات المالك" }, 403);
    }

    const number = (phone || "").trim() || null;
    const { error } = await admin.from("profiles")
      .update({ full_name: name, phone: number, updated_at: new Date().toISOString() })
      .eq("id", target.user_id);
    if (error) return json({ error: error.message }, 400);

    // The same two fields live on the auth user as metadata, written when
    // the account was created. Leaving them behind means two answers to
    // "what is this person called" — and the stale one is the one that
    // reappears the next time anything reads the auth record.
    await admin.auth.admin.updateUserById(target.user_id, {
      user_metadata: { full_name: name, phone: number },
    });

    await admin.from("activity_log").insert({
      property_id,
      actor_id: user.id,
      entity_type: "staff",
      entity_id: target.user_id,
      action: "updated",
      payload: { full_name: name, phone: number },
    });
    return json({ ok: true, full_name: name, phone: number });
  }

  if (action === "reset_password") {
    if (!member_id || !password) return json({ error: "ناقص بيانات" }, 400);
    if (password.length < 8) return json({ error: "الباسورد لازم 8 حروف على الأقل" }, 400);
    const { data: target } = await admin.from("property_members").select("user_id, role").eq("id", member_id).eq("property_id", property_id).maybeSingle();
    if (!target) return json({ error: "الموظف مش موجود" }, 404);
    if (target.role === "owner" && caller.role !== "owner") return json({ error: "مالكش صلاحية" }, 403);
    const { error } = await admin.auth.admin.updateUserById(target.user_id, { password });
    if (error) return json({ error: error.message }, 400);
    return json({ ok: true });
  }

  return json({ error: "إجراء غير معروف" }, 400);
});
