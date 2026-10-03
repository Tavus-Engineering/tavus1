import React, { useCallback, useEffect, useState } from "react";

/* Apex Wealth demo — Live Call Console + CRM sandbox, served at /apex.
   Backend: /api/apex?op=… (api/apex.js). Signed-in builder session required. */

const API = (op) => `/api/apex?op=${op}`;

const CATEGORY = { fees: "Fee concern", guaranteed_returns: "Guaranteed returns", recession_risk: "Recession risk", account_setup: "Account setup timing", other: "Other" };
const PROP_LABELS = {
  client_objections: "Client Objections",
  discovery_summary: "Discovery Summary",
  financial_goals: "Financial Goals",
  goal_timeline: "Goal Timeline",
  investable_assets: "Investable Assets",
  risk_tolerance: "Risk Tolerance",
  current_accounts: "Current Investments / Accounts",
  retirement_plans: "Retirement Plans",
};

const fmtDateTime = (iso) =>
  new Date(iso).toLocaleString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric", hour: "numeric", minute: "2-digit", timeZoneName: "short" });
const fmtTime = (iso) =>
  new Date(iso).toLocaleTimeString("en-US", { timeZone: "America/New_York", hour: "numeric", minute: "2-digit", second: "2-digit" });
const money = (n) => n.toLocaleString("en-US", { style: "currency", currency: "USD", maximumFractionDigits: 0 });

// ---- tiny router ------------------------------------------------------------

function usePath() {
  const [path, setPath] = useState(window.location.pathname);
  useEffect(() => {
    const on = () => setPath(window.location.pathname);
    window.addEventListener("popstate", on);
    return () => window.removeEventListener("popstate", on);
  }, []);
  return path.replace(/\/+$/, "") || "/apex";
}
function go(href) {
  window.history.pushState({}, "", href);
  window.dispatchEvent(new PopStateEvent("popstate"));
  window.scrollTo(0, 0);
}
function A({ href, className, children, ...rest }) {
  return (
    <a href={href} className={className} {...rest}
      onClick={(e) => { if (e.metaKey || e.ctrlKey || rest.target) return; e.preventDefault(); go(href); }}>
      {children}
    </a>
  );
}

// ---- shared state (polled) ----------------------------------------------------

