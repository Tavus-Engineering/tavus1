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
/* Counter with TTL on first touch — rate limits for the public share link. */
export async function incr(key, ttl) {
  if (storeMode === "memory") {
    const n = (mem.get(key) || 0) + 1;
    mem.set(key, n);
    return n;
  }
  const n = await redis(["INCR", key]);
  if (n === 1) await redis(["EXPIRE", key, String(ttl)]);
  return n;
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

export const nowTimeLabel = (tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }).format(new Date());

export const todayLabel = (tz = DEFAULT_TZ) =>
  new Intl.DateTimeFormat("en-US", { timeZone: tz, weekday: "long", year: "numeric", month: "long", day: "numeric" }).format(new Date());

// ---- firms --------------------------------------------------------------------
// Two avatars share this console + CRM: the Apex discovery call (scored demo) and
// the Optimize brochure walkthrough + full initial-meeting script.

export const FIRMS = {
  apex: {
    label: "Apex Wealth Advisory",
    palId: process.env.APEX_PAL_ID || "p6e28aea25fd",
    faceId: process.env.APEX_FACE_ID || "re3fd4adeafd",
    product: "Premier Growth Portfolio",
    greeting: (first) =>
      `Hi ${first}, great to meet you! I'm the Apex Portfolio Manager here at Apex Wealth Advisory. ` +
      `Thanks so much for making the time today. How's your day going so far?`,
    meetingTitle: "Apex Wealth Advisory - Portfolio Design & Risk Assessment Presentation",
    meetingDesc:
      "Meeting 2 of 3 with Apex Portfolio Manager.\n\n" +
      "We'll walk through a proposed Premier Growth Portfolio allocation and risk assessment based on the goals you shared on your discovery call.\n\n" +
      "Past performance (8-10% historical returns) does not guarantee future results.",
    minutes: 45,
    taskTitle: "Follow-up: Portfolio Design & Risk Assessment Presentation",
    taskBody: (name) => `Present a proposed allocation for ${name} based on discovery answers. Address logged objections (fees, guarantees, recession risk).`,
  },
  optimize: {
    label: "Optimize Wealth Management",
    palId: process.env.OPTIMIZE_PAL_ID || "pb40abfd8546",
    faceId: process.env.OPTIMIZE_FACE_ID || "re3fd4adeafd",
    product: "Optimize Private Client - Comprehensive Financial Plan",
    greeting: (first) =>
      `Hi ${first}, it's Victor from Optimize Wealth Management. Great to meet you, and thanks for making the time today. How's your week going so far?`,
    meetingTitle: "Optimize Wealth Management - Comprehensive Financial Plan & Investment Strategy Review",
    meetingDesc:
      "Follow-up meeting with your Optimize Senior Portfolio Manager.\n\n" +
      "We'll walk through your Comprehensive Financial Plan and our recommended initial investment strategy, based on the goals you shared in our first meeting.\n\n" +
      "Past performance is not indicative of future results.",
    minutes: 60,
    taskTitle: "Follow-up: Comprehensive Financial Plan & Investment Strategy Review",
    taskBody: (name) => `Build ${name}'s Comprehensive Financial Plan and initial investment strategy from the discovery profile, and present it at this meeting.`,
  },
  corpdev: {
    label: "Optimize Corporate Development",
    palId: process.env.CORPDEV_PAL_ID || "pe1cff40644a",
    faceId: process.env.CORPDEV_FACE_ID || "re3fd4adeafd",
    product: "Optimize Advisor Platform - Advisor Recruitment",
    greeting: (first) =>
      `Hi ${first}, it's Victor from Optimize Wealth Management. Great to connect, and thanks for making the time. How's your week been so far?`,
    meetingTitle: "Optimize - Dealer Analysis Report Review & Investment Process (Meeting 2 of 4)",
    meetingDesc:
      "Follow-up with Optimize Corporate Development.\n\n" +
      "We'll walk through your custom Dealer Analysis Report (your compensation under the Optimize platform and the solutions available to your clients) and take a deeper look at our Institutional Investment Management Program.\n\n" +
      "Performance figures discussed are historical and not a guarantee of future results.",
    minutes: 45,
    taskTitle: "Follow-up: Dealer Analysis Report review (meeting 2 of 4)",
    taskBody: (name) => `Prepare ${name}'s Dealer Analysis Report from the intro-meeting profile and send investment info, firm overview and sample statements beforehand. Send the advisor testimonial video links.`,
  },
  invitationhomes: {
    label: "Invitation Homes",
    palId: process.env.IH_PAL_ID || "p5250d043111",
    faceId: process.env.IH_FACE_ID || "re3fd4adeafd",
    product: "Training Simulator",
    greeting: (first, scenario) => (IH_SCENARIOS[scenario] || IH_SCENARIOS.hvac).greeting,
    minutes: 0,
  },
};
export const firmOf = (s) => FIRMS[s?.firm] || FIRMS.apex;

