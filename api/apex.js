import { isAuthed } from "./_auth.js";
import * as A from "./_apex_lib.js";

/* Apex Wealth demo (/apex) — one function, routed by ?op=, so the demo adds a
   single serverless function to the project.

   Builder session required:  state, start, end, reset, google_auth
   Public (Tavus calls these): tool (known-conversation + optional HMAC),
                               webhook (conversation callbacks / guardrails),
                               google_callback (one-time state token)

   The PAL is "Apex Portfolio Manager" (p6e28aea25fd). Its five registry tools
   POST here with auth.type=hmac. */

const MEETING_RE = /^https:\/\/([\w-]+\.)*(zoom\.us|meet\.google\.com|teams\.microsoft\.com|teams\.live\.com)\//;

const origin = (req) => process.env.APEX_PUBLIC_URL || `https://${req.headers["x-forwarded-host"] || req.headers.host}`;
const text = (res, s) => { res.setHeader("Content-Type", "text/plain"); res.status(200).send(s); };

async function rawBody(req) {
  // Read the exact bytes Tavus signed; fall back to the parsed body if the
  // runtime already consumed the stream.
  const chunks = [];
  try { for await (const c of req) chunks.push(Buffer.isBuffer(c) ? c : Buffer.from(c)); } catch { /* consumed */ }
  if (chunks.length) return Buffer.concat(chunks).toString("utf8");
  if (typeof req.body === "string") return req.body;
  if (Buffer.isBuffer(req.body)) return req.body.toString("utf8");
  return req.body ? JSON.stringify(req.body) : "";
}

export default async function handler(req, res) {
  const op = String(req.query?.op || "");
  try {
    switch (op) {
      case "tool": return await tool(req, res);
      case "webhook": return await webhook(req, res);
      case "google_callback": return await googleCallback(req, res);
      case "public_info": return await publicInfo(req, res);
      case "public_start": return await publicStart(req, res);
      case "public_end": return await publicEnd(req, res);
    }
    if (!isAuthed(req)) { res.status(401).json({ error: "Sign in to the builder first (open the home page), then come back to /apex." }); return; }
    switch (op) {
      case "state": return await state(req, res);
      case "start": return await start(req, res);
      case "end": return await end(req, res);
      case "reset": return await reset(req, res);
      case "google_auth": return await googleAuth(req, res);
      default: res.status(404).json({ error: `Unknown op "${op}"` });
    }
  } catch (e) {
    console.error("apex", op, e);
    res.status(500).json({ error: e.message || String(e) });
  }
}

// ---- console ----------------------------------------------------------------

async function state(req, res) {
  await A.ensureSeeded();
  const deals = await A.listDeals();
  const contacts = Object.fromEntries((await Promise.all(deals.map((d) => A.getContact(d.contactId)))).filter(Boolean).map((c) => [c.id, c]));
  const activity = Object.fromEntries(await Promise.all(deals.map(async (d) => [d.id, await A.getActivity(d.id)])));
  const activeId = await A.getActiveId();
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    stages: A.STAGES, deals, contacts, activity,
    feed: (await A.getFeed()).slice(-200),
    active: activeId ? await A.getSession(activeId) : null,
    config: {
      store: A.storeMode,
      tavus: !!process.env.TAVUS_API_KEY,
      google: await A.googleConnected(),
      googleConfigured: A.googleConfigured(),
      firms: Object.fromEntries(Object.entries(A.FIRMS).map(([k, f]) => [k, { label: f.label, palId: f.palId }])),
      profileFields: A.PROFILE_FIELDS,
    },
  });
}

/* Creates the CRM prospect + Tavus conversation. Shared by the signed-in console
   (start) and the public share link (public_start). */
