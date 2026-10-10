import crypto from "node:crypto";
import { isAuthed, sessionEmail } from "./_auth.js";
import { kvAvailable, kvGet, kvSet, kvLpush, kvLtrim } from "./_kv.js";
import { BUILTIN_DEMOS, loadDemo } from "./_builtin-demos.js";

/* Shareable demo links.
   POST (builder session required): store an immutable snapshot of a demo
     { name?, site, controls, payload } → { slug }
   GET ?slug=… (public — the link is the credential): the snapshot, for the
     visitor demo page. Never contains API keys. */

const NO_KV_MSG =
  "Demo-link storage isn't set up. In Vercel: Storage → Create Database → Upstash Redis (attach to this project), then redeploy.";

export default async function handler(req, res) {
  if (req.method === "GET") {
    const slug = String(req.query?.slug ?? "");
    if (!/^[A-Za-z0-9_-]{6,24}$/.test(slug)) {
      res.status(400).json({ error: "Bad demo link." });
      return;
    }
    if (!BUILTIN_DEMOS[slug] && !kvAvailable()) { res.status(500).json({ error: NO_KV_MSG }); return; }
    try {
      const demo = await loadDemo(slug, kvAvailable, kvGet);
      if (!demo) { res.status(404).json({ error: "This demo link doesn't exist (or was created before storage was set up)." }); return; }
      const { payload, presentation, browserUse, ...pub } = demo; // visitors don't need the raw Tavus payload or the skill configs
      if (pub.experience && typeof pub.experience === "object") {
        // The attendance-alert webhook and the memory store key stay
        // server-side (used by /api/experience and /api/demo-launch).
        const { notifyWebhook, memory, ...expPub } = pub.experience;
        pub.experience = expPub;
      }
      res.status(200).json(pub);
    } catch (e) {
      res.status(502).json({ error: `Storage: ${e.message}` });
    }
    return;
  }

  if (req.method !== "POST") { res.status(405).json({ error: "GET or POST only" }); return; }
  if (!isAuthed(req)) { res.status(401).json({ error: "Not signed in — enter the access code first." }); return; }
  if (!kvAvailable()) { res.status(500).json({ error: NO_KV_MSG }); return; }

  const { name = "", site = {}, controls = {}, payload = null, experience = null, presentation = null, browserUse = null } = req.body ?? {};
  if (!payload?.pal_id || !payload?.face_id) {
    res.status(400).json({ error: "The demo needs a PAL ID and Face ID before it can be shared." });
    return;
  }
  const exp = experience && typeof experience === "object" && !Array.isArray(experience) ? experience : null;
  // The presentation-skill config (doc ids + trigger). The deck lives on the
  // PAL — mutable by any later builder launch — so demo-launch re-attaches
  // this snapshot per visitor call to keep the link's slides stable.
  const deck = Array.isArray(presentation?.config?.document_ids) && presentation.config.document_ids.length
    ? { config: presentation.config } : null;
  // Guided browser flows — same re-attach-per-visitor treatment as the deck.
  const flows = Array.isArray(browserUse?.config?.guided_flows) && browserUse.config.guided_flows.length
    ? { config: browserUse.config } : null;
  const size = JSON.stringify({ site, controls, payload, experience: exp, presentation: deck, browserUse: flows }).length;
  if (size > 800_000) {
    res.status(413).json({ error: "This demo config is too large to share — usually the site screenshot or logo; re-add a smaller one." });
    return;
  }

  try {
    const slug = crypto.randomBytes(6).toString("base64url");
    const createdAt = new Date().toISOString();
    const createdBy = sessionEmail(req) || "";
    await kvSet(`demo:${slug}`, {
      v: 1,
      name: String(name).slice(0, 120),
      createdAt,
      createdBy,
      site,
      controls,
      payload,
      ...(exp ? { experience: exp } : {}),
      ...(deck ? { presentation: deck } : {}),
      ...(flows ? { browserUse: flows } : {}),
    });
    // Index for the stats dashboard (newest first, capped).
    await kvLpush("demos:index", { slug, name: String(name).slice(0, 120), createdAt, createdBy });
    await kvLtrim("demos:index", 0, 499);
    res.status(200).json({ slug });
  } catch (e) {
    res.status(502).json({ error: `Storage: ${e.message}` });
  }
}
