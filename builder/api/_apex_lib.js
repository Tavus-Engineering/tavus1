/* Apex Wealth demo — shared server logic for api/apex.js.
   A Tavus PAL ("Apex Portfolio Manager") joins a live Zoom call, and its
   tool calls land here: objections, discovery answers, booking (Google
   Calendar), deal-stage change, advisor handoff — all written to a small
   HubSpot-shaped CRM sandbox in Redis. Everything lives under `apex:` keys,
   so it can never touch the builder's own data.
   Underscore prefix keeps Vercel from deploying this file as a function. */

import crypto from "node:crypto";

// ---- storage ----------------------------------------------------------------
// Upstash REST when attached (production), in-process Map otherwise (local dev).

const base = process.env.KV_REST_API_URL || process.env.UPSTASH_REDIS_REST_URL || "";
const token = process.env.KV_REST_API_TOKEN || process.env.UPSTASH_REDIS_REST_TOKEN || "";
export const storeMode = base && token ? "redis" : "memory";
const mem = (globalThis.__apexMem ??= new Map());

async function redis(cmd) {
  const r = await fetch(base, {
    method: "POST",
    headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
    body: JSON.stringify(cmd),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok || j.error) throw new Error(j.error || `storage error (${r.status})`);
  return j.result;
}

export async function getJSON(key) {
  if (storeMode === "memory") return mem.has(key) ? structuredClone(mem.get(key)) : null;
  const raw = await redis(["GET", key]);
  return raw == null ? null : JSON.parse(raw);
}
export async function setJSON(key, value) {
  if (storeMode === "memory") return void mem.set(key, structuredClone(value));
  await redis(["SET", key, JSON.stringify(value)]);
}
export async function del(...keys) {
  if (!keys.length) return;
  if (storeMode === "memory") return void keys.forEach((k) => mem.delete(k));
  await redis(["DEL", ...keys]);
}
/* Append-only lists: atomic in Redis, so concurrent tool calls can't clobber each other. */
export async function push(key, value) {
  if (storeMode === "memory") {
    const arr = mem.get(key) ?? [];
    arr.push(structuredClone(value));
    return void mem.set(key, arr);
  }
  await redis(["RPUSH", key, JSON.stringify(value)]);
}
export async function list(key) {
  if (storeMode === "memory") return structuredClone(mem.get(key) ?? []);
  return ((await redis(["LRANGE", key, "0", "-1"])) || []).map((s) => JSON.parse(s));
}
/* True only the first time — idempotency for Tavus's one retry on 5xx. */
export async function setOnce(key, ttl = 86400) {
  if (storeMode === "memory") {
    if (mem.has(key)) return false;
    mem.set(key, 1);
    return true;
  }
  return (await redis(["SET", key, "1", "NX", "EX", String(ttl)])) === "OK";
}
async function scanKeys(match) {
  if (storeMode === "memory") {
    const re = new RegExp("^" + match.split("*").map((s) => s.replace(/[.+?^${}()|[\]\\]/g, "\\$&")).join(".*") + "$");
    return [...mem.keys()].filter((k) => re.test(k));
  }
  let cursor = "0";
  const out = [];
  for (let i = 0; i < 50; i++) {
    const [next, chunk] = await redis(["SCAN", cursor, "MATCH", match, "COUNT", "500"]);
    out.push(...(chunk || []));
    cursor = String(next);
    if (cursor === "0") break;
  }
  return out;
}

// ---- dates (server-side so the LLM never computes calendar dates) ----------

export const DEFAULT_TZ = "America/New_York";
const WEEKDAYS = ["sunday", "monday", "tuesday", "wednesday", "thursday", "friday", "saturday"];

export function zonedParts(date, tz) {
  const f = new Intl.DateTimeFormat("en-US", {
    timeZone: tz, year: "numeric", month: "2-digit", day: "2-digit",
    hour: "2-digit", minute: "2-digit", weekday: "long", hourCycle: "h23",
  });
  const p = Object.fromEntries(f.formatToParts(date).map((x) => [x.type, x.value]));
  return { year: +p.year, month: +p.month, day: +p.day, hour: +p.hour, minute: +p.minute, weekday: WEEKDAYS.indexOf(String(p.weekday).toLowerCase()) };
}

/* Wall-clock time in tz -> UTC Date. */
export function zonedToUtc(y, m, d, h, min, tz) {
  const target = Date.UTC(y, m - 1, d, h, min);
  let guess = target;
  for (let i = 0; i < 3; i++) {
    const p = zonedParts(new Date(guess), tz);
    guess += target - Date.UTC(p.year, p.month - 1, p.day, p.hour, p.minute);
  }
  return new Date(guess);
}

export function parseTime(t) {
  const m = String(t).trim().toLowerCase().replace(/\s+/g, "").replace(/\./g, "").match(/^(\d{1,2})(?::?(\d{2}))?(am|pm)?$/);
  if (!m) return null;
  let hour = +m[1];
  const minute = m[2] ? +m[2] : 0;
  if (m[3] === "pm" && hour < 12) hour += 12;
  if (m[3] === "am" && hour === 12) hour = 0;
  if (hour > 23 || minute > 59) return null;
  return { hour, minute };
}

/* Explicit YYYY-MM-DD wins; else the next occurrence of `weekday` strictly after today (in tz). */
export function resolveSlot({ date, weekday, time, tz = DEFAULT_TZ, now = new Date() }) {
  const t = parseTime(time);
  if (!t) throw new Error(`Could not understand time "${time}"`);
  let y, m, d;
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    [y, m, d] = date.split("-").map(Number);
  } else if (weekday) {
    const want = WEEKDAYS.indexOf(String(weekday).trim().toLowerCase().replace(/^(next|this)\s+/, ""));
    if (want < 0) throw new Error(`Could not understand weekday "${weekday}"`);
    const today = zonedParts(now, tz);
    let delta = (want - today.weekday + 7) % 7;
    if (delta === 0) delta = 7;
    const b = new Date(Date.UTC(today.year, today.month - 1, today.day + delta));
    [y, m, d] = [b.getUTCFullYear(), b.getUTCMonth() + 1, b.getUTCDate()];
  } else {
    throw new Error("Need a date or weekday");
  }
  const start = zonedToUtc(y, m, d, t.hour, t.minute, tz);
  return { start, tz, label: formatSlot(start, tz) };
}

