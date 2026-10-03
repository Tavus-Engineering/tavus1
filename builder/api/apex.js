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

const PAL_ID = process.env.APEX_PAL_ID || "p6e28aea25fd";
const FACE_ID = process.env.APEX_FACE_ID || "re3fd4adeafd";
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
      palId: PAL_ID,
    },
  });
}

async function start(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const { meetingUrl, firstname, lastname = "", email } = req.body || {};
  if (!meetingUrl || !MEETING_RE.test(meetingUrl)) { res.status(400).json({ error: "Paste a Zoom, Google Meet or Teams link" }); return; }
  if (!firstname || !email) { res.status(400).json({ error: "Prospect first name and email are required" }); return; }
  if (await A.getActiveId()) { res.status(409).json({ error: "A call is already live. End it first." }); return; }

  await A.ensureSeeded();
  const { contact, deal } = await A.createProspect({ firstname, lastname, email });
  const name = `${firstname} ${lastname}`.trim();
  try {
    const convo = await A.createConversation({
      pal_id: PAL_ID,
      face_id: FACE_ID,
      meeting_url: meetingUrl,
      conversation_name: `Apex discovery - ${name}`,
      callback_url: `${origin(req)}/api/apex?op=webhook`,
      custom_greeting:
        `Hi ${firstname}, great to meet you! I'm the Apex Portfolio Manager here at Apex Wealth Advisory. ` +
        `Thanks so much for making the time today. How's your day going so far?`,
      conversational_context:
        `Today is ${A.todayLabel()} (Eastern Time). The prospect on this call is ${name}, email ${email}. ` +
        `A deal already exists in the CRM for them at stage "Discovery Call Scheduled". Your greeting already played; don't re-introduce yourself.`,
      properties: { max_call_duration: 2700, participant_left_timeout: 60 },
    });
    await A.saveSession({
      conversationId: convo.conversation_id, meetingUrl, dealId: deal.id, contactId: contact.id,
      prospectName: name, prospectEmail: email, startedAt: new Date().toISOString(), status: "starting",
    });
    await A.setActiveId(convo.conversation_id);
    await A.feed({ type: "system", title: "Apex is joining the meeting", detail: meetingUrl, conversationId: convo.conversation_id });
    res.status(200).json({ conversationId: convo.conversation_id, dealId: deal.id });
  } catch (e) {
    await A.feed({ type: "error", title: "Could not start conversation", detail: e.message });
    res.status(502).json({ error: e.message });
  }
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
  if (!session) { text(res, "No CRM record is linked to this call, so nothing was saved. Continue the conversation normally."); return; }

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