async function launch(req, { firmKey, mode, meetingUrl, firstname, lastname, email, isPublic }) {
  const inZoom = mode === "zoom";
  const firm = A.FIRMS[firmKey];
  await A.ensureSeeded();
  const { contact, deal } = await A.createProspect({ firstname, lastname, email, firm: firmKey });
  const name = `${firstname} ${lastname}`.trim();
  try {
    if (inZoom) await A.ensureConferencing(firm.palId);
    const convo = await A.createConversation({
      pal_id: firm.palId,
      face_id: firm.faceId,
      // Standalone = Tavus-hosted room rendered in our page; Zoom = PAL joins the meeting link.
      ...(inZoom ? { meeting_url: meetingUrl } : {}),
      conversation_name: `${firm.label} - ${name}${isPublic ? " (share link)" : ""}`,
      callback_url: `${origin(req)}/api/apex?op=webhook`,
      custom_greeting: firm.greeting(firstname),
      conversational_context:
        `Today is ${A.todayLabel()}; the meeting started at ${A.nowTimeLabel()} Eastern Time. The prospect on this call is ${name}, email ${email}. ` +
        `A deal already exists in the CRM for them at stage "Discovery Call Scheduled". Your greeting already played; don't re-introduce yourself.` +
        (firmKey === "optimize"
          ? " During the brochure, present in short passes and pause only at the six planned question moments; after each question, stop and wait for the answer."
          : ""),
      properties: { max_call_duration: firmKey === "optimize" ? 3600 : 2700, participant_left_timeout: 60 },
    });
    await A.saveSession({
      conversationId: convo.conversation_id, conversationUrl: convo.conversation_url, mode: inZoom ? "zoom" : "room",
      meetingUrl: inZoom ? meetingUrl : null, dealId: deal.id, contactId: contact.id, public: !!isPublic,
      prospectName: name, prospectEmail: email, firm: firmKey, startedAt: new Date().toISOString(), status: "starting",
    });
    // Share-link calls run in parallel and never occupy the console's single "active" slot.
    if (!isPublic) await A.setActiveId(convo.conversation_id);
    await A.feed({
      type: "system",
      title: isPublic ? `${name} started a ${firm.label} call from the share link` : inZoom ? `${firm.label} avatar is joining the meeting` : `${firm.label} room is ready`,
      detail: inZoom ? meetingUrl : isPublic ? email : "Standalone call opened in the browser",
      conversationId: convo.conversation_id,
    });
    return { conversationId: convo.conversation_id, conversationUrl: inZoom ? null : convo.conversation_url, dealId: deal.id };
  } catch (e) {
    await A.feed({ type: "error", title: "Could not start conversation", detail: e.message });
    throw e;
  }
}

async function start(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const { meetingUrl, firstname, lastname = "", email, firm: firmKey = "apex", mode = "room" } = req.body || {};
  const firm = A.FIRMS[firmKey];
  if (!firm) { res.status(400).json({ error: `Unknown firm "${firmKey}"` }); return; }
  if (!firm.palId) { res.status(500).json({ error: `No avatar configured for ${firm.label}` }); return; }
  if (mode === "zoom" && (!meetingUrl || !MEETING_RE.test(meetingUrl))) { res.status(400).json({ error: "Paste a Zoom, Google Meet or Teams link" }); return; }
  if (!firstname || !email) { res.status(400).json({ error: "Prospect first name and email are required" }); return; }
  if (await A.getActiveId()) { res.status(409).json({ error: "A call is already live. End it first." }); return; }
  try {
    res.status(200).json(await launch(req, { firmKey, mode, meetingUrl, firstname, lastname, email, isPublic: false }));
  } catch (e) {
    res.status(502).json({ error: e.message });
  }
}

// ---- public share link (/meet/:firm) ----------------------------------------
// Anyone with the link can start a call, so it's capped: per-IP per hour and an
// account-wide daily ceiling (APEX_PUBLIC_DAILY_CAP, default 40).

const EMAIL_RE = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;
const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();

async function publicInfo(req, res) {
  const firm = A.FIRMS[String(req.query?.firm || "")];
  if (!firm || !firm.palId) { res.status(404).json({ error: "This link isn't active." }); return; }
  res.status(200).json({ label: firm.label, minutes: req.query.firm === "optimize" ? "35-45" : "20-30" });
}

async function publicStart(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const { firm: firmKey, firstname = "", lastname = "", email = "" } = req.body || {};
  const firm = A.FIRMS[firmKey];
  if (!firm || !firm.palId) { res.status(404).json({ error: "This link isn't active." }); return; }
  const first = String(firstname).trim().slice(0, 60), last = String(lastname).trim().slice(0, 60), mail = String(email).trim().slice(0, 120);
  if (!first || !EMAIL_RE.test(mail)) { res.status(400).json({ error: "Please enter your first name and a valid email." }); return; }

  const hour = new Date().toISOString().slice(0, 13), day = hour.slice(0, 10);
  if ((await A.incr(`apex:rl:ip:${clientIp(req)}:${hour}`, 3600)) > 4) { res.status(429).json({ error: "Too many calls from this network in the last hour. Please try again later." }); return; }
  if ((await A.incr(`apex:rl:day:${day}`, 86400)) > Number(process.env.APEX_PUBLIC_DAILY_CAP || 40)) { res.status(429).json({ error: "This demo has reached today's limit. Please try again tomorrow." }); return; }

  try {
    const out = await launch(req, { firmKey, mode: "room", firstname: first, lastname: last, email: mail, isPublic: true });
    res.status(200).json({ conversationId: out.conversationId, conversationUrl: out.conversationUrl });
  } catch (e) {
    res.status(502).json({ error: "Couldn't start the call. Please try again in a minute." });
  }
}

