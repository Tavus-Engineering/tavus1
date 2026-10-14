import { kvAvailable, kvGet, kvIncr, kvLpush, kvLtrim, kvSetRaw } from "./_kv.js";
import { BUILTIN_DEMOS, loadDemo } from "./_builtin-demos.js";

/* Public endpoint: a visitor on /d/{slug} presses Start. We create a fresh
   Tavus conversation server-side with the team's TAVUS_API_KEY — visitors
   never need any credentials. Lightly rate-limited per demo per hour. */

const LAUNCHES_PER_HOUR = 60;

/* Weave the visitor's guided-journey answers into the conversation payload.
   Answers arrive as step/option INDEXES resolved against the demo's STORED
   journey config — visitors can only select from what the builder composed
   (free text is capped and quoted). Mirrors applyJourneyPrefs in the
   frontend (builder previews) — keep the two in sync. */
function applyJourneyPrefs(payload, journeyArr, prefs) {
  if (!prefs || !Array.isArray(prefs.answers) || !Array.isArray(journeyArr)) return payload;
  const out = { ...payload };
  const lines = [];
  prefs.answers.slice(0, 12).forEach((ans) => {
    const s = journeyArr[Number(ans?.step)];
    if (!s) return;
    if (s.type === "question") {
      const opt = s.options?.[Number(ans.option)];
      if (typeof opt === "string") lines.push(`- ${s.prompt} → ${opt}`);
      // Authored per-option override — how the conversation changes when this
      // option is picked ("Label :: instructions" on the Experience step).
      const oc = Array.isArray(s.optionContext) ? String(s.optionContext[Number(ans.option)] ?? "").trim() : "";
      if (oc) lines.push(oc.slice(0, 600));
    } else if (s.type === "input") {
      const text = String(ans.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (text) lines.push(`- ${s.prompt} → "${text}"`);
    } else if (s.type === "personas") {
      const o = s.options?.[Number(ans.option)];
      if (!o) return;
      lines.push(`- Chosen experience: ${o.label}`);
      if (o.context) lines.push(String(o.context));
      if (o.greeting) {
        out.custom_greeting = String(o.greeting);
        // Keep in sync with applyJourneyPrefs in TavusExperienceBuilder.jsx:
        // REPLACE the base greeting instruction (two conflicting "your first
        // line is…" claims made the model re-greet), then state the new one.
        out.conversational_context = String(out.conversational_context || "")
          .split("\n\n").filter((p) => !/^Your first spoken line is already scripted/.test(p)).join("\n\n");
        lines.push(`- Your first spoken line is already scripted and plays automatically: "${String(o.greeting).slice(0, 300)}" — continue naturally from it; never introduce yourself a second time.`);
      }
      if (o.palId && /^p[a-z0-9_-]{3,60}$/i.test(String(o.palId))) out.pal_id = String(o.palId);
    }
  });
  const email = String(prefs.email ?? "").trim().slice(0, 200);
  if (email) lines.push(`- Email they provided: ${email}`);
  if (lines.length) {
    const intro = "Pre-call setup from this visitor (personalize with it naturally — never recite it back as a list):";
    const settled = "Anything already answered above is settled: confirm briefly if useful, never ask for it again — skip or fast-complete any objective step that asks for it.";
    out.conversational_context = [out.conversational_context, `${intro}\n${lines.join("\n")}\n${settled}`].filter(Boolean).join("\n\n");
  }
  return out;
}

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }

  const slug = String(req.body?.slug ?? "");
  if (!/^[A-Za-z0-9_-]{6,24}$/.test(slug)) { res.status(400).json({ error: "Bad demo link." }); return; }
  // Built-in demos ship with the code; only stored links need Redis.
  const builtin = !!BUILTIN_DEMOS[slug];
  if (!builtin && !kvAvailable()) { res.status(500).json({ error: "Demo-link storage isn't set up on the server." }); return; }
  if (!process.env.TAVUS_API_KEY) {
    res.status(500).json({ error: "TAVUS_API_KEY is not set on the server — shared demo links need it to start conversations. Add it in the Vercel project's environment variables." });
    return;
  }

  try {
    const demo = await loadDemo(slug, kvAvailable, kvGet);
    if (!demo?.payload) { res.status(404).json({ error: "This demo link doesn't exist." }); return; }

    // Rate limit needs Redis; a built-in demo on a storage-less deploy runs
    // uncapped by this counter (max_call_duration still bounds each call).
    const hourBucket = Math.floor(Date.now() / 3_600_000);
    const launches = kvAvailable() ? await kvIncr(`rl:${slug}:${hourBucket}`, 3700) : 0;
    if (launches > LAUNCHES_PER_HOUR) {
      res.status(429).json({ error: "This demo is getting a lot of traffic — try again in a little while." });
      return;
    }

    const payload = applyJourneyPrefs(structuredClone(demo.payload), demo.experience?.journey, req.body?.prefs);

    // Tavus Memories: derive the store key server-side. "visitor" mode keys
    // the memory to the gate email (scoped to this demo, so different demos
    // never share a store); no email → no cross-call memory for that caller.
    const mem = demo.experience?.memory;
    if (mem?.enabled) {
      const memSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
      const base = memSlug(mem.key || slug) || memSlug(slug);
      const email = String(req.body?.prefs?.email ?? "").trim().toLowerCase();
      if (mem.mode === "visitor") {
        if (email) payload.memory_stores = [`${base}_${memSlug(email)}`.slice(0, 120)];
        else delete payload.memory_stores;
      } else {
        payload.memory_stores = [base];
      }
    }

    // Re-attach the demo's deck to the PAL this call will use. The skill
    // persists on the PAL, where any later builder launch (a different demo,
    // or presentation toggled off) can rewrite or detach it — the snapshot
    // is the link's ground truth. Best-effort: a hiccup here must not block
    // the visitor's call. Runs after journey prefs so a per-option PAL
    // override gets the deck too.
    if (demo.presentation?.config?.document_ids?.length && payload.pal_id) {
      try {
        await fetch(`https://tavusapi.com/v2/pals/${encodeURIComponent(payload.pal_id)}/skills/presentation`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.TAVUS_API_KEY },
          body: JSON.stringify({ config: demo.presentation.config }),
        });
      } catch { /* deck attach is best-effort */ }
    }
    // Guided browser flows: same treatment — a later builder launch with the
    // toggle off DETACHES the skill from the PAL, which used to silently kill
    // browser mode on every live link.
    if (demo.browserUse?.config?.guided_flows?.length && payload.pal_id) {
      try {
        await fetch(`https://tavusapi.com/v2/pals/${encodeURIComponent(payload.pal_id)}/skills/browser_use`, {
          method: "PUT",
          headers: { "Content-Type": "application/json", "x-api-key": process.env.TAVUS_API_KEY },
          body: JSON.stringify({ config: demo.browserUse.config }),
        });
      } catch { /* flow attach is best-effort */ }
    }

    const r = await fetch("https://tavusapi.com/v2/conversations", {
      method: "POST",
      headers: { "Content-Type": "application/json", "x-api-key": process.env.TAVUS_API_KEY },
      body: JSON.stringify(payload),
    });
    const data = await r.json().catch(() => ({}));
    if (!r.ok) {
      res.status(502).json({ error: `Tavus: ${data.message || data.error || r.status}` });
      return;
    }
    // Per-demo stats (best-effort — never blocks the launch).
    if (kvAvailable()) try {
      const now = new Date();
      await kvIncr(`stats:${slug}:launches`);
      await kvIncr(`stats:${slug}:d:${now.toISOString().slice(0, 10)}`, 90 * 86400);
      await kvSetRaw(`stats:${slug}:last`, now.toISOString());
      if (data.conversation_id) {
        await kvLpush(`stats:${slug}:convos`, { id: data.conversation_id, at: now.toISOString() });
        await kvLtrim(`stats:${slug}:convos`, 0, 499);
      }
    } catch { /* stats are non-critical */ }

    res.status(200).json({
      conversation_url: data.conversation_url,
      conversation_id: data.conversation_id,
    });
  } catch (e) {
    res.status(502).json({ error: e.message || "launch failed" });
  }
}
