/* HubSpot CRM client for the Apex demos. Inert unless HUBSPOT_ACCESS_TOKEN (a
   service key, or a legacy private-app token) is set. Custom call data lands in deal properties named
   tavus_<field>, created on first use in a "Tavus AI call" property group. */

const BASE = "https://api.hubapi.com";
const GROUP = "tavus_ai_call";

export const configured = () => !!process.env.HUBSPOT_ACCESS_TOKEN;

async function hs(method, path, body) {
  const r = await fetch(`${BASE}${path}`, {
    method,
    headers: { Authorization: `Bearer ${process.env.HUBSPOT_ACCESS_TOKEN}`, "Content-Type": "application/json" },
    body: body ? JSON.stringify(body) : undefined,
  });
  const raw = await r.text();
  let j = {};
  try { j = raw ? JSON.parse(raw) : {}; } catch { j = { message: raw.slice(0, 300) }; }
  if (!r.ok) {
    const e = new Error(`HubSpot ${method} ${path.split("?")[0]} → ${r.status}: ${j.message || "no detail"}`);
    e.status = r.status;
    throw e;
  }
  return j;
}

// Default sales pipeline stage ids (every portal has these until someone edits the pipeline).
const STAGE_MAP = {
  discovery_scheduled: "appointmentscheduled",
  discovery_completed: "qualifiedtobuy",
  hot_lead: "decisionmakerboughtin",
  portfolio_design: "presentationscheduled",
  onboarding: "contractsent",
  closed_won: "closedwon",
  closed_lost: "closedlost",
};
export const stageFor = (stage) => STAGE_MAP[stage] || STAGE_MAP.discovery_scheduled;

// HubSpot-defined association type ids.
const ASSOC = {
  deal_contact: 3,
  note: { contact: 202, deal: 214 },
  task: { contact: 204, deal: 216 },
  meeting: { contact: 200, deal: 212 },
  call: { contact: 194, deal: 206 },
};
const to = (id, typeId) => ({ to: { id }, types: [{ associationCategory: "HUBSPOT_DEFINED", associationTypeId: typeId }] });

let portal;
async function portalInfo() {
  if (portal === undefined) {
    try {
      const d = await hs("GET", "/account-info/v3/details");
      portal = { id: d.portalId, ui: d.uiDomain || "app.hubspot.com" };
    } catch { portal = null; }
  }
  return portal;
}
export async function dealUrl(dealId) {
  const p = await portalInfo();
  return p ? `https://${p.ui}/contacts/${p.id}/record/0-3/${dealId}` : null;
}

async function upsertContact({ email, firstname, lastname }) {
  const properties = { email, firstname, ...(lastname ? { lastname } : {}) };
  const found = await hs("POST", "/crm/v3/objects/contacts/search", {
    filterGroups: [{ filters: [{ propertyName: "email", operator: "EQ", value: email }] }],
    properties: ["email"],
    limit: 1,
  });
  const existing = found.results?.[0]?.id;
  if (existing) {
    await hs("PATCH", `/crm/v3/objects/contacts/${existing}`, { properties });
    return existing;
  }
  try {
    return (await hs("POST", "/crm/v3/objects/contacts", { properties: { ...properties, lifecyclestage: "lead" } })).id;
  } catch (e) {
    // Search is eventually consistent; a contact created seconds ago shows up as a 409.
    const id = e.status === 409 && /Existing ID:\s*(\d+)/.exec(e.message)?.[1];
    if (id) return id;
    throw e;
  }
}

export async function createContactAndDeal({ contact, deal }) {
  const contactId = await upsertContact(contact);
  const d = await hs("POST", "/crm/v3/objects/deals", {
    properties: { dealname: deal.name, amount: String(deal.amount ?? ""), pipeline: "default", dealstage: stageFor(deal.stage) },
    associations: [to(contactId, ASSOC.deal_contact)],
  });
  return { contactId, dealId: d.id };
}

let knownProps;
async function ensureDealProperties(labels) {
  if (!knownProps) {
    const r = await hs("GET", "/crm/v3/properties/deals");
    knownProps = new Set((r.results || []).map((p) => p.name));
  }
  const missing = Object.keys(labels).filter((k) => !knownProps.has(`tavus_${k}`));
  if (!missing.length) return;
  if (!knownProps.has(GROUP)) {
    try { await hs("POST", "/crm/v3/properties/deals/groups", { name: GROUP, label: "Tavus AI call", displayOrder: -1 }); }
    catch (e) { if (e.status !== 409) throw e; }
    knownProps.add(GROUP);
  }
  await hs("POST", "/crm/v3/properties/deals/batch/create", {
    inputs: missing.map((k) => ({ name: `tavus_${k}`, label: labels[k], type: "string", fieldType: "textarea", groupName: GROUP })),
  });
  for (const k of missing) knownProps.add(`tavus_${k}`);
}

export async function updateDeal(dealId, { stage, props, labels }) {
  const properties = {};
  if (stage) properties.dealstage = stageFor(stage);
  if (stage === "hot_lead") properties.hs_priority = "high";
  const known = Object.entries(props || {}).filter(([k]) => labels?.[k]);
  if (known.length) {
    await ensureDealProperties(Object.fromEntries(known.map(([k]) => [k, labels[k]])));
    for (const [k, v] of known) properties[`tavus_${k}`] = v;
  }
  if (Object.keys(properties).length) await hs("PATCH", `/crm/v3/objects/deals/${dealId}`, { properties });
}

const engagement = (type, properties, ids) =>
  hs("POST", `/crm/v3/objects/${type}s`, { properties, associations: [to(ids.contactId, ASSOC[type].contact), to(ids.dealId, ASSOC[type].deal)] });

const html = (s) => String(s ?? "").replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;").replace(/\n/g, "<br>");

export const createNote = (ids, { title, body }) =>
  engagement("note", { hs_note_body: `<b>${html(title)}</b><br>${html(body)}`, hs_timestamp: new Date().toISOString() }, ids);

export const createTask = (ids, { title, body, dueAt }) =>
  engagement("task", { hs_task_subject: title, hs_task_body: html(body), hs_timestamp: dueAt || new Date().toISOString(), hs_task_status: "NOT_STARTED", hs_task_type: "TODO", hs_task_priority: "HIGH" }, ids);

export const createMeeting = (ids, m) =>
  engagement("meeting", {
    hs_meeting_title: m.title,
    hs_meeting_body: html([m.meetLink && `Join: ${m.meetLink}`, m.attendees?.length && `Attendees: ${m.attendees.join(", ")}`].filter(Boolean).join("\n")),
    hs_timestamp: m.startAt,
    hs_meeting_start_time: m.startAt,
    hs_meeting_end_time: m.endAt,
    hs_meeting_outcome: "SCHEDULED",
    ...(m.meetLink || m.calendarLink ? { hs_meeting_external_url: m.meetLink || m.calendarLink } : {}),
  }, ids);

export const createCall = (ids, { title, lines, startedAt }) =>
  engagement("call", {
    hs_call_title: title,
    hs_call_body: html(lines.join("\n")).slice(0, 60000),
    hs_call_status: "COMPLETED",
    hs_timestamp: startedAt || new Date().toISOString(),
    ...(startedAt ? { hs_call_duration: String(Math.max(0, Date.now() - Date.parse(startedAt))) } : {}),
  }, ids);

/* Verifies the token and pre-creates the custom deal properties. */
export async function check(labels) {
  const p = await portalInfo();
  await ensureDealProperties(labels);
  return { portalId: p?.id ?? null, properties: Object.keys(labels).length };
}
