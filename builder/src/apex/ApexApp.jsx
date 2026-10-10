import React, { useCallback, useEffect, useState } from "react";
import { CVIProvider } from "../components/cvi/components/cvi-provider";
import { Conversation } from "../components/cvi/components/conversation";
import { useDaily } from "@daily-co/daily-react";

/* Apex Wealth demo — Live Call Console + CRM sandbox, served at /apex.
   Backend: /api/apex?op=… (api/apex.js). Signed-in builder session required. */

const API = (op) => `/api/apex?op=${op}`;

const CATEGORY = { fees: "Fee concern", guaranteed_returns: "Guaranteed returns", recession_risk: "Recession risk", account_setup: "Account setup timing", proprietary_products: "Proprietary products", transfers_in_kind: "Transfers in kind", compensation: "Compensation", book_ownership: "Book ownership", licensing: "Licensing", transition_effort: "Transition effort", regulatory: "Regulatory history", firm_stability: "Firm stability", other: "Other" };
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
  // Public share link: no sign-in, no console state.
  const pub = path.match(/^\/meet\/([a-z]+)$/);
  if (pub) return <PublicMeet firm={pub[1]} />;
  if (path === "/apex/score-preview") return <ScorePreview />;
  return <Signed path={path} />;
}

function Signed({ path }) {
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

  if (path === "/apex/room") return <Room {...app} />;
  if (path === "/apex/crm") return <DealsBoard {...app} />;
  if (path === "/apex/crm/tasks") return <Tasks {...app} />;
  if (path === "/apex/training") return <Training {...app} />;
  const m = path.match(/^\/apex\/crm\/deals\/([^/]+)$/);
  if (m) return <DealRecord id={decodeURIComponent(m[1])} {...app} />;
  return <Console {...app} />;
}

// ---- Console ------------------------------------------------------------------