function useAppState(intervalMs = 2000) {
  const [state, setState] = useState(null);
  const [error, setError] = useState(null);
  const refresh = useCallback(async () => {
    try {
      const r = await fetch(API("state"), { cache: "no-store", credentials: "same-origin" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      setState(j);
      setError(null);
    } catch (e) {
      setError(e.message);
    }
  }, []);
  useEffect(() => {
    refresh();
    const t = setInterval(refresh, intervalMs);
    return () => clearInterval(t);
  }, [refresh, intervalMs]);
  return { state, error, refresh };
}

export default function ApexApp() {
  const path = usePath();
  const app = useAppState(path === "/apex" ? 1500 : 2000);

  if (app.error && !app.state) {
    return (
      <div className="wrap">
        <div className="card stack" style={{ maxWidth: 520, margin: "60px auto" }}>
          <h2>Apex Live Console</h2>
          <div className="muted">{app.error}</div>
          <div><a href="/">Open the Experience Builder to sign in</a>, then come back to <b>/apex</b>.</div>
        </div>
      </div>
    );
  }

  if (path === "/apex/crm") return <DealsBoard {...app} />;
  if (path === "/apex/crm/tasks") return <Tasks {...app} />;
  const m = path.match(/^\/apex\/crm\/deals\/([^/]+)$/);
  if (m) return <DealRecord id={decodeURIComponent(m[1])} {...app} />;
  return <Console {...app} />;
}

// ---- Console ------------------------------------------------------------------

function Console({ state, refresh }) {
  const [form, setForm] = useState({ meetingUrl: "", firstname: "Tim", lastname: "", email: "tim@tavus.io" });
  const [busy, setBusy] = useState(false);
  const [msg, setMsg] = useState(null);

  async function call(op, body) {
    setBusy(true);
    setMsg(null);
    try {
      const r = await fetch(API(op), {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: body ? JSON.stringify(body) : undefined,
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setMsg(j.error || `Error ${r.status}`);
      await refresh();
    } finally {
      setBusy(false);
    }
  }

  const active = state?.active;
  const cfg = state?.config;
  const feed = (state?.feed ?? []).slice().reverse();
  const activeDeal = active ? state?.deals.find((d) => d.id === active.dealId) : null;

  return (
    <>
      <TopBar section="console" />
      <main className="wrap grid2">
        <div className="stack">
          <section className="card stack">
            <h2>Send Apex Portfolio Manager into a call</h2>
            <div>
              <label>Zoom / Meet / Teams link</label>
              <input placeholder="https://us02web.zoom.us/j/123456789?pwd=..." value={form.meetingUrl}
                onChange={(e) => setForm({ ...form, meetingUrl: e.target.value.trim() })} />
            </div>
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div style={{ flex: 1 }}>
                <label>Prospect first name</label>
                <input value={form.firstname} onChange={(e) => setForm({ ...form, firstname: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Last name</label>
                <input value={form.lastname} onChange={(e) => setForm({ ...form, lastname: e.target.value })} />
              </div>
            </div>
            <div>
              <label>Prospect email (gets the calendar invite)</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} />
            </div>
            <div className="row">
              <button className="primary" disabled={busy || !!active} onClick={() => call("start", form)}>Send Apex in</button>
              <button className="danger" disabled={busy || !active} onClick={() => call("end")}>End call</button>
            </div>
            {msg && <div className="pill bad" style={{ whiteSpace: "normal" }}>{msg}</div>}
          </section>

          <section className="card stack">
            <h2>Current call</h2>
            {active ? (
              <>
                <div className="row">
                  <span className={`pill ${active.status === "live" ? "live" : ""}`}>{active.status}</span>
                  <span className="muted">{active.prospectName}</span>
                </div>
                {activeDeal && (
                  <div className="muted">
                    Deal stage: <b>{state.stages.find((s) => s.id === activeDeal.stage)?.label}</b> ·{" "}
                    <A href={`/apex/crm/deals/${activeDeal.id}`}>open record</A>
                  </div>
                )}
                <div className="muted" style={{ wordBreak: "break-all" }}>Conversation {active.conversationId}</div>
              </>
            ) : (
              <div className="muted">No live call.</div>
            )}
          </section>

          <section className="card stack">
            <h2>Setup checks</h2>
            {cfg ? (
              <div className="checks">
                <span>Tavus API key</span> <Check ok={cfg.tavus} />
                <span>Shared storage (Redis)</span> <Check ok={cfg.store === "redis"} label={cfg.store} />
                <span>Google Calendar</span>{" "}
                {cfg.google ? <Check ok label="connected" /> : cfg.googleConfigured ? <a href={API("google_auth")}>Connect</a> : <Check label="add Google keys" />}
                <span>Avatar (PAL)</span> <span className="pill">{cfg.palId}</span>
              </div>
            ) : (
              <div className="muted">Loading…</div>
            )}
            <div className="row">
              <button disabled={busy || !!active} onClick={() => window.confirm("Wipe the Apex CRM sandbox and event feed, then re-seed demo data?") && call("reset")}>
                Reset demo data
              </button>
            </div>
          </section>
        </div>

        <section className="card">
          <div className="row" style={{ justifyContent: "space-between", marginBottom: 12 }}>
            <h2 style={{ margin: 0 }}>Live activity</h2>
            <span className="muted">What the AI did, as it happened</span>
          </div>
          <div className="feed">
            {feed.length === 0 && <div className="muted">Nothing yet. Tool calls from the avatar will show up here in real time.</div>}
            {feed.map((e, i) => (
              <div key={i} className={`ev ${e.type}`}>
                <div className="t">{fmtTime(e.at)} · {e.type === "tool" ? "AI tool call" : e.type}</div>
                <div className="title">{e.title}</div>
                {e.detail && <pre>{e.detail}</pre>}
              </div>
            ))}
          </div>
        </section>
      </main>
    </>
  );
}

function Check({ ok, label }) {
  return <span className={`pill ${ok ? "ok" : "bad"}`}>{label ?? (ok ? "ready" : "missing")}</span>;
}

function TopBar({ section }) {
  return (
    <header className="topbar">
      <div className="logo">APEX WEALTH ADVISORY <span>· {section === "crm" ? "CRM" : "Live Call Console"}</span></div>
      <nav>
        <A href="/apex" className={section === "console" ? "on" : ""}>Console</A>
        <A href="/apex/crm" className={section === "crm" ? "on" : ""}>CRM</A>
      </nav>
    </header>
  );
}

// ---- CRM --------------------------------------------------------------------

function CrmShell({ children, section }) {
  return (
    <>
      <TopBar section="crm" />
      <div className="sandbox-banner">CRM sandbox with demo data. Records marked AI were written by the avatar's tool calls during the live conversation.</div>
      <div className="crm-shell">
        <aside className="crm-side">
          <div className="sec">CRM</div>
          <A href="/apex/crm" className={section === "deals" ? "on" : ""}>Deals</A>
          <A href="/apex/crm/tasks" className={section === "tasks" ? "on" : ""}>Tasks</A>
        </aside>
        <main className="wrap" style={{ maxWidth: "none", width: "100%" }}>{children}</main>
      </div>
    </>
  );
}

function DealsBoard({ state }) {
  const recent = (iso) => Date.now() - new Date(iso).getTime() < 20_000;
  return (
    <CrmShell section="deals">
      <div className="row" style={{ justifyContent: "space-between", marginBottom: 14 }}>
        <h1 style={{ fontSize: 20, margin: 0 }}>Deals · Advisory Pipeline</h1>
        <span className="muted">{state ? `${state.deals.length} deals` : "Loading…"}</span>
      </div>
      <div className="board">
        {state?.stages.map((st) => {
          const deals = state.deals.filter((d) => d.stage === st.id);
          return (
            <div className="col" key={st.id}>
              <h3>{st.label} <span>{deals.length}</span></h3>
              {deals.map((d) => {
                const c = state.contacts[d.contactId];
                const ai = state.activity[d.id]?.some((a) => a.source === "ai");
                return (
                  <A key={d.id} href={`/apex/crm/deals/${d.id}`} className={`deal ${recent(d.updatedAt) ? "flash" : ""}`}>
                    <div className="n">{d.name}</div>
                    <div className="muted">{c?.email}</div>
                    <div className="row" style={{ marginTop: 6, justifyContent: "space-between" }}>
                      <span className="muted">{money(d.amount)}</span>
                      {ai && <span className="pill ai">AI updated</span>}
                    </div>
                  </A>
                );
              })}
            </div>
          );
        })}
      </div>
    </CrmShell>
  );
}

function DealRecord({ id, state }) {
  const [tab, setTab] = useState("all");
  const deal = state?.deals.find((d) => d.id === id);
  if (!state) return <CrmShell section="deals"><div className="muted">Loading…</div></CrmShell>;
  if (!deal) return <CrmShell section="deals"><div className="muted">Deal not found.</div></CrmShell>;

  const contact = state.contacts[deal.contactId];
  const acts = (state.activity[deal.id] ?? []).slice().reverse();
  const shown = acts.filter((a) => (tab === "all" ? a.kind !== "property" : a.kind === tab));
  const stageIdx = state.stages.findIndex((s) => s.id === deal.stage);
  const label = (sid) => state.stages.find((s) => s.id === sid)?.label ?? sid;
  const tasks = acts.filter((a) => a.kind === "task");
  const meetings = acts.filter((a) => a.kind === "meeting");

  return (
    <CrmShell section="deals">
      <div className="record">
        <section className="card">
          <div className="muted">Deal</div>
          <h1 style={{ fontSize: 18, margin: "4px 0" }}>{deal.name}</h1>
          <div className="muted">{money(deal.amount)} · {deal.product}</div>
          <div className="stagebar">
            {state.stages.slice(0, 5).map((s, i) => (
              <div key={s.id} className={i <= stageIdx && deal.stage !== "closed_lost" ? "on" : ""} title={s.label} />
            ))}
          </div>
          <div style={{ fontWeight: 600, fontSize: 14 }}>Stage: {label(deal.stage)}</div>
          <div style={{ marginTop: 14 }}>
            <Prop k="Deal owner" v={deal.owner} />
            <Prop k="Last modified" v={fmtDateTime(deal.updatedAt)} />
            {Object.entries(PROP_LABELS).map(([k, l]) => <Prop key={k} k={l} v={deal.props[k]} custom />)}
          </div>
        </section>

        <section className="card">
          <div className="tabs">
            {["all", "note", "task", "meeting", "objection"].map((t) => (
              <button key={t} className={tab === t ? "on" : ""} onClick={() => setTab(t)}>
                {t === "all" ? "Activity" : t === "objection" ? "Objections" : t[0].toUpperCase() + t.slice(1) + "s"}
              </button>
            ))}
          </div>
          {shown.length === 0 && <div className="muted">No activity.</div>}
          {shown.map((a) => <ActivityCard key={a.id} a={a} label={label} />)}
        </section>

        <aside className="stack">
          <section className="card">
            <h2>Contact</h2>
            <div style={{ fontWeight: 600 }}>{contact ? `${contact.firstname} ${contact.lastname}` : "-"}</div>
            <div className="muted">{contact?.email}</div>
          </section>
          <section className="card">
            <h2>Upcoming meetings</h2>
            {meetings.length === 0 && <div className="muted">None</div>}
            {meetings.map((m) => (
              <div key={m.id} className="prop">
                <div className="v">{fmtDateTime(m.startAt)}</div>
                <div className="k">{m.title}</div>
                {m.calendarLink && <a href={m.calendarLink} target="_blank" rel="noreferrer">Google Calendar event</a>}
              </div>
            ))}
          </section>
          <section className="card">
            <h2>Open tasks</h2>
            {tasks.length === 0 && <div className="muted">None</div>}
            {tasks.map((t) => (
              <div key={t.id} className="prop">
                <div className="v">{t.title}</div>
                <div className="k">Due {fmtDateTime(t.dueAt)}</div>
              </div>
            ))}
          </section>
        </aside>
      </div>
    </CrmShell>
  );
}

function Prop({ k, v, custom }) {
  return (
    <div className={`prop ${custom ? "custom" : ""}`}>
      <div className="k">{k}</div>
      <div className={`v ${v ? "" : "empty"}`}>{v || "-"}</div>
    </div>
  );
}

function ActivityCard({ a, label }) {
  const src = a.source === "ai" ? <span className="pill ai">AI</span> : a.source === "system" ? <span className="pill">Automation</span> : null;
  const head = (title, extra) => (
    <div className="h">
      <span><b>{title}</b> {extra && <span className="muted">· {extra}</span>}</span>
      <span className="row" style={{ gap: 6 }}>{src}<span className="muted">{fmtDateTime(a.at)}</span></span>
    </div>
  );
  switch (a.kind) {
    case "note":
      return <div className="act">{head(`Note: ${a.title}`)}<div className="body">{a.body}</div></div>;
    case "task":
      return <div className="act">{head(`Task: ${a.title}`, `due ${fmtDateTime(a.dueAt)}`)}<div className="body">{a.body}</div></div>;
    case "meeting":
      return (
        <div className="act">
          {head(`Meeting booked: ${a.title}`)}
          <div className="body">
            {fmtDateTime(a.startAt)} · {a.attendees.join(", ")}
            {a.meetLink && <>{"\n"}<a href={a.meetLink} target="_blank" rel="noreferrer">{a.meetLink}</a></>}
          </div>
        </div>
      );
    case "stage":
      return <div className="act">{head("Deal stage changed")}<div className="body">{label(a.from)} → <b>{label(a.to)}</b></div></div>;
    case "objection":
      return <div className="act">{head(`Objection: ${CATEGORY[a.category] ?? a.category}`)}<div className="body">{a.detail}</div></div>;
    case "property":
      return <div className="act">{head("Properties updated")}<div className="body">{a.changed.join(", ")}</div></div>;
    default:
      return null;
  }
}

function Tasks({ state }) {
  const rows = (state?.deals ?? []).flatMap((d) => (state.activity[d.id] ?? []).filter((a) => a.kind === "task").map((t) => ({ t, d })));
  rows.sort((a, b) => a.t.dueAt.localeCompare(b.t.dueAt));
  return (
    <CrmShell section="tasks">
      <h1 style={{ fontSize: 20, marginTop: 0 }}>Tasks</h1>
      <div className="card">
        {rows.length === 0 && <div className="muted">No tasks yet.</div>}
        {rows.map(({ t, d }) => (
          <div key={t.id} className="prop">
            <div className="row" style={{ justifyContent: "space-between" }}>
              <div className="v" style={{ fontWeight: 600 }}>{t.title}</div>
              {t.source === "ai" && <span className="pill ai">AI</span>}
            </div>
            <div className="k">Due {fmtDateTime(t.dueAt)} · <A href={`/apex/crm/deals/${d.id}`}>{d.name}</A></div>
          </div>
        ))}
      </div>
    </CrmShell>
  );
}