export const formatSlot = (date, tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", month: "long", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" }).format(date);

export const todayLabel = (tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());

// ---- CRM sandbox (modeled on HubSpot contacts / deals / engagements) -------
// Deal writes are append-only patches + activity lists, so parallel tool calls
// during a live call never overwrite each other.

export const STAGES = [
  { id: "discovery_scheduled", label: "Discovery Call Scheduled" },
  { id: "discovery_completed", label: "Discovery Call Completed" },
  { id: "portfolio_design", label: "Portfolio Design Presented" },
  { id: "onboarding", label: "Implementation & Onboarding" },
  { id: "closed_won", label: "Closed Won" },
  { id: "closed_lost", label: "Closed Lost" },
];

const K = {
  contact: (id) => `apex:crm:contact:${id}`,
  deal: (id) => `apex:crm:deal:${id}`,
  patches: (id) => `apex:crm:deal:${id}:patches`,
  activity: (id) => `apex:crm:deal:${id}:activity`,
  dealIndex: "apex:crm:deals",
};

export const newId = (p) => `${p}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
const now = () => new Date().toISOString();

export const categoryLabel = (c) =>
  ({ fees: "Fee concern", guaranteed_returns: "Guaranteed returns", recession_risk: "Recession risk", account_setup: "Account setup timing", other: "Other" })[c] ?? c;

export async function getDeal(id) {
  const b = await getJSON(K.deal(id));
  if (!b) return null;
  const patches = await list(K.patches(id));
  return patches.reduce((d, p) => ({ ...d, stage: p.stage ?? d.stage, props: { ...d.props, ...(p.props ?? {}) }, updatedAt: p.at }), b);
}
export async function listDeals() {
  const ids = (await getJSON(K.dealIndex)) ?? [];
  return (await Promise.all(ids.map(getDeal))).filter(Boolean);
}
export const getContact = (id) => getJSON(K.contact(id));
export const getActivity = (dealId) => list(K.activity(dealId));
const addActivity = (dealId, a) => push(K.activity(dealId), a);

export async function moveStage(dealId, to, source = "ai") {
  const deal = await getDeal(dealId);
  if (!deal) throw new Error(`Deal ${dealId} not found`);
  if (deal.stage === to) return;
  await push(K.patches(dealId), { at: now(), stage: to });
  await addActivity(dealId, { kind: "stage", id: newId("act"), at: now(), source, from: deal.stage, to });
}

export async function updateProps(dealId, props, source = "ai") {
  const clean = Object.fromEntries(Object.entries(props).filter(([, v]) => typeof v === "string" && v.trim()));
  if (!Object.keys(clean).length) return;
  await push(K.patches(dealId), { at: now(), props: clean });
  await addActivity(dealId, { kind: "property", id: newId("act"), at: now(), source, changed: Object.keys(clean) });
}

export async function logObjection(dealId, category, detail, source = "ai") {
  await addActivity(dealId, { kind: "objection", id: newId("obj"), at: now(), source, category, detail });
  // Roll every objection so far into the custom "Client Objections" property.
  const rollup = (await getActivity(dealId)).filter((a) => a.kind === "objection").map((o) => `• [${categoryLabel(o.category)}] ${o.detail}`).join("\n");
  await push(K.patches(dealId), { at: now(), props: { client_objections: rollup } });
}

export const addNote = (dealId, title, body, tags = [], source = "ai") =>
  addActivity(dealId, { kind: "note", id: newId("note"), at: now(), source, title, body, tags });
export const addTask = (dealId, title, body, dueAt, source = "ai") =>
  addActivity(dealId, { kind: "task", id: newId("task"), at: now(), source, title, body, dueAt, status: "open" });
export const addMeeting = (dealId, m, source = "ai") =>
  addActivity(dealId, { kind: "meeting", id: newId("mtg"), at: now(), source, ...m });

export async function createProspect({ firstname, lastname = "", email, amount = 250000 }) {
  const contact = { id: newId("ct"), firstname, lastname, email };
  const deal = {
    id: newId("deal"),
    name: `${`${firstname} ${lastname}`.trim()} - Premier Growth Portfolio`,
    contactId: contact.id, amount, stage: "discovery_scheduled", product: "Premier Growth Portfolio",
    owner: "Apex Portfolio Manager (AI)", createdAt: now(), updatedAt: now(), props: {},
  };
  await setJSON(K.contact(contact.id), contact);
  await setJSON(K.deal(deal.id), deal);
  await setJSON(K.dealIndex, [deal.id, ...((await getJSON(K.dealIndex)) ?? [])]);
  await addNote(deal.id, "Deal created", "Inbound lead booked a Discovery & Financial Goal Mapping call.", [], "system");
  return { contact, deal };
}

const SEED = [
  ["Priya", "Raman", "priya.raman@example.com", 400000, "portfolio_design", "Wants to consolidate two 401(k)s. Moderate risk."],
  ["Marcus", "Hale", "marcus.hale@example.com", 150000, "discovery_completed", "Saving for a home in 3 years plus long-term growth."],
  ["Elena", "Ortiz", "elena.ortiz@example.com", 1200000, "onboarding", "Recently sold a business. Compliance docs in review."],
  ["David", "Kim", "david.kim@example.com", 75000, "discovery_scheduled", "Referred by Priya Raman."],
  ["Sarah", "Whitfield", "sarah.whitfield@example.com", 600000, "closed_won", "Funded Premier Growth Portfolio."],
  ["Tom", "Becker", "tom.becker@example.com", 90000, "closed_lost", "Chose a robo-advisor on fees."],
];

/* Wipes ONLY apex:* keys (CRM, sessions, feed, tool-call ids) — never builder data. */
export async function resetAndSeed() {
  const keys = (await scanKeys("apex:*")).filter((k) => k !== GOOGLE_TOKEN_KEY);
  for (let i = 0; i < keys.length; i += 200) await del(...keys.slice(i, i + 200));
  for (const [f, l, e, amt, stage, note] of SEED) {
    const { deal } = await createProspect({ firstname: f, lastname: l, email: e, amount: amt });
    if (stage !== "discovery_scheduled") await moveStage(deal.id, stage, "seed");
    await addNote(deal.id, "Advisor note", note, [], "seed");
  }
}
export async function ensureSeeded() {
  if (!(await getJSON(K.dealIndex))) await resetAndSeed();
}

// ---- live-call bookkeeping ---------------------------------------------------

export const getSession = (id) => (id ? getJSON(`apex:conv:${id}`) : null);
export const saveSession = (s) => setJSON(`apex:conv:${s.conversationId}`, s);
export const getActiveId = () => getJSON("apex:active");
export const setActiveId = (id) => (id ? setJSON("apex:active", id) : del("apex:active"));
export const feed = (e) => push("apex:feed", { ...e, at: now() });
export const getFeed = () => list("apex:feed");

// ---- Tavus ------------------------------------------------------------------

const TAVUS = "https://tavusapi.com/v2";
const tavusHeaders = () => {
  if (!process.env.TAVUS_API_KEY) throw new Error("TAVUS_API_KEY is not set on this Vercel project");
  return { "x-api-key": process.env.TAVUS_API_KEY, "Content-Type": "application/json" };
};
export async function createConversation(body) {
  const r = await fetch(`${TAVUS}/conversations`, { method: "POST", headers: tavusHeaders(), body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Tavus create conversation failed (${r.status}): ${JSON.stringify(j)}`);
  return j;
}
export async function endConversation(id) {
  const r = await fetch(`${TAVUS}/conversations/${id}/end`, { method: "POST", headers: tavusHeaders() });
  if (!r.ok && r.status !== 404) throw new Error(`Tavus end conversation failed (${r.status}): ${await r.text()}`);
}