function Console({ state, refresh }) {
  const [form, setForm] = useState({ meetingUrl: "", firstname: "Tim", lastname: "", email: "tim@tavus.io", firm: "apex", mode: "room", scenario: "hvac" });
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
      if (r.ok && op === "start" && j.conversationUrl) go("/apex/room");
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
            <h2>Send an avatar into a call</h2>
            <div>
              <label>Meeting type</label>
              <div className="seg">
                <button className={form.firm === "apex" ? "on" : ""} onClick={() => setForm({ ...form, firm: "apex" })}>
                  <b>Apex</b><span>Discovery call · 20-30 min</span>
                </button>
                <button className={form.firm === "optimize" ? "on" : ""} onClick={() => setForm({ ...form, firm: "optimize" })}>
                  <b>Optimize</b><span>Client brochure + initial meeting · 35-45 min</span>
                </button>
                <button className={form.firm === "corpdev" ? "on" : ""} onClick={() => setForm({ ...form, firm: "corpdev" })}>
                  <b>Optimize Corp Dev</b><span>Advisor recruiting intro · 30-40 min</span>
                </button>
                <button className={form.firm === "invitationhomes" ? "on" : ""} onClick={() => setForm({ ...form, firm: "invitationhomes", mode: "room" })}>
                  <b>Invitation Homes</b><span>Training roleplay + scorecard · 5-10 min</span>
                </button>
              </div>
            </div>
            {form.firm === "invitationhomes" && cfg?.scenarios && (
              <div>
                <label>Scenario</label>
                <ScenarioPicker scenarios={cfg.scenarios} value={form.scenario} onChange={(scenario) => setForm({ ...form, scenario })} />
              </div>
            )}
            <div>
              <label>Where</label>
              <div className="seg">
                <button className={form.mode === "room" ? "on" : ""} onClick={() => setForm({ ...form, mode: "room" })}>
                  <b>Standalone</b><span>Opens a call page in this browser</span>
                </button>
                <button className={form.mode === "zoom" ? "on" : ""} onClick={() => setForm({ ...form, mode: "zoom" })}>
                  <b>Zoom / Meet / Teams</b><span>Avatar joins your meeting link</span>
                </button>
              </div>
            </div>
            {form.mode === "zoom" && (
              <div>
                <label>Zoom / Meet / Teams link</label>
                <input placeholder="https://us02web.zoom.us/j/123456789?pwd=..." value={form.meetingUrl}
                  onChange={(e) => setForm({ ...form, meetingUrl: e.target.value.trim() })} />
              </div>
            )}
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div style={{ flex: 1 }}>
                <label>{form.firm === "corpdev" ? "Advisor first name" : form.firm === "invitationhomes" ? "Trainee first name" : "Prospect first name"}</label>
                <input value={form.firstname} onChange={(e) => setForm({ ...form, firstname: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Last name</label>
                <input value={form.lastname} onChange={(e) => setForm({ ...form, lastname: e.target.value })} />
              </div>
            </div>
            <div>
              <label>{form.firm === "corpdev" ? "Advisor email (gets the calendar invite)" : form.firm === "invitationhomes" ? "Trainee email (training record)" : "Prospect email (gets the calendar invite)"}</label>
              <input value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} />
            </div>
            <div className="row">
              <button className="primary" disabled={busy || !!active} onClick={() => call("start", form)}>
                {form.firm === "invitationhomes" ? "Start training" : `Send ${form.firm === "optimize" ? "Optimize" : form.firm === "corpdev" ? "Corp Dev" : "Apex"} in`}
              </button>
              <button className="danger" disabled={busy || !active} onClick={() => call("end")}>End call</button>
              {active?.mode === "room" && active.status !== "ended" && <A href="/apex/room">Rejoin call page →</A>}
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
                {Object.entries(cfg.firms || {}).map(([k, f]) => (
                  <React.Fragment key={k}><span>{f.label} avatar</span> <span className="pill">{f.palId || "not set"}</span></React.Fragment>
                ))}
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
      <div className="logo">APEX WEALTH ADVISORY <span>· {section === "crm" ? "CRM" : section === "training" ? "Training Records" : "Live Call Console"}</span></div>
      <nav>
        <A href="/apex" className={section === "console" ? "on" : ""}>Console</A>
        <A href="/apex/crm" className={section === "crm" ? "on" : ""}>CRM</A>
        <A href="/apex/training" className={section === "training" ? "on" : ""}>Training</A>
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
        <span className="muted">{state ? `${state.deals.filter((d) => d.firm !== "invitationhomes").length} deals` : "Loading…"}</span>
      </div>
      <div className="board">
        {state?.stages.map((st) => {
          const deals = state.deals.filter((d) => d.stage === st.id && d.firm !== "invitationhomes");
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
            {Object.entries(PROP_LABELS).filter(([k]) => !deal.firm || deal.firm === "apex" || deal.props[k] || k === "client_objections" || k === "discovery_summary")
              .map(([k, l]) => <Prop key={k} k={l} v={deal.props[k]} custom />)}
            {deal.firm === "corpdev" && (
              <>
                <div className="muted" style={{ marginTop: 14, fontWeight: 600 }}>Dealer Analysis Report inputs</div>
                {Object.entries(state.config?.advisorFields || {}).map(([k, l]) => <Prop key={k} k={l} v={deal.props[k]} custom />)}
              </>
            )}
            {deal.firm === "invitationhomes" && (
              <>
                <div className="muted" style={{ marginTop: 14, fontWeight: 600 }}>Training scorecard</div>
                {Object.entries(state.config?.trainingFields || {}).map(([k, l]) => <Prop key={k} k={l} v={deal.props[k]} custom />)}
              </>
            )}
            {deal.firm === "optimize" && (
              <>
                <div className="muted" style={{ marginTop: 14, fontWeight: 600 }}>Client profile (initial meeting)</div>
                {Object.entries(state.config?.profileFields || {}).map(([k, l]) => <Prop key={k} k={l} v={deal.props[k]} custom />)}
              </>
            )}
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

// ---- Standalone call page -------------------------------------------------------
// Tavus-hosted room rendered with the builder's vendored CVI call UI: the avatar's
// face, and its presentation (brochure pages) as the main view when it shares.

function Room({ state, refresh }) {
  const active = state?.active;
  const [showFeed, setShowFeed] = useState(true);
  const firmLabel = active ? state.config?.firms?.[active.firm]?.label || "Apex" : "";

  const leave = useCallback(async () => {
    await fetch(API("end"), { method: "POST", credentials: "same-origin" }).catch(() => {});
    await refresh();
    go("/apex");
  }, [refresh]);

  if (!state) return <div className="wrap muted">Loading…</div>;
  if (!active?.conversationUrl || active.mode !== "room") {
    return (
      <>
        <TopBar section="console" />
        <div className="wrap"><div className="card stack" style={{ maxWidth: 520 }}>
          <h2>No standalone call is live</h2>
          <A href="/apex">Back to the console</A>
        </div></div>
      </>
    );
  }

  const feed = (state.feed ?? []).filter((e) => e.conversationId === active.conversationId).slice().reverse();
  const sc = active.firm === "invitationhomes" ? state.config?.scenarios?.[active.scenario] : null;
  const roomDeal = state.deals.find((d) => d.id === active.dealId);
  return (
    <div className="room">
      <header className="topbar">
        <div className="logo">{firmLabel.toUpperCase()} <span>· {active.prospectName}</span></div>
        <nav>
          <a href="#" onClick={(e) => { e.preventDefault(); setShowFeed((v) => !v); }}>{showFeed ? "Hide" : "Show"} AI activity</a>
          {sc ? <A href="/apex/training" target="_blank">Training records ↗</A> : <A href="/apex/crm" target="_blank">CRM ↗</A>}
        </nav>
      </header>
      <div className={`room-body ${showFeed ? "with-feed" : ""}`}>
        <div className="room-stage">
          <CVIProvider>
            <Conversation conversationUrl={active.conversationUrl} onLeave={leave} />
            <AutoAdvance conversationId={active.conversationId} />
            {sc && <ScoreButton conversationId={active.conversationId} onResult={refresh} />}
          </CVIProvider>
        </div>
        {showFeed && (
          <aside className={`room-feed ${sc ? "ih-side" : ""}`}>
            {sc && <ScoreStatus />}
            {sc && roomDeal?.props?.overall_score && <ScorecardPanel p={roomDeal.props} />}
            {sc && <ScenarioBrief sc={sc} compact={!!roomDeal?.props?.overall_score} />}
            <div className="muted" style={{ fontWeight: 600, marginBottom: 8 }}>What the AI did</div>
            <div className="feed">
              {feed.length === 0 && <div className="muted">Actions appear here as the avatar takes them.</div>}
              {feed.map((e, i) => (
                <div key={i} className={`ev ${e.type}`}>
                  <div className="t">{fmtTime(e.at)}</div>
                  <div className="title">{e.title}</div>
                  {e.detail && <pre>{e.detail}</pre>}
                </div>
              ))}
            </div>
          </aside>
        )}
      </div>
    </div>
  );
}

// ---- Public share link (/meet/:firm) ----------------------------------------------
// A prospect opens the link, enters name + email, and talks to the avatar directly.
// Same CRM writes as the console; never shows internal activity.

function PublicMeet({ firm }) {
  const [info, setInfo] = useState(null);
  const [form, setForm] = useState({ firstname: "", lastname: "", email: "", scenario: "hvac" });
  const [call, setCall] = useState(null);
  const [phase, setPhase] = useState("form"); // form | call | done
  const [busy, setBusy] = useState(false);
  const [err, setErr] = useState(null);
  const [card, setCard] = useState(null);

  useEffect(() => {
    fetch(`${API("public_info")}&firm=${firm}`).then(async (r) => {
      const j = await r.json().catch(() => ({}));
      if (!r.ok) setErr(j.error || "This link isn't active.");
      else setInfo(j);
    });
  }, [firm]);

  async function start(e) {
    e.preventDefault();
    setBusy(true);
    setErr(null);
    try {
      const r = await fetch(API("public_start"), {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ...form, firm }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return setErr(j.error || "Couldn't start the call.");
      setCall(j);
      setPhase("call");
    } finally {
      setBusy(false);
    }
  }

  const leave = useCallback(() => {
    if (call) fetch(API("public_end"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: call.conversationId }) }).catch(() => {});
    setPhase("done");
  }, [call]);

  const label = info?.label || "";
  const training = info?.audience === "trainee";
  const picked = training ? info.scenarios.find((x) => x.id === form.scenario) : null;
  if (phase === "call" && call?.conversationUrl) {
    return (
      <div className="room">
        <header className="topbar"><div className="logo">{label.toUpperCase()}{training && <span> · Training Simulator</span>}</div></header>
        <div className={`room-body ${picked ? "with-feed" : ""}`}>
          <div className="room-stage">
            <CVIProvider>
              <Conversation conversationUrl={call.conversationUrl} onLeave={leave} />
              <AutoAdvance conversationId={call.conversationId} />
              {picked && <ScoreButton conversationId={call.conversationId} onResult={setCard} />}
            </CVIProvider>
          </div>
          {picked && <aside className="room-feed ih-side"><ScoreStatus />{card && <ScorecardPanel p={card} />}<ScenarioBrief sc={picked} compact={!!card} /></aside>}
        </div>
      </div>
    );
  }

  return (
    <div className="meet">
      <div className="meet-card">
        <div className="meet-brand">{label || " "}</div>
        {phase === "done" ? (
          <>
            <h1>Thanks for your time{form.firstname ? `, ${form.firstname}` : ""}.</h1>
            {training && card && <ScorecardPanel p={card} />}
            <p className="muted">{training ? "Your scorecard has been saved to your training record." : `If you booked a follow-up, the invite is on its way to ${form.email || "your inbox"}.`}</p>
            {training && <button className="primary" onClick={() => { setCall(null); setCard(null); setPhase("form"); }}>Run another scenario</button>}
          </>
        ) : err && !info ? (
          <>
            <h1>Link unavailable</h1>
            <p className="muted">{err}</p>
          </>
        ) : (
          <form onSubmit={start} className="stack">
            <h1>{info?.headline || "Meet your portfolio manager"}</h1>
            <p className="muted">
              {training ? "Practice a real conversation with a live AI roleplay partner, then get an instant scorecard and coaching. About 5-10 minutes." : `A live video conversation${info ? ` (about ${info.minutes} minutes)` : ""}.`} Allow camera and microphone when your browser asks.
            </p>
            {training && (
              <div>
                <label>Pick a scenario</label>
                <ScenarioPicker scenarios={Object.fromEntries(info.scenarios.map((x) => [x.id, x]))} value={form.scenario} onChange={(scenario) => setForm({ ...form, scenario })} />
              </div>
            )}
            <div className="row" style={{ flexWrap: "nowrap" }}>
              <div style={{ flex: 1 }}>
                <label>First name</label>
                <input required value={form.firstname} onChange={(e) => setForm({ ...form, firstname: e.target.value })} />
              </div>
              <div style={{ flex: 1 }}>
                <label>Last name</label>
                <input value={form.lastname} onChange={(e) => setForm({ ...form, lastname: e.target.value })} />
              </div>
            </div>
            <div>
              <label>Email</label>
              <input required type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value.trim() })} />
            </div>
            <button className="primary" disabled={busy || !info}>{busy ? "Starting…" : training ? "Start the roleplay" : "Start the conversation"}</button>
            {err && <div className="pill bad" style={{ whiteSpace: "normal" }}>{err}</div>}
            <p className="muted" style={{ fontSize: 12 }}>
              {training
                ? "You'll be speaking with an AI roleplay partner. Scenarios are fictional and for practice only; follow your actual company policies in the field. Say \"end scenario\" any time to get your scorecard."
                : `You'll be speaking with an AI avatar${info?.audience === "advisor" ? " from Optimize Corporate Development" : ""}. Past performance is not indicative of future results.`}
            </p>
          </form>
        )}
      </div>
    </div>
  );
}

// ---- Invitation Homes training simulator -------------------------------------------

function ScenarioPicker({ scenarios, value, onChange }) {
  const cur = scenarios[value];
  return (
    <div className="stack" style={{ gap: 8 }}>
      <div className="seg">
        {Object.entries(scenarios).map(([id, x]) => (
          <button key={id} type="button" className={value === id ? "on" : ""} onClick={() => onChange(id)}>
            <b>{x.label}</b><span>{x.track}</span>
          </button>
        ))}
      </div>
      {cur && <div className="muted" style={{ fontSize: 13 }}>{cur.brief}</div>}
    </div>
  );
}

function ScenarioBrief({ sc, compact }) {
  return (
    <div className="ih-card ih-brief">
      <div className="ih-eyebrow">{sc.track}</div>
      <div className="ih-title">{sc.label}</div>
      <p className="ih-text">{sc.brief}</p>
      {!compact && (
        <>
          <div className="ih-eyebrow" style={{ marginTop: 14 }}>You're scored on</div>
          <div className="ih-chips">{sc.criteria.map((c, i) => <span key={c} className="ih-chip"><b>{i + 1}</b>{c}</span>)}</div>
          <div className="ih-hint">Done? Hit <b>End scenario &amp; score me</b> on the video.</div>
        </>
      )}
    </div>
  );
}

/* Design preview of the in-call scorecard with sample data (no call needed). */
function ScorePreview() {
  const sc = { track: "Resident service · Difficult customer", label: "Upset resident: repeat AC failure", brief: "You're the technician. Marcus's AC has failed three times in five weeks, it's 96°F inside and the last tech no-showed.", criteria: [] };
  const p = {
    overall_score: "78",
    outcome: "Marcus calmed down and agreed to a same-day repair with portable units as a fallback.",
    criteria_scores: "Acknowledges impact and empathizes: 5/5 - 'I'm really sorry, 96 degrees with Maya's asthma is not okay'; Takes ownership (no blaming): 4/5 - 'That no-show is on us'; Clear next steps and realistic commitments: 4/5 - laid out diagnosis now and portable units by 3pm; Stays calm and professional under pressure: 4/5 - steady tone when threatened with reviews; Escalates the credit request correctly (doesn't promise it): 2/5 - said 'I'll get you a credit' without supervisor sign-off",
    strengths: "1) Named Maya and the heat specifically before talking about the repair. 2) Owned the no-show without blaming the vendor.",
    improvements: "1) Don't promise the rent credit; try 'I'm putting in a credit request with my supervisor today and you'll hear back by Friday.' 2) Confirm a callback time before leaving.",
  };
  return (
    <div className="room">
      <header className="topbar"><div className="logo">INVITATION HOMES<span> · Training Simulator</span></div></header>
      <div className="room-body with-feed">
        <div className="room-stage"><div style={{ background: "#1b2a3a", borderRadius: 12 }} /><button className="primary score-btn"><span className="dot" />End scenario &amp; score me</button></div>
        <aside className="room-feed ih-side"><ScorecardPanel p={p} /><ScenarioBrief sc={sc} compact /></aside>
      </div>
    </div>
  );
}

function Training({ state }) {
  const rows = (state?.deals ?? []).filter((d) => d.firm === "invitationhomes").sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  return (
    <>
      <TopBar section="training" />
      <div className="sandbox-banner">Invitation Homes Training Simulator. Each session's scorecard is written by the AI roleplay partner at the end of the scenario.</div>
      <main className="wrap stack">
        <div className="row" style={{ justifyContent: "space-between" }}>
          <h1 style={{ fontSize: 20, margin: 0 }}>Training records</h1>
          <span className="muted">{state ? `${rows.length} session${rows.length === 1 ? "" : "s"}` : "Loading…"}</span>
        </div>
        {state && rows.length === 0 && <div className="card muted">No sessions yet. Start one from the Console (Invitation Homes) or the share link /meet/invitationhomes.</div>}
        {rows.map((d) => {
          const c = state.contacts[d.contactId];
          const p = d.props;
          return (
            <section key={d.id} className="card stack">
              <div className="row" style={{ justifyContent: "space-between" }}>
                <div>
                  <div style={{ fontWeight: 600 }}>{c ? `${c.firstname} ${c.lastname}`.trim() : "Trainee"} · {d.product}</div>
                  <div className="muted">{fmtDateTime(d.createdAt)} · {c?.email}</div>
                </div>
                <div className="row" style={{ gap: 8 }}>
                  {p.safety_flag && <span className="pill bad">Safety flag</span>}
                  <span className={`pill ${p.overall_score ? (Number(p.overall_score) >= 75 ? "ok" : "") : ""}`} style={{ fontSize: 15 }}>{p.overall_score ? `${p.overall_score}/100` : "in progress"}</span>
                </div>
              </div>
              {p.outcome && <div>{p.outcome}</div>}
              {p.criteria_scores && <pre style={{ whiteSpace: "pre-wrap", margin: 0, fontFamily: "inherit", fontSize: 13 }}>{p.criteria_scores}</pre>}
              {p.strengths && <div><b>Strengths:</b> {p.strengths}</div>}
              {p.improvements && <div><b>Improve:</b> {p.improvements}</div>}
              {p.safety_flag && <div className="pill bad" style={{ whiteSpace: "normal" }}>{p.safety_flag}</div>}
              <A href={`/apex/crm/deals/${d.id}`}>Full record →</A>
            </section>
          );
        })}
      </main>
    </>
  );
}

// Scorecard: the call page records both sides' speech and, on click, asks the server to
// grade it (api op=score) while cueing the avatar to step out of character and debrief.
// Doesn't depend on the avatar calling its tool.

const scoreBus = new EventTarget();

function ScoreButton({ conversationId, onResult }) {
  const daily = useDaily();
  const lines = React.useRef([]);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    if (!daily) return;
    const onMsg = (e) => {
      const d = e?.data;
      if (!/^conversation\.utterance$/i.test(d?.event_type || "")) return;
      const role = String(d.properties?.role ?? "").toLowerCase() === "user" ? "user" : "replica";
      const text = String(d.properties?.speech ?? d.properties?.text ?? "").trim();
      if (!text) return;
      const last = lines.current[lines.current.length - 1];
      // Utterances can re-emit cumulatively within a turn: replace, don't stack.
      if (last && last.role === role && (text.startsWith(last.text) || last.text.startsWith(text))) last.text = text.length > last.text.length ? text : last.text;
      else lines.current.push({ role, text });
    };
    daily.on("app-message", onMsg);
    return () => daily.off("app-message", onMsg);
  }, [daily]);

  async function go() {
    setBusy(true);
    scoreBus.dispatchEvent(new CustomEvent("s", { detail: { state: "grading" } }));
    const transcript = lines.current.map((l) => ({ ...l }));
    try {
      daily?.sendAppMessage({ message_type: "conversation", event_type: "conversation.respond", conversation_id: conversationId,
        properties: { text: "End scenario. Step out of character and give me my coaching debrief." } }, "*");
    } catch { /* room gone */ }
    try {
      const r = await fetch(API("score"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId, transcript }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `Error ${r.status}`);
      onResult?.(j.scorecard);
      scoreBus.dispatchEvent(new CustomEvent("s", { detail: { state: "done" } }));
    } catch (e) {
      scoreBus.dispatchEvent(new CustomEvent("s", { detail: { state: "error", msg: e.message } }));
    } finally {
      setBusy(false);
    }
  }

  return (
    <button className="primary score-btn" disabled={busy} onClick={go}>
      <span className="dot" />{busy ? "Scoring…" : "End scenario & score me"}
    </button>
  );
}

