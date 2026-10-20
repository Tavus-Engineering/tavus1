import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useDaily } from "@daily-co/daily-react";
import { CVIProvider } from "../components/cvi/components/cvi-provider";
import { Conversation } from "../components/cvi/components/conversation";
import { createChannel } from "./channel.js";

// MoneyMaya "Maya" demo (/maya): a debt relief application with Maya live
// beside it. Instead of watching a screen share (which lags), the form sends
// every change into the call as it happens:
//   note  → conversation.append_llm_context (silent; Maya just knows)
//   nudge → conversation.respond (Maya speaks), held while anyone is talking
// Maya's PAL prompt explains the [FORM EVENT] convention.

const API = (op) => `/api/maya?op=${op}`;

const DEBT = [
  ["100000+", "$100,000+", 100000], ["90000", "$90,000 – $99,999", 95000], ["80000", "$80,000 – $89,999", 85000],
  ["70000", "$70,000 – $79,999", 75000], ["60000", "$60,000 – $69,999", 65000], ["50000", "$50,000 – $59,999", 55000],
  ["40000", "$40,000 – $49,999", 45000], ["30000", "$30,000 – $39,999", 35000], ["20000", "$20,000 – $29,999", 25000],
  ["15000", "$15,000 – $19,999", 17500], ["10000", "$10,000 – $14,999", 12500], ["7500", "$7,500 – $9,999", 8750],
  ["5000", "$5,000 – $7,499", 6250], ["0", "$0 – $4,999", 2500],
];
const STATES = "AL AK AZ AR CA CO CT DE DC FL GA HI ID IL IN IA KS KY LA ME MD MA MI MN MS MO MT NE NV NH NJ NM NY NC ND OH OK OR PA RI SC SD TN TX UT VT VA WA WV WI WY".split(" ");
const STEP_NAMES = ["debt amount", "name", "home address", "date of birth", "quote"];
const STEP_FIELDS = { 1: ["debt"], 2: ["first", "last"], 3: ["street", "city", "state", "zip"], 4: ["dob"] };
const EMPTY = { debt: "", cards: false, income: false, first: "", last: "", street: "", city: "", state: "", zip: "", dob: "" };
const IDLE_MS = 30000;
const ERROR_GRACE_MS = 1500;

const fmt = (n) => "$" + Math.round(n).toLocaleString();
const debtLabel = (v) => DEBT.find((d) => d[0] === v)?.[1] || "";

function ageFromDob(s) {
  const m = /^(\d{2})\/(\d{2})\/(\d{4})$/.exec(s);
  if (!m) return null;
  const [mo, d, y] = [+m[1], +m[2], +m[3]];
  const dt = new Date(y, mo - 1, d);
  if (dt.getFullYear() !== y || dt.getMonth() !== mo - 1 || dt.getDate() !== d) return null;
  const now = new Date();
  let age = now.getFullYear() - y;
  if (now < new Date(now.getFullYear(), mo - 1, d)) age--;
  return age >= 18 && age < 120 ? age : null;
}

// Each rule returns null when valid, or a plain-English error for Maya.
const RULES = {
  debt: (v) => (v.debt ? null : "no debt range selected"),
  first: (v) => (v.first.trim() ? null : "first name is empty"),
  last: (v) => (v.last.trim() ? null : "last name is empty"),
  street: (v) => (v.street.trim().length >= 4 ? null : "street address is missing or too short"),
  city: (v) => (v.city.trim() ? null : "city is empty"),
  state: (v) => (v.state ? null : "no state selected"),
  zip: (v) => {
    if (!/^\d{5}$/.test(v.zip)) return `ZIP code "${v.zip || "(blank)"}" is not a valid 5-digit ZIP`;
    if (v.state === "CA" && !/^9[0-6]/.test(v.zip)) return `ZIP code ${v.zip} doesn't match California`;
    return null;
  },
  dob: (v) => (ageFromDob(v.dob) ? null : `date of birth "${v.dob || "(blank)"}" is not a valid MM/DD/YYYY date for an adult`),
};