/* Tavus signs the exact body bytes (canonical JSON, sorted keys) with the tool's HMAC secret. */
export function signatureOk(raw, received) {
  const secret = process.env.APEX_TOOL_SECRET || process.env.TAVUS_TOOL_SECRET;
  if (!secret) return null; // not configured — caller falls back to the known-conversation check
  const expected = crypto.createHmac("sha256", secret).update(raw).digest("hex");
  const a = Buffer.from(String(received || ""));
  const b = Buffer.from(expected);
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

// ---- Google Calendar (one-time OAuth consent; refresh token kept in Redis) ---

const GOOGLE_TOKEN_KEY = "apex:google:refresh_token";
export const googleConfigured = () => !!(process.env.GOOGLE_CLIENT_ID && process.env.GOOGLE_CLIENT_SECRET);
export const googleRedirect = (origin) => `${origin}/api/apex?op=google_callback`;

export function googleAuthUrl(origin, state) {
  return "https://accounts.google.com/o/oauth2/v2/auth?" + new URLSearchParams({
    client_id: process.env.GOOGLE_CLIENT_ID, redirect_uri: googleRedirect(origin), response_type: "code",
    scope: "https://www.googleapis.com/auth/calendar.events", access_type: "offline", prompt: "consent", state,
  });
}

async function googleToken(params) {
  const r = await fetch("https://oauth2.googleapis.com/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ client_id: process.env.GOOGLE_CLIENT_ID, client_secret: process.env.GOOGLE_CLIENT_SECRET, ...params }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Google token error: ${JSON.stringify(j)}`);
  return j;
}

export async function googleExchange(code, origin) {
  const j = await googleToken({ code, redirect_uri: googleRedirect(origin), grant_type: "authorization_code" });
  if (!j.refresh_token) throw new Error("Google returned no refresh token — remove the app at myaccount.google.com/permissions and connect again.");
  await setJSON(GOOGLE_TOKEN_KEY, j.refresh_token);
}

const refreshToken = async () => process.env.GOOGLE_REFRESH_TOKEN || (await getJSON(GOOGLE_TOKEN_KEY));
export const googleConnected = async () => googleConfigured() && !!(await refreshToken());

export async function createCalendarEvent({ summary, description, start, end, tz, attendees, requestId }) {
  const rt = await refreshToken();
  if (!googleConfigured() || !rt) throw new Error("Google Calendar is not connected");
  const { access_token } = await googleToken({ refresh_token: rt, grant_type: "refresh_token" });
  const cal = encodeURIComponent(process.env.GOOGLE_CALENDAR_ID || "primary");
  const r = await fetch(`https://www.googleapis.com/calendar/v3/calendars/${cal}/events?sendUpdates=all&conferenceDataVersion=1`, {
    method: "POST",
    headers: { Authorization: `Bearer ${access_token}`, "Content-Type": "application/json" },
    body: JSON.stringify({
      summary, description,
      start: { dateTime: start.toISOString(), timeZone: tz },
      end: { dateTime: end.toISOString(), timeZone: tz },
      attendees: attendees.map((email) => ({ email })),
      reminders: { useDefault: true },
      conferenceData: { createRequest: { requestId, conferenceSolutionKey: { type: "hangoutsMeet" } } },
    }),
  });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Calendar insert failed: ${JSON.stringify(j.error ?? j)}`);
  return { htmlLink: j.htmlLink, meetLink: j.hangoutLink };
}

// ---- tool handlers (what the avatar does mid-call) --------------------------

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

export async function runTool(name, args, s, toolCallId) {
  switch (name) {
    case "log_objection": {
      const category = str(args.category) || "other";
      const detail = str(args.detail) || "(no detail captured)";
      await logObjection(s.dealId, category, detail);
      await feed({ type: "tool", title: `Objection logged: ${categoryLabel(category)}`, detail, conversationId: s.conversationId });
      return "Objection logged to CRM.";
    }

    case "record_discovery_answers": {
      const props = {
        financial_goals: str(args.financial_goals), goal_timeline: str(args.goal_timeline),
        investable_assets: str(args.investable_assets), risk_tolerance: str(args.risk_tolerance),
        current_accounts: str(args.current_accounts), retirement_plans: str(args.retirement_plans),
      };
      await updateProps(s.dealId, props);
      const filled = Object.entries(props).filter(([, v]) => v);
      await feed({ type: "tool", title: `Discovery answers saved (${filled.length}/6)`, detail: filled.map(([k, v]) => `${k}: ${v}`).join("\n"), conversationId: s.conversationId });
      return "Discovery answers saved.";
    }

    case "book_next_meeting": {
      const tz = str(args.timezone) || DEFAULT_TZ;
      const slot = resolveSlot({ date: str(args.date), weekday: str(args.weekday), time: str(args.time) || "15:00", tz });
      const end = new Date(slot.start.getTime() + 45 * 60_000);
      const attendee = s.prospectEmail;
      const title = "Apex Wealth Advisory - Portfolio Design & Risk Assessment Presentation";
      let calendarLink, meetLink;
      let inviteLine = `The meeting is on the books; a calendar invite will follow by email to ${attendee}.`;

      if (await googleConnected()) {
        try {
          const ev = await createCalendarEvent({
            summary: title,
            description:
              "Meeting 2 of 3 with Apex Portfolio Manager.\n\n" +
              "We'll walk through a proposed Premier Growth Portfolio allocation and risk assessment based on the goals you shared on your discovery call.\n\n" +
              "Past performance (8-10% historical returns) does not guarantee future results.",
            start: slot.start, end, tz, attendees: [attendee], requestId: toolCallId,
          });
          calendarLink = ev.htmlLink;
          meetLink = ev.meetLink;
          inviteLine = `A Google Calendar invite was sent to ${attendee}.`;
        } catch (e) {
          await feed({ type: "error", title: "Calendar invite failed", detail: String(e.message || e), conversationId: s.conversationId });
        }
      } else {
        await feed({ type: "error", title: "Google Calendar not connected", detail: "Click Connect under Setup checks.", conversationId: s.conversationId });
      }

      await addMeeting(s.dealId, { title, startAt: slot.start.toISOString(), endAt: end.toISOString(), attendees: [attendee], calendarLink, meetLink });
      await addTask(
        s.dealId,
        "Follow-up: Portfolio Design & Risk Assessment Presentation",
        `Present a proposed allocation for ${s.prospectName} based on discovery answers. Address logged objections (fees, guarantees, recession risk).`,
        slot.start.toISOString(),
      );
      await feed({ type: "tool", title: `Meeting booked: ${slot.label}`, detail: `${inviteLine} Follow-up task created.`, conversationId: s.conversationId });
      return `Booked for ${slot.label}. ${inviteLine} Confirm the day, time and time zone back to the prospect, and tell them you look forward to seeing them then.`;
    }

    case "complete_discovery_call": {
      const summary = str(args.summary);
      await moveStage(s.dealId, "discovery_completed");
      if (summary) await updateProps(s.dealId, { discovery_summary: summary });
      const deal = await getDeal(s.dealId);
      await addNote(
        s.dealId, "Discovery Call Summary",
        [summary, deal?.props.client_objections ? `\nClient objections:\n${deal.props.client_objections}` : ""].join("\n").trim(),
        ["discovery", "ai-call"],
      );
      await feed({ type: "tool", title: 'Deal moved to "Discovery Call Completed"', detail: summary, conversationId: s.conversationId });
      return "Deal stage updated.";
    }

    case "request_advisor_handoff": {
      const reason = str(args.reason) || "Prospect asked to speak with a person.";
      const t = zonedParts(new Date(Date.now() + 86400_000), DEFAULT_TZ);
      const due = zonedToUtc(t.year, t.month, t.day, 10, 0, DEFAULT_TZ);
      await addTask(s.dealId, "Human advisor follow-up requested", reason, due.toISOString());
      await addNote(s.dealId, "Advisor handoff requested", reason, ["handoff"]);
      await feed({ type: "tool", title: "Advisor handoff requested", detail: reason, conversationId: s.conversationId });
      return "A licensed advisor follow-up task was created for tomorrow morning.";
    }

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}
