<!-- BEGIN:nextjs-agent-rules -->

# This is NOT the Next.js you know

This version has breaking changes — APIs, conventions, and file structure may all differ from your training data. Read the relevant guide in `node_modules/next/dist/docs/` (resolved from this file's directory; in monorepos the `next` package may not be visible from the repo root) before writing any code. Heed deprecation notices.

This block is written and re-added by `next dev` — verify at `node_modules/next/dist/server/lib/generate-agent-files.js`. Removing it from a diff only re-creates the uncommitted change; committing it with your work keeps the tree clean.

<!-- END:nextjs-agent-rules -->

# اقرأ `STATUS.md` قبل أي شغل

المالك بيشغّل أكتر من agent على المشروع ده، وكل واحد بيدخل من غير ما يعرف
اللي قبله عمل إيه. **`STATUS.md` هو نقطة التسليم بينكم.**

1. **اقرأه قبل ما تبدأ** — وبالذات قسم «قرارات لا تُكسَر». فيه حاجات لو
   كسرتها التطبيق كله يبقى غير موثوق، ومش هتلاحظ.
2. **حدّثه مع كل تغيير، في نفس الكوميت.** تغيير من غير تحديث = الـagent
   اللي بعدك هيشتغل على معلومة غلط.
3. **أي رقم أو حالة فيه تتأكد من المصدر مش من الذاكرة** — الأعداد من قاعدة
   البيانات، والاختبارات من تشغيلها. ده حصل غلط قبل كده واتقال للمالك.
4. **لو حاجة فيه خالفت الواقع، الملف هو الغلط.** صلّحه فوراً.

## قبل ما تعدّل العزل

`is_member` و`has_role` و`manageable_property_ids` هم كل العزل بين الفنادق.
قبل وبعد أي تعديل فيهم شغّل:

```bash
supabase/replay/replay.sh --check
```

لازم يطلع نفس النتيجة بالظبط. غلطة فيهم مش بتبان غير لما حد يقرا سجل نزلاء
فندق تاني.

## الأساسيات

```bash
npx vitest run     # اختبارات الوحدة
npx eslint .       # لينت
npm run build      # بناء
```

- أي نص جديد في شاشة → مفتاح في `messages/ar.json` و`en.json`. مفيش نص
  عربي متحطوط في الكود.
- أي تعديل في قاعدة البيانات → ملف هجرة في `supabase/migrations/` **و**
  تطبيقه على الإنتاج. الاتنين.
- مفتاح `service_role` عمره ما يدخل المتصفح. أي إجراء محتاجه يبقى في Edge
  Function ومعاها فحص صلاحية في أول سطر.
