import { kvAvailable, kvGet, kvIncr, kvSetEx } from "./_kv.js";

/* MoneyMaya "Maya" demo (/maya). Public: a visitor presses Start and we create
   a Tavus conversation server-side with the team's TAVUS_API_KEY. The page
   streams form events into the call itself, so this endpoint only starts and
   ends conversations. Capped per network per hour and per day account-wide
   (MAYA_DAILY_CAP, default 40) because anyone with the link can start one.

   ?op=start  POST           → { conversationId, conversationUrl }
   ?op=end    POST {conversationId} → ends a conversation this endpoint started */

const TAVUS = "https://tavusapi.com/v2";
const PAL_ID = () => process.env.MAYA_PAL_ID || "peb9b600328c";
const PER_IP_PER_HOUR = 6;
const MAX_CALL_SECONDS = 900;

const clientIp = (req) => String(req.headers["x-forwarded-for"] || req.socket?.remoteAddress || "unknown").split(",")[0].trim();
const tavusHeaders = () => ({ "x-api-key": process.env.TAVUS_API_KEY, "Content-Type": "application/json" });

// Mirrors the "How You See the Form" section of the PAL's prompt; kept short
// because the PAL already carries the full instructions.
const CONTEXT =
  "You are embedded beside the MoneyMaya debt relief application on this page. " +
  "Messages that start with [FORM EVENT] come from the form the instant something changes; they are the ground truth, " +
  "so never ask the visitor to share their screen and never read those messages aloud. Your greeting already played; don't re-introduce yourself.";

export default async function handler(req, res) {
  if (req.method !== "POST") { res.status(405).json({ error: "POST only" }); return; }
  const op = String(req.query?.op || "");
  if (!process.env.TAVUS_API_KEY) {
    res.status(500).json({ error: "TAVUS_API_KEY is not set on the server. Add it in the Vercel project's environment variables." });
    return;
  }
  if (!kvAvailable()) { res.status(500).json({ error: "Redis isn't set up on the server, so the demo can't rate-limit calls." }); return; }

  try {
    if (op === "start") return await start(req, res);
    if (op === "end") return await end(req, res);
    res.status(400).json({ error: "Unknown op." });
  } catch (e) {
    res.status(502).json({ error: "Couldn't reach Tavus. Please try again in a minute." });
  }
}

async function start(req, res) {
  const hour = new Date().toISOString().slice(0, 13), day = hour.slice(0, 10);
  if ((await kvIncr(`maya:rl:ip:${clientIp(req)}:${hour}`, 3600)) > PER_IP_PER_HOUR) {
    res.status(429).json({ error: "Too many calls from this network in the last hour. Please try again later." });
    return;
  }
  if ((await kvIncr(`maya:rl:day:${day}`, 86400)) > Number(process.env.MAYA_DAILY_CAP || 40)) {
    res.status(429).json({ error: "This demo has reached today's limit. Please try again tomorrow." });
    return;
  }

  const r = await fetch(`${TAVUS}/conversations`, {
    method: "POST",
    headers: tavusHeaders(),
    body: JSON.stringify({
      pal_id: PAL_ID(),
      ...(process.env.MAYA_FACE_ID ? { face_id: process.env.MAYA_FACE_ID } : {}),
      conversation_name: "MoneyMaya demo (Maya)",
      conversational_context: CONTEXT,
      properties: { max_call_duration: MAX_CALL_SECONDS, participant_left_timeout: 30 },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || !j.conversation_url) {
    res.status(502).json({ error: "Couldn't start the call. Please try again in a minute." });
    return;
  }
  await kvSetEx(`maya:conv:${j.conversation_id}`, { startedAt: Date.now() }, MAX_CALL_SECONDS + 600);
  res.status(200).json({ conversationId: j.conversation_id, conversationUrl: j.conversation_url });
}

async function end(req, res) {
  const id = String(req.body?.conversationId || "");
  // Only conversations this endpoint started; anything else is a no-op.
  if (/^[a-z0-9]{6,40}$/i.test(id) && (await kvGet(`maya:conv:${id}`))) {
    await fetch(`${TAVUS}/conversations/${id}/end`, { method: "POST", headers: tavusHeaders() }).catch(() => {});
  }
  res.status(200).json({ ok: true });
}