// What Maya is told when a field is done. Street and full birth date stay summarized.
function describe(f, v) {
  switch (f) {
    case "debt": return `Applicant selected total debt range ${debtLabel(v.debt)}.`;
    case "first": return `Applicant entered first name: ${v.first.trim()}.`;
    case "last": return `Applicant entered last name: ${v.last.trim()}.`;
    case "street": return "Applicant entered their street address.";
    case "city": return `Applicant entered city: ${v.city.trim()}.`;
    case "state": return `Applicant selected state: ${v.state}.`;
    case "zip": return `Applicant entered a valid ZIP code (${v.zip}).`;
    case "dob": return `Applicant entered a valid date of birth (age ${ageFromDob(v.dob)}).`;
    default: return "";
  }
}

const UI_ERRORS = {
  debt: "Pick the range closest to your total unsecured debt.",
  first: "Please enter your first name.", last: "Please enter your last name.",
  street: "Please enter your street address.", city: "Enter your city.", state: "Pick a state.",
  zip: "Enter a valid 5-digit ZIP.", dob: "Enter a valid date as MM/DD/YYYY.",
};

// Illustrative only (labelled on the page): est. settlement + fees ≈ 75% of enrolled debt.
function estimate(debtValue) {
  const debt = DEBT.find((d) => d[0] === debtValue)?.[2] ?? 25000;
  const months = debt < 10000 ? 24 : debt < 25000 ? 36 : debt < 50000 ? 42 : 48;
  return { debt, months, monthly: (debt * 0.75) / months };
}

// Inside CVIProvider: hands the Daily call object to the channel and reports
// "connected" once Maya (the remote participant) is actually in the room.
function MayaBridge({ channel, conversationId, onConnected }) {
  const daily = useDaily();
  useEffect(() => {
    if (!daily) return;
    channel.daily = daily;
    channel.conversationId = conversationId;
    const check = () => {
      if (channel.connected) return;
      const remote = Object.values(daily.participants() || {}).some((p) => !p.local);
      if (remote && daily.meetingState() === "joined-meeting") { channel.connected = true; onConnected(); }
    };
    const onMsg = (e) => channel.onAppMessage(e);
    daily.on("app-message", onMsg);
    daily.on("joined-meeting", check);
    daily.on("participant-joined", check);
    check();
    return () => {
      daily.off("app-message", onMsg);
      daily.off("joined-meeting", check);
      daily.off("participant-joined", check);
    };
  }, [daily, channel, conversationId, onConnected]);
  return null;
}

