import { isAuthed } from "./_auth.js";
import { kvAvailable, kvGet, kvSetEx, kvIncr, kvMget } from "./_kv.js";
import { loadDemo } from "./_builtin-demos.js";

/* Visitor experience data — who attended a call and what they thought of it.

   POST (public): { kind: "attend"|"feedback", conversation_id, slug?,
                    email?, rating?, comment? }
     - Visitor calls send the demo slug (the link is the credential);
       builder previews authenticate with the session cookie instead.
     - Records merge under exp:{conversation_id} (90-day TTL) so attend and
       feedback land in one place per call.
     - kind=attend on a slug demo forwards an alert to the demo's stored
       notifyWebhook (set on the Experience step; kept server-side — the
       public demo GET strips it, visitors never see the URL).

   GET ?ids=c1,c2 (builder session): { id: record } map for the Results
   step — same shape as /api/recordings. */

const TTL = 90 * 86400;
const GLOBAL_PER_HOUR = 5000; // abuse backstop for a public endpoint
const PER_SLUG_PER_HOUR = 300;

function safeForwardUrl(raw) {
  try {
    const u = new URL(String(raw));
    if (!/^https?:$/.test(u.protocol)) return null;
    const host = u.hostname.toLowerCase();
    if (host === "localhost" || /^(\d+\.){3}\d+$/.test(host) || host.endsWith(".local") || host.endsWith(".internal")) return null;
    return u.href;
  } catch { return null; }
}

export default async function handler(req, res) {
  if (req.method === "GET") {
    if (!isAuthed(req)) { res.status(401).json({ error: "Not signed in." }); return; }
    if (!kvAvailable()) { res.status(200).json({}); return; }
    const ids = String(req.query?.ids ?? "")
      .split(",")
      .map((s) => s.trim())
      .filter((s) => /^[a-z0-9]{6,64}$/i.test(s))
      .slice(0, 100);
    if (!ids.length) { res.status(200).json({}); return; }
    try {
      const vals = await kvMget(ids.map((id) => `exp:${id}`));
      const out = {};
      ids.forEach((id, i) => {
        if (vals[i] != null) {
          try { out[id] = JSON.parse(vals[i]); } catch { /* skip bad entry */ }
        }
      });
      res.status(200).json(out);
    } catch (e) {
      res.status(502).json({ error: e.message || "lookup failed" });
    }
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "GET or POST only" }); return; }
  if (!kvAvailable()) { res.status(501).json({ error: "Storage isn't set up — attendance/feedback can't be recorded." }); return; }

  const { kind, conversation_id, slug = "", email = "", rating = 0, comment = "", answers = null } = req.body ?? {};
  const convId = String(conversation_id ?? "");
  if (!/^[a-z0-9]{6,64}$/i.test(convId)) { res.status(400).json({ error: "Bad conversation id." }); return; }
  if (kind !== "attend" && kind !== "feedback") { res.status(400).json({ error: "kind must be attend or feedback." }); return; }

  // Who's allowed to write: a real demo slug (visitor) or a builder session (preview).
  let demo = null;
  const slugStr = String(slug ?? "");
  if (slugStr) {
    if (!/^[A-Za-z0-9_-]{6,24}$/.test(slugStr)) { res.status(400).json({ error: "Bad demo link." }); return; }
    try { demo = await loadDemo(slugStr, kvAvailable, kvGet); } catch { /* treated as unknown below */ }
    if (!demo) { res.status(404).json({ error: "Unknown demo link." }); return; }
  } else if (!isAuthed(req)) {
    res.status(401).json({ error: "Not signed in." });
    return;
  }

  try {
    const hour = Math.floor(Date.now() / 3_600_000);
    if ((await kvIncr(`rl:exp:${hour}`, 3700)) > GLOBAL_PER_HOUR) { res.status(429).json({ error: "Busy — try again shortly." }); return; }
    if (slugStr && (await kvIncr(`rl:exp:${slugStr}:${hour}`, 3700)) > PER_SLUG_PER_HOUR) { res.status(429).json({ error: "Busy — try again shortly." }); return; }

    const prev = (await kvGet(`exp:${convId}`)) || {};
    const rec = { ...prev };
    if (slugStr) rec.slug = slugStr;
    const cleanEmail = String(email ?? "").trim().slice(0, 200);
    if (cleanEmail && (kind === "attend" || !rec.email)) rec.email = cleanEmail;
    // Journey + card answers ({q, a} pairs) — appended, since card picks
    // arrive mid-call after the journey answers landed. Shown in Results.
    if (Array.isArray(answers)) {
      const clean = answers.slice(0, 12)
        .map((x) => ({ q: String(x?.q ?? "").trim().slice(0, 300), a: String(x?.a ?? "").trim().slice(0, 300) }))
        .filter((x) => x.q && x.a);
      if (clean.length) rec.answers = [...(Array.isArray(prev.answers) ? prev.answers : []), ...clean].slice(0, 24);
    }
    if (kind === "attend") {
      rec.attendAt = prev.attendAt || new Date().toISOString();
    } else {
      const r = Math.round(Number(rating));
      if (r >= 1 && r <= 5) rec.rating = r;
      const c = String(comment ?? "").trim().slice(0, 2000);
      if (c) rec.comment = c;
      rec.feedbackAt = new Date().toISOString();
    }
    await kvSetEx(`exp:${convId}`, rec, TTL);

    // Attendance alert — fire-and-forget to the demo owner's webhook. Only
    // visitor (slug) calls alert; builder previews shouldn't ping the team.
    if (kind === "attend" && demo && !prev.attendAt) {
      const hook = safeForwardUrl(demo.experience?.notifyWebhook);
      if (hook) {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 8000);
        // text/plain keeps Zapier/Make catch hooks happy (recording-hook convention).
        await fetch(hook, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            type: "demo.attend",
            demo: String(demo.name ?? ""),
            slug: slugStr,
            conversation_id: convId,
            email: cleanEmail,
            ...(rec.answers ? { answers: rec.answers } : {}),
            at: new Date().toISOString(),
          }),
          signal: ctrl.signal,
        }).catch(() => {}).finally(() => clearTimeout(t));
      }
    }

    res.status(200).json({ ok: true });
  } catch (e) {
    res.status(502).json({ error: `Storage: ${e.message}` });
  }
}