// ---- Invitation Homes training simulator --------------------------------------
// One PAL plays every scenario; the character sheet rides conversational_context
// per launch, so adding a scenario is a new entry here, not a new PAL.

export const IH_SCENARIOS = {
  hvac: {
    label: "Upset resident: repeat AC failure",
    track: "Resident service · Difficult customer",
    trainee: "an Invitation Homes maintenance technician arriving at the home for the repair",
    brief: "You're the technician. Marcus's AC has failed three times in five weeks, it's 96°F inside and the last tech no-showed. Calm him down, own it, and leave him with a realistic plan.",
    greeting: "Oh, so somebody actually showed up this time. You know it's ninety-six degrees in my daughter's room right now?",
    character:
      "You are Marcus Bell, 38, an Invitation Homes resident for two years in a four-bedroom home in Phoenix. Your AC has failed three times in five weeks; it's 96 degrees inside, your seven-year-old daughter Maya has asthma, you've taken two unpaid days off work waiting for techs, and the last tech no-showed on Tuesday with no call. You're exhausted and angry, not violent. " +
      "What you want: working AC today, someone to actually own the problem, and a rent credit. Pressure you apply: threaten to break your lease, post on Google and Nextdoor, and call corporate. " +
      "You escalate when the trainee cites policy, blames the vendor or 'the system', says 'I just do the repairs', talks over you, or promises a rent credit they can't authorize (call that out later if it doesn't happen). " +
      "You de-escalate, gradually over two or three turns, when they acknowledge Maya and the heat specifically, apologize for the no-show without excuses, take ownership, explain what they'll check right now, offer a real fallback if it can't be fixed today (like portable units), and route the credit request to a supervisor with a timeline. Once genuinely heard, you soften and say thanks.",
    criteria: ["Acknowledges impact and empathizes", "Takes ownership (no blaming)", "Clear next steps and realistic commitments", "Stays calm and professional under pressure", "Escalates the credit request correctly (doesn't promise it)"],
  },
  safety: {
    label: "Home entry: resident escalates",
    track: "Field operations · Safety protocol",
    trainee: "an Invitation Homes service technician at the front door for a scheduled ProCare preventive maintenance visit",
    brief: "You're at the door for a scheduled ProCare visit. Ray says nobody told him and gets more agitated the harder you push. Your safety comes first: read the warning signs, de-escalate, and know when to leave.",
    greeting: "Yeah? Who are you? Nobody told me anybody was coming today.",
    character:
      "You are Ray Dawson, 45, an Invitation Homes resident. A technician is at your front door for a scheduled ProCare preventive maintenance visit; a notice went out through the resident app two days ago but you never saw it. You were laid off last week, you're stressed and suspicious, and you're standing in the doorway. " +
      "You escalate when the trainee insists on coming in, quotes the lease or entry rights, steps closer, argues about the notice, or gets defensive. At the peak, say once, in a low, tense voice, that you don't want strangers in your house, that you keep a firearm for your family's protection, and that they need to leave. That is an implied threat only: never describe a weapon, never say you're holding one, never threaten an action in detail. " +
      "You de-escalate when the trainee keeps a calm, low voice, keeps their distance, says they won't come in, acknowledges you didn't get the notice, offers to reschedule at a time that works for you, and leaves. If they handle it well, you calm down and grudgingly apologize. If they keep pushing after the firearm line, stay tense and repeat that they need to go. " +
      "End the scene once the trainee has left or says they're walking away.",
    criteria: ["Recognizes warning signs and keeps a safe distance", "Does not enter or argue entry rights once tension rises", "Calm, de-escalating tone and language", "Disengages safely (offers to reschedule, leaves)", "States they'll report the incident to their supervisor (911 if a threat is imminent)"],
  },
  leasing: {
    label: "Leasing tour: price and rent-vs-buy objections",
    track: "Leasing · Sales roleplay",
    trainee: "an Invitation Homes leasing agent meeting a prospect at a three-bedroom listing",
    brief: "You're showing a three-bedroom home. Chris has fifteen minutes, saw a cheaper place two streets over, has a big dog, and is half-thinking about buying instead. Find out what matters to them, handle the objections, and land a next step.",
    greeting: "Hi, thanks for meeting me. I'll be upfront, I've only got about fifteen minutes, and we saw a place two streets over that's cheaper.",
    character:
      "You are Chris Alvarez, 34, touring a three-bedroom single-family rental listed at 2,450 dollars a month. You're married with two kids (8 and 5) and a seventy-pound lab named Biscuit; your current lease ends in six weeks. Objections, raised naturally one at a time: a similar home two streets over is listed 200 dollars cheaper; you're worried about pet fees; you've read online reviews saying maintenance is slow at big rental companies; and you're half-thinking you should just buy instead of renting. " +
      "Hidden motivations you reveal only if asked good discovery questions: the kids' school district matters most, your spouse travels for work so you hate handling repairs alone, and you don't have a down payment saved yet. " +
      "You warm up when the trainee asks about your needs before pitching, ties value to what you told them, answers the reviews concern honestly, and is straight about renting versus buying. You cool off at pushy closing, discounting without being asked, or vague answers. If they've done well by the end, agree to a concrete next step such as starting an application or holding the home; otherwise say you'll think about it.",
    criteria: ["Discovery before pitching", "Handles price with value, not discounts", "Honest rent-versus-buy conversation", "Addresses the maintenance-reviews concern credibly", "Clear close and next step"],
  },
};