function ScoreStatus() {
  const [st, setSt] = useState(null);
  useEffect(() => {
    const on = (e) => setSt(e.detail);
    scoreBus.addEventListener("s", on);
    return () => scoreBus.removeEventListener("s", on);
  }, []);
  if (!st || st.state === "done") return null;
  if (st.state === "error") return <div className="ih-card ih-error">Couldn't score this run: {st.msg}</div>;
  return (
    <div className="ih-card ih-grading">
      <div className="ih-spinner" />
      <div>
        <div className="ih-title" style={{ fontSize: 15 }}>Grading your roleplay…</div>
        <div className="ih-text">Reviewing the conversation against each criterion.</div>
      </div>
    </div>
  );
}

/* "Name: 4/5 - evidence" lines, newline- or semicolon-separated. */
function parseCriteria(text = "") {
  const parts = String(text).split(/\n+|;\s*(?=[^;:]{3,90}:\s*\d(?:\.\d)?\s*\/\s*5)/).map((x) => x.trim()).filter(Boolean);
  const rows = parts.map((x) => {
    const m = x.match(/^(?:\d+[.)]\s*)?(.+?):\s*(\d(?:\.\d)?)\s*\/\s*5\s*(?:[-–—:]\s*)?([\s\S]*)$/);
    return m ? { name: m[1].trim(), score: Math.max(0, Math.min(5, Number(m[2]))), note: m[3].trim() } : null;
  });
  return rows.every(Boolean) ? rows : null;
}
const splitPoints = (t = "") => {
  const parts = String(t).split(/\s*(?:\(\d\)|\b\d[.)])\s+|\n+|;\s+(?=[A-Z])/).map((x) => x.trim()).filter((x) => x.length > 3);
  return parts.length ? parts : [String(t)];
};
const tone = (n, max) => (n / max >= 0.75 ? "good" : n / max >= 0.5 ? "mid" : "low");