async function publicEnd(req, res) {
  const id = String(req.body?.conversationId || "");
  const s = await A.getSession(id);
  if (s?.public && s.status !== "ended") {
    try { await A.endConversation(id); } catch { /* participant_left_timeout ends it anyway */ }
    await A.saveSession({ ...s, status: "ended" });
    await A.feed({ type: "system", title: `${s.prospectName} left the share-link call`, conversationId: id });
  }
  res.status(200).json({ ok: true });
}

async function end(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const id = await A.getActiveId();
  if (id) {
    try { await A.endConversation(id); } catch (e) { await A.feed({ type: "error", title: "End call failed at Tavus", detail: e.message, conversationId: id }); }
    const s = await A.getSession(id);
    if (s) await A.saveSession({ ...s, status: "ended" });
    await A.setActiveId(null);
    await A.feed({ type: "system", title: "Conversation ended from the console", conversationId: id });
  }
  res.status(200).json({ ok: true });
}

async function reset(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  if (await A.getActiveId()) { res.status(409).json({ error: "End the live call before resetting." }); return; }
  await A.resetAndSeed();
  res.status(200).json({ ok: true });
}

// ---- Tavus → us -------------------------------------------------------------

async function tool(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const raw = await rawBody(req);
  const sig = A.signatureOk(raw, req.headers["x-tavus-signature"]);
  if (sig === false) { res.status(401).send("bad signature"); return; }

  let body;
  try { body = JSON.parse(raw); } catch { res.status(400).send("bad json"); return; }
  let args = {};
  try { args = body.arguments ? JSON.parse(body.arguments) : {}; } catch { /* keep empty */ }

  // Only conversations this console started can write to the CRM.
  const session = await A.getSession(String(body.conversation_id || ""));
  if (!session) {
    // Not a console-started call (e.g. a Tavus text-chat test): stay in character, write nothing.
    text(res, A.GUIDE[body.name] || "Booked. Confirm the day, time and time zone back to the prospect and say a calendar invite will follow by email.");
    return;
  }

  if (!(await A.setOnce(`apex:toolcall:${body.tool_call_id}`))) { text(res, "Already handled."); return; }

  try {
    text(res, await A.runTool(body.name, args, session, String(body.tool_call_id)));
  } catch (e) {
    await A.feed({ type: "error", title: `Tool ${body.name} failed`, detail: e.message, conversationId: session.conversationId });
    // 200 with guidance (not 5xx) so the avatar recovers gracefully instead of stalling.
    text(res, `That didn't go through (${e.message}). Apologize briefly and offer to have an advisor confirm by email.`);
  }
}

async function webhook(req, res) {
  const data = req.body || {};
  const id = String(data.conversation_id || "");
  const s = await A.getSession(id);
  if (!s) { res.status(200).json({ ok: true }); return; } // not ours — ignore quietly

  switch (data.event_type) {
    case "system.pal_joined":
    case "system.replica_joined":
      await A.saveSession({ ...s, status: "live" });
      await A.feed({ type: "tavus", title: "Apex joined the meeting", conversationId: id });
      break;
    case "system.shutdown":
      await A.saveSession({ ...s, status: "ended" });
      if ((await A.getActiveId()) === id) await A.setActiveId(null);
      await A.feed({ type: "tavus", title: "Call ended", detail: String(data.properties?.shutdown_reason ?? ""), conversationId: id });
      break;
    case "application.transcription_ready": {
      const t = data.properties?.transcript ?? [];
      await A.feed({ type: "tavus", title: "Transcript ready", detail: `${t.filter((m) => m.role !== "system").length} turns`, conversationId: id });
      break;
    }
    default:
      if (data.event_type) {
        const guard = String(data.event_type).includes("guardrail");
        await A.feed({ type: guard ? "error" : "tavus", title: guard ? "Guardrail flagged a response" : data.event_type, detail: guard ? JSON.stringify(data.properties ?? {}) : undefined, conversationId: id });
      }
  }
  res.status(200).json({ ok: true });
}

// ---- Google Calendar connect ------------------------------------------------

async function googleAuth(req, res) {
  if (!A.googleConfigured()) { res.status(500).send("Add GOOGLE_CLIENT_ID and GOOGLE_CLIENT_SECRET to the Vercel project first."); return; }
  const state = A.newId("st");
  await A.setJSON(`apex:google:state:${state}`, 1);
  res.redirect(302, A.googleAuthUrl(origin(req), state));
}

async function googleCallback(req, res) {
  const { code, state, error } = req.query || {};
  if (!code) { res.status(400).send(`Google sign-in failed: ${error || "no code"}`); return; }
  const key = `apex:google:state:${state}`;
  if (!state || !(await A.getJSON(key))) { res.status(400).send("Sign-in link expired. Go back to /apex and click Connect again."); return; }
  await A.del(key);
  await A.googleExchange(String(code), origin(req));
  res.redirect(302, "/apex?google=connected");
}