export const ihContext = (scenarioKey, traineeName) => {
  const sc = IH_SCENARIOS[scenarioKey] || IH_SCENARIOS.hvac;
  return (
    `SCENARIO: ${sc.label}. The trainee, ${traineeName}, is playing ${sc.trainee}. ` +
    `YOUR CHARACTER: ${sc.character} ` +
    `Your first line already played: "${sc.greeting}" Continue from there in character. ` +
    `SCORING CRITERIA for the scorecard (score each out of 5): ${sc.criteria.map((c, i) => `${i + 1}. ${c}`).join("; ")}.`
  );
};

export const TRAINING_FIELDS = {
  scenario: "Scenario",
  outcome: "Outcome",
  overall_score: "Overall score",
  criteria_scores: "Criteria scores",
  strengths: "Strengths",
  improvements: "Improvements",
  safety_flag: "Safety flag",
};

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
  ({ fees: "Fee concern", guaranteed_returns: "Guaranteed returns", recession_risk: "Recession risk", account_setup: "Account setup timing", proprietary_products: "Proprietary products", transfers_in_kind: "Transfers in kind", compensation: "Compensation", book_ownership: "Book ownership", licensing: "Licensing", transition_effort: "Transition effort", regulatory: "Regulatory history", firm_stability: "Firm stability", other: "Other" })[c] ?? c;

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