function ScorecardPanel({ p }) {
  const n = Math.max(0, Math.min(100, Number(p.overall_score) || 0));
  const rows = parseCriteria(p.criteria_scores);
  const t = tone(n, 100);
  return (
    <div className="ih-card ih-score">
      <div className="ih-score-head">
        <div className={`ih-ring ${t}`} style={{ "--pct": n }}>
          <div><b>{n}</b><span>/100</span></div>
        </div>
        <div>
          <div className="ih-eyebrow">Your scorecard</div>
          <div className="ih-title">{t === "good" ? "Strong run" : t === "mid" ? "Solid start" : "Needs another rep"}</div>
          {p.outcome && <p className="ih-text">{p.outcome}</p>}
        </div>
      </div>

      {p.safety_flag && <div className="ih-flag"><span>⚠</span><div><b>Safety</b>{p.safety_flag}</div></div>}

      {rows ? (
        <div className="ih-crit">
          {rows.map((r) => (
            <div key={r.name} className="ih-crit-row">
              <div className="ih-crit-top">
                <span>{r.name}</span>
                <b className={tone(r.score, 5)}>{r.score}<i>/5</i></b>
              </div>
              <div className="ih-bar"><div className={tone(r.score, 5)} style={{ width: `${(r.score / 5) * 100}%` }} /></div>
              {r.note && <div className="ih-note">{r.note}</div>}
            </div>
          ))}
        </div>
      ) : p.criteria_scores && <p className="ih-text">{p.criteria_scores}</p>}

      {p.strengths && (
        <div className="ih-callout good">
          <div className="ih-eyebrow">What worked</div>
          <ul>{splitPoints(p.strengths).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
      {p.improvements && (
        <div className="ih-callout fix">
          <div className="ih-eyebrow">Try next time</div>
          <ul>{splitPoints(p.improvements).map((x, i) => <li key={i}>{x}</li>)}</ul>
        </div>
      )}
    </div>
  );
}

// ---- Presentation pacing ------------------------------------------------------------
// The avatar presents one brochure page per turn, so something has to start the
// next turn. Prompt wording can't time that, and Tavus's idle_engagement either
// waits too long or jumps in while the prospect is thinking. So the call page
// decides: while the avatar is presenting (screen track live), if its turn ended
// on a statement and the prospect hasn't started talking within ~1.5s, cue the
// next page. If the turn ended on a question, wait for the prospect.

const ADVANCE_DELAY_MS = 700;
const UNKNOWN_TURN_DELAY_MS = 2000;
const MAX_UNANSWERED_ADVANCES = 14; // runaway guard; resets when the prospect speaks

function AutoAdvance({ conversationId }) {
  const daily = useDaily();
  useEffect(() => {
    if (!daily || !conversationId) return;
    let buf = "";
    let timer = null;
    let userTalking = false;
    let advances = 0;
    let deckDone = false; // after the last deck pause, pacing cues would only interrupt discovery / the goodbye

    const roleOf = (d) => String(d.properties?.role ?? (/\.user\./i.test(d.event_type) ? "user" : "replica")).toLowerCase();
    const presenting = () =>
      Object.values(daily.participants() || {}).some(
        (p) => !p.local && ["playable", "loading", "interrupted"].includes(p.tracks?.screenVideo?.state)
      );

    const onMsg = (e) => {
      const d = e?.data;
      if (!d?.event_type) return;
      const who = roleOf(d);

      if (/^conversation\.utterance$/i.test(d.event_type) && who !== "user") {
        const t = String(d.properties?.speech ?? d.properties?.text ?? "").trim();
        // Utterances can arrive cumulatively; replace rather than stack.
        if (t) buf = t.startsWith(buf) ? t : buf.startsWith(t) ? buf : `${buf} ${t}`.trim();
        return;
      }
      if (/started_speaking/i.test(d.event_type)) {
        clearTimeout(timer);
        if (who === "user") { userTalking = true; advances = 0; buf = ""; }
        return;
      }
      if (/stopped_speaking/i.test(d.event_type)) {
        clearTimeout(timer);
        if (who === "user") { userTalking = false; return; }
        // Decide when the timer fires (the transcript can land just after stopped_speaking).
        const decide = (extended) => {
          if (userTalking || !presenting()) { buf = ""; return; }
          const said = buf.trim();
          if (!said && !extended) {
            // No transcript yet: can't tell question from statement, so give the prospect longer.
            timer = setTimeout(() => decide(true), UNKNOWN_TURN_DELAY_MS - ADVANCE_DELAY_MS);
            return;
          }
          buf = "";
          if (/few quick details|rest of your day|speaking with you soon|step out of the roleplay/i.test(said)) deckDone = true;
          if (deckDone) return;
          // A question anywhere near the end of the turn means "wait for the prospect",
          // even if the avatar tacked a short line on after it.
          if (said.slice(-220).includes("?")) return;
          if (advances >= MAX_UNANSWERED_ADVANCES) return;
          advances += 1;
          try {
            daily.sendAppMessage(
              { message_type: "conversation", event_type: "conversation.respond", conversation_id: conversationId, properties: { text: "(continue)" } },
              "*"
            );
          } catch { /* room gone */ }
        };
        timer = setTimeout(() => decide(false), ADVANCE_DELAY_MS);
      }
    };

    // When the avatar hangs up (end_call), close our side too instead of leaving an empty room.
    const onLeft = (e) => {
      if (e?.participant?.local) return;
      setTimeout(() => {
        const others = Object.values(daily.participants() || {}).filter((p) => !p.local);
        if (!others.length) daily.leave().catch(() => {});
      }, 2500);
    };
    daily.on("app-message", onMsg);
    daily.on("participant-left", onLeft);
    return () => { clearTimeout(timer); daily.off("app-message", onMsg); daily.off("participant-left", onLeft); };
  }, [daily, conversationId]);
  return null;
}