export default function MayaApp() {
  const [step, setStep] = useState(1);
  const [values, setValues] = useState(EMPTY);
  const [bad, setBad] = useState({});
  const [zipMsg, setZipMsg] = useState(UI_ERRORS.zip);
  const [quote, setQuote] = useState(null);
  const [call, setCall] = useState(null);
  const [starting, setStarting] = useState(false);
  const [startErr, setStartErr] = useState("");
  const [live, setLive] = useState(false);
  const [feed, setFeed] = useState([]);

  const valuesRef = useRef(values);
  const stepRef = useRef(step);
  stepRef.current = step;
  const lastReported = useRef({});
  const errorTimers = useRef({});
  const idleTimer = useRef(null);
  const idleNudged = useRef({});

  const log = useCallback((kind, text, sent) => {
    const t = new Date().toLocaleTimeString([], { minute: "2-digit", second: "2-digit" });
    setFeed((f) => [{ id: Math.random(), kind, text, sent, t }, ...f].slice(0, 80));
  }, []);
  const channel = useMemo(() => createChannel(log), [log]);

  const stepName = (n = stepRef.current) => STEP_NAMES[n - 1];

  const armIdle = useCallback(() => {
    clearTimeout(idleTimer.current);
    const s = stepRef.current;
    if (s >= 5 || idleNudged.current[s]) return;
    idleTimer.current = setTimeout(() => {
      if (!channel.connected) return;
      idleNudged.current[s] = true;
      channel.nudge(`The applicant has been on the ${STEP_NAMES[s - 1]} step for about 30 seconds without finishing. They may be stuck or hesitant. Check in gently.`, () => stepRef.current === s);
    }, IDLE_MS);
  }, [channel]);

  useEffect(() => { armIdle(); return () => clearTimeout(idleTimer.current); }, [step, armIdle]);
  // Talking counts as activity: a 30s chat with Maya on one step isn't being stuck.
  useEffect(() => { channel.onActivity = armIdle; }, [channel, armIdle]);

  const setField = (f, val) => {
    valuesRef.current = { ...valuesRef.current, [f]: val };
    setValues(valuesRef.current);
    armIdle();
    // Clear an error as soon as it's fixed, without waiting for blur.
    if (bad[f] && RULES[f] && !RULES[f](valuesRef.current)) check(f);
  };

  function check(f, { speakOnError = true } = {}) {
    const v = valuesRef.current;
    const error = RULES[f](v);
    setBad((b) => ({ ...b, [f]: !!error }));
    if (f === "zip" && error) setZipMsg(/match/.test(error) ? "That ZIP doesn't match the state you picked." : UI_ERRORS.zip);
    const key = error ? "E:" + error : "OK:" + describe(f, v);
    if (lastReported.current[f] === key) return error;
    lastReported.current[f] = key;
    clearTimeout(errorTimers.current[f]);
    if (!error) channel.note(describe(f, v));
    else if (speakOnError) {
      // Give them a beat to fix it themselves before Maya says anything.
      errorTimers.current[f] = setTimeout(() => {
        if (RULES[f](valuesRef.current)) channel.nudge(`An error is showing on the form: ${error}. Help the applicant fix it, briefly.`, () => !!RULES[f](valuesRef.current));
      }, ERROR_GRACE_MS);
    }
    return error;
  }

  const onBlur = (f) => () => { if (valuesRef.current[f].trim()) check(f); };
  const onSelect = (f) => (e) => { setField(f, e.target.value); check(f); };
  const onCheck = (f, label) => (e) => {
    setField(f, e.target.checked);
    channel.note(`Applicant ${e.target.checked ? "checked" : "unchecked"}: ${label}.`);
  };

  const next = () => {
    const errs = STEP_FIELDS[step].map((f) => check(f, { speakOnError: false })).filter(Boolean);
    if (errs.length) {
      const blocked = STEP_FIELDS[step];
      channel.nudge(`The applicant tried to continue but the form blocked them: ${errs.join("; ")}. Help them fix it, briefly.`, () => blocked.some((f) => RULES[f](valuesRef.current)));
      return;
    }
    window.scrollTo({ top: 0, behavior: "smooth" });
    if (step < 4) {
      const n = step + 1;
      setStep(n);
      stepRef.current = n;
      channel.nudge(`Applicant finished the previous step and is now on step ${n} of 4: ${stepName(n)}. Briefly tell them what this step is for and why it's asked.`, () => stepRef.current === n);
      return;
    }
    setStep(5);
    stepRef.current = 5;
    setQuote(null);
    channel.note("Applicant submitted the form. The results page is loading.");
    setTimeout(() => {
      const q = estimate(valuesRef.current.debt);
      setQuote(q);
      channel.nudge(`The results page is now showing. Estimated debt enrolled: ${fmt(q.debt)}. Estimated monthly deposit: ${fmt(q.monthly)} per month. Estimated program length: ${q.months} months. These are illustrative estimates, not an offer. The next step is a free consultation call from a debt specialist, with no upfront fees. Walk the applicant through it simply.`);
    }, 2200);
  };

  const back = () => {
    const n = step - 1;
    setStep(n);
    stepRef.current = n;
    channel.note(`Applicant went back to step ${n} of 4: ${stepName(n)}.`);
  };

  const restart = () => {
    valuesRef.current = EMPTY;
    setValues(EMPTY);
    setBad({});
    setQuote(null);
    lastReported.current = {};
    idleNudged.current = {};
    setStep(1);
    stepRef.current = 1;
    channel.note("Applicant restarted the application from step 1.");
  };

  const startMaya = async () => {
    setStarting(true);
    setStartErr("");
    try {
      const r = await fetch(API("start"), { method: "POST", headers: { "Content-Type": "application/json" }, body: "{}" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok || !j.conversationUrl) throw new Error(j.error || "Couldn't start the call. Please try again in a minute.");
      setCall({ conversationId: j.conversationId, conversationUrl: j.conversationUrl });
      log("sys", `Starting call ${j.conversationId}`, true);
    } catch (e) {
      setStartErr(e.message);
    } finally {
      setStarting(false);
    }
  };

  const onConnected = useCallback(() => {
    setLive(true);
    log("sys", "Maya joined", true);
    const s = Math.min(stepRef.current, 4);
    channel.note(`Session start. The applicant has the form open next to you and is on step ${s} of 4 (${STEP_NAMES[s - 1]}). You will get form updates like this one instantly; you do not need a screen share.`);
    armIdle();
  }, [channel, log, armIdle]);

  const callId = call?.conversationId;
  const leave = useCallback(() => {
    if (callId) fetch(API("end"), { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ conversationId: callId }) }).catch(() => {});
    channel.reset();
    setLive(false);
    setCall(null);
  }, [callId, channel]);

  // DOB auto-slash; ZIP digits only.
  const onDob = (e) => {
    let d = e.target.value.replace(/\D/g, "").slice(0, 8);
    if (d.length > 4) d = d.slice(0, 2) + "/" + d.slice(2, 4) + "/" + d.slice(4);
    else if (d.length > 2) d = d.slice(0, 2) + "/" + d.slice(2);
    setField("dob", d);
  };

  const field = (f, label, props = {}) => (
    <div className={`field${bad[f] ? " bad" : ""}`}>
      <label className="f" htmlFor={f}>{label}</label>
      <input type="text" id={f} value={values[f]} onChange={(e) => setField(f, e.target.value)} onBlur={onBlur(f)} {...props} />
      <div className="err">{f === "zip" ? zipMsg : UI_ERRORS[f]}</div>
    </div>
  );

  return (
    <div className="maya-page">
      <div className="banner">Concept demo built with Tavus. Not a real application, and nothing you type is submitted or stored.</div>
      <header className="maya-head">
        <div className="logo">Money<span>Maya</span></div>
        <div className="tag">Debt relief, guided by Maya</div>
      </header>

      <main className="maya-main">
        <section className="card form" aria-live="polite">
          <div className="progress">{[1, 2, 3, 4, 5].map((i) => <i key={i} className={i <= step ? "on" : ""} />)}</div>

          {step === 1 && (
            <div className="step">
              <p className="eyebrow">Step 1 of 4</p>
              <h1>Need debt relief?</h1>
              <p className="sub">Pay less than you owe, in less time than you think.</p>
              <ul className="perks"><li>Save up to 45% of what you owe*</li><li>Debt free in as little as 24–48 months*</li><li>Free consultation, zero up-front fees</li></ul>
              <div className={`field${bad.debt ? " bad" : ""}`}>
                <label className="f" htmlFor="debt">How big is your debt?</label>
                <select id="debt" value={values.debt} onChange={onSelect("debt")}>
                  <option value="">Select an amount</option>
                  {DEBT.map(([v, l]) => <option key={v} value={v}>{l}</option>)}
                </select>
                <div className="err">{UI_ERRORS.debt}</div>
              </div>
              <label className="check"><input type="checkbox" checked={values.cards} onChange={onCheck("cards", "most of their debt is from credit cards")} /> Most of my debt is from credit cards</label>
              <label className="check"><input type="checkbox" checked={values.income} onChange={onCheck("income", "they have a steady income")} /> Yes, I have a steady income</label>
              <div className="actions"><button className="btn" onClick={next}>See if you qualify</button></div>
              <p className="fine">*Subject to terms of program. Results vary.</p>
            </div>
          )}

          {step === 2 && (
            <div className="step">
              <p className="eyebrow">Step 2 of 4</p>
              <h1>Great news, let's keep going.</h1>
              <p className="sub">What's your name?</p>
              <div className="row">
                {field("first", "First name", { autoComplete: "given-name" })}
                {field("last", "Last name", { autoComplete: "family-name" })}
              </div>
              <div className="actions"><button className="btn ghost" onClick={back}>Back</button><button className="btn" onClick={next}>Continue</button></div>
            </div>
          )}

          {step === 3 && (
            <div className="step">
              <p className="eyebrow">Step 3 of 4</p>
              <h1>Where do you live?</h1>
              <p className="sub">Programs vary by state, so we need your home address.</p>
              {field("street", "Street address", { autoComplete: "address-line1" })}
              <div className="row3">
                {field("city", "City", { autoComplete: "address-level2" })}
                <div className={`field${bad.state ? " bad" : ""}`}>
                  <label className="f" htmlFor="state">State</label>
                  <select id="state" value={values.state} onChange={onSelect("state")} autoComplete="address-level1">
                    <option value="">--</option>
                    {STATES.map((s) => <option key={s} value={s}>{s}</option>)}
                  </select>
                  <div className="err">{UI_ERRORS.state}</div>
                </div>
                {field("zip", "ZIP", { inputMode: "numeric", maxLength: 5, autoComplete: "postal-code", onChange: (e) => setField("zip", e.target.value.replace(/\D/g, "").slice(0, 5)) })}
              </div>
              <div className="actions"><button className="btn ghost" onClick={back}>Back</button><button className="btn" onClick={next}>Continue</button></div>
            </div>
          )}

          {step === 4 && (
            <div className="step">
              <p className="eyebrow">Step 4 of 4</p>
              <h1>Last thing: your date of birth.</h1>
              <p className="sub">This helps verify your identity and find the right program.</p>
              <div style={{ maxWidth: 260 }}>{field("dob", "Date of birth", { inputMode: "numeric", placeholder: "MM/DD/YYYY", maxLength: 10, autoComplete: "bday", onChange: onDob })}</div>
              <div className="actions"><button className="btn ghost" onClick={back}>Back</button><button className="btn" onClick={next}>See my results</button></div>
              <p className="lock">🔒 Your information is encrypted and never sold.</p>
            </div>
          )}

          {step === 5 && !quote && (
            <div className="step loading"><div className="spinner" /><strong>Reviewing your information…</strong><p className="sub">This only takes a moment.</p></div>
          )}

          {step === 5 && quote && (
            <div className="step">
              <p className="eyebrow">Your estimate</p>
              <h1>{values.first.trim() ? `${values.first.trim()}, you` : "You"} may qualify.</h1>
              <p className="sub">Here's what a debt relief program could look like for you.</p>
              <div className="quote-grid">
                <div className="stat"><small>Debt enrolled (est.)</small><b>{fmt(quote.debt)}</b></div>
                <div className="stat hero"><small>Est. monthly deposit</small><b>{fmt(quote.monthly)}/mo</b></div>
                <div className="stat"><small>Est. program length</small><b>{quote.months} months</b></div>
              </div>
              <div className="next"><strong>What happens next:</strong> a debt specialist will call you for a free consultation to build a plan around your budget. There are no up-front fees.</div>
              <p className="fine">Illustrative demo figures, not an offer. Actual results depend on program terms, creditor participation and your individual situation. Debt settlement may affect your credit.</p>
              <div className="actions"><button className="btn ghost" onClick={restart}>Start over</button></div>
            </div>
          )}
        </section>

        <aside className="maya-side">
          <div className="card maya-stage">
            {call ? (
              <CVIProvider>
                <Conversation conversationUrl={call.conversationUrl} onLeave={leave} />
                <MayaBridge channel={channel} conversationId={call.conversationId} onConnected={onConnected} />
              </CVIProvider>
            ) : (
              <div className="connect">
                <div className="avatar">M</div>
                <h2>Apply with Maya</h2>
                <p>Your personal guide. She'll walk through each step with you and sees your progress as you go.</p>
                <button className="btn" onClick={startMaya} disabled={starting}>{starting ? "Connecting…" : "Start with Maya"}</button>
                <div className="status">{startErr}</div>
              </div>
            )}
          </div>
          <details className="feed" open>
            <summary><span><span className={`dot${live ? " live" : ""}`} />What Maya knows (live)</span><span>{feed.length}</span></summary>
            <ul>
              {feed.map((e) => (
                <li key={e.id} className={`${e.kind}${e.sent ? "" : " off"}`}>
                  <span className="k">{e.kind}</span> <span className="t">{e.t}</span> {e.text}{e.sent ? "" : " (Maya not connected)"}
                </li>
              ))}
            </ul>
          </details>
        </aside>
      </main>
    </div>
  );
}