export async function createProspect({ firstname, lastname = "", email, amount = 250000, firm = "apex", product }) {
  const f = FIRMS[firm] || FIRMS.apex;
  const contact = { id: newId("ct"), firstname, lastname, email };
  const deal = {
    id: newId("deal"),
    name: `${`${firstname} ${lastname}`.trim()} - ${product || f.product}`,
    contactId: contact.id, amount, stage: "discovery_scheduled", product: product || f.product, firm,
    owner: { optimize: "Optimize Senior Portfolio Manager (AI)", corpdev: "Optimize Corporate Development (AI)", invitationhomes: "Invitation Homes Training Simulator (AI)" }[firm] || "Apex Portfolio Manager (AI)",
    createdAt: now(), updatedAt: now(), props: {},
  };
  await setJSON(K.contact(contact.id), contact);
  await setJSON(K.deal(deal.id), deal);
  await setJSON(K.dealIndex, [deal.id, ...((await getJSON(K.dealIndex)) ?? [])]);
  await addNote(deal.id, firm === "invitationhomes" ? "Training session started" : "Deal created", firm === "invitationhomes" ? `Roleplay: ${product}` : "Inbound lead booked a Discovery & Financial Goal Mapping call.", [], "system");
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
  // Keep the Google connection and the share-link rate limits across resets.
  const keys = (await scanKeys("apex:*")).filter((k) => k !== GOOGLE_TOKEN_KEY && !k.startsWith("apex:rl:"));
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
/* Joining Zoom/Meet/Teams via meeting_url requires the PAL to have a
   conferencing identity (layers.conferencing.username). Set it once if missing. */
export async function ensureConferencing(palId) {
  const r = await fetch(`${TAVUS}/pals/${palId}`, { headers: tavusHeaders() });
  const pal = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(`Tavus get PAL failed (${r.status}): ${JSON.stringify(pal)}`);
  if (pal?.layers?.conferencing?.username) return pal.layers.conferencing.username;
  const hasLayer = !!pal?.layers?.conferencing;
  let lastErr = "";
  for (const username of ["apex-portfolio-manager", `apex-pm-${palId.slice(-6)}`, `apex-${Date.now().toString(36)}`]) {
    const ops = hasLayer
      ? [{ op: "add", path: "/layers/conferencing/username", value: username }]
      : [{ op: "add", path: "/layers/conferencing", value: { username } }];
    const p = await fetch(`${TAVUS}/pals/${palId}`, { method: "PATCH", headers: tavusHeaders(), body: JSON.stringify(ops) });
    if (p.ok) return username;
    lastErr = `${p.status}: ${await p.text()}`;
  }
  throw new Error(`Could not give the avatar a meeting identity (${lastErr})`);
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

/* What the avatar hears back. These tools resolve with generate_response, so the
   reply is always spoken (a silent fire-and-forget tool left dead air). The same
   lines are returned for calls not started from the console, minus the CRM write. */
/* Optimize initial-meeting profile (mirrors the script's discovery sections). */
export const PROFILE_FIELDS = {
  retirement_target: "Financial independence target",
  retirement_lifestyle: "Retirement lifestyle",
  major_purchases: "Major purchases",
  plan_type: "Plan type (joint / individual)",
  date_of_birth: "Date of birth",
  marital_status: "Marital status",
  spouse_name: "Spouse name",
  spouse_date_of_birth: "Spouse date of birth",
  income: "Income (base + bonus)",
  spouse_income: "Spouse income",
  children: "Children & ages",
  phone: "Best phone",
  email_on_file: "Best email",
  rrsp: "RRSP value & contributions",
  employer_match: "Employer RRSP/pension match",
  spouse_rrsp: "Spouse RRSP",
  other_registered: "Other registered (spousal RRSP / LIRA)",
  tfsa: "TFSA value & contributions",
  non_registered: "Non-registered investments",
  pension: "Pension (DB / DC details)",
  government_benefits: "CPP / OAS",
  resp: "RESP",
  home_value: "Home value",
  mortgage: "Mortgage outstanding",
  other_properties: "Other properties",
  investor_profile: "Investor profile",
  time_horizon: "Investing time horizon",
  liquidity_needs: "Liquidity requirements",
  primary_objective: "Primary investment objective",
  review_cadence: "Agreed review cadence",
  ideal_relationship: "Wants from an advisory relationship",
};

/* Corp Dev intro meeting: the Dealer Analysis Report inputs. */
export const ADVISOR_FIELDS = {
  current_dealer: "Current dealer",
  book_size: "Book size (AUM)",
  organic_growth: "Expected organic growth",
  years_in_industry: "Years in industry",
  years_to_retirement: "Years to retirement",
  households: "Households",
  individuals_per_household: "Individuals per household",
  registered_pct: "% clients with registered accounts",
  admin_fee_registered: "Admin fee on registered accounts",
  equity_trade_cost: "Cost per equity trade",
  mutual_fund_trade_cost: "Cost per mutual fund trade",
  monthly_dealer_fees: "Monthly fixed dealer fees",
  succession_multiple: "Dealer succession multiple",
  gross_revenue_pct: "Gross revenue (% of book)",
  grid_payout: "Grid payout",
  client_risk_tilt: "Client risk profile tilt",
  values_commitment: "Commitment to clients & professionalism",
  personal_email: "Personal email",
};

export const GUIDE = {
  log_objection: "Noted. Now answer the prospect's concern(s) directly, warmly and concisely, following your objection guidance.",
  record_discovery_answers: "Saved. Briefly reflect their goals back and connect them to the Premier Growth Portfolio, then move toward booking the next meeting.",
  record_client_profile: "Saved. Continue with the next part of the meeting script.",
  record_advisor_profile: "Saved. Continue with the next discovery question.",
  complete_discovery_call: "Done. Close warmly: confirm you'll see them at the booked time.",
  record_training_scorecard: "Scorecard saved to the trainee's record. Now give the spoken debrief as their training coach: overall score first, two strengths in their own words, two improvements each with a better line, then ask if they want to run it again.",
  request_advisor_handoff: "Handoff created. Tell them a licensed advisor will follow up with them directly, then ask if there's anything else you can help with today.",
};

const str = (v) => (typeof v === "string" ? v.trim() : v == null ? "" : String(v));

export async function runTool(name, args, s, toolCallId) {
  switch (name) {
    case "log_objection": {
      // Accepts a batch (concerns[]) so several objections in one breath are one call.
      const items = Array.isArray(args.concerns) && args.concerns.length ? args.concerns : [{ category: args.category, detail: args.detail }];
      for (const it of items) {
        const category = str(it?.category) || "other";
        const detail = str(it?.detail) || "(no detail captured)";
        await logObjection(s.dealId, category, detail);
        await feed({ type: "tool", title: `Objection logged: ${categoryLabel(category)}`, detail, conversationId: s.conversationId });
      }
      return GUIDE.log_objection;
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
      return GUIDE.record_discovery_answers;
    }

    case "record_client_profile": {
      // Optimize discovery: called once per script section, so fields arrive in batches.
      const props = Object.fromEntries(Object.entries(args).filter(([k]) => PROFILE_FIELDS[k]).map(([k, v]) => [k, str(v)]));
      await updateProps(s.dealId, props);
      const filled = Object.entries(props).filter(([, v]) => v);
      await feed({ type: "tool", title: `Client profile updated (${filled.length} field${filled.length === 1 ? "" : "s"})`, detail: filled.map(([k, v]) => `${PROFILE_FIELDS[k]}: ${v}`).join("\n"), conversationId: s.conversationId });
      return GUIDE.record_client_profile;
    }

    case "record_advisor_profile": {
      const props = Object.fromEntries(Object.entries(args).filter(([k]) => ADVISOR_FIELDS[k]).map(([k, v]) => [k, str(v)]));
      await updateProps(s.dealId, props);
      const filled = Object.entries(props).filter(([, v]) => v);
      await feed({ type: "tool", title: `Dealer Analysis inputs saved (${filled.length} field${filled.length === 1 ? "" : "s"})`, detail: filled.map(([k, v]) => `${ADVISOR_FIELDS[k]}: ${v}`).join("\n"), conversationId: s.conversationId });
      return GUIDE.record_advisor_profile;
    }

    case "book_dar_review":
    case "book_plan_review":
    case "book_next_meeting": {
      const firm = firmOf(s);
      const tz = str(args.timezone) || DEFAULT_TZ;
      const slot = resolveSlot({ date: str(args.date), weekday: str(args.weekday), time: str(args.time) || "15:00", tz });
      const end = new Date(slot.start.getTime() + firm.minutes * 60_000);
      const attendee = s.prospectEmail;
      const title = firm.meetingTitle;
      let calendarLink, meetLink;
      let inviteLine = `The meeting is on the books; a calendar invite will follow by email to ${attendee}.`;

      if (await googleConnected()) {
        try {
          const ev = await createCalendarEvent({
            summary: title,
            description: firm.meetingDesc,
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
        firm.taskTitle,
        firm.taskBody(s.prospectName),
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
      return GUIDE.complete_discovery_call;
    }

    case "request_advisor_handoff": {
      const reason = str(args.reason) || "Prospect asked to speak with a person.";
      const t = zonedParts(new Date(Date.now() + 86400_000), DEFAULT_TZ);
      const due = zonedToUtc(t.year, t.month, t.day, 10, 0, DEFAULT_TZ);
      await addTask(s.dealId, "Human advisor follow-up requested", reason, due.toISOString());
      await addNote(s.dealId, "Advisor handoff requested", reason, ["handoff"]);
      await feed({ type: "tool", title: "Advisor handoff requested", detail: reason, conversationId: s.conversationId });
      return GUIDE.request_advisor_handoff;
    }

    case "record_training_scorecard": {
      // The call-page "Get my scorecard" button grades the transcript itself; if that
      // already ran, keep its result and let the avatar just give the spoken debrief.
      const deal = await getDeal(s.dealId);
      if (!deal?.props?.overall_score) await saveScorecard(s, args, "avatar");
      return GUIDE.record_training_scorecard;
    }

    default:
      throw new Error(`Unknown tool ${name}`);
  }
}


// ---- Training scorecards ---------------------------------------------------------

export async function saveScorecard(s, raw, by = "grader") {
  // Graders sometimes return arrays/objects for list fields; flatten to readable lines.
  const flat = (v) => Array.isArray(v) ? v.map(flat).join("\n") : v && typeof v === "object" ? Object.entries(v).map(([k, x]) => `${k}: ${flat(x)}`).join("\n") : str(v);
  const props = Object.fromEntries(Object.entries(raw || {}).filter(([k]) => TRAINING_FIELDS[k]).map(([k, v]) => [k, flat(v)]));
  props.scenario = IH_SCENARIOS[s.scenario]?.label || props.scenario || "";
  await updateProps(s.dealId, props);
  await moveStage(s.dealId, "discovery_completed");
  await addNote(s.dealId, `Scorecard: ${props.overall_score || "?"}/100`,
    [props.outcome, props.criteria_scores && `\n${props.criteria_scores}`, props.strengths && `\nStrengths: ${props.strengths}`, props.improvements && `\nImprove: ${props.improvements}`, props.safety_flag && `\nSAFETY FLAG: ${props.safety_flag}`].filter(Boolean).join("\n"),
    ["training", by]);
  await feed({ type: props.safety_flag ? "error" : "tool", title: `Scorecard saved: ${props.overall_score || "?"}/100`, detail: [props.criteria_scores, props.safety_flag && `Safety flag: ${props.safety_flag}`].filter(Boolean).join("\n"), conversationId: s.conversationId });
  return props;
}

/* Grades a roleplay transcript against the scenario criteria with Claude, so the
   scorecard never depends on the avatar remembering to call its tool. */
export async function gradeTranscript(scenarioKey, traineeName, lines) {
  const sc = IH_SCENARIOS[scenarioKey] || IH_SCENARIOS.hvac;
  const transcript = [`CHARACTER: ${sc.greeting}`, ...lines.map((l) => `${l.role === "user" ? "TRAINEE" : "CHARACTER"}: ${l.text}`)].join("\n").slice(-24000);
  if (!lines.some((l) => l.role === "user")) throw new Error("No trainee speech captured yet. Talk to the character first.");
  const { default: Anthropic } = await import("@anthropic-ai/sdk");
  const client = new Anthropic();
  const system =
    "You are a strict, fair training coach at Invitation Homes grading a recorded roleplay. Score only from what the TRAINEE actually said. " +
    "5 = textbook, 3 = acceptable with clear gaps, 1 = missing or harmful. A trainee who argued, made promises they can't keep, or skipped a safety step scores 3 or lower on that criterion. " +
    "Lines after the trainee asked to end the scenario or for feedback are not part of the roleplay. " +
    'Reply with ONLY a JSON object: {"overall_score": "0-100 as a string", "criteria_scores": "one line per criterion: Name: N/5 - evidence quoting the trainee", "strengths": "two specific strengths quoting the trainee", "improvements": "two specific improvements, each with a better line they could have said", "safety_flag": "a missed safety step, or empty string", "outcome": "one sentence on how the scene ended"}';
  const user = `SCENARIO: ${sc.label}\nTRAINEE ROLE: ${traineeName}, ${sc.trainee}\nCHARACTER BRIEF: ${sc.character}\nCRITERIA:\n${sc.criteria.map((c, i) => `${i + 1}. ${c}`).join("\n")}\n\nTRANSCRIPT:\n${transcript}`;
  let msg;
  for (const model of ["claude-opus-4-8", "claude-haiku-4-5-20251001"]) {
    try { msg = await client.messages.create({ model, max_tokens: 1500, system, messages: [{ role: "user", content: user }] }); break; }
    catch (e) { if (model.startsWith("claude-haiku")) throw e; }
  }
  const text = msg.content.map((b) => b.text || "").join("");
  const json = text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1);
  return JSON.parse(json);
}
