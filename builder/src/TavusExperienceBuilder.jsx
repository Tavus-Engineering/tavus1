import { useState, useMemo, useRef, useEffect, useCallback } from "react";
import { useDaily } from "@daily-co/daily-react";
import DailyIframe from "@daily-co/daily-js";
import { upload as blobUpload } from "@vercel/blob/client";

/* ─────────────────────────────────────────────────────────────
   Tavus Experience Builder — Alto edition
   Styled to approximate Alto (Tavus Design System): warm light
   canvas, white cards, hairline borders, large radii, black pill
   actions, peach accent. All tokens live in :root below — paste
   real Alto values there to match exactly.
   ───────────────────────────────────────────────────────────── */

const API_BASE = "https://tavusapi.com/v2";

/* The 42 languages Tavus speaks with the default tavus-auto engine (docs →
   Language Support). Sent as `properties.languages` — an ORDERED list of
   codes, where the first entry is the language the call opens in.
   `properties.language` (one full name) is deprecated; LANG_LEGACY migrates
   scenarios saved against it. */
const LANGUAGES = [{ c: "ar", n: "Arabic" }, { c: "bg", n: "Bulgarian" }, { c: "bn", n: "Bengali" }, { c: "cs", n: "Czech" }, { c: "da", n: "Danish" }, { c: "de", n: "German" }, { c: "el", n: "Greek" }, { c: "en", n: "English" }, { c: "es", n: "Spanish" }, { c: "fi", n: "Finnish" }, { c: "fr", n: "French" }, { c: "gu", n: "Gujarati" }, { c: "he", n: "Hebrew" }, { c: "hi", n: "Hindi" }, { c: "hr", n: "Croatian" }, { c: "hu", n: "Hungarian" }, { c: "id", n: "Indonesian" }, { c: "it", n: "Italian" }, { c: "ja", n: "Japanese" }, { c: "ka", n: "Georgian" }, { c: "kn", n: "Kannada" }, { c: "ko", n: "Korean" }, { c: "ml", n: "Malayalam" }, { c: "mr", n: "Marathi" }, { c: "ms", n: "Malay" }, { c: "nl", n: "Dutch" }, { c: "no", n: "Norwegian" }, { c: "pa", n: "Punjabi" }, { c: "pl", n: "Polish" }, { c: "pt", n: "Portuguese" }, { c: "ro", n: "Romanian" }, { c: "ru", n: "Russian" }, { c: "sk", n: "Slovak" }, { c: "sv", n: "Swedish" }, { c: "ta", n: "Tamil" }, { c: "te", n: "Telugu" }, { c: "th", n: "Thai" }, { c: "tl", n: "Tagalog" }, { c: "tr", n: "Turkish" }, { c: "uk", n: "Ukrainian" }, { c: "vi", n: "Vietnamese" }, { c: "zh", n: "Chinese" }];
const LANG_NAME = (c) => LANGUAGES.find((l) => l.c === c)?.n || c;
const LANG_LEGACY = Object.fromEntries(LANGUAGES.map((l) => [l.n.toLowerCase(), l.c]));

const CANVAS_COMPONENTS = [
  { key: "question", label: "Question", desc: "Multiple-choice cards; answers flow back to the PAL and your webhook." },
  { key: "input", label: "Input", desc: "Free-form input fields the user can type into mid-conversation." },
  { key: "calendar", label: "Calendar", desc: "Date and time-slot pickers; availability comes from PAL context or tools." },
  { key: "text", label: "Text", desc: "Supporting text or markdown cards shown beside the PAL." },
  { key: "chart", label: "Chart", desc: "Bar, line, or pie charts the PAL renders on the fly." },
  { key: "alert", label: "Alert", desc: "Info / success / warning / error notices with optional auto-dismiss." },
  { key: "scheduling_embed", label: "Scheduling", desc: "Your live Calendly page embedded in-call for real booking. Needs a URL below to activate." },
];

/* Starter demos — ready-made scenarios in builder/demos/*.json, bundled at
   build time and offered in the Demo library. A tool URL written as
   https://YOUR-BUILDER-DOMAIN/… points at this deployment's own /api
   endpoints, so it's resolved to the current origin when a demo is adopted. */
const STARTER_DEMOS = Object.values(import.meta.glob("../demos/*.json", { eager: true, import: "default" }))
  .filter((d) => d && d.name && d.config)
  .sort((a, b) => a.name.localeCompare(b.name));
const withThisOrigin = (config) => {
  const origin = typeof window !== "undefined" ? window.location.origin : "";
  return origin ? JSON.parse(JSON.stringify(config).split("https://YOUR-BUILDER-DOMAIN").join(origin)) : config;
};

const STEPS = [
  { id: "start", label: "New Demo", group: "Start" },
  { id: "demos", label: "Demo library", group: "Start" },
  { id: "setup", label: "Account", group: "Start" },
  { id: "human", label: "Your AI human", group: "The AI human" },
  { id: "persona", label: "Persona", group: "The AI human" },
  { id: "guide", label: "Objectives & Guardrails", group: "The AI human" },
  { id: "vision", label: "Perception", group: "The AI human" },
  { id: "kb", label: "Knowledge Base", group: "The AI human" },
  { id: "presentation", label: "Presentation", group: "The experience" },
  { id: "canvas", label: "Magic Canvas", group: "The experience" },
  { id: "speech", label: "Voice", group: "The experience" },
  { id: "site", label: "Page & Brand", group: "The experience" },
  { id: "experience", label: "Experience", group: "The experience" },
  { id: "tools", label: "Integrations", group: "Run it" },
  { id: "controls", label: "Timing", group: "Run it" },
  { id: "launch", label: "Launch & Share", group: "Run it" },
  { id: "studio", label: "Studio", group: "Run it" },
  { id: "grade", label: "Scorecard", group: "Run it" },
  { id: "calls", label: "Results", group: "Run it" },
];

/* Tavus-hosted LLMs available for a PAL's brain (layers.llm.model). */
const PAL_LLMS = [
  { v: "tavus-gemma-4", label: "Gemma 4 — recommended", desc: "Tavus's recommended default — fast, tuned for CVI." },
  { v: "tavus-glm-4.7", label: "GLM 4.7", desc: "Fast and smart with a 200K context window." },
  { v: "tavus-gpt-5.2", label: "GPT 5.2", desc: "Strong reasoning; latency less critical." },
  { v: "tavus-claude-haiku-4.5", label: "Claude Haiku 4.5", desc: "Quick and capable." },
  { v: "tavus-gemini-3-flash", label: "Gemini 3 Flash", desc: "Fast, current Gemini." },
  { v: "tavus-gemini-2.5-flash", label: "Gemini 2.5 Flash", desc: "Low latency." },
  { v: "tavus-gpt-oss", label: "GPT-OSS", desc: "Snappiest, lightweight fallback." },
];

/* Formats the Knowledge Base can turn into presentation slides. */
const PRESENTABLE = /\.(pdf|png|jpe?g|pptx)(\?|#|$)/i;

/* Face presets — the team's go-to stock faces, one click instead of hunting
   down the r… ID every time. The free-text field still takes any face ID. */
/* All Phoenix-4 default faces (from the Tavus platform's Default Faces
   gallery) + custom presets — pickable everywhere a face is needed. */
const FACE_PRESETS = [
  { name: "Kelly", vibe: "casual", id: "r862e3a3c5e0" },
  { name: "Mark", vibe: "casual", id: "rcea962f9f9b" },
  { name: "Celine", vibe: "casual", id: "r1a0108fbd75" },
  { name: "Gloria", vibe: "warm", id: "r3f427f43c9d" },
  { name: "Zane", vibe: "casual", id: "ra3a03647d46" },
  { name: "Ivy", vibe: "casual", id: "r0a8102ab353" },
  { name: "Ruby", vibe: "office", id: "rcc28da86847" },
  { name: "Victor", vibe: "office", id: "re3fd4adeafd" },
  { name: "Victor", vibe: "casual", id: "r1d7cf9edbb4" },
  { name: "Dawn", vibe: "casual", id: "re22cfdd52e0" },
  { name: "Lucas", vibe: "studio", id: "r5f0577fc829" },
];

/* One-glance loadout badges for a demo's library card — derived from the
   stored config, zero extra typing. Null when only a cloud copy exists
   locally (config not cached in this browser). */
function demoBadges(cfg) {
  if (!cfg || typeof cfg !== "object") return null;
  const b = [];
  b.push({ desktop: "🖥 desktop", phone: "📱 mobile app", kiosk: "🏬 kiosk", hologram: "🫧 hologram", designed: "✨ designed page" }[cfg.site?.format] || "🖥 desktop");
  const face = FACE_PRESETS.find((f) => f.id === String(cfg.faceId || "").trim());
  if (face) b.push(`🙂 ${face.name}`);
  b.push(String(cfg.palId || "").trim() ? "🧠 PAL linked" : "⚠ no PAL yet");
  if (cfg.objectivesEnabled) {
    const n = String(cfg.objectivesText || "").split("\n").filter((l) => l.trim() && !/^[ \t]/.test(l)).length;
    if (n) b.push(`🎯 ${n} objective${n > 1 ? "s" : ""}`);
  }
  if (cfg.guardrailsEnabled) {
    const n = String(cfg.guardrailsText || "").split("\n").filter((l) => l.trim()).length;
    if (n) b.push(`🛡 ${n} guardrail${n > 1 ? "s" : ""}`);
  }
  if (cfg.presentationEnabled) b.push("📽 deck");
  if (cfg.canvasEnabled) b.push("🪄 canvas");
  if (Array.isArray(cfg.scCards) && cfg.scCards.length) b.push(`🃏 ${cfg.scCards.length} scripted card${cfg.scCards.length > 1 ? "s" : ""}`);
  if (cfg.visionEnabled) b.push("👁 perception");
  if (cfg.toolsEnabled && Array.isArray(cfg.toolRows) && cfg.toolRows.some((r) => String(r?.name || "").trim())) b.push("🔧 tools");
  const j = Array.isArray(cfg.expJourney) ? cfg.expJourney.length : 0;
  if (j) b.push(`🧭 ${j}-step journey`);
  if (cfg.expEmailGate !== false) b.push("✉ email gate");
  if (cfg.recordingEnabled) b.push("⏺ records");
  if (cfg.duetPlan) b.push("🎭 duet");
  const cfgLangs = Array.isArray(cfg.languages) ? cfg.languages : (cfg.language ? [cfg.language] : []);
  if (cfgLangs.length > 1) b.push(`🌐 ${cfgLangs.length} languages`);
  else if (cfgLangs.length === 1 && cfgLangs[0] !== "en" && String(cfgLangs[0]).toLowerCase() !== "english") b.push(`🌐 ${cfgLangs[0]}`);
  return b;
}

/* Float32 mic chunks → 16kHz mono 16-bit WAV → base64, for the Wispr Flow
   dictation API. Resamples linearly when the AudioContext refused 16kHz. */
function encodeWavBase64(chunks, totalLen, inRate) {
  let data = new Float32Array(totalLen);
  let o = 0;
  chunks.forEach((c) => { data.set(c, o); o += c.length; });
  const RATE = 16000;
  if (inRate !== RATE && inRate > 0) {
    const outLen = Math.floor((totalLen * RATE) / inRate);
    const out = new Float32Array(outLen);
    for (let i = 0; i < outLen; i++) {
      const pos = (i * inRate) / RATE;
      const i0 = Math.floor(pos);
      const frac = pos - i0;
      out[i] = (data[i0] || 0) * (1 - frac) + (data[Math.min(totalLen - 1, i0 + 1)] || 0) * frac;
    }
    data = out;
  }
  const buf = new ArrayBuffer(44 + data.length * 2);
  const v = new DataView(buf);
  const ws = (off, s) => { for (let i = 0; i < s.length; i++) v.setUint8(off + i, s.charCodeAt(i)); };
  ws(0, "RIFF"); v.setUint32(4, 36 + data.length * 2, true); ws(8, "WAVE");
  ws(12, "fmt "); v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, RATE, true); v.setUint32(28, RATE * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  ws(36, "data"); v.setUint32(40, data.length * 2, true);
  for (let i = 0; i < data.length; i++) v.setInt16(44 + i * 2, Math.max(-1, Math.min(1, data[i])) * 0x7fff, true);
  const bytes = new Uint8Array(buf);
  let bin = "";
  for (let i = 0; i < bytes.length; i += 32768) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 32768));
  return btoa(bin);
}

const SITE_FORMATS = [
  { v: "desktop", label: "Desktop", desc: "Full page — headline, tagline, wide 16:9 stage. The default." },
  { v: "phone", label: "Mobile app", desc: "A scrollable in-app screen inside a real phone frame — how it feels living in your app." },
  { v: "kiosk", label: "Kiosk", desc: "A freestanding kiosk totem with a touch-to-start attract screen. Go live for real kiosk hardware." },
  { v: "hologram", label: "Hologram", desc: "A Proto-style holobox — white enclosure, glowing life-size screen the AI beams into." },
];

/* Video URL → embeddable source for journey video steps. YouTube/Loom/Vimeo
   share links become embeds; direct media files play in a <video> tag;
   anything else iframes as-is. */
function videoEmbed(url) {
  const u = String(url || "").trim();
  if (/\.(mp4|webm|mov|m4v)(\?|#|$)/i.test(u)) return { kind: "file", src: u };
  let m = u.match(/youtube\.com\/watch\?.*v=([\w-]{6,20})/) || u.match(/youtu\.be\/([\w-]{6,20})/) || u.match(/youtube\.com\/shorts\/([\w-]{6,20})/);
  if (m) return { kind: "iframe", src: `https://www.youtube.com/embed/${m[1]}` };
  m = u.match(/loom\.com\/(?:share|embed)\/([a-f0-9]{16,40})/i);
  if (m) return { kind: "iframe", src: `https://www.loom.com/embed/${m[1]}` };
  m = u.match(/vimeo\.com\/(\d{6,12})/);
  if (m) return { kind: "iframe", src: `https://player.vimeo.com/video/${m[1]}` };
  return { kind: "iframe", src: u };
}

/* Weave a completed pre-call journey into a conversation payload: context
   lines from the visitor's answers, plus greeting/PAL overrides when they
   picked a persona. Mirrored server-side in api/demo-launch.js for shared
   links — keep the two in sync. */
function applyJourneyPrefs(payload, journeyArr, prefs) {
  if (!prefs || !Array.isArray(prefs.answers) || !Array.isArray(journeyArr)) return payload;
  const out = { ...payload };
  const lines = [];
  prefs.answers.slice(0, 12).forEach((ans) => {
    const s = journeyArr[ans.step];
    if (!s) return;
    if (s.type === "question") {
      const opt = s.options?.[ans.option];
      if (typeof opt === "string") lines.push(`- ${s.prompt} → ${opt}`);
      // Authored per-option override — the builder's instructions for how the
      // conversation changes when this option is picked, not just the Q&A.
      const oc = Array.isArray(s.optionContext) ? String(s.optionContext[ans.option] ?? "").trim() : "";
      if (oc) lines.push(oc);
    } else if (s.type === "input") {
      const text = String(ans.text ?? "").replace(/\s+/g, " ").trim().slice(0, 200);
      if (text) lines.push(`- ${s.prompt} → "${text}"`);
    } else if (s.type === "personas") {
      const o = s.options?.[ans.option];
      if (!o) return;
      lines.push(`- Chosen experience: ${o.label}`);
      if (o.context) lines.push(String(o.context));
      if (o.greeting) {
        out.custom_greeting = String(o.greeting);
        // REPLACE the base greeting instruction, never append a second one —
        // two "your first line is…" claims with different quotes made the
        // model hedge by re-greeting.
        out.conversational_context = String(out.conversational_context || "")
          .split("\n\n").filter((p) => !/^Your first spoken line is already scripted/.test(p)).join("\n\n");
        lines.push(`- Your first spoken line is already scripted and plays automatically: "${String(o.greeting).slice(0, 300)}" — continue naturally from it; never introduce yourself a second time.`);
      }
      if (o.palId && /^p[a-z0-9_-]{3,60}$/i.test(String(o.palId))) out.pal_id = String(o.palId);
    }
  });
  if (prefs.email) lines.push(`- Email they provided: ${String(prefs.email).trim().slice(0, 200)}`);
  if (lines.length) {
    const intro = "Pre-call setup from this visitor (personalize with it naturally — never recite it back as a list):";
    // Journey-captured facts are SETTLED — without this the objectives graph
    // still mechanically re-asks questions the visitor answered pre-call.
    const settled = "Anything already answered above is settled: confirm briefly if useful, never ask for it again — skip or fast-complete any objective step that asks for it.";
    out.conversational_context = [out.conversational_context, `${intro}\n${lines.join("\n")}\n${settled}`].filter(Boolean).join("\n\n");
  }
  return out;
}

/* Turn a plain-English line into an API-safe objective/guardrail name */
const slugName = (text, prefix, i) => {
  const s = text.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 40);
  return `${prefix}_${i + 1}_${s || "item"}`;
};

/* Objectives DSL → Tavus objective graph.
   - Top-level lines are the main flow, chaining in order (next_required_objective).
   - Indented "if <condition> -> <objective>" lines under a step become
     next_conditional_objectives branches (Tavus if/then routing). Branch
     detours rejoin the main flow at the next top-level step, and a catch-all
     to that step is added automatically so an uncovered answer never stalls
     the conversation (docs recommend always having a catch-all path).
   - Legacy: a "| var1, var2" suffix still extracts output_variables (kept for
     old saved scenarios) but the syntax is no longer surfaced in the UI. */
const parseObjectives = (text, confirmationMode) => {
  const applyVars = (item, varsPart) => {
    if (!varsPart) return;
    const vars = varsPart.split(",").map((v) => v.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")).filter(Boolean);
    if (vars.length) item.output_variables = vars;
  };
  const slugCore = (t) => t.toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 32) || "item";

  // Pass 1: group lines into main steps + their branches.
  // Branches require INDENTATION (or an explicit -> prefix): a top-level step
  // that happens to start with "If…" must stay a step — swallowing it as a
  // branch collapsed two steps into one and made the parent re-ask.
  const mains = [];
  const seenPrompts = new Set(); // duplicate lines compiled into two identical objectives → asked twice
  for (const raw of text.split("\n")) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw) || /^(?:->|→)/.test(raw.trim());
    const line = raw.trim().replace(/^(?:->|→)\s*/, "");
    const branch = indented && mains.length ? line.match(/^if\s+(.+?)\s*(?:->|→|:)\s*(.+)$/i) : null;
    if (branch) {
      const [p, v] = branch[2].split("|").map((s) => s.trim());
      if (p) mains[mains.length - 1].branches.push({ condition: branch[1].trim(), prompt: p.slice(0, 1000), vars: v });
      continue;
    }
    const [p, v] = line.split("|").map((s) => s.trim());
    if (p && !seenPrompts.has(p.toLowerCase())) {
      seenPrompts.add(p.toLowerCase());
      mains.push({ prompt: p.slice(0, 1000), vars: v, branches: [] });
    }
  }

  // Pass 2: emit the graph — branches sit right after their parent step.
  mains.forEach((m, i) => { m.name = slugName(m.prompt, "obj", i); });
  const items = [];
  mains.forEach((m, i) => {
    const nextMain = mains[i + 1] || null;
    const item = { objective_name: m.name, objective_prompt: m.prompt, confirmation_mode: confirmationMode };
    applyVars(item, m.vars);
    if (m.branches.length) {
      const cond = {};
      m.branches.forEach((b, k) => {
        b.name = `obj_${i + 1}_if${k + 1}_${slugCore(b.prompt)}`;
        cond[b.name] = `If ${b.condition}`;
      });
      // A conditional map must ALWAYS have a catch-all — on the last step the
      // old code emitted none, leaving a dead-end the PAL sat on (re-asking).
      if (nextMain) cond[nextMain.name] = "In any other case";
      else {
        const wrapName = `${m.name}_wrap`;
        cond[wrapName] = "In any other case";
        m.wrapName = wrapName;
      }
      item.next_conditional_objectives = cond; // mutually exclusive with next_required
    } else if (nextMain) {
      item.next_required_objective = nextMain.name;
    }
    items.push(item);
    m.branches.forEach((b) => {
      const bItem = { objective_name: b.name, objective_prompt: b.prompt, confirmation_mode: confirmationMode };
      applyVars(bItem, b.vars);
      // Detour rejoins the flow — at the next step, or the synthetic wrap-up
      // node when the branch hangs off the final step.
      if (nextMain) bItem.next_required_objective = nextMain.name;
      else if (m.wrapName) bItem.next_required_objective = m.wrapName;
      items.push(bItem);
    });
    if (m.wrapName) {
      items.push({
        objective_name: m.wrapName,
        objective_prompt: "Wrap up the conversation warmly: summarize what was covered and offer a clear next step.",
        confirmation_mode: confirmationMode,
      });
    }
  });
  return items;
};

/* New Demo feature checklist — each pick maps 1:1 to a builder toggle and a
   section the template drafts. Defaults mirror what a good first demo wants. */
const DEMO_FEATURES = [
  { k: "canvas", label: "🪄 Magic Canvas", desc: "Interactive cards beside the video", def: true },
  { k: "emailGate", label: "✉️ Email gate", desc: "Capture an email before the call starts", def: true },
  { k: "vision", label: "👁 Vision", desc: "Notices what's on camera and in their tone", def: false },
  { k: "coach", label: "🎯 Coach scorecard", desc: "Roleplay trainer panel with live scoring", def: false },
  { k: "presentation", label: "📽 Slide deck", desc: "Walks a deck (you add the doc ID after)", def: false },
  { k: "browseruse", label: "🌐 Browser Use", desc: "Drives a live browser (you script the flow after)", def: false },
];
const defaultDemoFeatures = () => Object.fromEntries(DEMO_FEATURES.map((f) => [f.k, f.def]));

const hex6 = (v) => {
  const s = String(v || "").trim();
  const m3 = s.match(/^#([0-9a-f]{3})$/i);
  if (m3) return `#${m3[1].split("").map((c) => c + c).join("")}`.toLowerCase();
  return /^#[0-9a-f]{6}$/i.test(s) ? s.toLowerCase() : "";
};

/* Pass-1 outline of the objectives DSL (same grouping parseObjectives uses)
   — mains with their branches, for the visual decision tree. */
function flowOutline(text) {
  const mains = [];
  for (const raw of String(text || "").split("\n")) {
    if (!raw.trim()) continue;
    const indented = /^\s/.test(raw);
    const line = raw.trim().replace(/^(?:->|→)\s*/, "");
    const branch = line.match(/^if\s+(.+?)\s*(?:->|→|:)\s*(.+)$/i);
    if (branch && (indented || mains.length) && mains.length) {
      const [p, v] = branch[2].split("|").map((s) => s.trim());
      if (p) mains[mains.length - 1].branches.push({ condition: branch[1].trim(), prompt: p, vars: v });
      continue;
    }
    const [p, v] = line.split("|").map((s) => s.trim());
    if (p) mains.push({ prompt: p, vars: v, branches: [] });
  }
  return mains;
}

/* Visual decision tree for the objectives flow — a live rendering of the
   exact graph parseObjectives attaches (branches detour then rejoin the
   next step; the "anything else" lane is added mechanically at launch),
   so what you see is what runs. */
function FlowDiagram({ text }) {
  const mains = flowOutline(text);
  if (!mains.length) return null;
  const vars = (v) => (v ? <span className="fv-vars">📎 {v}</span> : null);
  return (
    <div className="flowviz">
      <div className="fv-cap">▶ conversation starts</div>
      {mains.map((m, i) => (
        <div key={i}>
          <div className="fv-arrow">↓</div>
          <div className="fv-node">
            <span className="fv-num">{i + 1}</span>
            <span style={{ minWidth: 0 }}>{m.prompt}</span>
            {vars(m.vars)}
          </div>
          {m.branches.length > 0 && (
            <div className="fv-branches">
              {m.branches.map((b, k) => (
                <div key={k} className="fv-branch">
                  <span className="fv-cond">if {b.condition}</span>
                  <span className="fv-node fv-detour">↳ {b.prompt}{vars(b.vars)}</span>
                  <span className="fv-rejoin">{i + 1 < mains.length ? `→ rejoins at ${i + 2}` : "→ then wraps up"}</span>
                </div>
              ))}
              <div className="fv-branch">
                <span className="fv-cond fv-else">anything else</span>
                <span className="fv-rejoin">{i + 1 < mains.length ? `→ continues to ${i + 2}` : "→ wraps up"}</span>
              </div>
            </div>
          )}
        </div>
      ))}
      <div className="fv-arrow">↓</div>
      <div className="fv-cap fv-end">✅ flow complete</div>
    </div>
  );
}

/* One guardrail per line. "[visual]" anywhere in the line marks it visual. */
const parseGuardrails = (text) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  return lines.map((line, i) => {
    const visual = /\[visual\]/i.test(line);
    const prompt = line.replace(/\[visual\]/gi, "").trim().slice(0, 1000);
    return {
      guardrail_name: slugName(prompt, "gr", i),
      guardrail_prompt: prompt,
      modality: visual ? "visual" : "verbal",
    };
  });
};

/* One rule per line: "word = how to say it". Add [ipa] for IPA notation,
   [case] for case-sensitive matching. "=" ":" or "->" all work as separators. */
const parsePronunciation = (text) => {
  const lines = text.split("\n").map((l) => l.trim()).filter(Boolean);
  const rules = [];
  const seen = new Set();
  for (const line of lines) {
    const ipa = /\[ipa\]/i.test(line);
    const caseSensitive = /\[case\]/i.test(line);
    const cleaned = line.replace(/\[(ipa|case)\]/gi, "").trim();
    const m = cleaned.match(/^(.+?)\s*(?:=|:|->)\s*(.+)$/);
    if (!m) continue;
    const word = m[1].trim().slice(0, 200);
    const pron = m[2].trim().slice(0, 500);
    if (!word || !pron || seen.has(word.toLowerCase())) continue; // API rejects duplicate text
    seen.add(word.toLowerCase());
    const rule = { text: word, pronunciation: pron, type: ipa ? "ipa" : "alias" };
    if (caseSensitive) rule.case_sensitive = true;
    rules.push(rule);
  }
  return rules;
};

/* Pronunciation editor rows ⇄ the one-line-per-rule DSL. The DSL stays the
   stored format (scenarios + launch payload unchanged); the row editor is a
   friendlier face on the same text. */
function pronRowsFromText(text) {
  const rows = [];
  for (const line of String(text || "").split("\n")) {
    if (!line.trim()) continue;
    const ipa = /\[ipa\]/i.test(line);
    const cs = /\[case\]/i.test(line);
    const cleaned = line.replace(/\[(ipa|case)\]/gi, "").trim();
    const m = cleaned.match(/^(.+?)\s*(?:=|:|->)\s*(.+)$/);
    if (m) rows.push({ word: m[1].trim(), pron: m[2].trim(), ipa, cs });
  }
  return rows;
}
const pronTextFromRows = (rows) => rows
  .filter((r) => String(r.word).trim() || String(r.pron).trim())
  .map((r) => `${String(r.word).trim()} = ${String(r.pron).trim()}${r.ipa ? " [ipa]" : ""}${r.cs ? " [case]" : ""}`)
  .join("\n");

/* Parse Claude's vision draft (VISUAL:/AUDIO: sections with "- query" lines). */
const parseVisionDraft = (text) => {
  const visual = [];
  const audio = [];
  let target = null;
  for (const raw of text.split("\n")) {
    const line = raw.trim();
    if (/^visual:?\s*$/i.test(line)) { target = visual; continue; }
    if (/^audio:?\s*$/i.test(line)) { target = audio; continue; }
    const m = line.match(/^[-*•]\s*(.+)/);
    if (m && target) target.push(m[1].trim());
  }
  return { visual, audio };
};

/* First few words of a prompt, for consumer-friendly summaries (no slugs). */
const shortLabel = (text, max = 38) =>
  text.length > max ? `${text.slice(0, max).replace(/\s+\S*$/, "")}…` : text;

/* ── Visitor mode: /d/{slug} (or ?demo=slug) renders a shared demo — no
      builder, no login. Config comes from /api/demos; Start creates a fresh
      conversation server-side via /api/demo-launch. ── */
/* The full stylesheet, shared by the builder AND the standalone visitor
   page (/d/ links render VisitorDemo without the builder component, so
   they must carry the styles themselves — unstyled-logo bug). */
const BUILDER_CSS = `
        @import url('https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap');

        /* ── Alto tokens (approximated — paste real values here) ── */
        :root {
          --canvas: #F5F4F1;     /* page background */
          --surface: #FFFFFF;    /* cards, inputs */
          --surface-2: #FAF9F7;  /* subtle fills */
          --border: #E6E4DF;     /* hairline */
          --text: #17181A;       /* primary text */
          --muted: #7A7B74;      /* secondary text (gray-olive) */
          --accent: #FF6B5E;     /* tavus peach */
          --accent-soft: #FFF0EE;
          --ok: #2E9E6B;
          --danger: #D64545;
          --r-lg: 16px; --r-md: 12px; --r-sm: 9px;
          --font: 'Instrument Sans', system-ui, sans-serif;
          --mono: 'JetBrains Mono', monospace;
        }
        * { box-sizing: border-box; }
        .root { min-height:100vh; background:var(--canvas); color:var(--text); font-family:var(--font); font-size:14px; display:flex; flex-direction:column; }

        /* top bar */
        .topbar { display:flex; align-items:center; justify-content:space-between; gap:16px; padding:16px 28px; flex-wrap:wrap; }
        .scenario-bar { display:flex; align-items:center; gap:8px; flex:1; justify-content:center; flex-wrap:wrap; }
        .scenario-bar select, .scenario-bar input { width:auto; padding:8px 12px; font-size:13px; border-radius:999px; }
        /* demo library panel + post-launch save prompt */
        .lib-overlay { position:fixed; inset:0; z-index:70; background:rgba(20,20,22,.35); display:flex; align-items:flex-start; justify-content:center; padding:70px 20px 20px; }
        .lib-panel { width:min(640px, 100%); max-height:76vh; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-lg); box-shadow:0 30px 80px -20px rgba(20,20,20,.4); display:flex; flex-direction:column; padding:18px 20px; }
        .lib-head { display:flex; align-items:center; gap:8px; margin-bottom:12px; }
        .lib-head .lib-hint { color:var(--muted); font-size:12px; flex:1; }
        .lib-list { overflow-y:auto; margin-top:6px; }
        .lib-group { font-family:var(--mono); font-size:10.5px; letter-spacing:.08em; text-transform:uppercase; color:var(--muted); padding:14px 2px 5px; }
        .lib-row { display:flex; align-items:center; gap:9px; padding:7px 10px; border-radius:var(--r-sm); }
        .lib-row:hover { background:var(--surface-2); }
        .lib-name { flex:1; min-width:0; text-align:left; background:none; border:none; font:inherit; font-size:13.5px; font-weight:500; color:var(--text); cursor:pointer; padding:2px 0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .lib-active { color:var(--ok); font-size:11px; font-weight:600; margin-left:8px; }
        .lib-time { color:var(--muted); font-size:11.5px; flex-shrink:0; }
        .saveprompt { position:fixed; right:20px; bottom:20px; z-index:60; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-lg); box-shadow:0 20px 60px -18px rgba(20,20,20,.4); padding:16px 18px; display:flex; flex-direction:column; gap:9px; width:300px; }
        .saveprompt-sub { color:var(--muted); font-size:12.5px; line-height:1.5; }
        /* duet stage: two AI humans side by side, recorded from the tab */
        .duet-root { position:fixed; inset:0; z-index:55; background:#101114; display:flex; flex-direction:column; }
        .duet-bar { display:flex; align-items:center; gap:14px; padding:12px 18px; color:#e8e9ec; }
        .duet-brand { font-weight:700; font-size:16px; letter-spacing:-.3px; flex:1; }
        .duet-rec { font-family:var(--mono); font-size:12px; color:#ff6b5e; animation:recpulse 1.6s ease-in-out infinite; }
        .duet-stage { flex:1; min-height:0; display:grid; grid-template-columns:1fr 1fr; gap:10px; padding:0 14px; transition:grid-template-columns .5s ease; }
        .duet-stage.duet-screen-a { grid-template-columns:2.6fr 1fr; }
        .duet-stage.duet-screen-b { grid-template-columns:1fr 2.6fr; }
        .duet-frame { width:100%; height:100%; border:none; border-radius:14px; background:#000; }
        .duet-note { padding:10px 18px 14px; color:#9aa0ab; font-size:13px; text-align:center; min-height:38px; }
        .logo-wrap { display:flex; align-items:center; gap:10px; }
        .logo-word { font-weight:700; font-size:19px; letter-spacing:-.4px; }
        .logo-sub { font-family:var(--mono); font-size:11px; color:var(--muted); background:var(--surface); border:1px solid var(--border); border-radius:999px; padding:4px 10px; }
        .status-pill { font-family:var(--mono); font-size:11px; color:var(--muted); }
        .status-pill b { color:var(--ok); font-weight:500; }

        .layout { display:flex; flex:1; min-height:0; gap:16px; padding:0 16px 16px; }

        /* left rail */
        .rail { width:190px; flex-shrink:0; display:flex; flex-direction:column; gap:4px; padding-top:8px; }
        .rail-btn { display:flex; align-items:center; gap:10px; width:100%; background:none; border:none; color:var(--muted); cursor:pointer; padding:10px 14px; border-radius:var(--r-md); font:inherit; font-weight:500; text-align:left; }
        .rail-btn:hover { background:var(--surface); color:var(--text); }
        .rail-btn.active { background:var(--surface); color:var(--text); border:1px solid var(--border); box-shadow:0 1px 2px rgba(20,20,20,.04); }
        .rail-check { margin-left:auto; color:var(--ok); font-size:11px; }
        .rail-warn { margin-left:auto; min-width:17px; height:17px; border-radius:9px; background:#C4553B; color:#fff;
          font-size:10.5px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; padding:0 5px; }

        /* Cross-check */
        .xc { border:1px solid var(--border); border-radius:18px; padding:18px 20px; margin-bottom:26px; background:var(--surface); }
        .xc-bad { border-color:#C4553B; box-shadow:0 0 0 3px rgba(196,85,59,.09); }
        .xc-warn { border-color:#D9922E; box-shadow:0 0 0 3px rgba(217,146,46,.08); }
        .xc-head { display:grid; grid-template-columns:auto 1fr; gap:0 11px; align-items:center; margin-bottom:4px; }
        .xc-head h2 { margin:0; font-size:17px; letter-spacing:-.01em; }
        .xc-sub { grid-column:2; font-size:12.5px; color:var(--muted); }
        .xc-dot { grid-row:span 2; width:11px; height:11px; border-radius:50%; background:var(--ok,#2E9E6B); }
        .xc-bad .xc-dot { background:#C4553B; } .xc-warn .xc-dot { background:#D9922E; }
        .xc-row { display:flex; gap:13px; align-items:flex-start; padding:14px 0; border-top:1px solid var(--border); margin-top:14px; }
        .xc-tag { flex-shrink:0; margin-top:1px; font-size:9.5px; font-weight:750; letter-spacing:.07em; padding:3px 7px; border-radius:5px; }
        .xc-break .xc-tag { background:rgba(196,85,59,.12); color:#9c4230; }
        .xc-look .xc-tag { background:rgba(217,146,46,.14); color:#8a5b12; }
        .xc-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:3px; }
        .xc-body b { font-size:13.5px; font-weight:600; line-height:1.45; }
        .xc-body span { font-size:12.5px; color:var(--muted); line-height:1.5; }
        .xc-acts { display:flex; gap:6px; flex-shrink:0; flex-wrap:wrap; justify-content:flex-end; }
        @media (max-width:720px) { .xc-row { flex-wrap:wrap; } .xc-acts { width:100%; justify-content:flex-start; } }
        .rail-group { font-family:var(--mono); font-size:9.5px; letter-spacing:.12em; text-transform:uppercase; color:var(--muted); opacity:.75; padding:14px 14px 4px; }
        .rail > div:first-child .rail-group { padding-top:2px; }
        .flow-nav { display:flex; align-items:center; justify-content:space-between; gap:10px; margin-top:36px; padding-top:18px; border-top:1px solid var(--border); }
        .flow-pos { font-family:var(--mono); font-size:11px; color:var(--muted); }

        /* main card */
        .main { flex:1; min-width:0; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-lg); padding:32px 36px; overflow-y:auto; box-shadow:0 1px 3px rgba(20,20,20,.04); }
        .main h1 { font-size:24px; font-weight:700; letter-spacing:-.5px; margin:0 0 6px; }
        .main .lede { color:var(--muted); margin:0 0 26px; max-width:560px; line-height:1.55; }
        .subhead { font-size:16px; font-weight:600; letter-spacing:-.2px; margin:26px 0 8px; }

        .field { display:flex; flex-direction:column; gap:6px; margin-bottom:18px; max-width:560px; }
        .field-label { font-weight:600; font-size:13px; }
        .field-hint { font-size:12px; color:var(--muted); line-height:1.5; }
        input, select, textarea { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); color:var(--text); padding:10px 13px; font:inherit; outline:none; width:100%; }
        input:focus, select:focus, textarea:focus { border-color:var(--text); }
        input::placeholder, textarea::placeholder { color:#B4B3AD; }
        .mono { font-family:var(--mono); font-size:13px; }
        textarea { resize:vertical; min-height:72px; }

        .skill-head { display:flex; align-items:center; justify-content:space-between; max-width:560px; margin-bottom:4px; }

        .toggle { width:42px; height:24px; border-radius:999px; border:1px solid var(--border); background:var(--surface-2); position:relative; cursor:pointer; flex-shrink:0; padding:0; }
        .toggle-dot { position:absolute; top:2px; left:2px; width:18px; height:18px; border-radius:50%; background:#C9C8C2; transition:all .15s ease; }
        .toggle-on { background:var(--text); border-color:var(--text); }
        .toggle-on .toggle-dot { left:20px; background:#fff; }

        .seg { display:flex; background:var(--surface-2); border:1px solid var(--border); border-radius:999px; padding:3px; width:fit-content; }
        .seg button { background:none; border:none; color:var(--muted); padding:7px 15px; font:inherit; font-weight:500; cursor:pointer; border-radius:999px; }
        .seg button.on { background:var(--text); color:#fff; }

        .comp-grid { display:grid; grid-template-columns:repeat(auto-fill,minmax(250px,1fr)); gap:10px; max-width:800px; }
        .comp-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); padding:14px; display:flex; flex-direction:column; gap:7px; }
        .comp-card.off { opacity:.45; background:var(--surface-2); }
        .comp-top { display:flex; align-items:center; justify-content:space-between; }
        .comp-name { font-weight:600; font-size:14px; }
        .comp-desc { font-size:12px; color:var(--muted); line-height:1.5; }
        .rule-input { margin-top:2px; font-size:12px; padding:7px 10px; border-radius:var(--r-sm); background:var(--surface-2); }

        .placement-row { display:flex; gap:10px; max-width:560px; margin-top:8px; }
        .placement-card { flex:1; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); padding:12px; cursor:pointer; text-align:center; color:var(--muted); font-size:13px; font-weight:500; }
        .placement-card.on { border-color:var(--text); color:var(--text); box-shadow:0 1px 3px rgba(20,20,20,.06); }
        .face-row { display:flex; gap:8px; flex-wrap:wrap; margin-bottom:8px; }
        .face-chip { display:flex; flex-direction:column; align-items:center; gap:2px; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); padding:8px 16px; cursor:pointer; font:inherit; color:var(--muted); }
        .face-chip:hover { color:var(--text); }
        .face-chip.on { border-color:var(--text); color:var(--text); box-shadow:0 1px 3px rgba(20,20,20,.06); }
        .face-chip-name { font-weight:600; font-size:13px; }
        .face-chip-vibe { font-size:10.5px; font-family:var(--mono); }
        /* journey composer (Experience step) */
        .jr-list { display:flex; flex-direction:column; gap:10px; max-width:640px; margin-bottom:12px; }
        .jr-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); padding:12px 14px; }
        .jr-head { display:flex; align-items:center; gap:8px; margin-bottom:8px; }
        .jr-num { font-weight:700; font-size:12px; color:var(--muted); }
        .jr-type { font-family:var(--mono); font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; color:var(--muted); background:var(--surface-2); border-radius:999px; padding:3px 10px; }
        .jr-btns { margin-left:auto; display:flex; gap:2px; }
        .jr-card input, .jr-card textarea { margin-bottom:6px; }
        .jr-opt { border:1px dashed var(--border); border-radius:var(--r-sm); padding:9px 9px 3px; margin-bottom:8px; }
        /* scripted cards (deterministic canvas) */
        .sc-card { width:calc(var(--canvas-panel-w, 340px) - 48px); max-width:100%; background:var(--surface,#fff); border:1px solid var(--border,#E6E4DF); border-radius:16px; padding:18px; box-shadow:0 22px 48px -20px rgba(20,20,20,.30); display:flex; flex-direction:column; gap:12px; }
        .canvas-panel .sc-card { position:absolute; top:50%; left:50%; transform:translate(-50%,-50%); }
        .sc-title { font-weight:700; font-size:15px; letter-spacing:-.2px; }
        .sc-note p { margin:0 0 8px; font-size:13.5px; line-height:1.55; }
        .sc-note p:last-child { margin-bottom:0; }

        .lang-picked { display:flex; flex-wrap:wrap; gap:6px; margin-bottom:8px; }
        .lang-picked:empty { display:none; }
        .lang-chip { display:inline-flex; align-items:center; gap:6px; padding:5px 8px 5px 11px; border-radius:999px;
          border:1px solid var(--border,#E6E4DF); background:var(--surface,#fff); font-size:12.5px; }
        .lang-chip.lang-first { border-color:var(--accent,#F0A891); background:color-mix(in srgb, var(--accent,#F0A891) 12%, var(--surface,#fff)); }
        .lang-open { font-size:9.5px; font-weight:700; letter-spacing:.06em; text-transform:uppercase; color:var(--muted,#7A7A73); }
        .lang-chip button { border:0; background:none; cursor:pointer; font:inherit; font-size:12px; color:var(--muted,#7A7A73); padding:0 2px; }
        .lang-chip button:disabled { opacity:.28; cursor:default; }
        .lang-opts { display:flex; flex-wrap:wrap; gap:6px; margin-top:8px; }

        /* Interview grade */
        .gc { background:var(--surface,#fff); border:1px solid var(--border,#E6E4DF); border-radius:20px; padding:22px; max-width:720px; }
        .gc-top { display:flex; gap:22px; align-items:flex-start; padding-bottom:18px; border-bottom:1px solid var(--border,#E6E4DF); }
        .gc-ring { position:relative; flex-shrink:0; width:104px; height:104px; border-radius:50%; display:flex; flex-direction:column;
          align-items:center; justify-content:center; gap:0;
          background:conic-gradient(var(--gc-c) var(--gc-pct), var(--canvas,#F5F4F1) 0); }
        .gc-ring::after { content:""; position:absolute; inset:9px; border-radius:50%; background:var(--surface,#fff); }
        .gc-ring > * { position:relative; z-index:1; }
        .gc-num { font-size:30px; font-weight:650; letter-spacing:-.02em; line-height:1; }
        .gc-den { font-size:11.5px; color:var(--muted,#7A7A73); margin-top:3px; }
        .gc-hi { --gc-c:#2E9E6B; } .gc-mid { --gc-c:#D9922E; } .gc-lo { --gc-c:#C4553B; } .gc-none { --gc-c:var(--border,#E6E4DF); }
        .gc-head { flex:1; min-width:0; }
        .gc-verdict { display:inline-block; padding:4px 12px; border-radius:999px; font-size:12px; font-weight:650;
          background:color-mix(in srgb, var(--gc-c) 14%, transparent); color:var(--gc-c); margin-bottom:9px; }
        .gc-summary { margin:0 0 8px; font-size:14.5px; line-height:1.55; }
        .gc-meta { font-size:11.5px; color:var(--muted,#7A7A73); }
        .gc-rows { display:flex; flex-direction:column; }
        .gc-row { padding:15px 0; border-bottom:1px solid var(--border,#E6E4DF); }
        .gc-row:last-child { border-bottom:0; }
        .gc-row-null { opacity:.62; }
        .gc-row-head { display:flex; align-items:center; gap:9px; flex-wrap:wrap; }
        .gc-label { font-size:13.5px; font-weight:600; }
        .gc-weight { font-size:10.5px; font-weight:650; color:var(--muted,#7A7A73); border:1px solid var(--border,#E6E4DF); border-radius:5px; padding:1px 5px; }
        .gc-dots { display:flex; gap:4px; margin-left:auto; }
        .gc-dot { width:9px; height:9px; border-radius:50%; background:var(--canvas,#F5F4F1); border:1px solid var(--border,#E6E4DF); }
        .gc-dot.on { background:var(--gc-c); border-color:var(--gc-c); }
        .gc-score { font-size:12px; font-weight:650; color:var(--muted,#7A7A73); min-width:56px; text-align:right; }
        .gc-quote { margin:9px 0 0; padding:8px 0 8px 13px; border-left:2px solid var(--accent,#F0A891);
          font-size:13px; line-height:1.5; color:var(--text,#17181A); }
        .gc-quote::before { content:"“"; } .gc-quote::after { content:"”"; }
        .gc-note { margin:7px 0 0; font-size:12.5px; line-height:1.5; color:var(--muted,#7A7A73); }
        .gc-split { display:grid; grid-template-columns:1fr 1fr; gap:18px; padding-top:16px; border-top:1px solid var(--border,#E6E4DF); }
        .gc-sub { font-size:11px; font-weight:650; letter-spacing:.05em; text-transform:uppercase; color:var(--muted,#7A7A73); margin-bottom:8px; }
        .gc-chip { display:inline-block; margin:0 5px 5px 0; padding:4px 10px; border-radius:999px; font-size:12px; line-height:1.35; }
        .gc-chip-hi { background:rgba(46,158,107,.11); color:#24734f; }
        .gc-chip-lo { background:rgba(196,85,59,.11); color:#9c4230; }
        @media (max-width:640px) { .gc-top { flex-direction:column; } .gc-split { grid-template-columns:1fr; } }
        .sc-link-btn { display:inline-block; margin-top:10px; padding:10px 16px; border-radius:999px; background:var(--text,#17181A); color:var(--surface,#fff); font-size:13px; font-weight:600; text-decoration:none; }
        .sc-chart { display:flex; flex-direction:column; gap:8px; }
        .sc-bar-row { display:grid; grid-template-columns:minmax(56px,38%) 1fr auto; align-items:center; gap:8px; font-size:12px; }
        .sc-bar-label { color:var(--muted); overflow:hidden; text-overflow:ellipsis; white-space:nowrap; }
        .sc-bar-track { background:var(--surface-2,#F0EEE9); border-radius:5px; height:12px; overflow:hidden; }
        .sc-bar { display:block; height:100%; background:var(--accent,#F05A3C); border-radius:5px; }
        .sc-bar-val { font-weight:600; }
        .sc-stat { text-align:center; padding:6px 0; }
        .sc-stat-value { display:block; font-size:36px; font-weight:700; letter-spacing:-1.2px; line-height:1.1; }
        .sc-stat-label { display:block; color:var(--muted); font-size:13px; line-height:1.5; margin-top:3px; }
        .sc-img { width:100%; border-radius:10px; display:block; }
        .sc-preview { flex:0 0 260px; background:var(--canvas); border:1px dashed var(--border); border-radius:var(--r-md); padding:14px; display:flex; align-items:center; justify-content:center; }
        .sc-preview .sc-card { position:static; transform:none; width:100%; box-shadow:0 10px 30px -14px rgba(20,20,20,.25); }
        .sc-preview-empty { color:var(--muted); font-size:12px; text-align:center; line-height:1.6; }
        .sc-options { display:flex; flex-direction:column; gap:7px; }
        .sc-opt { border:1px solid var(--border,#E6E4DF); background:var(--surface,#fff); border-radius:11px; padding:10px 13px; cursor:pointer; font:inherit; font-size:13px; font-weight:600; text-align:left; color:var(--text,#17181A); }
        .sc-opt:hover:not(:disabled) { border-color:var(--text,#17181A); }
        .sc-opt.on { border-color:var(--accent,#F05A3C); background:var(--accent-soft,#FDEEE9); }
        .sc-opt:disabled:not(.on) { opacity:.45; cursor:default; }
        .sc-answered { color:var(--ok,#3E9B5F); font-size:12px; font-weight:600; }
        .canvas-panel .sc-card { pointer-events:auto; }
        .duet-tile { position:relative; min-height:0; }
        .duet-tile .duet-frame { position:absolute; inset:0; }
        .duet-name { position:absolute; top:12px; left:12px; z-index:3; background:rgba(12,13,16,.66); color:#f2f3f5; font-size:12.5px; font-weight:600; letter-spacing:.2px; padding:5px 12px; border-radius:999px; pointer-events:none; }
        /* "Call recording" look — reads like a saved Zoom/Meet call: Meet-dark
           canvas, bottom-left name tags, a native Recording pill, controls
           that fade away when the mouse is idle so the capture never shows
           them, and the narrator as a Meet-style caption bar. */
        .duet-root.duet-meeting { background:#202124; }
        .duet-meeting .duet-stage { padding:8px; gap:8px; }
        .duet-meeting .duet-tile { border-radius:8px; overflow:hidden; background:#3c4043; }
        .duet-meeting .duet-name { top:auto; bottom:10px; left:10px; background:rgba(0,0,0,.55); color:#e8eaed; font-weight:500; font-size:12.5px; border-radius:6px; padding:4px 10px; }
        .meet-rec { position:absolute; top:12px; left:14px; z-index:7; display:flex; align-items:center; gap:7px; color:#e8eaed; font-size:12.5px; background:rgba(32,33,36,.72); padding:5px 12px; border-radius:999px; pointer-events:none; }
        .meet-rec-dot { width:9px; height:9px; border-radius:50%; background:#ea4335; animation:recpulse 1.6s ease-in-out infinite; }
        .meet-controls { position:absolute; right:14px; bottom:14px; z-index:7; display:flex; gap:10px; align-items:center; background:rgba(32,33,36,.85); padding:8px 12px; border-radius:12px; transition:opacity .4s ease; }
        .meet-controls.hidden { opacity:0; pointer-events:none; }
        .meet-note { max-width:320px; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; color:#9aa0ab; font-size:12px; }
        .meet-captions { position:absolute; left:50%; transform:translateX(-50%); bottom:20px; z-index:5; max-width:72%; text-align:center; background:rgba(32,33,36,.85); color:#e8eaed; font-size:14px; line-height:1.45; padding:8px 16px; border-radius:8px; pointer-events:none; }
        /* Closed captions — live transcript of what's actually being said,
           revealed word by word at speech pace. Speaker name in Meet blue. */
        .duet-cc { position:fixed; left:50%; transform:translateX(-50%); z-index:6; max-width:70%; background:rgba(0,0,0,.72); color:#fff; font-size:15px; line-height:1.5; padding:7px 14px; border-radius:8px; text-align:center; pointer-events:none; }
        .duet-cc b { color:#8ab4f8; font-weight:600; }
        /* the card renders ON the asker's tile, lower third — like their own screen */
        .duet-tile-card { position:absolute; left:50%; bottom:16px; transform:translateX(-50%); z-index:4; width:min(400px, 88%); animation:duetcard .45s ease; }
        .duet-tile-card .sc-card { position:static; transform:none; width:100%; box-shadow:0 22px 60px -16px rgba(0,0,0,.7); }
        /* narrator strip: what the viewer is watching, feature by feature */
        .duet-narrator { flex-shrink:0; text-align:center; padding:12px 20px 0; color:#e8ebf0; font-size:14.5px; font-weight:600; letter-spacing:.1px; }
        @keyframes duetcard { from { opacity:0; transform:translateX(-50%) translateY(14px); } to { opacity:1; transform:translateX(-50%) translateY(0); } }
        .placement-viz { display:flex; gap:4px; height:42px; margin-bottom:8px; }
        .pv-video { flex:1; background:var(--border); border-radius:6px; }
        .pv-rail { width:15px; background:var(--accent); border-radius:6px; }
        .pv-rail.ghost { opacity:.2; }

        .pill-btn { border-radius:999px; border:1px solid var(--border); background:var(--surface); color:var(--text); padding:10px 18px; font:inherit; font-weight:600; cursor:pointer; display:inline-flex; align-items:center; gap:8px; }
        .pill-btn:hover { border-color:var(--text); }
        .pill-btn.primary { background:var(--text); color:#fff; border-color:var(--text); }
        .pill-btn.primary:hover { opacity:.88; }
        .pill-btn.primary:disabled { opacity:.35; cursor:not-allowed; }
        .pill-btn.big { padding:15px 32px; font-size:16px; }
        .pill-btn.ghost { background:var(--surface); }

        /* Global toast: the latest log line, visible on every step (the full
           log only lives on Launch). z above the demo overlay (z-50). */
        .toast { position:fixed; bottom:20px; left:50%; transform:translateX(-50%); z-index:200; display:flex; align-items:center; gap:12px; background:#17181A; color:#fff; border-radius:999px; padding:11px 20px; font-size:13px; line-height:1.45; max-width:min(760px,92vw); box-shadow:0 8px 28px rgba(0,0,0,.28); }
        .toast-err { background:#B93B3B; }
        .toast-ok { background:#1D7A4C; }
        .toast button { background:none; border:none; color:#fff; opacity:.7; font-size:16px; cursor:pointer; padding:0 2px; line-height:1; }
        .toast button:hover { opacity:1; }

        .log { max-width:640px; margin-top:20px; display:flex; flex-direction:column; gap:6px; }
        .log-row { font-family:var(--mono); font-size:12px; display:flex; gap:10px; line-height:1.5; }
        .log-t { color:var(--muted); flex-shrink:0; }
        .log-ok { color:var(--ok); } .log-err { color:var(--danger); } .log-info { color:var(--text); }

        /* right preview */
        .preview { width:360px; flex-shrink:0; display:flex; flex-direction:column; gap:12px; padding-top:8px; }
        .preview-card { background:var(--surface); border:1px solid var(--border); border-radius:var(--r-lg); padding:16px; display:flex; flex-direction:column; gap:12px; flex:1; box-shadow:0 1px 3px rgba(20,20,20,.04); }
        .preview-head { display:flex; align-items:center; justify-content:space-between; }
        .preview-title { font-family:var(--mono); font-size:11px; color:var(--accent); }
        .preview-code { background:#17181A; border-radius:var(--r-md); padding:14px; font-family:var(--mono); font-size:11.5px; line-height:1.6; white-space:pre-wrap; word-break:break-all; color:#D8D9DE; overflow-y:auto; flex:1; }
        .preview-note { font-size:11.5px; color:var(--muted); line-height:1.55; }

        /* demo page */
        .demo-root { position:fixed; inset:0; z-index:50; background:var(--canvas); color:var(--text); font-family:var(--font); display:flex; flex-direction:column; overflow-y:auto; }
        .demo-nav { display:flex; align-items:center; justify-content:space-between; padding:16px 28px; position:sticky; top:0; background:var(--canvas); z-index:2; }
        .demo-brandwrap { display:flex; align-items:center; gap:11px; }
        .demo-logo { height:30px; border-radius:7px; object-fit:contain; }
        .demo-monogram { width:32px; height:32px; border-radius:9px; background:var(--text); color:#fff; display:inline-flex; align-items:center; justify-content:center; font-weight:700; }
        .demo-brand { font-weight:700; font-size:18px; letter-spacing:-.3px; }
        .demo-main { flex:1; display:flex; flex-direction:column; align-items:center; padding:24px 24px 48px; }
        .demo-header { text-align:center; margin-bottom:28px; }
        /* Demo library tab — one card per saved demo: purpose, status, loadout */
        .demolib-card { background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:12px 14px; margin-bottom:10px; max-width:760px; }
        .demolib-top { display:flex; align-items:center; gap:10px; }
        .demolib-desc { width:100%; margin-top:8px; font-size:13px; }
        .demolib-foot { display:flex; align-items:center; gap:12px; margin-top:10px; flex-wrap:wrap; }
        .demolib-badges { display:flex; gap:6px; flex-wrap:wrap; }
        .demolib-badges span { border:1px solid var(--border); background:var(--canvas); border-radius:999px; padding:3px 10px; font-size:11.5px; color:var(--muted); white-space:nowrap; }
        /* Chat-with-the-demo edit bar — fixed bottom-center, approve-to-apply */
        .editbar { position:fixed; left:50%; transform:translateX(-50%); bottom:16px; z-index:40; width:min(720px,92%); display:flex; gap:8px; align-items:center; background:var(--surface); border:1px solid var(--border); border-radius:16px; padding:8px 10px; box-shadow:0 18px 50px -18px rgba(20,20,20,.3); }
        .editbar input { flex:1; border:none; background:transparent; font:inherit; font-size:13.5px; color:var(--text); outline:none; padding:6px 8px; }
        .editbar-pending { display:flex; align-items:center; gap:14px; width:100%; padding:2px 4px; }
        .editbar-pending > div:first-child { flex:1; min-width:0; }
        .editbar-chip { border:1px solid var(--accent); border-radius:999px; padding:2px 10px; font-size:11.5px; color:var(--text); background:color-mix(in srgb, var(--accent) 14%, transparent); }
        /* Objectives decision tree — the DSL rendered as the graph it compiles to */
        .flowviz { max-width:640px; margin:2px 0 16px; font-size:13px; }
        .fv-cap { display:inline-block; background:var(--text); color:var(--surface); border-radius:999px; padding:4px 14px; font-size:11.5px; font-weight:600; letter-spacing:.3px; }
        .fv-cap.fv-end { background:#2e7d4f; color:#fff; }
        .fv-arrow { color:var(--muted); padding:3px 0 3px 20px; line-height:1; }
        .fv-node { display:inline-flex; align-items:center; gap:9px; background:var(--surface); border:1px solid var(--border); border-radius:12px; padding:8px 13px; box-shadow:0 3px 10px -6px rgba(20,20,20,.18); max-width:100%; }
        .fv-num { flex-shrink:0; width:20px; height:20px; border-radius:50%; background:var(--accent); color:#fff; font-size:11px; font-weight:700; display:inline-flex; align-items:center; justify-content:center; }
        .fv-vars { flex-shrink:0; font-size:11px; color:var(--muted); }
        .fv-branches { margin:8px 0 4px 30px; padding-left:16px; border-left:2px dashed var(--border); display:flex; flex-direction:column; gap:7px; }
        .fv-branch { display:flex; align-items:center; gap:8px; flex-wrap:wrap; }
        .fv-cond { background:color-mix(in srgb, var(--accent) 16%, var(--surface)); border:1px solid var(--accent); border-radius:999px; padding:3px 11px; font-size:11.5px; font-weight:600; flex-shrink:0; }
        .fv-cond.fv-else { background:var(--canvas); border-color:var(--border); color:var(--muted); font-weight:500; }
        .fv-detour { border-style:dashed; padding:5px 11px; }
        .fv-rejoin { font-size:11px; color:var(--muted); white-space:nowrap; }
        .pron-row { display:flex; align-items:center; gap:8px; margin-bottom:8px; flex-wrap:wrap; }
        /* ✨ Designed pages — spec-driven look from the design engine. The
           spec only supplies tokens + text; layout is these fixed classes. */
        /* Blueprint blocks: browser chrome, nav links, profile block, skeleton */
        /* ── Feature walkthrough player ── */
        .rail-play { margin-left:auto; flex-shrink:0; width:20px; height:20px; border-radius:50%; background:var(--accent); color:#fff; font-size:9px; display:inline-flex; align-items:center; justify-content:center; padding-left:1px; opacity:.85; transition:transform .15s, opacity .15s; }
        .rail-play:hover { transform:scale(1.2); opacity:1; }
        .rail-btn .rail-play + .rail-check { margin-left:6px; }
        .wt-overlay { position:fixed; inset:0; z-index:70; background:rgba(12,13,16,.72); display:flex; align-items:center; justify-content:center; padding:26px; }
        .wt-modal { width:min(960px,100%); background:var(--surface); border-radius:16px; overflow:hidden; box-shadow:0 40px 120px -30px rgba(0,0,0,.6); }
        .wt-head { display:flex; align-items:center; gap:10px; padding:12px 16px; border-bottom:1px solid var(--border); }
        .wt-head b { flex:1; font-size:14px; }
        .wt-modal video { display:block; width:100%; max-height:72vh; background:#0b0c0f; }

        /* ── Magic moments board: cards pinned to the talk track ── */
        .mm-board { border:1px solid var(--border); border-radius:14px; padding:16px 18px; max-width:720px; background:var(--surface); }
        .mm-step { display:flex; gap:14px; }
        .mm-rail { display:flex; flex-direction:column; align-items:center; }
        .mm-rail::after { content:""; flex:1; width:2px; background:var(--border); margin:4px 0; }
        .mm-step:last-child .mm-rail::after { display:none; }
        .mm-node { width:26px; height:26px; border-radius:50%; background:var(--accent); color:#fff; font-size:12.5px; font-weight:700; display:flex; align-items:center; justify-content:center; flex-shrink:0; }
        .mm-body { flex:1; min-width:0; display:flex; flex-direction:column; gap:8px; padding-bottom:16px; }
        .mm-label { font-size:13.5px; font-weight:600; padding-top:4px; }
        .mm-card { border:1px dashed color-mix(in srgb, var(--accent) 45%, var(--border)); border-radius:12px; padding:10px 12px; background:color-mix(in srgb, var(--accent) 4%, var(--surface)); display:flex; flex-direction:column; }
        .mm-own { border-top:1px dashed var(--border); margin-top:6px; padding-top:14px; display:flex; flex-direction:column; gap:8px; }

        /* ── Anatomy hub: the AI human as navigation ── */
        .human-hub { display:flex; gap:22px; align-items:center; max-width:860px; }
        .human-col { flex:1 1 240px; display:flex; flex-direction:column; gap:10px; }
        .human-fig { position:relative; flex:0 0 300px; }
        .human-fig svg { display:block; width:100%; height:auto; }
        .human-dot { position:absolute; width:11px; height:11px; margin:-5.5px 0 0 -5.5px; border-radius:50%; border:1.5px solid #fff; background:var(--accent); opacity:.55; cursor:pointer; padding:0; transition:transform .2s, opacity .2s; }
        .human-dot.hot, .human-dot:hover { transform:scale(1.7); opacity:1; z-index:2; box-shadow:0 0 0 4px color-mix(in srgb, var(--accent) 18%, transparent); }
        .human-card { display:flex; gap:10px; align-items:flex-start; text-align:left; background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:12px 14px; cursor:pointer; font:inherit; transition:border-color .2s, transform .2s, box-shadow .2s; }
        .human-card:hover, .human-card.hot { border-color:var(--accent); transform:translateY(-1px); box-shadow:0 10px 30px -18px color-mix(in srgb, var(--accent) 45%, transparent); }
        .human-card-icon { font-size:20px; line-height:1.2; flex-shrink:0; }
        .human-card b { display:block; font-size:13.5px; }
        .human-card small { display:block; color:var(--muted); font-size:12px; line-height:1.4; margin-top:2px; }
        .human-card em { display:block; font-style:normal; font-size:11.5px; color:var(--muted); margin-top:5px; }
        .human-card em.ok { color:#1a7f37; font-weight:600; }
        @media (max-width:860px) { .human-hub { flex-direction:column; } .human-fig { flex-basis:auto; width:min(300px,80%); } }
        .dz-navlinks { display:flex; gap:20px; margin:0 auto 0 30px; color:var(--muted); font-size:13px; font-weight:600; }
        @media (max-width:760px) { .dz-navlinks { display:none; } }
        /* 📸 Screenshot facade — "their site comes alive". Their real header
           crisp on top, their page as a blurred dimmed backdrop, the call on
           a clean centered stage. Selectors are two-class on purpose — a bare
           .shot-stage loses every property to the later .demo-stage rule. */
        .demo-desktop.demo-shot .demo-main { padding:0; max-width:none; }
        .shot-wrap { position:relative; width:100%; height:calc(100vh - 0px); min-height:640px; background:#0d0e10; overflow:hidden; display:flex; flex-direction:column; }
        .shot-topbar { flex-shrink:0; max-height:118px; overflow:hidden; box-shadow:0 10px 40px -10px rgba(8,10,14,.5); position:relative; z-index:2; }
        .shot-topbar img { display:block; width:100%; height:auto; user-select:none; }
        .shot-backdrop { position:absolute; inset:0; top:0; overflow:hidden; }
        .shot-backdrop img { width:104%; height:104%; margin:-1%; object-fit:cover; object-position:top center; user-select:none; animation:shotdim 1.1s ease-out .25s both; }
        @keyframes shotdim { from { filter:none; } to { filter:blur(16px) brightness(.48) saturate(1.15); } }
        .shot-overlay { position:relative; z-index:1; flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:18px; padding:26px 20px 40px; }
        .shot-head { text-align:center; color:#fff; animation:shotrise .8s ease-out .55s both; max-width:760px; }
        .shot-head h2 { margin:0; font-size:clamp(24px,3.2vw,38px); letter-spacing:-.8px; text-shadow:0 2px 24px rgba(0,0,0,.45); }
        .shot-head p { margin:8px 0 0; color:rgba(255,255,255,.82); font-size:15.5px; text-shadow:0 1px 14px rgba(0,0,0,.45); }
        .demo-shot .shot-overlay .demo-stage { width:min(860px,92%); max-height:100%; box-shadow:0 50px 140px -30px rgba(0,0,0,.7); border-radius:18px; overflow:hidden; border:1px solid rgba(255,255,255,.22); animation:shotrise .8s ease-out .45s both; }
        @keyframes shotrise { from { opacity:0; transform:translateY(26px); } to { opacity:1; transform:none; } }
        .demo-desktop.demo-shot .demo-powered { position:fixed; right:16px; bottom:12px; color:rgba(255,255,255,.55); z-index:3; }
        /* The screenshot already contains THEIR header — our brand bar floats
           transparent with just the operator buttons, never a second nav. */
        .demo-desktop.demo-shot .demo-nav { position:absolute; top:0; left:0; right:0; z-index:6; background:transparent; border-bottom:none; justify-content:flex-end; }
        .demo-desktop.demo-shot .demo-nav .demo-brand, .demo-desktop.demo-shot .demo-nav img, .demo-desktop.demo-shot .dz-navlinks { display:none; }
        .shot-phone { position:relative; height:100%; overflow-y:auto; }
        .shot-phone .shot-img { display:block; width:100%; height:auto; min-height:100%; object-fit:cover; user-select:none; }
        .shot-phone-cta { position:sticky; bottom:14px; display:flex; justify-content:center; padding:0 14px; }
        .shot-phone-cta .pill-btn { box-shadow:0 18px 50px -12px rgba(8,10,14,.55); }
        /* Brand carry-through on themed pages: accent eyebrow + accent CTA +
           a soft accent wash behind the hero. Alto default stays untouched. */
        .demo-eyebrow { display:inline-flex; align-items:center; gap:8px; font-size:12px; font-weight:700; letter-spacing:1.6px; text-transform:uppercase; color:var(--accent); margin-bottom:14px; }
        .demo-eyebrow::before, .demo-eyebrow::after { content:""; width:26px; height:1.5px; background:var(--accent); opacity:.5; }
        .demo-themed .demo-main { background:radial-gradient(60% 340px at 50% 0, color-mix(in srgb, var(--accent) 9%, transparent), transparent 70%); }
        .demo-themed .demo-cta .pill-btn.primary { background:var(--accent); border-color:var(--accent); color:#fff; box-shadow:0 6px 22px -8px color-mix(in srgb, var(--accent) 65%, transparent); }
        .demo-themed .demo-cta .pill-btn.primary:hover { opacity:.92; }
        .demo-themed .demo-stage { border-top:3px solid var(--accent); }
        .demo-header h1 { font-size:clamp(28px,4.5vw,44px); font-weight:700; letter-spacing:-1.2px; margin:0; line-height:1.1; max-width:760px; }
        .demo-header p { color:var(--muted); font-size:16px; line-height:1.6; max-width:600px; margin:14px auto 0; }
        .demo-stage { width:min(1080px,100%); aspect-ratio:16/9; background:var(--surface); border:1px solid var(--border); border-radius:20px; overflow:hidden; box-shadow:0 20px 60px -24px rgba(20,20,20,.18); display:flex; align-items:center; justify-content:center; position:relative; }
        .demo-stage iframe { width:100%; height:100%; border:none; }
        .cvi-wrap { position:relative; width:100%; height:100%; background:#0e0f12; overflow:hidden; --canvas-panel-w:min(480px, 46%); }
        .cvi-wrap.canvas-wide { --canvas-panel-w:min(760px, 58%); }
        .cvi-wrap > * { width:100%; height:100%; }
        /* Split layout: an active side card claims a dedicated panel and the
           video pane RESIZES into the remaining width — the canvas gets its own
           screen region instead of cards overlaying (cutting into) the video. */
        /* width/height:auto — size from the insets; the .cvi-wrap > * 100% sizing
           would otherwise win the over-constraint tie and pin the pane full-width */
        .cvi-video-pane { position:absolute; inset:0; width:auto; height:auto; overflow:hidden; transition:left .55s cubic-bezier(.22,.9,.3,1), right .55s cubic-bezier(.22,.9,.3,1); }
        .cvi-video-pane > * { width:100%; height:100%; }
        /* The vendored conversation container is aspect-ratio:16/9 + max-height:90vh —
           exact fit for a full 16:9 stage, but a letterboxed strip (black bars) once
           the pane narrows for the split. Make it fill the pane; the video itself is
           object-fit:cover so it crops instead of squishing. Structural selector
           because the module class names are hashed. */
        .cvi-wrap .cvi-video-pane > * > * { height:100%; max-height:none; aspect-ratio:auto; border-radius:0; }
        /* A replica stream that isn't 16:9 (portrait/square faces) must never
           be crop-zoomed on the desktop stage — the vendored UI forces
           object-fit:cover, which chops the head off. Letterbox it against
           the dark pane instead. Phone/kiosk/hologram keep cover: their
           portrait frames are meant to fill, and side-cropping a centered
           face is safe there. Canvas-split panes also keep cover (the pane
           is near-square; contain would shrink the face behind the card). */
        .demo-desktop .cvi-wrap:not(.canvas-split) video[class*="mainVideo"] { object-fit: contain !important; }
        .canvas-split-right .cvi-video-pane { right:var(--canvas-panel-w); }
        .canvas-split-left .cvi-video-pane { left:var(--canvas-panel-w); }

        /* ── Coach mode: persistent dark scorecard sidebar (Rilla-style) ── */
        .cvi-wrap { --coach-w: 320px; }
        .coach-split .cvi-video-pane { right:var(--coach-w); }
        .coach-panel { position:absolute; top:0; right:0; bottom:0; width:var(--coach-w); background:#131417; color:#e8e8ea; padding:18px 18px 14px; overflow-y:auto; display:flex; flex-direction:column; gap:10px; font-size:13px; z-index:6; }
        .coach-rec { display:flex; align-items:center; gap:7px; font-size:12px; letter-spacing:.04em; color:#c9c9ce; padding-bottom:8px; border-bottom:1px solid #26272c; }
        .coach-rec b { color:#fff; font-variant-numeric:tabular-nums; }
        .coach-total { color:#8b8b92; }
        .coach-dot { width:9px; height:9px; border-radius:50%; background:#ff4d4d; animation:coachblink 1.4s ease-in-out infinite; }
        @keyframes coachblink { 50% { opacity:.35; } }
        .coach-title { margin-left:auto; color:#9a9aa2; font-size:11px; white-space:nowrap; overflow:hidden; text-overflow:ellipsis; max-width:55%; }
        .coach-sec { font-size:10.5px; font-weight:700; letter-spacing:.14em; text-transform:uppercase; color:#8b8b92; margin-top:6px; display:flex; align-items:baseline; gap:8px; }
        .coach-pct { margin-left:auto; color:#fff; font-size:12px; font-variant-numeric:tabular-nums; }
        .coach-list { display:flex; flex-direction:column; gap:6px; }
        .coach-item { display:flex; gap:9px; align-items:flex-start; background:#1c1d22; border:1px solid #26272c; border-radius:10px; padding:9px 11px; line-height:1.35; color:#b9b9c0; transition:all .3s; }
        .coach-item.on { background:#15241a; border-color:#2e5b3c; color:#dff3e4; }
        .coach-check { width:16px; height:16px; border-radius:50%; border:1.5px solid #4a4b52; flex-shrink:0; margin-top:1px; font-size:10px; line-height:13px; text-align:center; color:#7be495; }
        .coach-item.on .coach-check { border-color:#3fae5f; background:#1f4a2c; }
        .coach-meter { height:5px; border-radius:3px; background:#26272c; overflow:hidden; }
        .coach-meter span { display:block; height:100%; background:#f5d90a; border-radius:3px; transition:width .6s; }
        .coach-hint { font-size:11.5px; color:#8b8b92; }
        .coach-transcript { flex:1; min-height:80px; overflow-y:auto; display:flex; flex-direction:column; gap:7px; }
        .coach-line { color:#c4c4ca; line-height:1.4; font-size:12.5px; }
        .coach-line b { color:#8b8b92; font-size:10.5px; letter-spacing:.06em; text-transform:uppercase; margin-right:5px; }
        .coach-line.you b { color:#f5d90a; }
        .coach-scene { position:absolute; inset:0; z-index:7; background:#0d0e10; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:14px; text-align:center; padding:24px; }
        /* On-stage annotation chips — ONE-SHOT entrance only (A/V invariant:
           nothing may animate perpetually over a live call). */
        .annot-rail { position:absolute; top:14px; left:14px; z-index:8; width:auto; height:auto; display:flex; flex-direction:column; align-items:flex-start; gap:6px; pointer-events:none; max-width:min(46%, 380px); }
        .annot-chip { background:rgba(13,14,16,.82); color:#fff; font-size:12.5px; line-height:1.35; padding:7px 12px 7px 9px; border-radius:999px; border:1px solid rgba(255,255,255,.14); display:flex; align-items:center; gap:7px; animation:annotin .3s ease both; box-shadow:0 2px 10px rgba(0,0,0,.25); }
        .annot-icon { font-size:14px; flex-shrink:0; }
        .annot-chip.annot-react { margin-left:18px; background:rgba(13,14,16,.68); font-size:11.5px; }
        .annot-chip.annot-memory { border-color:rgba(150,190,255,.35); }
        @keyframes annotin { from { opacity:0; transform:translateY(-6px); } to { opacity:1; transform:none; } }
        .coach-scene-badge { width:84px; height:84px; border-radius:50%; background:#f5a623; border:6px solid #7a6a1e; color:#1a1a1a; font-weight:800; font-size:26px; display:flex; align-items:center; justify-content:center; }
        .coach-scene-title { color:#fff; font-size:26px; font-weight:800; letter-spacing:.02em; text-transform:uppercase; }
        .coach-scene-sub { color:#9a9aa2; font-size:13.5px; max-width:420px; }
        .coach-scene-bar { width:220px; height:5px; border-radius:3px; background:#26272c; overflow:hidden; }
        .coach-scene-bar span { display:block; height:100%; width:38%; background:#f5d90a; border-radius:3px; animation:coachload 1.6s ease-in-out infinite alternate; }
        @keyframes coachload { from { margin-left:0; width:22%; } to { margin-left:62%; width:38%; } }
        /* A light sheet (site canvas color), not a dark strip — it should read as
           the card's own screen, matching the page, never as a dead black region. */
        .canvas-panel { position:absolute; top:0; bottom:0; width:var(--canvas-panel-w); background:var(--canvas,#F5F4F1); opacity:0; transition:opacity .45s ease; pointer-events:none; }
        .canvas-panel-right { right:0; border-left:1px solid var(--border,#E6E4DF); }
        .canvas-panel-left { left:0; border-right:1px solid var(--border,#E6E4DF); }
        .canvas-split .canvas-panel { opacity:1; }
        /* Keep Magic Canvas cards inside the stage instead of a full-viewport overlay */
        .canvas-contained { position:absolute !important; inset:0 !important; }
        /* Fit the side slots to the panel (the vendored module sizes them off
           100vw, which overflows a stage narrower than the viewport). */
        .canvas-contained [data-canvas-slot="safe-area-right"],
        .canvas-contained [data-canvas-slot="safe-area-left"] { width:calc(var(--canvas-panel-w) - 32px); }
        /* Alto-style card chrome on the panel — the module's flat 8px card
           washes out against the light panel background. */
        .canvas-contained [data-canvas-card] { border-radius:16px; border:1px solid var(--border,#E6E4DF); box-shadow:0 22px 48px -20px rgba(20,20,20,.30); }
        /* Call controls stay over the video, not under the canvas panel */
        .canvas-split-right .interrupt-btn { right:calc(var(--canvas-panel-w) + 18px); }
        .canvas-split-left .rec-live { left:calc(var(--canvas-panel-w) + 14px); }
        /* Sits ABOVE the call's own control cluster, never beside it, and stays
           visually subordinate to the face — it is an escape hatch, not a CTA. */
        /* width/height auto on every direct-child overlay of .cvi-wrap: the
           .cvi-wrap > * 100% sizing rule otherwise inflates these pills to the
           whole stage — a stage-sized translucent disc over the face (seen
           live: the "giant white disc" bug). */
        .interrupt-btn { position:absolute; bottom:92px; right:18px; z-index:30; width:auto; height:auto; border-radius:999px; border:none; background:rgba(255,255,255,.86); color:#17181A; padding:6px 12px; font:inherit; font-size:12px; font-weight:600; line-height:1.35; white-space:nowrap; cursor:pointer; box-shadow:0 2px 10px rgba(0,0,0,.22); opacity:.9; animation:intfade .18s ease-out; }
        @keyframes intfade { from { opacity:0; transform:translateY(4px); } to { opacity:.9; transform:none; } }
        @media (prefers-reduced-motion:reduce) { .interrupt-btn { animation:none; } }
        /* pointer-events:none — must never block call controls under it */
        .rec-live { position:absolute; top:14px; left:14px; z-index:30; width:auto; height:auto; pointer-events:none; display:inline-flex; align-items:center; gap:7px; background:rgba(0,0,0,.55); color:#fff; border-radius:999px; padding:6px 13px; font-size:12px; font-weight:600; letter-spacing:.3px; }
        .rec-live.rec-fail { background:rgba(214,69,69,.92); }
        .stage-rec-btn { position:absolute; bottom:18px; left:18px; z-index:30; width:auto; height:auto; border-radius:999px; border:none; background:rgba(214,69,69,.94); color:#fff; padding:10px 16px; font:inherit; font-size:13px; font-weight:600; cursor:pointer; box-shadow:0 4px 14px rgba(0,0,0,.25); display:inline-flex; align-items:center; gap:8px; }
        .stage-rec-btn:hover { background:rgba(214,69,69,1); }
        .interrupt-btn:hover { background:#fff; opacity:1; }
        .demo-cta { display:flex; flex-direction:column; align-items:center; gap:14px; }
        /* pre-call email gate & post-call feedback screens (inside the stage) */
        .exp-screen { display:flex; flex-direction:column; align-items:center; gap:14px; text-align:center; padding:28px 24px; max-width:460px; width:100%; }
        .exp-screen h3 { font-size:22px; letter-spacing:-.4px; margin:0; line-height:1.2; }
        .exp-hint { color:var(--muted); font-size:13.5px; line-height:1.55; margin:0; }
        .demo-hologram .exp-hint { color:#8f9ab8; }
        .exp-input { width:100%; max-width:320px; text-align:center; }
        .exp-comment { width:100%; max-width:360px; min-height:74px; }
        .exp-err { color:var(--danger); font-size:12.5px; margin:0; }
        .exp-actions { display:flex; gap:10px; flex-wrap:wrap; justify-content:center; margin-top:4px; }
        .exp-actions a.pill-btn { text-decoration:none; }
        .exp-screen { max-height:100%; overflow-y:auto; }
        .flow-dots { display:flex; gap:6px; justify-content:center; }
        .flow-dots span { width:7px; height:7px; border-radius:50%; background:var(--border); }
        .flow-dots span.on { background:var(--accent); }
        .exp-video { width:100%; max-width:420px; aspect-ratio:16/9; border:none; border-radius:12px; background:#000; }
        .exp-options { display:flex; flex-direction:column; gap:8px; width:100%; max-width:340px; }
        .exp-opt { border:1px solid var(--border); background:var(--surface); border-radius:12px; padding:11px 14px; cursor:pointer; font:inherit; font-size:14px; font-weight:600; text-align:left; color:var(--text); }
        .exp-opt:hover, .exp-opt.on { border-color:var(--text); box-shadow:0 1px 3px rgba(20,20,20,.08); }
        .exp-opt-desc { display:block; color:var(--muted); font-size:12px; font-weight:400; margin-top:2px; }
        .star-row { display:flex; gap:6px; }
        .star { border:none; background:none; font-size:34px; line-height:1; cursor:pointer; color:var(--border); padding:2px; transition:transform .12s ease; }
        .star.on { color:#F3B93F; }
        .star:hover { transform:scale(1.12); }
        .demo-cta-hint { color:var(--muted); font-size:13px; }
        .demo-powered { color:var(--muted); font-size:11px; font-family:var(--mono); margin-top:30px; }
        @keyframes recpulse { 0%,100%{opacity:1} 50%{opacity:.35} }

        .idea-box { background:var(--accent-soft); border:1px solid var(--border); border-radius:var(--r-lg); padding:18px 20px; margin-bottom:26px; max-width:600px; }

        /* demo dashboard */
        .stat-bars { display:flex; align-items:flex-end; gap:5px; padding:10px 12px; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); width:fit-content; }
        .stat-col { display:flex; flex-direction:column; align-items:center; gap:3px; }
        .stat-bar { width:16px; background:var(--accent); border-radius:3px 3px 0 0; }
        .stat-day { font-family:var(--mono); font-size:9px; color:var(--muted); }

        /* calls & data */
        .transcript { display:flex; flex-direction:column; gap:8px; max-width:640px; margin-top:8px; }
        .t-row { display:flex; gap:10px; font-size:13px; line-height:1.55; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); padding:9px 12px; }
        .t-row.t-assistant { background:var(--surface-2); }
        .t-role { font-weight:600; flex-shrink:0; min-width:56px; color:var(--muted); font-size:12px; padding-top:1px; }
        .perception-card { max-width:640px; background:var(--surface-2); border:1px solid var(--border); border-radius:var(--r-md); padding:12px 14px; font-size:13px; line-height:1.6; white-space:pre-wrap; margin-bottom:8px; }

        /* knowledge base list */
        .kb-list { display:flex; flex-direction:column; gap:6px; max-width:640px; margin-top:10px; }
        .kb-row { display:flex; align-items:center; gap:10px; background:var(--surface); border:1px solid var(--border); border-radius:var(--r-md); padding:8px 12px; }
        .kb-name { flex:1; border:1px solid transparent; background:none; padding:4px 6px; border-radius:var(--r-sm); font-size:13px; }
        .kb-name:hover, .kb-name:focus { border-color:var(--border); background:var(--surface-2); }
        .kb-status { font-family:var(--mono); font-size:10.5px; padding:3px 8px; border-radius:999px; background:var(--surface-2); color:var(--muted); flex-shrink:0; }
        .kb-ready { color:var(--ok); }
        .kb-error { color:var(--danger); }
        .kb-processing, .kb-started, .kb-recrawling { color:#B8860B; }
        .kb-use { display:flex; align-items:center; gap:6px; font-size:12px; color:var(--muted); cursor:pointer; flex-shrink:0; }
        .kb-del, .kb-move { border:none; background:none; color:var(--muted); cursor:pointer; font-size:13px; padding:2px 6px; border-radius:6px; flex-shrink:0; }
        .kb-del:hover { color:var(--danger); background:var(--surface-2); }
        .kb-move:hover:not(:disabled) { color:var(--text); background:var(--surface-2); }
        .kb-move:disabled { opacity:.25; cursor:default; }

        /* format picker icons */
        .format-viz { display:flex; align-items:center; justify-content:center; height:42px; margin-bottom:8px; }
        .fv-desktop { width:56px; height:34px; border:2px solid currentColor; border-radius:5px; opacity:.65; }
        .fv-phone { width:20px; height:38px; border:2px solid currentColor; border-radius:6px; opacity:.65; }
        .fv-kiosk { width:22px; height:30px; border:2px solid currentColor; border-radius:3px; opacity:.55; position:relative; }
        .fv-kiosk::after { content:""; position:absolute; left:50%; top:100%; transform:translateX(-50%); width:8px; height:8px; border-left:2px solid currentColor; border-right:2px solid currentColor; }
        .fv-holo { width:24px; height:38px; border:2px solid currentColor; border-radius:6px; opacity:.65; padding:3px; }
        .fv-holo::before { content:""; display:block; width:100%; height:100%; background:currentColor; opacity:.35; border-radius:2px; }

        /* phone format: a scrollable in-app screen inside a device frame —
           the demo reads as a screen of the prospect's own mobile app, with
           skeleton content standing in for the app around the conversation. */
        .demo-phone .demo-main { justify-content:center; }
        .phone-frame { position:relative; width:min(390px, 92vw); aspect-ratio:9/19; background:#0e0f12; border-radius:44px; padding:10px; box-shadow:0 30px 80px -30px rgba(20,20,20,.45), 0 0 0 2px rgba(20,20,20,.9); display:flex; }
        .phone-frame::before { content:""; position:absolute; right:-4px; top:118px; width:3px; height:62px; background:#26272b; border-radius:2px; }
        .phone-frame::after { content:""; position:absolute; left:-4px; top:98px; width:3px; height:88px; background:#26272b; border-radius:2px; }
        .phone-island { position:absolute; top:20px; left:50%; transform:translateX(-50%); width:96px; height:25px; background:#0e0f12; border-radius:14px; z-index:3; }
        .phone-screen { position:relative; flex:1; border-radius:34px; overflow:hidden; background:var(--canvas); display:flex; flex-direction:column; min-height:0; }
        .demo-phone .demo-stage { width:100%; height:100%; aspect-ratio:auto; flex:1; border-radius:0; border:none; box-shadow:none; }
        .app-status { display:flex; justify-content:space-between; align-items:center; padding:15px 24px 4px; font-size:12px; font-weight:600; flex-shrink:0; }
        .app-status-icons { letter-spacing:2px; font-size:10px; opacity:.75; }
        .app-scroll { flex:1; min-height:0; overflow-y:auto; padding:4px 14px 14px; }
        .app-header { display:flex; align-items:center; gap:8px; font-weight:700; font-size:15px; letter-spacing:-.2px; padding:8px 6px 4px; }
        .app-logo { height:22px; border-radius:5px; object-fit:contain; }
        .app-monogram { width:24px; height:24px; border-radius:7px; background:var(--text); color:#fff; display:inline-flex; align-items:center; justify-content:center; font-weight:700; font-size:13px; }
        .app-hero { background:var(--surface); border:1px solid var(--border); border-radius:18px; padding:20px 16px; margin:10px 0 12px; text-align:center; display:flex; flex-direction:column; gap:10px; align-items:center; }
        .demo-themed .app-hero { border-top:3px solid var(--accent); }
        .app-hero h2 { font-size:19px; margin:0; letter-spacing:-.4px; line-height:1.2; }
        .app-hero p { color:var(--muted); font-size:13px; margin:0; line-height:1.5; }
        .app-skeleton { display:flex; flex-direction:column; gap:10px; }
        .app-card { background:var(--surface); border:1px solid var(--border); border-radius:14px; padding:12px; display:flex; flex-direction:column; gap:8px; flex-shrink:0; }
        .app-line { height:9px; border-radius:5px; background:var(--border); }
        .app-line.dim { opacity:.55; }
        .app-tabbar { display:flex; justify-content:space-around; align-items:center; padding:11px 0 17px; border-top:1px solid var(--border); background:var(--surface); color:var(--border); font-size:9px; flex-shrink:0; }
        .app-tabbar .on { color:var(--accent); }

        /* kiosk format: a framed freestanding totem with an attract screen —
           the in-context preview. "Go live" (demo-kiosk-live) strips the frame
           to chrome-less full-viewport for real kiosk/tablet hardware. */
        .demo-kiosk .demo-main { justify-content:center; }
        .kiosk-scene { display:flex; flex-direction:column; align-items:center; gap:24px; width:100%; }
        .kiosk-totem { display:flex; flex-direction:column; align-items:center; filter:drop-shadow(0 36px 40px rgba(20,20,20,.30)); }
        /* Width also bounded by the height budget (via the aspect ratio) so the
           whole totem + Go-live button fit the viewport without scrolling. */
        .kiosk-screen { width:min(420px, 90vw, calc(56vh * 9 / 14)); aspect-ratio:9/14; background:var(--canvas); border-radius:18px; border:13px solid #1b1c1f; box-shadow:inset 0 0 0 2px #000; overflow:hidden; display:flex; }
        .kiosk-neck { width:82px; height:min(96px, 9vh); background:linear-gradient(90deg, #232427, #3a3b3f 50%, #232427); }
        .kiosk-base { width:230px; height:16px; background:#1b1c1f; border-radius:8px 8px 3px 3px; }
        .demo-kiosk:not(.demo-kiosk-live) .demo-stage { width:100%; height:100%; max-width:none; aspect-ratio:auto; border-radius:0; border:none; box-shadow:none; }
        .kiosk-attract { flex:1; display:flex; flex-direction:column; align-items:center; justify-content:center; gap:13px; text-align:center; padding:26px 22px; }
        .kiosk-logo { height:42px; object-fit:contain; border-radius:9px; margin-bottom:4px; }
        .kiosk-attract h2 { font-size:23px; letter-spacing:-.5px; margin:0; line-height:1.15; }
        .kiosk-attract p { color:var(--muted); font-size:14px; margin:0; line-height:1.5; }
        .kiosk-cta { position:relative; margin-top:12px; border:none; border-radius:999px; background:var(--text); color:#fff; font:inherit; font-weight:600; font-size:16px; padding:16px 30px; cursor:pointer; }
        .kiosk-cta:disabled { opacity:.6; cursor:default; }
        .kiosk-cta::after { content:""; position:absolute; inset:-9px; border-radius:999px; border:2px solid var(--accent); animation:kioskpulse 2.2s ease-out infinite; }
        @keyframes kioskpulse { 0% { transform:scale(.9); opacity:.9; } 70% { transform:scale(1.12); opacity:0; } 100% { opacity:0; } }
        .demo-kiosk-live .demo-nav, .demo-kiosk-live .demo-header, .demo-kiosk-live .demo-powered { display:none; }
        .demo-kiosk-live .demo-main { padding:0; }
        .demo-kiosk-live .demo-stage { width:100vw; height:100vh; max-width:none; aspect-ratio:auto; border-radius:0; border:none; }
        .demo-kiosk-live .demo-cta { transform:scale(1.25); }
        .kiosk-exit { position:fixed; top:14px; right:14px; z-index:60; width:38px; height:38px; border-radius:50%; border:1px solid var(--border); background:rgba(255,255,255,.85); color:var(--muted); font-size:20px; line-height:1; cursor:pointer; opacity:.35; }
        .kiosk-exit:hover { opacity:1; }

        /* hologram format: a Proto-style holobox — a life-size white
           enclosure with speaker grilles and a glowing portrait screen the
           AI human "beams into". Bright and physical, not dark sci-fi. */
        .demo-hologram .demo-main { justify-content:center; }
        .holo-scene { display:flex; flex-direction:column; align-items:center; width:100%; }
        .holo-head { text-align:center; margin-bottom:20px; }
        .holo-head h2 { font-size:clamp(22px, 3.4vw, 34px); letter-spacing:-.6px; margin:0; line-height:1.15; }
        .holo-head p { color:var(--muted); font-size:15px; line-height:1.6; max-width:520px; margin:10px auto 0; }
        .holo-box { position:relative; display:flex; flex-direction:column; align-items:center; background:linear-gradient(180deg, #fbfbfc, #ececef); border-radius:24px; padding:16px 34px 20px; box-shadow:0 44px 90px -38px rgba(20,20,20,.5), inset 0 1px 0 #fff, 0 0 0 1px #d9d9de; }
        .holo-topbar { display:flex; align-items:center; justify-content:space-between; gap:18px; width:100%; padding:4px 2px 12px; }
        .holo-topbar .holo-brand { font-weight:800; letter-spacing:.22em; text-transform:uppercase; font-size:13px; color:#3c3c40; }
        .holo-topbar .holo-tag { font-size:12px; color:#77777d; }
        /* speaker grilles on the enclosure's inner walls */
        .holo-box::before, .holo-box::after { content:""; position:absolute; top:120px; bottom:120px; width:8px; background-image:radial-gradient(circle, #c9c9cf 1.2px, transparent 1.4px); background-size:8px 8px; }
        .holo-box::before { left:12px; }
        .holo-box::after { right:12px; }
        /* portrait glowing screen, width bounded by the height budget */
        /* Static glow: the pulsing box-shadow (hologlow) repainted every frame
           for the whole call, which starves audio playout on marginal machines
           (audio lags lipsync, then speeds up). The bright static glow reads
           the same at demo distance. */
        .holo-screen { position:relative; width:min(400px, 84vw, calc(58vh * 9 / 16)); aspect-ratio:9/16; border-radius:12px; overflow:hidden; background:radial-gradient(120% 90% at 50% 26%, #a6d4fb, #4f9be4 62%, #2f6fb6); box-shadow:inset 0 0 60px rgba(255,255,255,.4), inset 0 0 0 2px rgba(20,40,70,.35), 0 0 60px rgba(96,168,255,.48); }
        .demo-hologram .demo-stage.holo-stage { position:absolute; inset:0; width:100%; height:100%; max-width:none; aspect-ratio:auto; background:transparent; border:none; border-radius:0; box-shadow:none; }
        /* the video beams in over the glow: crop to fill the portrait panel */
        .holo-stage .cvi-wrap, .holo-stage .cvi-video-pane > * > * { background:transparent; }
        .holo-foot { padding-top:12px; font-size:12px; color:#77777d; }
        .demo-hologram .holo-stage .demo-cta-hint { color:#eaf4ff; text-shadow:0 1px 8px rgba(30,80,140,.6); }
        @keyframes hologlow { 0%, 100% { box-shadow:inset 0 0 60px rgba(255,255,255,.4), inset 0 0 0 2px rgba(20,40,70,.35), 0 0 54px rgba(96,168,255,.4); } 50% { box-shadow:inset 0 0 74px rgba(255,255,255,.5), inset 0 0 0 2px rgba(20,40,70,.35), 0 0 70px rgba(96,168,255,.55); } }

        @media (max-width:1100px){ .preview { display:none; } }
        @media (max-width:760px){
          .rail { width:56px; }
          .rail-btn span.rail-label, .rail-check { display:none; }
          .main { padding:20px; }
          .layout { padding:0 10px 10px; gap:10px; }
        }
      `;

function VisitorDemo({ slug }) {
  const [demo, setDemo] = useState(null);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [conversation, setConversation] = useState(null);

  useEffect(() => {
    fetch(`/api/demos?slug=${encodeURIComponent(slug)}`)
      .then(async (r) => {
        const j = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(j.error || "This demo link isn't available.");
        setDemo(j);
        document.title = j.site?.brand ? `${j.site.brand} — live demo` : "Live demo";
      })
      .catch((e) => setError(e.message));
  }, [slug]);

  const start = async (prefs) => {
    setBusy(true);
    setError("");
    try {
      const r = await fetch("/api/demo-launch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          slug,
          // Guided-journey answers (option/step indexes + short free text) —
          // the server resolves them against the STORED journey config.
          ...(prefs && Array.isArray(prefs.answers)
            ? { prefs: { email: String(prefs.email || "").slice(0, 200), answers: prefs.answers.slice(0, 12) } }
            : {}),
        }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "Couldn't start the conversation — try again.");
      setConversation(j);
    } catch (e) {
      setError(e.message);
    } finally {
      setBusy(false);
    }
  };

  const center = { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F4F1", color: "#17181A", fontFamily: "'Instrument Sans', system-ui, sans-serif", fontSize: 14, textAlign: "center", padding: 24 };
  if (error && !demo) return <div style={center}>{error}</div>;
  if (!demo) return <div style={center}>Loading…</div>;

  return (
    <>
      {/* Visitor pages never mount the builder component, so they must carry
          the stylesheet themselves. */}
      <style>{BUILDER_CSS}</style>
      <DemoSite
        site={demo.site || {}}
        controls={demo.controls || {}}
        experience={demo.experience || {}}
        slug={slug}
        conversationUrl={conversation?.conversation_url || null}
        conversationId={conversation?.conversation_id || null}
        onStart={start}
        onExit={() => setConversation(null)}
        onCallEnd={() => setConversation(null)}
        busy={busy}
        visitor
      />
      {error && (
        <div style={{ position: "fixed", bottom: 16, left: "50%", transform: "translateX(-50%)", zIndex: 99, background: "#fff", border: "1px solid #E6E4DF", color: "#D64545", borderRadius: 999, padding: "9px 18px", fontSize: 13, fontFamily: "'Instrument Sans', system-ui, sans-serif", boxShadow: "0 4px 14px rgba(0,0,0,.12)" }}>
          {error}
        </div>
      )}
    </>
  );
}

/* ── Duet: two AI humans in conversation, each in its own same-origin iframe
      (Daily allows one call object per page — iframes are separate pages).
      The parent is a text switchboard: when one replica finishes a turn, its
      words go to the other room as conversation.respond. No microphones
      anywhere, so there are no feedback loops; both voices play in the tab
      and the tab capture records the whole stage locally. ── */

/* Joiner page: /?duet=join&url=…&id=…&side=a|b — joins one room, renders the
   replica full-bleed, relays finished turns up, accepts respond/leave down. */
function DuetJoiner({ url, id, side, hold = false }) {
  const videoRef = useRef(null);
  const audioRef = useRef(null);
  const screenRef = useRef(null);
  const [hasScreen, setHasScreen] = useState(false); // replica screen track (slides/browser) present
  useEffect(() => {
    let call = null;
    let buf = [];
    let pendingTurn = null; // debounce: a stop only ends the turn after real quiet
    // Hold mode (side B): join immediately so the face is on screen from the
    // start, but stay silent — audio muted, any spontaneous greeting
    // interrupted — until the parent releases us with the scripted reply.
    let holding = !!hold;
    const origin = window.location.origin;
    const post = (m) => window.parent?.postMessage({ __duet: true, from: side, ...m }, origin);
    const send = (event_type, properties) => {
      try {
        call?.sendAppMessage({ message_type: "conversation", event_type, conversation_id: id, ...(properties ? { properties } : {}) }, "*");
      } catch { /* room gone */ }
    };
    const onParent = (e) => {
      if (e.origin !== origin || e.data?.__duet !== true) return;
      if (e.data.type === "respond" && e.data.text) {
        send("conversation.respond", { text: String(e.data.text).slice(0, 4000) });
      }
      if (e.data.type === "release") {
        holding = false;
        buf = [];
        if (audioRef.current) audioRef.current.muted = false;
        // The scripted reply speaks verbatim + instantly (no LLM round-trip).
        if (e.data.echo) send("conversation.echo", { text: String(e.data.echo).slice(0, 1000) });
      }
      if (e.data.type === "leave") { try { call?.leave(); } catch { /* gone */ } }
    };
    window.addEventListener("message", onParent);
    (async () => {
      try {
        call = DailyIframe.createCallObject();
        const attach = (el, track) => {
          if (!el) return;
          const stream = el.srcObject instanceof MediaStream ? el.srcObject : new MediaStream();
          stream.getTracks().filter((t) => t.kind === track.kind).forEach((t) => stream.removeTrack(t));
          stream.addTrack(track);
          el.srcObject = stream;
          el.play?.().catch(() => post({ type: "autoplay-blocked" }));
        };
        call.on("track-started", (ev) => {
          if (ev?.participant?.local || !ev?.track) return;
          if (ev.track.kind === "audio") { attach(audioRef.current, ev.track); return; }
          // Presentation slides / Browser Use arrive as the replica's screen
          // track — render it dominant with the face as a corner tile.
          const isScreen = ev.participant?.tracks?.screenVideo?.track?.id === ev.track.id;
          if (isScreen) { attach(screenRef.current, ev.track); setHasScreen(true); post({ type: "screen", on: true }); }
          else attach(videoRef.current, ev.track);
        });
        call.on("track-stopped", (ev) => {
          const scr = screenRef.current?.srcObject;
          if (ev?.track && scr instanceof MediaStream && scr.getTracks().some((t) => t.id === ev.track.id)) {
            screenRef.current.srcObject = null;
            setHasScreen(false);
            post({ type: "screen", on: false });
          }
        });
        call.on("app-message", (e2) => {
          const d = e2?.data;
          if (!d?.event_type) return;
          // Role arrives as properties.role ("pal"/"replica"/"user") or embedded
          // in the event type (conversation.replica.stopped_speaking).
          const role = String(
            d.properties?.role ?? (/\.user\./i.test(d.event_type) ? "user" : "replica")
          ).toLowerCase();
          if (role === "user") return; // duet rooms have no microphone anyway
          // While holding: kill any spontaneous greeting the moment it starts.
          if (holding) {
            if (/started_speaking/i.test(d.event_type)) send("conversation.interrupt");
            clearTimeout(pendingTurn);
            buf = [];
            return;
          }
          // Exact match: conversation.utterance-streaming would duplicate text.
          if (/^conversation\.utterance$/i.test(d.event_type)) {
            const t = String(d.properties?.speech ?? d.properties?.text ?? "").trim();
            if (t) {
              // Tavus can re-emit a turn's speech cumulatively (a later event
              // contains everything said so far) — replace, never stack, or
              // the relayed turn reads "A. B. A. B. C." and derails the
              // other side's reply.
              const last = buf[buf.length - 1];
              if (!buf.length) buf.push(t);
              else if (t === last || last.startsWith(t)) { /* duplicate / stale partial */ }
              else if (t.startsWith(last)) buf[buf.length - 1] = t;
              else buf.push(t);
              // Live speech feed — keyword cards fire the moment the word is
              // actually said, not an end-of-turn quiet-window later.
              post({ type: "speech", text: t });
            }
          }
          // stopped_speaking fires on PAUSES too — resuming within the quiet
          // window cancels the pending turn, so only a real end-of-turn posts
          // (premature posts caused talk-over). Empty transcripts still post:
          // scripted speech (greetings/echoes) may emit no utterance events.
          if (/started_speaking/i.test(d.event_type)) {
            clearTimeout(pendingTurn);
          }
          if (/stopped_speaking/i.test(d.event_type)) {
            clearTimeout(pendingTurn);
            // Adaptive quiet window — this wait IS most of the gap between
            // speakers. A transcript ending on sentence-final punctuation is
            // almost certainly a finished turn: confirm fast. Mid-sentence
            // stops and blank buffers (scripted speech has no transcript)
            // keep the long window — posting early there caused talk-over.
            const quiet = /[.!?…]["')\]]*$/.test(buf.join(" ").trim()) ? 900 : 1400;
            pendingTurn = setTimeout(() => {
              const text = buf.join(" ").trim();
              buf = [];
              post({ type: "turn", text });
            }, quiet);
          }
        });
        call.on("left-meeting", () => post({ type: "left" }));
        await call.join({ url, startVideoOff: true, startAudioOff: true });
        try { call.setLocalAudio(false); call.setLocalVideo(false); } catch { /* already off */ }
        post({ type: "ready" });
      } catch (err) {
        post({ type: "fatal", error: err?.message || "join failed" });
      }
    })();
    return () => {
      window.removeEventListener("message", onParent);
      try { call?.leave(); } catch { /* gone */ }
      try { call?.destroy(); } catch { /* gone */ }
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // Slides / Browser Use land in their own panel — a window that slides open
  // BESIDE the face (canvas-placement style), never replacing or covering it.
  // Both videos stay mounted so track attach always has a target.
  return (
    <div style={{ position: "fixed", inset: 0, background: "#101114", display: "flex" }}>
      <div style={{ flex: 1, minWidth: 0, position: "relative" }}>
        <video ref={videoRef} autoPlay playsInline muted={false} style={{ width: "100%", height: "100%", objectFit: "cover" }} />
      </div>
      <div
        style={{
          width: hasScreen ? "58%" : 0,
          transition: "width .5s ease",
          overflow: "hidden",
          flexShrink: 0,
          background: "#171a21",
          borderLeft: hasScreen ? "1px solid rgba(255,255,255,.12)" : "none",
          padding: hasScreen ? 10 : 0,
          boxSizing: "border-box",
        }}
      >
        <video ref={screenRef} autoPlay playsInline style={{ width: "100%", height: "100%", objectFit: "contain", background: "#000", borderRadius: 10 }} />
      </div>
      <audio ref={audioRef} autoPlay muted={!!hold} />
    </div>
  );
}

/* The duet stage the builder sees: branded chrome, two rooms side by side,
   REC indicator, turn counter, End button. Records the captured tab locally
   (MediaRecorder) and downloads the file when the duet ends. */
function DuetStage({ run, brand, maxTurns, cards = [], labels = null, openerA = "", openerB = "", summary = "", features = "", outline = [], surfaces = null, look = "stage", captions = false, onExit }) {
  // Closed captions — live transcript off the speech feed, revealed word by
  // word at roughly speech pace. Scripted lines (no transcript events) are
  // captioned from their authored text at turn time.
  const [cc, setCc] = useState(null); // {side, text, words, shown}
  const ccClearRef = useRef(null);
  const showCc = useCallback((side, textRaw) => {
    const text = String(textRaw || "").trim();
    if (!text) return;
    setCc((cur) => {
      const words = text.split(/\s+/);
      // Cumulative re-emits extend the same caption; a new utterance restarts it.
      if (cur && cur.side === side && text.startsWith(cur.text)) return { side, text, words, shown: cur.shown };
      return { side, text, words, shown: Math.min(3, words.length) };
    });
    clearTimeout(ccClearRef.current);
    ccClearRef.current = setTimeout(() => setCc(null), 9000);
  }, []);
  useEffect(() => {
    if (!captions) return undefined;
    const iv = setInterval(() => setCc((cur) => (cur && cur.shown < cur.words.length ? { ...cur, shown: cur.shown + 1 } : cur)), 320);
    return () => { clearInterval(iv); clearTimeout(ccClearRef.current); };
  }, [captions]);
  // "meeting" look: the recording reads as a saved Zoom/Meet call — no
  // branded chrome; the operator controls fade out when the mouse is idle
  // so the tab capture shows only what a real call recording would.
  const meeting = look === "meeting";
  const [chromeVisible, setChromeVisible] = useState(true);
  useEffect(() => {
    if (!meeting) return undefined;
    let idle;
    const onMove = () => {
      setChromeVisible(true);
      clearTimeout(idle);
      idle = setTimeout(() => setChromeVisible(false), 2500);
    };
    onMove();
    window.addEventListener("mousemove", onMove);
    return () => { clearTimeout(idle); window.removeEventListener("mousemove", onMove); };
  }, [meeting]);
  // Opening choreography: BOTH rooms join at t=0 (both faces on screen
  // together — no black tile). Side B starts HELD (muted, auto-interrupted);
  // when A's opener lands, we release B with the scripted reply via echo.
  // A's opener is not relayed — B's scripted reply already answers it.
  const aFirstRef = useRef(true);
  const releasedRef = useRef(false);
  const echoRelayedRef = useRef(false); // B's scripted reply handed to A exactly once
  const echoTimerRef = useRef(null);
  const lastTurnAtRef = useRef(Date.now());
  const lastFromRef = useRef("");
  const frameA = useRef(null);
  const frameB = useRef(null);
  const recorderRef = useRef(null);
  const chunksRef = useRef([]);
  const turnsRef = useRef(0);
  const [turns, setTurns] = useState(0);
  const [note, setNote] = useState("Both AI humans are connecting…");
  // Narrator strip: explains what the viewer is watching, beat by beat.
  const [narr, setNarr] = useState(summary || "Two AI humans in live conversation on Tavus — every turn is generated in real time. You could be either side of this call.");
  const lastCardAtRef = useRef(0);
  const beatRef = useRef(-1);
  const endedRef = useRef(false);
  // Scripted cards: keyword cards fire off what EITHER AI actually says and
  // render ON THE ASKER'S TILE; when a question card is up, the other AI's
  // spoken answer visibly selects the matching option.
  const [duetCard, setDuetCard] = useState(null); // {card, index, from, picked}
  // Which side has a live screen panel (slides / Browser Use) — that tile
  // widens so the deck window and the face both stay readable.
  const [screenSide, setScreenSide] = useState("");
  const cardFiredRef = useRef(new Set());
  const cardTimersRef = useRef([]);
  const cardsArmedRef = useRef(false);
  const showDuetCard = (i, from = "a") => {
    if (cardFiredRef.current.has(i)) return;
    cardFiredRef.current.add(i);
    lastCardAtRef.current = Date.now();
    // Placement is deterministic: every compiled card carries an owner —
    // the triggering speaker never decides which tile a card lands on.
    const side = cards[i].owner === "host" ? "b" : "a";
    setDuetCard({ card: cards[i], index: i, from: side, picked: null });
    setNarr("🪄 Magic Canvas — this interactive element was triggered live by what was just said.");
    // Duet cards never park forever: default auto-hide keeps them alternating.
    const hide = Number(cards[i].hideAfter) || 35;
    cardTimersRef.current.push(setTimeout(() => {
      setDuetCard((cur) => (cur?.index === i ? null : cur));
    }, hide * 1000));
  };
  const readyRef = useRef({ a: false, b: false });
  const pendingRef = useRef({ a: [], b: [] });
  // Scheduled surface cues — each fires exactly once, riding the next
  // host→featured relay as a (Stage direction: …) parenthetical.
  const deckCuedRef = useRef(false);
  const browserCuedRef = useRef(false);

  const endDuet = useCallback(() => {
    if (endedRef.current) return;
    endedRef.current = true;
    const origin = window.location.origin;
    [frameA, frameB].forEach((f) => f.current?.contentWindow?.postMessage({ __duet: true, type: "leave" }, origin));
    const rec = recorderRef.current;
    const finish = () => {
      if (chunksRef.current.length) {
        const blob = new Blob(chunksRef.current, { type: chunksRef.current[0]?.type || "video/webm" });
        const a = document.createElement("a");
        a.href = URL.createObjectURL(blob);
        a.download = `tavus-duet-${new Date().toISOString().slice(0, 19).replace(/[T:]/g, "-")}.webm`;
        a.click();
        setTimeout(() => URL.revokeObjectURL(a.href), 10_000);
      }
      run.stream?.getTracks().forEach((t) => t.stop());
      onExit();
    };
    if (rec && rec.state !== "inactive") {
      rec.onstop = finish;
      setTimeout(() => { try { rec.stop(); } catch { finish(); } }, 800); // let the last words land
    } else {
      finish();
    }
  }, [onExit, run.stream]);

  useEffect(() => {
    const origin = window.location.origin;
    const deliver = (side, text) => {
      const frame = side === "a" ? frameA : frameB;
      if (readyRef.current[side]) {
        frame.current?.contentWindow?.postMessage({ __duet: true, type: "respond", text }, origin);
      } else {
        pendingRef.current[side].push(text); // flushed when that room reports ready
      }
    };
    const releaseB = () => {
      if (releasedRef.current) return;
      releasedRef.current = true;
      frameB.current?.contentWindow?.postMessage({ __duet: true, type: "release", echo: openerB }, origin);
      // Guarantee the echoed reply reaches A even if B's speech events never
      // fire: relay it on a timer sized to the line's speaking duration.
      if (openerB) {
        const ms = 3000 + openerB.split(/\s+/).length * 450;
        echoTimerRef.current = setTimeout(() => {
          if (echoRelayedRef.current || endedRef.current) return;
          echoRelayedRef.current = true;
          deliver("a", openerB);
        }, ms);
      }
    };
    // Card matching runs on the LIVE speech feed (word said → card up) and
    // again on the finished turn as a backstop (scripted speech has no live
    // feed — its text gets substituted at turn time).
    const matchCards = (lower, from) => {
      if (!lower) return;
      // A spoken answer visibly selects the matching option on a live
      // question card — that's what makes it read as two-way, not a video.
      setDuetCard((cur) => {
        if (!cur || cur.card.style !== "question" || cur.picked !== null || cur.from === from) return cur;
        const opts = String(cur.card.body || "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 4);
        const hit = opts.findIndex((o) => lower.includes(o.toLowerCase()));
        return hit >= 0 ? { ...cur, picked: hit } : cur;
      });
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (c.trigger !== "keyword" || cardFiredRef.current.has(i)) continue;
        const kws = String(c.keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (kws.some((k) => lower.includes(k))) { showDuetCard(i, from); break; }
      }
    };
    const onMsg = (e) => {
      if (e.origin !== origin || e.data?.__duet !== true) return;
      const d = e.data;
      if (d.type === "speech" && typeof d.text === "string") {
        if (captions) showCc(d.from, d.text);
        matchCards(d.text.toLowerCase(), d.from);
        return;
      }
      if (d.type === "ready" && (d.from === "a" || d.from === "b")) {
        readyRef.current[d.from] = true;
        const frame = d.from === "a" ? frameA : frameB;
        pendingRef.current[d.from].splice(0).forEach((text) =>
          frame.current?.contentWindow?.postMessage({ __duet: true, type: "respond", text }, origin));
        if (d.from === "a") {
          setNote("Live — waiting for your AI human's opener…");
          if (!cardsArmedRef.current) {
            cardsArmedRef.current = true;
            cards.forEach((c, i) => {
              if (c.trigger === "start") showDuetCard(i);
              else if (c.trigger === "time" && Number(c.atSeconds) > 0) cardTimersRef.current.push(setTimeout(() => showDuetCard(i), c.atSeconds * 1000));
            });
          }
        }
      }
      if (d.type === "fatal") setNote(`Room ${String(d.from).toUpperCase()} failed: ${d.error}`);
      if (d.type === "autoplay-blocked") setNote("Audio blocked by the browser — click anywhere on this page once.");
      if (d.type === "screen" && (d.from === "a" || d.from === "b")) {
        setScreenSide((cur) => (d.on ? d.from : cur === d.from ? "" : cur));
        if (d.on) {
          setNarr("🖥 A window just opened beside the face — slides or a live browser, driven by the AI human itself, mid-conversation.");
          lastCardAtRef.current = Date.now();
        }
      }
      if (d.type === "turn") {
        // Scripted speech (custom greetings, echoes) can finish with NO
        // transcript — an empty turn still means "I'm done speaking". We know
        // the scripted texts, so substitute them where the transcript is blank.
        const rawText = String(d.text || "").trim();
        let text = rawText;
        turnsRef.current += 1;
        setTurns(turnsRef.current);
        lastTurnAtRef.current = Date.now();
        lastFromRef.current = d.from;
        if (turnsRef.current >= maxTurns * 2) { endDuet(); return; }
        const nowBeat = Math.floor(turnsRef.current / 2) + 1; // 1-indexed talk-track beat
        // Once the opening exchange has played, tell the viewer which Tavus
        // features to watch for (holds until the next beat/card caption).
        if (turnsRef.current === 2 && features) {
          setNarr(features);
          lastCardAtRef.current = Date.now();
        }
        // Scheduled surfaces: at the chosen beat, ride a stage direction into
        // the next host→featured relay so the deck / browser opens ON CUE
        // instead of whenever the model feels like it.
        let cue = "";
        if (d.from === "b") {
          if (surfaces?.deckBeat > 0 && nowBeat >= surfaces.deckBeat && !deckCuedRef.current) {
            deckCuedRef.current = true;
            cue += " (Stage direction: bring up the slide deck now — present the most relevant slide as you answer.)";
          }
          if (surfaces?.browserBeat > 0 && nowBeat >= surfaces.browserBeat && !browserCuedRef.current) {
            browserCuedRef.current = true;
            cue += ` (Stage direction: start your guided browser flow${surfaces.browserShow ? ` "${surfaces.browserShow}"` : ""} now and narrate it as it moves.)`;
          }
        }
        if (d.from === "a") {
          const isOpener = aFirstRef.current;
          aFirstRef.current = false;
          if (isOpener) {
            releaseB(); // B unmutes + speaks the scripted reply
            // Scripted speech has no transcript — substitute the authored
            // opener so its keywords still fire cards and the note reads.
            if (!text) text = openerA;
            // Scripted reply already answers the opener — never relay it too.
            if (!openerB && text) deliver("b", text);
          } else if (text) {
            deliver("b", text);
          }
        } else {
          // B's first audible turn after release is the echoed reply — relay
          // it to A exactly once, using the authored line when the transcript
          // is blank. Later turns relay their real text.
          if (releasedRef.current && !echoRelayedRef.current) {
            echoRelayedRef.current = true;
            clearTimeout(echoTimerRef.current);
            if (!text) text = openerB;
          }
          const out = (text ? text + cue : cue).trim();
          if (out) deliver("a", out);
        }
        // Scripted lines emit no speech events — caption them from the
        // authored text the moment their turn lands.
        if (captions && !rawText && text) showCc(d.from, text);
        if (text) setNote(`${labels?.[d.from] || String(d.from).toUpperCase()}: “${text.slice(0, 110)}${text.length > 110 ? "…" : ""}”`);
        // Backstop matching on the finished turn — the live speech feed
        // already ran, but substituted scripted texts only exist here.
        matchCards(text.toLowerCase(), d.from);
        // Beat-pinned cards: deterministic timing — fire when the talk track
        // reaches their beat (~2 turns per beat, same clock as the narrator).
        for (let i = 0; i < cards.length; i++) {
          if (cards[i].trigger !== "beat" || cardFiredRef.current.has(i)) continue;
          if (cards[i].atBeat <= nowBeat) { showDuetCard(i, d.from); break; }
        }
        // Fallback scheduling for KEYWORD cards only (beat/time/start cards
        // have their own clock): every card still gets its moment even if
        // its trigger words never come up — spread across the conversation.
        const totalTurns = maxTurns * 2;
        for (let i = 0; i < cards.length; i++) {
          if (cards[i].trigger !== "keyword" || cardFiredRef.current.has(i)) continue;
          const due = Math.ceil(((i + 1) * totalTurns) / (cards.length + 1));
          if (turnsRef.current >= due) showDuetCard(i, d.from);
          break; // only the next unfired keyword card, in plan order
        }
        // Narrator follows the talk track (unless a card caption is fresh).
        const beat = Math.min(outline.length - 1, Math.floor(turnsRef.current / 2));
        if (outline.length && beat !== beatRef.current && Date.now() - lastCardAtRef.current > 8000) {
          beatRef.current = beat;
          setNarr(`Now: ${outline[beat]}`);
        }
      }
    };
    window.addEventListener("message", onMsg);
    // If the opener never registers (event hiccup), release B anyway.
    const releaseFallback = setTimeout(releaseB, 18_000);
    // Anti-stall watchdog: if nobody has finished a turn in 25s, nudge the
    // side whose turn it is — a duet must never sit in silence.
    const watchdog = setInterval(() => {
      if (endedRef.current || turnsRef.current >= maxTurns * 2) return;
      if (Date.now() - lastTurnAtRef.current < 25_000) return;
      lastTurnAtRef.current = Date.now();
      if (!releasedRef.current) { releaseB(); return; }
      const target = lastFromRef.current === "b" ? "a" : "b";
      deliver(target, "Please continue the conversation — respond briefly and naturally to what was just said, then keep going with the plan.");
    }, 5000);

    // Local recording of the captured tab — both faces, both voices.
    if (run.stream) {
      try {
        const mime = MediaRecorder.isTypeSupported("video/webm;codecs=vp9,opus") ? "video/webm;codecs=vp9,opus" : "video/webm";
        const rec = new MediaRecorder(run.stream, { mimeType: mime, videoBitsPerSecond: 4_000_000 });
        rec.ondataavailable = (e) => { if (e.data?.size) chunksRef.current.push(e.data); };
        rec.start(1000);
        recorderRef.current = rec;
      } catch (err) { setNote(`Recorder failed (${err.message}) — the duet still runs, unrecorded.`); }
      run.stream.getVideoTracks()[0]?.addEventListener("ended", endDuet); // user hit "stop sharing"
    }

    const hardStop = setTimeout(endDuet, 5 * 60_000); // absolute cap
    return () => {
      clearTimeout(hardStop);
      clearTimeout(releaseFallback);
      clearTimeout(echoTimerRef.current);
      clearInterval(watchdog);
      cardTimersRef.current.forEach(clearTimeout);
      window.removeEventListener("message", onMsg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const src = (conv, side) =>
    `${window.location.origin}/?duet=join&side=${side}&id=${encodeURIComponent(conv.conversation_id || "")}&url=${encodeURIComponent(conv.conversation_url || "")}`;

  return (
    <div className={"duet-root" + (meeting ? " duet-meeting" : "")}>
      {meeting ? (
        <>
          <div className="meet-rec"><span className="meet-rec-dot" /> Recording</div>
          <div className={"meet-controls" + (chromeVisible ? "" : " hidden")}>
            <span className="meet-note">{note}</span>
            <span style={{ color: "#9aa0ab", fontSize: 12, fontFamily: "var(--mono)" }}>{turns} turns</span>
            <button className="pill-btn" onClick={endDuet}>■ End &amp; save</button>
          </div>
        </>
      ) : (
        <header className="duet-bar">
          <span className="duet-brand">{brand || "Tavus"} — AI duet</span>
          <span className="duet-rec">⏺ REC · {turns} turns</span>
          <button className="pill-btn" onClick={endDuet}>■ End &amp; save</button>
        </header>
      )}
      <div className={"duet-stage" + (screenSide ? ` duet-screen-${screenSide}` : "")}>
        <div className="duet-tile">
          <iframe ref={frameA} title="Duet A" className="duet-frame" allow="autoplay" src={src(run.a, "a")} />
          {labels?.a && <span className="duet-name">{labels.a}</span>}
          {duetCard?.from === "a" && (
            <div className="duet-tile-card">
              <ScriptedCard key={duetCard.index} card={duetCard.card} forcePicked={duetCard.picked} />
            </div>
          )}
        </div>
        <div className="duet-tile">
          <iframe ref={frameB} title="Duet B" className="duet-frame" allow="autoplay" src={`${src(run.b, "b")}&hold=1`} />
          {labels?.b && <span className="duet-name">{labels.b}</span>}
          {duetCard?.from === "b" && (
            <div className="duet-tile-card">
              <ScriptedCard key={duetCard.index} card={duetCard.card} forcePicked={duetCard.picked} />
            </div>
          )}
        </div>
      </div>
      {/* Closed captions — what's actually being said, revealed at speech pace. */}
      {captions && cc && (
        <div className="duet-cc" style={{ bottom: meeting ? 18 : 96 }}>
          <b>{(cc.side === "a" ? labels?.a : labels?.b) || (cc.side === "a" ? "Speaker 1" : "Speaker 2")}:</b>{" "}
          {cc.words.slice(Math.max(0, cc.shown - 18), cc.shown).join(" ")}
        </div>
      )}
      {/* Narrator — in meeting look it reads as a live-captions bar (native
          to a call recording); in stage look it's the branded strip. When CC
          is on it sits above the caption line. */}
      {narr && <div className={meeting ? "meet-captions" : "duet-narrator"} style={meeting && captions ? { bottom: 74 } : undefined}>{narr}</div>}
      {!meeting && <footer className="duet-note">{note}</footer>}
    </div>
  );
}

/* ── Duet rehearsal: plays the storyboard on a mock stage — every card on its
      exact tile at its scheduled moment, surface panels opening on cue, the
      narrator line — WITHOUT creating conversations. Free, instant, and the
      answer to "what exactly is about to be recorded?". Pacing is simulated
      (~11s a turn); order and placement are exact, wall-clock drifts a bit. ── */
function DuetRehearsal({ brand, maxTurns, cards = [], labels = null, outline = [], surfaces = null, summary = "", features = "", look = "stage", onExit }) {
  const meeting = look === "meeting";
  const TURN = 11; // seconds per live turn (speech + generation), rough average
  const totalTurns = Math.max(4, maxTurns * 2);
  const total = totalTurns * TURN;
  const fmt = (s) => `${Math.floor(s / 60)}:${String(Math.max(0, Math.floor(s % 60))).padStart(2, "0")}`;
  const beatTurn = (b) => Math.max(1, (Math.max(1, b) - 1) * 2); // first turn where the stage clock reaches beat b
  const model = useMemo(() => {
    const kwBeat = (c) => {
      const kws = String(c.keywords || "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
      return outline.findIndex((b2) => kws.some((k) => String(b2).toLowerCase().includes(k)));
    };
    const fires = cards.map((c, i) => {
      let t; let approx = false;
      if (c.trigger === "start") t = 1;
      else if (c.trigger === "time") t = c.atSeconds;
      else if (c.trigger === "beat") t = beatTurn(c.atBeat) * TURN;
      else {
        const bi = kwBeat(c);
        approx = true; // keyword cards fire when the word is actually said
        t = bi >= 0 ? (beatTurn(bi + 1) + 0.5) * TURN : Math.ceil(((i + 1) * totalTurns) / (cards.length + 1)) * TURN;
      }
      return { i, c, t: Math.min(total - 2, t), hide: Math.min(total, Math.min(total - 2, t) + (c.hideAfter || 35)), approx };
    });
    const deckT = surfaces?.deckOn ? (surfaces.deckBeat > 0 ? (beatTurn(surfaces.deckBeat) + 1) * TURN : total * 0.4) : null;
    const browserT = surfaces?.browserOn ? (surfaces.browserBeat > 0 ? (beatTurn(surfaces.browserBeat) + 1) * TURN : total * 0.55) : null;
    const events = [
      ...fires.map((f) => ({ t: f.t, label: `${f.approx ? "≈" : ""}${f.c.style === "chart" ? "📊" : f.c.style === "stat" ? "🔢" : f.c.style === "image" ? "🖼" : f.c.style === "question" ? "❓" : "📄"} ${f.c.title || f.c.style} → ${f.c.owner === "host" ? labels?.b || "host" : labels?.a || "featured"}` })),
      ...(deckT != null ? [{ t: deckT, label: `${surfaces.deckBeat > 0 ? "" : "≈"}📽 deck panel opens → ${labels?.a || "featured"}` }] : []),
      ...(browserT != null ? [{ t: browserT, label: `${surfaces.browserBeat > 0 ? "" : "≈"}🌐 browser opens → ${labels?.a || "featured"}` }] : []),
      { t: total, label: "⏹ take ends & saves" },
    ].sort((x, y) => x.t - y.t);
    return { fires, deckT, browserT, events };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  const [t, setT] = useState(0);
  const [playing, setPlaying] = useState(true);
  const [speed, setSpeed] = useState(2);
  useEffect(() => {
    if (!playing) return undefined;
    const iv = setInterval(() => setT((x) => (x + 0.2 * speed >= total ? (setPlaying(false), total) : x + 0.2 * speed)), 200);
    return () => clearInterval(iv);
  }, [playing, speed, total]);
  const turn = Math.min(totalTurns, Math.floor(t / TURN) + 1);
  const beat = Math.min(Math.max(1, outline.length), Math.floor(turn / 2) + 1);
  const speaking = turn % 2 === 1 ? "a" : "b"; // featured opens
  const lastFire = model.fires.filter((f) => f.t <= t).sort((x, y) => x.t - y.t).pop() || null;
  const active = lastFire && t < lastFire.hide ? lastFire : null;
  const deckOpen = model.deckT != null && t >= model.deckT;
  const browserOpen = model.browserT != null && t >= model.browserT;
  const panelOpen = deckOpen || browserOpen;
  const narr = (() => {
    const cands = [{ t: 0, s: summary || "Two AI humans in live conversation on Tavus." }];
    if (features) cands.push({ t: 2 * TURN, s: features });
    outline.forEach((b2, i) => cands.push({ t: beatTurn(i + 1) * TURN + 0.01, s: `Now: ${b2}` }));
    model.fires.forEach((f) => cands.push({ t: f.t, s: "🪄 Magic Canvas — this interactive element was triggered live by what was just said." }));
    if (model.deckT != null) cands.push({ t: model.deckT, s: "🖥 A window just opened beside the face — slides driven by the AI human itself." });
    if (model.browserT != null) cands.push({ t: model.browserT, s: "🖥 A window just opened beside the face — a live browser driven by the AI human itself." });
    return cands.filter((c) => c.t <= t).sort((x, y) => x.t - y.t).pop()?.s || "";
  })();
  const tile = (side) => {
    const name = side === "a" ? labels?.a || "Featured" : labels?.b || "Host";
    return (
      <div className="duet-tile" key={side} style={{ background: side === "a" ? "linear-gradient(135deg,#23262e,#181a20)" : "linear-gradient(135deg,#1d232b,#15181d)", borderRadius: 12, overflow: "hidden", outline: speaking === side ? "2px solid rgba(255,171,113,.75)" : "1px solid rgba(255,255,255,.08)", position: "relative" }}>
        <div style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center", flexDirection: "column", gap: 8, color: "#aab2bf", right: side === "a" && panelOpen ? "58%" : 0, transition: "right .5s ease" }}>
          <div style={{ width: 84, height: 84, borderRadius: "50%", background: "rgba(255,255,255,.08)", display: "flex", alignItems: "center", justifyContent: "center", fontSize: 34, fontWeight: 800, color: "#e8ebf0" }}>{name.slice(0, 1).toUpperCase()}</div>
          <div style={{ fontSize: 13 }}>{speaking === side ? "speaking…" : "listening"}</div>
        </div>
        {side === "a" && panelOpen && (
          <div style={{ position: "absolute", top: 0, right: 0, bottom: 0, width: "58%", background: "#171a21", borderLeft: "1px solid rgba(255,255,255,.12)", display: "flex", alignItems: "center", justifyContent: "center", color: "#cdd4de", fontSize: 14, textAlign: "center", padding: 16 }}>
            {deckOpen ? "📽 Slide deck presents here" : "🌐 Live browser renders here"}
          </div>
        )}
        <span className="duet-name">{name}</span>
        {active && (active.c.owner === "host" ? "b" : "a") === side && (
          <div className="duet-tile-card">
            <ScriptedCard key={active.i} card={active.c} forcePicked={null} />
          </div>
        )}
      </div>
    );
  };
  return (
    <div className={"duet-root" + (meeting ? " duet-meeting" : "")}>
      <header className="duet-bar">
        <span className="duet-brand" style={meeting ? { color: "#e8eaed" } : undefined}>{brand || "Tavus"} — rehearsal (nothing is live, nothing is billed)</span>
        <span className="duet-rec">▶ {fmt(t)} / {fmt(total)} · turn {turn}/{totalTurns} · beat {beat}</span>
        <button className="pill-btn" onClick={onExit}>✕ Close rehearsal</button>
      </header>
      <div className={"duet-stage" + (panelOpen ? " duet-screen-a" : "")}>
        {tile("a")}
        {tile("b")}
      </div>
      <div className={meeting ? "meet-captions" : "duet-narrator"} style={meeting ? { bottom: 108 } : undefined}>{narr}</div>
      <div style={{ flexShrink: 0, display: "flex", alignItems: "center", gap: 10, padding: "10px 20px 4px", color: "#aab2bf", fontSize: 13 }}>
        <button className="pill-btn" style={{ padding: "3px 12px" }} onClick={() => { setT(0); setPlaying(true); }}>⏪</button>
        <button className="pill-btn" style={{ padding: "3px 12px" }} onClick={() => setPlaying((p) => !p)}>{playing ? "⏸" : "▶"}</button>
        <select value={speed} onChange={(e) => setSpeed(Number(e.target.value))} style={{ background: "#1b1e24", color: "#e8ebf0", border: "1px solid rgba(255,255,255,.15)", borderRadius: 8, padding: "3px 8px", fontSize: 12.5 }}>
          <option value={1}>1×</option><option value={2}>2×</option><option value={4}>4×</option>
        </select>
        <input type="range" min="0" max={total} step="0.5" value={t} onChange={(e) => { setT(Number(e.target.value)); setPlaying(false); }} style={{ flex: 1 }} />
      </div>
      <div style={{ flexShrink: 0, display: "flex", gap: 8, overflowX: "auto", padding: "6px 20px 14px", fontSize: 12 }}>
        {model.events.map((ev, i) => (
          <span key={i} style={{ whiteSpace: "nowrap", padding: "3px 10px", borderRadius: 999, border: "1px solid rgba(255,255,255,.14)", background: ev.t <= t ? "rgba(255,171,113,.18)" : "rgba(255,255,255,.04)", color: ev.t <= t ? "#ffd9bd" : "#8d95a3", cursor: "pointer" }} onClick={() => { setT(Math.max(0, ev.t - 1)); setPlaying(false); }} title="Jump here">
            {fmt(ev.t)} {ev.label}
          </span>
        ))}
      </div>
      <footer className="duet-note">Simulated pacing at ~{TURN}s a turn — live turns drift a few seconds, but order, tiles and beat positions are exact. “≈” = model-timed (word-triggered or AI-decided).</footer>
    </div>
  );
}

/* ── Studio runtime: audio buffers + captured tab stream for the take that's
      about to run. Module-level because the take spans two component trees
      (the builder prepares it, CallExtras inside the call consumes it). ── */
let STUDIO_RUNTIME = null;
const setStudioRuntime = (rt) => { STUDIO_RUNTIME = rt; };
const getStudioRuntime = () => STUDIO_RUNTIME;

/* ── In-call extras: timers, wake reminders, interrupt button, guardrail echo.
      Lives INSIDE CVIProvider so it can use the Daily call object; these
      features need the custom call UI (they're inert in the iframe fallback). */
function CallExtras({ controls, conversationId, onForceLeave, visitor = false, onScriptedCard = null, onCoachSpeech = null, onAnnot = null }) {
  const daily = useDaily();
  const timeWarnedRef = useRef(false); // the 2-minute warning speaks once per call, across effect re-runs
  const firedCardsRef = useRef(new Set()); // scripted cards fire once per call — effect re-runs must not replay them

  // Coach mode: stream both sides' utterances up to the coach panel
  // (scorecard, talk/listen meter, transcript). Raw cumulative text — the
  // panel handles Tavus's re-emit semantics.
  useEffect(() => {
    if (!daily || !onCoachSpeech) return;
    const onMsg = (e) => {
      const d = e?.data;
      if (!d?.event_type || !/^conversation\.utterance$/i.test(d.event_type)) return;
      const text = String(d.properties?.speech ?? d.properties?.text ?? "").trim();
      if (!text) return;
      const role = String(d.properties?.role ?? (/\.user\./i.test(d.event_type) ? "user" : "replica")).toLowerCase();
      onCoachSpeech({ role: role === "user" ? "user" : "replica", text });
    };
    daily.on("app-message", onMsg);
    return () => daily.off("app-message", onMsg);
  }, [daily, onCoachSpeech]);

  // Scripted cards — deterministic, SE-authored canvas content. Triggers are
  // hard rules (spoken keyword, elapsed time, call start); the model is never
  // consulted. Each card fires once; a new card replaces the current one.
  useEffect(() => {
    const cards = Array.isArray(controls.scriptedCards) ? controls.scriptedCards : [];
    if (!daily || !cards.length || !onScriptedCard) return;
    const fired = firedCardsRef.current; // survives effect re-runs (a reset replayed start/time cards)
    const timers = [];
    let current = -1;
    let armed = false;
    let shownAt = 0;
    const queue = [];
    // A card triggered a second after another wiped it off screen before anyone
    // could read it — an image card "flashed" and was replaced by the next
    // note. Each card holds the panel for a beat; anything triggered meanwhile
    // waits its turn (at most two waiting, so a card never lands minutes late).
    const MIN_DWELL_MS = 6000;
    const STALE_QUEUE_MS = 20000;
    const present = (i) => {
      current = i;
      shownAt = Date.now();
      onScriptedCard({
        card: cards[i],
        seq: i,
        // Question cards: the visitor's pick goes to the LLM as if spoken.
        answer: (text) => {
          try {
            daily.sendAppMessage({
              message_type: "conversation",
              event_type: "conversation.respond",
              conversation_id: conversationId,
              properties: { text: String(text).slice(0, 500) },
            }, "*");
          } catch { /* room gone */ }
        },
      });
      // Blank auto-hide used to mean "until the next card" — and when no next
      // card ever fired, a note about step 2 sat beside her for the rest of the
      // call. Blank now means the same 45s the link-catalog photo cards use.
      const hide = Number(cards[i].hideAfter) || DEFAULT_HIDE_S;
      timers.push(setTimeout(() => { if (current === i) { current = -1; onScriptedCard(null); } }, hide * 1000));
    };
    const drain = () => {
      // A card whose cue has long passed is worse than no card, so waiting
      // entries expire rather than surfacing minutes later. (The old overflow
      // rule binned the OLDEST entry outright — already in `fired`, so it could
      // never come back, and the card silently never appeared.)
      const cutoff = Date.now() - STALE_QUEUE_MS;
      while (queue.length && queue[0].at < cutoff) queue.shift();
      if (!queue.length) return;
      const wait = shownAt ? Math.max(0, shownAt + MIN_DWELL_MS - Date.now()) : 0;
      if (wait > 0) { timers.push(setTimeout(drain, wait)); return; }
      present(queue.shift().i);
      if (queue.length) timers.push(setTimeout(drain, MIN_DWELL_MS));
    };
    const showCard = (i) => {
      if (fired.has(i)) return;
      fired.add(i);
      queue.push({ i, at: Date.now() });
      drain();
    };
    const arm = () => {
      if (armed) return;
      armed = true;
      cards.forEach((c, i) => {
        if (c.trigger === "start") showCard(i);
        else if (c.trigger === "time" && Number(c.atSeconds) > 0) timers.push(setTimeout(() => showCard(i), Number(c.atSeconds) * 1000));
      });
    };
    // Keyword cards match what's actually SAID (either side) — Tavus streams
    // utterance events as app-messages, so cards land in sync with the talk track.
    const onMsg = (e) => {
      const d = e?.data;
      if (!d?.event_type || !/utterance/i.test(d.event_type)) return;
      const speech = String(d.properties?.speech ?? d.properties?.text ?? "").toLowerCase();
      if (!speech) return;
      // Same role read the coach panel uses. Without it a card fires on the
      // PAL's OWN answer — ask about forms, the PAL says "that's under user
      // management", and the user-management card jumps up looking like the
      // question triggered it.
      const role = String(d.properties?.role ?? (/\.user\./i.test(d.event_type) ? "user" : "replica")).toLowerCase();
      const fromVisitor = role === "user";
      for (let i = 0; i < cards.length; i++) {
        const c = cards[i];
        if (c.trigger !== "keyword" || fired.has(i)) continue;
        if (c.speaker === "visitor" && !fromVisitor) continue;
        if (c.speaker === "ai" && fromVisitor) continue;
        const kws = String(c.keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (kws.some((k) => speech.includes(k))) { showCard(i); break; }
      }
    };
    const onJoined = () => arm();
    daily.on("app-message", onMsg);
    daily.on("joined-meeting", onJoined);
    if (daily.meetingState() === "joined-meeting") arm();
    return () => {
      timers.forEach(clearTimeout);
      daily.off("app-message", onMsg);
      daily.off("joined-meeting", onJoined);
      onScriptedCard(null);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, controls.scriptedCards]);
  // Studio takes: drive the conversation with pre-rendered TTS visitor lines
  // and record the tab-captured stage — Daily's composed recordings can't see
  // DOM overlays, so this is the only capture that includes Magic Canvas
  // cards (and shows presentation slides exactly as the visitor sees them).
  useEffect(() => {
    const rt = controls.studio ? getStudioRuntime() : null;
    if (!daily || !rt) return;
    let disposed = false;
    let quietTimer, fallbackTimer;
    let lineIdx = 0;
    let playing = false;
    let finishing = false;

    const finishTake = () => {
      if (finishing || disposed) return;
      finishing = true;
      try { daily.stopRecording(); } catch { /* not recording */ }
      setTimeout(() => {
        try { daily.stopScreenShare(); } catch { /* already gone */ }
        window.__tavusStageCapture = false;
        onForceLeave?.();
      }, 2000);
    };

    const playNext = () => {
      if (disposed || playing || finishing) return;
      if (lineIdx >= rt.buffers.length) { finishTake(); return; }
      playing = true;
      const src = rt.ctx.createBufferSource();
      src.buffer = rt.buffers[lineIdx];
      src.connect(rt.dest);
      src.onended = () => {
        playing = false;
        lineIdx += 1;
        // Safety net: if the replica's reply never registers, advance anyway.
        clearTimeout(fallbackTimer);
        fallbackTimer = setTimeout(playNext, 16_000);
      };
      try { src.start(); } catch { playing = false; }
    };

    // The replica going quiet for a beat = our turn to speak the next line.
    const onMsg = (e) => {
      const d = e?.data;
      if (!d?.event_type || !/utterance|speech|respond/i.test(d.event_type)) return;
      clearTimeout(quietTimer);
      if (playing || finishing) return;
      quietTimer = setTimeout(playNext, 1700);
    };

    const begin = async () => {
      try { await rt.ctx.resume(); } catch { /* already running */ }
      try { await daily.setLocalVideo(false); } catch { /* no camera is fine */ }
      try { await daily.setInputDevicesAsync({ audioSource: rt.dest.stream.getAudioTracks()[0] }); }
      catch (err) { console.error("[studio] couldn't set the TTS mic track:", err); }
      try { await daily.setLocalAudio(true); } catch { /* default is on */ }
      // The tab was captured on the Record-take click (gesture requirement);
      // publish it and record with the stage dominant — same path as the
      // manual ⏺ full-stage button.
      if (rt.displayStream?.getVideoTracks().length) {
        try {
          window.__tavusStageCapture = true;
          daily.startScreenShare({ mediaStream: rt.displayStream });
          setTimeout(() => {
            try { daily.startRecording({ layout: { preset: "default", max_cam_streams: 9 } }); } catch { /* badge shows the failure */ }
          }, 1200);
        } catch (err) { console.error("[studio] stage capture publish failed:", err); }
      }
      // The greeting opens most calls; if nothing is ever heard, start anyway.
      clearTimeout(fallbackTimer);
      fallbackTimer = setTimeout(playNext, 12_000);
    };

    const onJoined = () => begin();
    daily.on("joined-meeting", onJoined);
    daily.on("app-message", onMsg);
    if (daily.meetingState() === "joined-meeting") begin();
    return () => {
      disposed = true;
      clearTimeout(quietTimer);
      clearTimeout(fallbackTimer);
      daily.off("joined-meeting", onJoined);
      daily.off("app-message", onMsg);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily, controls.studio]);

  // "Full stage" recording is builder-only (visitors must never see a share
  // prompt) — visitor calls with a stage snapshot fall back to the grid.
  const stageMode = controls.recordingLayout === "stage" && !visitor;

  const say = (text) =>
    daily?.sendAppMessage(
      { message_type: "conversation", event_type: "conversation.echo", conversation_id: conversationId, properties: { text } },
      "*"
    );

  const interrupt = () =>
    daily?.sendAppMessage(
      { message_type: "conversation", event_type: "conversation.interrupt", conversation_id: conversationId },
      "*"
    );

  // S3 recording: Tavus writes the file to the configured bucket, but the
  // recording does NOT start on its own — the frontend has to kick it off
  // once the participant has joined. Non-fatal: a recording hiccup must
  // never take down a live demo. recStatus drives the on-screen ⏺ REC badge
  // so "is it actually recording?" is answerable at a glance.
  const [recStatus, setRecStatus] = useState("");
  const [palSpeaking, setPalSpeaking] = useState(false);
  const speakingRef = useRef(false); // "" | "starting" | "recording" | "error"

  /* Full-stage capture: getDisplayMedia needs a user gesture, so it rides the
     ⏺ button click. The tab is published into the call as a screenshare and
     the recording composes it dominant — canvas + avatar + humans + all audio
     in one file. The vendored UI ignores this share (window flag) so the
     visitor's own screen doesn't show a mirror tunnel. */
  const startStageRecording = async () => {
    if (!daily) return;
    try {
      const stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false, // audio comes from the call's own mic + replica tracks
        preferCurrentTab: true, // Chrome pre-selects this tab; other browsers show the picker
        selfBrowserSurface: "include",
      });
      window.__tavusStageCapture = true;
      daily.startScreenShare({ mediaStream: stream });
      stream.getVideoTracks()[0].addEventListener("ended", () => {
        window.__tavusStageCapture = false;
        try { daily.stopScreenShare(); } catch { /* already gone */ }
      });
      setRecStatus("starting");
      // Give the track a beat to publish, then record with the screen dominant.
      setTimeout(() => {
        try { daily.startRecording({ layout: { preset: "default", max_cam_streams: 9 } }); }
        catch { setRecStatus("error"); }
      }, 900);
    } catch { /* user dismissed the share prompt — no recording, no drama */ }
  };
  useEffect(() => () => { window.__tavusStageCapture = false; }, []);

  useEffect(() => {
    if (!daily || !controls.recording) return;
    let started = false;
    let retryTimer;
    // Bare startRecording() uses the room default, which composes only the
    // digital human — pass an explicit layout so the visitor is in the file.
    const recOpts =
      controls.recordingLayout === "pal" ? undefined
      : controls.recordingLayout === "speaker" ? { layout: { preset: "active-participant" } }
      : { layout: { preset: "default", max_cam_streams: 9 } }; // everyone, side by side
    const kickoff = () => (recOpts ? daily.startRecording(recOpts) : daily.startRecording());
    const startRec = () => {
      if (stageMode) return; // stage capture starts from the ⏺ button, not on join
      if (started) return;
      if (daily.meetingState() !== "joined-meeting") return;
      started = true;
      setRecStatus("starting");
      try { kickoff(); } catch { setRecStatus("error"); }
    };
    const onStarted = () => {
      setRecStatus("recording");
      // Re-assert the layout once recording is live: if it started before the
      // local camera published, the composition can miss the visitor.
      if (recOpts) setTimeout(() => { try { daily.updateRecording(recOpts); } catch { /* best effort */ } }, 2000);
    };
    const onStopped = () => setRecStatus((s) => (s === "error" ? s : ""));
    const onError = () => {
      // One retry — recording infra can hiccup right at join time.
      setRecStatus("error");
      clearTimeout(retryTimer);
      retryTimer = setTimeout(() => {
        try { kickoff(); setRecStatus("starting"); } catch { /* stay in error */ }
      }, 2500);
    };
    daily.on("joined-meeting", startRec);
    daily.on("recording-started", onStarted);
    daily.on("recording-stopped", onStopped);
    daily.on("recording-error", onError);
    startRec(); // already joined by the time this mounts
    return () => {
      clearTimeout(retryTimer);
      daily.off("joined-meeting", startRec);
      daily.off("recording-started", onStarted);
      daily.off("recording-stopped", onStopped);
      daily.off("recording-error", onError);
    };
  }, [daily, controls.recording]);

  useEffect(() => {
    if (!daily) return;

    const timers = [];
    // Time-limit warning, spoken with 2 minutes left — once, ever: the effect
    // can re-run on a daily reconnect and used to schedule a second warning.
    if (controls.maxSeconds && controls.timeWarning && !timeWarnedRef.current) {
      const fireAt = (controls.maxSeconds - 120) * 1000;
      if (fireAt > 5000) timers.push(setTimeout(() => { if (!timeWarnedRef.current) { timeWarnedRef.current = true; say(controls.timeWarning); } }, fireAt));
    }

    // Inactivity: quiet for N seconds → spoken reminder → 10s grace → leave.
    // The nudge is ONE-SHOT: the reminder's own speech comes back as
    // utterance/speaker events, and re-arming on those cleared the grace
    // timer — the call never ended and the same line repeated forever.
    let inactivityTimer;
    let graceTimer;
    let nudged = false;
    const armInactivity = () => {
      if (nudged) return; // grace period owns the rest of the call
      clearTimeout(inactivityTimer);
      if (!controls.inactivitySeconds || !controls.inactivityUtterance) return;
      inactivityTimer = setTimeout(() => {
        nudged = true;
        say(controls.inactivityUtterance);
        graceTimer = setTimeout(() => onForceLeave?.(), 10_000);
      }, controls.inactivitySeconds * 1000);
    };
    // A real human response after the nudge cancels the countdown (their
    // speech only — the PAL's own echo must not).
    const onHumanSpeech = (d) => {
      if (!nudged) return;
      const role = String(d?.properties?.role ?? "").toLowerCase();
      if (role === "user" || /\.user\./i.test(String(d?.event_type))) {
        nudged = false;
        clearTimeout(graceTimer);
        armInactivity();
      }
    };

    const lastGuardrailEcho = { at: 0 };
    const onAppMessage = (e) => {
      const d = e?.data;
      if (!d?.event_type) return;
      // Anyone talking (user utterances, PAL speech events) counts as engagement.
      if (/utterance|speaking|respond/i.test(d.event_type)) { armInactivity(); onHumanSpeech(d); }
      // Track whether SHE is mid-sentence, for the interrupt affordance. Only
      // set state on an actual change — these fire several times a turn, and
      // the call surface must not re-render on speech events.
      if (/speaking/i.test(d.event_type)) {
        const who = String(d.properties?.role ?? (/\.user\./i.test(d.event_type) ? "user" : "replica")).toLowerCase();
        if (who !== "user") {
          const now = /started_speaking/i.test(d.event_type);
          if (/stopped_speaking/i.test(d.event_type) || now) {
            if (speakingRef.current !== now) { speakingRef.current = now; setPalSpeaking(now); }
          }
        }
      }
      // Manual objective confirmation: Tavus emits objective.pending and waits
      // for a client confirm — without this reply the flow never advances and
      // the PAL loops on step one.
      if (/objective\.pending/i.test(d.event_type)) {
        try {
          daily.sendAppMessage({
            message_type: "conversation",
            event_type: "conversation.objective.confirm",
            conversation_id: conversationId,
            properties: { objective_name: d.properties?.objective_name },
          }, "*");
        } catch { /* room gone */ }
      }
      // Guardrail fired → optional spoken acknowledgement. Debounced: multiple
      // guardrail events per violation (or per pushy turn) each replayed the
      // same canned line back to back.
      if (/guardrail/i.test(d.event_type) && controls.guardrailEcho && Date.now() - lastGuardrailEcho.at > 30_000) {
        lastGuardrailEcho.at = Date.now();
        say(controls.guardrailEcho);
      }
      // Custom tool call → forward to the configured webhook (Zapier/Make/…).
      // text/plain body avoids a CORS preflight so any catch-hook accepts it.
      if (/tool_?call/i.test(d.event_type) && !/result/i.test(d.event_type) && controls.toolWebhook) {
        fetch(controls.toolWebhook, {
          method: "POST",
          headers: { "Content-Type": "text/plain" },
          body: JSON.stringify({
            source: "tavus-demo",
            conversation_id: conversationId,
            tool: d.properties?.name || d.properties?.function_name || "",
            arguments: d.properties?.arguments ?? d.properties?.args ?? null,
            at: new Date().toISOString(),
          }),
        }).catch(() => {});
        // Same debounce rationale as the guardrail echo — one confirmation
        // line per burst of tool calls, not one per event.
        if (controls.toolEcho && Date.now() - (lastGuardrailEcho.toolAt || 0) > 15_000) {
          lastGuardrailEcho.toolAt = Date.now();
          say(controls.toolEcho);
        }
      }
    };
    const onSpeaker = () => armInactivity();

    daily.on("app-message", onAppMessage);
    daily.on("active-speaker-change", onSpeaker);
    armInactivity();

    return () => {
      timers.forEach(clearTimeout);
      clearTimeout(inactivityTimer);
      clearTimeout(graceTimer);
      daily.off("app-message", onAppMessage);
      daily.off("active-speaker-change", onSpeaker);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily]);

  // On-stage annotations: perception tool calls (note_emotion / note_scene),
  // knowledge (RAG) observability events, and memory-recall phrases in the
  // PAL's speech → chips rendered by DemoSite. Everything is deduped per
  // window so chips never spam, and chip STATE lives up in DemoSite —
  // outside the memoized call surface (A/V invariant).
  useEffect(() => {
    if (!daily || !onAnnot || !controls.annot) return;
    const A = controls.annot;
    const last = { lastText: "" };
    const reactArm = { at: 0 };
    const push = (kind, icon, text, minGapMs) => {
      const now = Date.now();
      if (now - (last[kind] || 0) < minGapMs) return;
      if (text === last.lastText) return;
      last[kind] = now;
      last.lastText = text;
      onAnnot({ kind, icon, text });
    };
    const onMsg = (e) => {
      const d = e?.data;
      if (!d?.event_type) return;
      const props = d.properties || {};
      if (/perception_tool_call/i.test(d.event_type)) {
        let args = props.arguments ?? props.args ?? {};
        if (typeof args === "string") { try { args = JSON.parse(args); } catch { args = {}; } }
        const name = String(props.name || props.function_name || props.tool_name || "");
        if (A.emotion && /note_emotion/i.test(name)) {
          const emo = String(args.emotion || "").trim();
          if (emo) {
            push("emotion", "🎭", `Senses ${emo}${args.evidence ? ` — ${String(args.evidence).slice(0, 60)}` : ""}`, 12_000);
            reactArm.at = Date.now(); // pair with the reply: sense → react
          }
        } else if (A.vision && /note_scene/i.test(name)) {
          const seen = String(args.seen || args.what || "").trim();
          if (seen) push("vision", "👁", `Sees: ${seen.slice(0, 80)}`, 8_000);
        }
      }
      // The sensed emotion becomes VISIBLE when the reply lands — expression
      // and tone follow the speech (tts_emotion_control).
      if (A.emotion && reactArm.at && Date.now() - reactArm.at < 15_000 &&
          /started_speaking/i.test(d.event_type) &&
          (props.role === "pal" || props.role === "replica" || /replica/i.test(d.event_type))) {
        reactArm.at = 0;
        push("react", "↳", "Reacting — tone and expression adjust", 10_000);
      }
      // Knowledge retrieval: the RAG observability tool call fires when the
      // reply uses document chunks, carrying the document names.
      if (A.memory && /rag/i.test(d.event_type)) {
        const names = [].concat(props.document_names || props.documents || []).filter(Boolean).map(String);
        push("memory", "📚", names.length ? `Pulling from knowledge: ${names.slice(0, 2).join(", ")}` : "Pulling from the knowledge base", 20_000);
      }
      // Memory recall, spoken: the context tells the PAL to say what it
      // remembers out loud — this is the matching chip.
      if (A.memory && /utterance/i.test(d.event_type) && (props.role === "replica" || props.role === "pal")) {
        const t = String(props.speech || props.text || "");
        if (/(last time|you mentioned|welcome back|when we (last )?spoke|as you (told|said)|from our (last|previous))/i.test(t)) {
          push("memory", "💭", "Recalling a memory from a previous conversation", 45_000);
        }
      }
    };
    daily.on("app-message", onMsg);
    // Memory active from the start — the badge explains a greeting that
    // "already knows" them.
    const badgeTimer = A.memoryOn
      ? setTimeout(() => push("memory", "💭", "Memory active — this visitor is remembered across calls", 0), 1500)
      : null;
    return () => {
      daily.off("app-message", onMsg);
      if (badgeTimer) clearTimeout(badgeTimer);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [daily]);

  return (
    <>
      {/* No badge while recording works — it covered call buttons. Only a
          failure warrants pixels, and it's click-transparent. */}
      {controls.recording && recStatus === "error" && (
        <span className="rec-live rec-fail" title="daily recording-error — the call continues but may not be recorded">⚠ recording failed</span>
      )}
      {/* Full-stage capture can't auto-start (browsers require a click for tab
          capture) — one button, one click, then it runs for the whole call. */}
      {stageMode && controls.recording && (!recStatus || recStatus === "error") && (
        <button className="stage-rec-btn" onClick={startStageRecording}
          title='Approve the "share this tab" prompt once — the recording then captures the full stage (canvas, avatar, you) with all audio to S3'>
          ⏺ Record full stage
        </button>
      )}
      {/* Only while she is actually talking. A permanent button sits over the
          face for the whole call offering to stop speech that isn't happening —
          the visitor reads it as chrome, and it's in the shot on every
          recording and screenshot. */}
      {controls.interruptButton && palSpeaking && (
        <button className="interrupt-btn" onClick={interrupt} title="Stop her mid-sentence">
          <span aria-hidden="true">✋</span> Interrupt
        </button>
      )}
    </>
  );
}

/* ── Safe storage: persists in a normal browser (your local Vite app);
      silently no-ops where storage is blocked (e.g. claude.ai preview). ── */
const store = {
  get(key, fallback) {
    try { const v = window.localStorage.getItem(key); return v ? JSON.parse(v) : fallback; }
    catch { return fallback; }
  },
  set(key, value) {
    try { window.localStorage.setItem(key, JSON.stringify(value)); return true; }
    catch { return false; }
  },
};
const SCENARIOS_KEY = "tavus_builder_scenarios_v1";
const DRAFT_KEY = "tavus_builder_draft_v1"; // rolling autosave of the whole config
const SCENMETA_KEY = "tavus_builder_scenario_meta_v1"; // name → {updatedAt} for the library list
const REC_KEY = "tavus_builder_recording_v1"; // S3 recording defaults (non-secret identifiers)
const WEBHOOK_KEY = "tavus_builder_webhook_v1"; // callback URL — account plumbing, survives scenario loads
const PROMPT_HISTORY_KEY = "tavus_builder_prompt_history_v1"; // per-PAL persona versions
const APIKEY_KEY = "tavus_builder_api_key_v1";
const SHOWAPI_KEY = "tavus_builder_showapi_v1";

function Field({ label, hint, children }) {
  return (
    <label className="field">
      {label && <span className="field-label">{label}</span>}
      {children}
      {hint && <span className="field-hint">{hint}</span>}
    </label>
  );
}

function Toggle({ on, onChange }) {
  return (
    <button className={"toggle" + (on ? " toggle-on" : "")} onClick={() => onChange(!on)} aria-pressed={on} type="button">
      <span className="toggle-dot" />
    </button>
  );
}

/* Editor/plan shape → deliverable scripted cards. Incomplete cards drop out
   silently (missing content or an unusable trigger). */
const DEFAULT_HIDE_S = 45; // blank auto-hide — matches the link-catalog photo cards
const SC_STYLES = ["note", "chart", "stat", "image", "question", "link"];
const scStyle = (c) => (SC_STYLES.includes(c?.style) ? c.style : "note");
const scTrigger = (c) => (["keyword", "beat", "time", "start"].includes(c?.trigger) ? c.trigger : "keyword");
/* What each style needs before it can appear. The editor's live preview asks
   the SAME question the compiler does — two copies of this test drifted, and a
   card that compiled but read as incomplete shifted every preview after it. */
function scCardComplete(c) {
  const t = (v) => String(v ?? "").trim();
  const style = scStyle(c);
  const content = style === "image" ? t(c?.url) : style === "link" ? t(c?.href) : t(c?.body);
  const trig = scTrigger(c);
  const trigOk = trig === "start"
    ? true
    : trig === "keyword" ? !!t(c?.keywords)
    : trig === "beat" ? parseInt(c?.atBeat, 10) > 0
    : Math.round((parseFloat(c?.atMinutes) || 0) * 60) > 0; // matches the compiled atSeconds exactly
  return !!content && trigOk;
}

function compileScriptedCards(arr) {
  return (Array.isArray(arr) ? arr : []).map((c) => {
    const t = (v) => String(v ?? "").trim();
    const style = scStyle(c);
    const trigger = scTrigger(c);
    const card = {
      style,
      trigger,
      title: t(c.title),
      body: t(c.body),
      url: t(c.url),
      href: t(c.href),
      keywords: t(c.keywords),
      atBeat: Math.max(0, parseInt(c.atBeat, 10) || 0), // duets: 1-indexed talk-track beat
      atSeconds: Math.max(0, Math.round((parseFloat(c.atMinutes) || 0) * 60)),
      hideAfter: Math.max(0, parseInt(c.hideAfter, 10) || 0),
      linkLabel: t(c.linkLabel),
      // Which side's speech arms a keyword card. "either" is the old behaviour
      // and stays the default so saved demos don't change under people.
      speaker: ["visitor", "ai"].includes(c.speaker) ? c.speaker : "either",
      owner: c.owner === "host" ? "host" : "featured", // duets: whose screen it belongs on — ALWAYS explicit, placement is never speaker-dependent
    };
    if (!scCardComplete(c)) return null;
    return card;
  }).filter(Boolean).slice(0, 12);
}

/* ── Coach panel: live roleplay scorecard beside the call. Criteria tick
      two ways — instantly on trainee keywords, and every ~25s a fast Claude
      judge reads the transcript for the judgment-call behaviors. Plus a
      talk/listen meter, live transcript, and a REC countdown. ── */
function CoachPanel({ coach, events, conversationId, slug, maxSeconds, hidden = false }) {
  const [ticked, setTicked] = useState(() => new Set());
  const [elapsed, setElapsed] = useState(0);
  const tickedRef = useRef(ticked); tickedRef.current = ticked;
  const eventsRef = useRef(events); eventsRef.current = events;
  const judgeBusy = useRef(false);
  const lastJudged = useRef(0);
  const transcriptEnd = useRef(null);
  const criteria = coach.criteria || [];

  useEffect(() => {
    const t = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(t);
  }, []);

  // Instant ticks: trainee said a criterion's keyword.
  useEffect(() => {
    const userText = events.filter((e) => e.role === "user").map((e) => e.text).join(" ").toLowerCase();
    if (!userText) return;
    setTicked((prev) => {
      let changed = false;
      const next = new Set(prev);
      criteria.forEach((c, i) => {
        if (next.has(i)) return;
        const kws = String(c.keywords || "").split(",").map((s) => s.trim().toLowerCase()).filter(Boolean);
        if (kws.length && kws.some((k) => userText.includes(k))) { next.add(i); changed = true; }
      });
      return changed ? next : prev;
    });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [events]);

  // Judged ticks: every 25s, if the trainee said something new, a fast model
  // reads the transcript and rules on the still-unmet criteria.
  useEffect(() => {
    const t = setInterval(async () => {
      if (judgeBusy.current) return;
      const evs = eventsRef.current;
      const userTurns = evs.filter((e) => e.role === "user").length;
      if (!userTurns || userTurns === lastJudged.current) return;
      const unmet = criteria.map((c, i) => ({ c, i })).filter((x) => !tickedRef.current.has(x.i) && !String(x.c.keywords || "").trim());
      if (!unmet.length) return;
      judgeBusy.current = true;
      lastJudged.current = userTurns;
      try {
        const transcript = evs.map((e) => `${e.role === "user" ? "TRAINEE" : "CHARACTER"}: ${e.text}`).join("\n").slice(-11000);
        const r = await fetch("/api/generate-persona", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ kind: "score", vibe: transcript, ...(slug ? { slug } : {}), context: { criteria: unmet.map((x) => x.c.label) } }),
        });
        const text = await r.text();
        if (!r.ok || text.startsWith("[error]")) return;
        const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
        const hits = (Array.isArray(j?.hit) ? j.hit : []).map((k) => unmet[k]?.i).filter((i) => i !== undefined);
        if (hits.length) setTicked((prev) => new Set([...prev, ...hits]));
      } catch { /* next round */ } finally { judgeBusy.current = false; }
    }, 25000);
    return () => clearInterval(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Final score lands on the call's experience record (Results / webhook).
  useEffect(() => () => {
    const got = [...tickedRef.current].map((i) => criteria[i]?.label).filter(Boolean);
    if (!conversationId) return;
    fetch("/api/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "attend", conversation_id: conversationId, ...(slug ? { slug } : {}),
        answers: [{ q: "Scorecard", a: `${got.length}/${criteria.length}${got.length ? " — " + got.join("; ") : ""}` }],
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => { transcriptEnd.current?.scrollIntoView({ block: "nearest" }); }, [events]);

  const words = (role) => events.filter((e) => e.role === role).reduce((n, e) => n + e.text.split(/\s+/).filter(Boolean).length, 0);
  const you = words("user");
  const them = words("replica");
  const talkPct = you + them ? Math.round((you / (you + them)) * 100) : 0;
  const mmss = (s) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, "0")}`;

  // Assessment mode: the criteria ARE the answer key. A candidate reading
  // "mentions total cost of ownership" off a sidebar mid-interview is being
  // handed the marking scheme. Score silently — the keyword ticks, the judge,
  // and the final post to the call record all still run above.
  if (hidden) return null;

  return (
    <div className="coach-panel">
      <div className="coach-rec">
        <span className="coach-dot" /> REC <b>{mmss(elapsed)}</b>{maxSeconds > 0 && <span className="coach-total"> / {mmss(maxSeconds)}</span>}
        {coach.title && <span className="coach-title">{coach.title}</span>}
      </div>
      <div className="coach-sec">Live scorecard</div>
      <div className="coach-list">
        {criteria.map((c, i) => (
          <div key={i} className={"coach-item" + (ticked.has(i) ? " on" : "")}>
            <span className="coach-check">{ticked.has(i) ? "✓" : ""}</span>
            <span>{c.label}</span>
          </div>
        ))}
      </div>
      <div className="coach-sec">Talk / Listen <span className="coach-pct">{talkPct} / 100</span></div>
      <div className="coach-meter"><span style={{ width: `${Math.max(2, talkPct)}%` }} /></div>
      {coach.talkHint && <div className="coach-hint">{coach.talkHint}</div>}
      <div className="coach-sec">Transcript</div>
      <div className="coach-transcript">
        {events.length === 0 && <div className="coach-hint">Everything either of you says lands here.</div>}
        {events.map((e, i) => (
          <div key={i} className={"coach-line" + (e.role === "user" ? " you" : "")}>
            <b>{e.role === "user" ? "You" : "Them"}</b> {e.text}
          </div>
        ))}
        <div ref={transcriptEnd} />
      </div>
    </div>
  );
}

/* ── Scripted card renderer: SE-authored content, rendered verbatim.
      Styles: note (text), chart (one "Label: value" bar per line),
      stat (big value + label), image (URL). No model involved. ── */
/* Rendered interview grade. Every number carries the quote that produced it —
   a score with no receipt is the first thing anyone argues with. */
function GradeCard({ grade, rubric }) {
  const weightOf = (label) => rubric.find((r) => r.label === label)?.weight || 1;
  const pct = grade.overall != null ? (grade.overall / 5) * 100 : 0;
  const tone = grade.overall == null ? "none" : grade.overall >= 4 ? "hi" : grade.overall >= 3 ? "mid" : "lo";
  return (
    <div className="gc">
      <div className="gc-top">
        <div className={`gc-ring gc-${tone}`} style={{ "--gc-pct": `${pct}%` }}>
          <span className="gc-num">{grade.overall != null ? grade.overall.toFixed(1) : "—"}</span>
          <span className="gc-den">/ 5</span>
        </div>
        <div className="gc-head">
          {grade.verdict && <span className={`gc-verdict gc-${tone}`}>{grade.verdict}</span>}
          <p className="gc-summary">{grade.summary}</p>
          <span className="gc-meta">
            {grade.scored} of {grade.total} competencies evidenced
            {grade.at ? ` · graded ${grade.at.slice(0, 16).replace("T", " ")}` : ""}
          </span>
        </div>
      </div>

      <div className="gc-rows">
        {grade.rows.map((r, i) => {
          const sc = Number(r.score);
          const has = Number.isFinite(sc);
          const w = weightOf(r.label);
          return (
            <div key={i} className={"gc-row" + (has ? "" : " gc-row-null")}>
              <div className="gc-row-head">
                <span className="gc-label">{r.label}</span>
                {w > 1 && <span className="gc-weight" title={`Weighted ${w}×`}>{w}×</span>}
                <span className="gc-dots" aria-hidden="true">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <span key={n} className={"gc-dot" + (has && n <= sc ? ` on gc-${sc >= 4 ? "hi" : sc >= 3 ? "mid" : "lo"}` : "")} />
                  ))}
                </span>
                <span className="gc-score">{has ? sc : "no signal"}</span>
              </div>
              {r.evidence ? <blockquote className="gc-quote">{r.evidence}</blockquote> : null}
              {r.note && <p className="gc-note">{r.note}</p>}
            </div>
          );
        })}
      </div>

      {!!(grade.strengths?.length || grade.gaps?.length) && (
        <div className="gc-split">
          {!!grade.strengths?.length && (
            <div>
              <div className="gc-sub">Strengths</div>
              {grade.strengths.map((x, i) => <span key={i} className="gc-chip gc-chip-hi">{x}</span>)}
            </div>
          )}
          {!!grade.gaps?.length && (
            <div>
              <div className="gc-sub">Gaps</div>
              {grade.gaps.map((x, i) => <span key={i} className="gc-chip gc-chip-lo">{x}</span>)}
            </div>
          )}
        </div>
      )}
    </div>
  );
}

function ScriptedCard({ card, onAnswer, forcePicked = null }) {
  const [picked, setPicked] = useState(null); // question style: chosen option index
  useEffect(() => { setPicked(null); }, [card]);
  // forcePicked: driven from outside — e.g. a duet partner's spoken answer
  // visibly selecting the option they said.
  const eff = forcePicked !== null ? forcePicked : picked;
  const lines = String(card.body || "").split("\n").map((l) => l.trim()).filter(Boolean);
  let inner;
  if (card.style === "question") {
    inner = (
      <div className="sc-options">
        {lines.slice(0, 4).map((opt, i) => (
          <button
            key={i}
            type="button"
            className={"sc-opt" + (eff === i ? " on" : "")}
            disabled={eff !== null}
            onClick={() => { setPicked(i); onAnswer?.(opt); }}
          >
            {opt}
          </button>
        ))}
        {eff !== null && <span className="sc-answered">✓ {forcePicked !== null ? "answered in the conversation" : onAnswer ? "sent to the conversation" : "answered"}</span>}
      </div>
    );
  } else if (card.style === "chart") {
    const rows = lines
      .map((l) => { const m = l.match(/^(.*?)[:|=]\s*([\d.,]+)\s*(.*)$/); return m ? { label: m[1].trim(), value: parseFloat(m[2].replace(/,/g, "")) || 0, suffix: m[3].trim() } : null; })
      .filter(Boolean);
    const max = Math.max(1, ...rows.map((r) => r.value));
    inner = (
      <div className="sc-chart">
        {rows.map((r, i) => (
          <div key={i} className="sc-bar-row">
            <span className="sc-bar-label" title={r.label}>{r.label}</span>
            <span className="sc-bar-track"><span className="sc-bar" style={{ width: `${(r.value / max) * 100}%` }} /></span>
            <span className="sc-bar-val">{r.value.toLocaleString()}{r.suffix ? ` ${r.suffix}` : ""}</span>
          </div>
        ))}
      </div>
    );
  } else if (card.style === "stat") {
    inner = (
      <div className="sc-stat">
        <span className="sc-stat-value">{lines[0] || ""}</span>
        {lines.slice(1, 4).map((l, i) => <span key={i} className="sc-stat-label">{l}</span>)}
      </div>
    );
  } else if (card.style === "link") {
    // The whole point is the click: a scheduling page the visitor opens from
    // the card, with no model involvement and no URL read aloud.
    inner = (
      <div className="sc-note">
        {lines.map((l, i) => <p key={i}>{l}</p>)}
        <a className="sc-link-btn" href={card.href || ""} target="_blank" rel="noreferrer">
          {card.linkLabel || "Book a time"} →
        </a>
      </div>
    );
  } else if (card.style === "image") {
    const img = <img className="sc-img" src={card.url || ""} alt={card.title || ""} />;
    // Product cards: the photo click-throughs to the real product page.
    inner = card.href ? <a href={card.href} target="_blank" rel="noreferrer">{img}</a> : img;
  } else {
    inner = <div className="sc-note">{lines.map((l, i) => <p key={i}>{l}</p>)}</div>;
  }
  return (
    <div className="sc-card">
      {card.title && <div className="sc-title">{card.title}</div>}
      {inner}
    </div>
  );
}

/* ── Demo page: minimal Alto shell around the conversation ──── */

function DemoSite({ site, conversationUrl, conversationId, controls, onStart, onExit, busy, visitor = false, experience = null, slug = null, onCallEnd = null }) {
  // Experience arc: a guided pre-call journey (builder-composed steps +
  // email gate) and a post-call feedback screen around the conversation.
  // All off = the classic landing→call flow.
  const exp = experience || {};
  const journey = Array.isArray(exp.journey) ? exp.journey : [];
  const flowLen = journey.length + (exp.emailGate ? 1 : 0); // email gate is the final flow screen
  const postEnabled = !!(exp.rating || (exp.booking && exp.schedulingUrl) || exp.talkAgain || exp.thanks);
  const [flowIdx, setFlowIdx] = useState(-1); // -1 = not in the pre-call flow
  const [flowAnswers, setFlowAnswers] = useState([]); // [{step, option?, text?}]
  const [gateEmail, setGateEmail] = useState("");
  const [gateErr, setGateErr] = useState("");
  const [visitorEmail, setVisitorEmail] = useState("");
  const prefsRef = useRef(null); // completed journey prefs — reused by "talk again"
  const [postCall, setPostCall] = useState(null); // conversation id of the call that just ended
  const [fbRating, setFbRating] = useState(0);
  const [fbComment, setFbComment] = useState("");
  const [fbSent, setFbSent] = useState(false);
  const attendSent = useRef(null);

  /* Resolve raw answers ({step, option, text}) into readable {q, a} pairs —
     what gets stored with the call and shown in Results. */
  const answersRecord = (answers) => (answers || []).map((ans) => {
    const s = journey[ans.step];
    if (!s) return null;
    if (s.type === "question") {
      const a = s.options?.[ans.option];
      return typeof a === "string" ? { q: s.prompt, a } : null;
    }
    if (s.type === "input") {
      const a = String(ans.text ?? "").trim().slice(0, 200);
      return a ? { q: s.prompt, a } : null;
    }
    if (s.type === "personas") {
      const o = s.options?.[ans.option];
      return o ? { q: s.prompt || "Experience", a: o.label } : null;
    }
    return null;
  }).filter(Boolean);

  // Record attendance (and fire the owner's alert webhook, server-side) once
  // per conversation. Builder previews without a captured email skip it —
  // there's nothing to record and the team shouldn't get pinged by tests.
  useEffect(() => {
    if (!conversationId || attendSent.current === conversationId) return;
    const record = answersRecord(prefsRef.current?.answers);
    if (!slug && !visitorEmail && !record.length) return;
    attendSent.current = conversationId;
    fetch("/api/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "attend",
        conversation_id: conversationId,
        ...(slug ? { slug } : {}),
        ...(visitorEmail ? { email: visitorEmail } : {}),
        ...(record.length ? { answers: record } : {}),
      }),
    }).catch(() => {});
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [conversationId, slug, visitorEmail]);

  const submitFeedback = () => {
    setFbSent(true); // optimistic — feedback is best-effort decoration
    fetch("/api/experience", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        kind: "feedback",
        conversation_id: postCall,
        ...(slug ? { slug } : {}),
        ...(fbRating ? { rating: fbRating } : {}),
        ...(fbComment.trim() ? { comment: fbComment.trim() } : {}),
        ...(visitorEmail ? { email: visitorEmail } : {}),
      }),
    }).catch(() => {});
  };

  // Magic Canvas layout: when a side card is active the stage splits into a
  // video pane + a dedicated canvas panel (the card never overlays the video).
  // The side is kept after deactivation so the exit slide goes back the same way.
  const [canvasPanel, setCanvasPanel] = useState({ active: false, side: "right" });
  // Scripted card currently on screen (deterministic canvas — see CallExtras).
  const [scCard, setScCard] = useState(null);
  useEffect(() => { if (!conversationUrl) setScCard(null); }, [conversationUrl]);
  // Coach mode: rolling utterance feed for the scorecard panel. Tavus
  // re-emits a turn's text cumulatively — replace, never stack.
  const [coachEvents, setCoachEvents] = useState([]);
  useEffect(() => { if (!conversationUrl) setCoachEvents([]); }, [conversationUrl]);
  const pushCoachEvent = useCallback((e) => setCoachEvents((list) => {
    const last = list[list.length - 1];
    if (last && last.role === e.role) {
      if (last.text === e.text || last.text.startsWith(e.text)) return list;
      if (e.text.startsWith(last.text)) return [...list.slice(0, -1), e];
    }
    return [...list.slice(-299), e];
  }), []);
  // On-stage annotation chips (🎭 senses / 👁 sees / 💭 recalls): pushed by
  // CallExtras from perception/RAG/recall events, auto-expire, capped at 4.
  const [annotChips, setAnnotChips] = useState([]);
  useEffect(() => { if (!conversationUrl) setAnnotChips([]); }, [conversationUrl]);
  const annotSeq = useRef(0);
  const pushAnnot = useCallback((chip) => {
    const id = ++annotSeq.current;
    setAnnotChips((list) => [...list.slice(-3), { ...chip, id }]);
    setTimeout(() => setAnnotChips((list) => list.filter((c) => c.id !== id)), 9000);
  }, []);
  const onCanvasLayout = useCallback((l) => {
    setCanvasPanel((prev) => ({ active: Boolean(l?.active), side: (l?.active && l.side) || prev.side }));
  }, []);

  // True when the logo image is a wordmark (wide) — the brand text is skipped
  // to avoid "Sendoso Sendoso" in the nav.
  const [logoIsWordmark, setLogoIsWordmark] = useState(false);

  // Load the vendored CVI components (committed under src/components/cvi).
  // The custom call UI is the ONLY call path — there is no hosted-iframe
  // fallback. A load failure (e.g. a chunk lost to a network blip) shows a
  // reload prompt instead of silently downgrading to the Daily prebuilt UI.
  const [cvi, setCvi] = useState(undefined); // undefined=loading, null=load failed, object=ready
  useEffect(() => {
    let alive = true;
    const mods = import.meta.glob("./components/cvi/components/*/index.{tsx,ts,jsx,js}");
    const load = (name) => {
      const key = Object.keys(mods).find((k) => k.includes(`/${name}/`));
      return key ? mods[key]() : Promise.reject(new Error(`${name} not bundled`));
    };
    Promise.all([load("cvi-provider"), load("conversation"), load("magic-canvas")])
      .then(([p, c, m]) => alive && setCvi({ CVIProvider: p.CVIProvider, Conversation: c.Conversation, MagicCanvas: m.MagicCanvas }))
      .catch((e) => {
        console.error("[builder] call interface failed to load:", e);
        if (alive) setCvi(null);
      });
    return () => { alive = false; };
  }, []);

  const stage = () => {
    if (!conversationUrl) {
      if (postCall && postEnabled) {
        return (
          <div className="exp-screen">
            <h3>{exp.thanks || "Thanks for the conversation!"}</h3>
            {exp.rating && !fbSent && (
              <>
                <div className="star-row">
                  {[1, 2, 3, 4, 5].map((n) => (
                    <button key={n} type="button" className={"star" + (fbRating >= n ? " on" : "")} onClick={() => setFbRating(n)} aria-label={`${n} star${n > 1 ? "s" : ""}`}>★</button>
                  ))}
                </div>
                <textarea className="exp-comment" value={fbComment} onChange={(e) => setFbComment(e.target.value)} placeholder="Anything you'd tell the team? (optional)" />
                <button className="pill-btn primary" onClick={submitFeedback} disabled={!fbRating && !fbComment.trim()}>Send feedback</button>
              </>
            )}
            {exp.rating && fbSent && <p className="exp-hint">Got it — thank you!</p>}
            <div className="exp-actions">
              {exp.booking && exp.schedulingUrl && (
                <a className={"pill-btn" + (!exp.rating || fbSent ? " primary" : "")} href={exp.schedulingUrl} target="_blank" rel="noreferrer">📅 Book a meeting</a>
              )}
              {exp.talkAgain && (
                <button className="pill-btn" onClick={() => { setPostCall(null); handleStart(); }} disabled={busy}>{busy ? "Connecting…" : "Talk again"}</button>
              )}
              <button className="pill-btn ghost" onClick={() => setPostCall(null)}>Done</button>
            </div>
          </div>
        );
      }
      if (flowIdx >= 0) {
        const dots = (
          <div className="flow-dots" aria-hidden="true">
            {Array.from({ length: flowLen }, (_, d) => <span key={d} className={d <= flowIdx ? "on" : ""} />)}
          </div>
        );
        const back = flowIdx > 0 && (
          <button className="pill-btn ghost" onClick={() => setFlowIdx(flowIdx - 1)}>← Back</button>
        );
        // Final screen: the email gate (when enabled).
        if (flowIdx >= journey.length) {
          return (
            <div className="exp-screen">
              {dots}
              <h3>{journey.length ? "One last thing…" : "Before we start…"}</h3>
              <p className="exp-hint">{exp.emailPrompt || "Where can we reach you? The team likes to know who they're talking to."}</p>
              <input
                className="exp-input"
                type="email"
                value={gateEmail}
                onChange={(e) => { setGateEmail(e.target.value); setGateErr(""); }}
                onKeyDown={(e) => e.key === "Enter" && submitGate()}
                placeholder="you@company.com"
                autoFocus
              />
              {gateErr && <p className="exp-err">{gateErr}</p>}
              <div className="exp-actions">
                {back}
                <button className="pill-btn primary" onClick={submitGate} disabled={busy}>{busy ? "Connecting…" : "Start the conversation"}</button>
                {exp.emailRequired === false && <button className="pill-btn ghost" onClick={() => finishFlow("")} disabled={busy}>Skip</button>}
              </div>
            </div>
          );
        }
        const s = journey[flowIdx];
        const current = flowAnswers.find((a) => a.step === flowIdx);
        if (s.type === "info") {
          return (
            <div className="exp-screen">
              {dots}
              {s.title && <h3>{s.title}</h3>}
              {s.body && <p className="exp-hint" style={{ whiteSpace: "pre-wrap" }}>{s.body}</p>}
              <div className="exp-actions">{back}<button className="pill-btn primary" onClick={advanceFlow}>Continue</button></div>
            </div>
          );
        }
        if (s.type === "video") {
          const embed = videoEmbed(s.url);
          return (
            <div className="exp-screen">
              {dots}
              {s.title && <h3>{s.title}</h3>}
              {embed.kind === "file"
                ? <video className="exp-video" src={embed.src} controls playsInline />
                : <iframe className="exp-video" src={embed.src} title={s.title || "Video"} allow="autoplay; fullscreen; picture-in-picture" allowFullScreen />}
              <div className="exp-actions">{back}<button className="pill-btn primary" onClick={advanceFlow}>Continue</button></div>
            </div>
          );
        }
        if (s.type === "question" || s.type === "personas") {
          const opts = s.type === "question" ? (s.options || []).map((o) => ({ label: o })) : (s.options || []);
          return (
            <div className="exp-screen">
              {dots}
              <h3>{s.prompt}</h3>
              <div className="exp-options">
                {opts.map((o, oi) => (
                  <button key={oi} type="button" className={"exp-opt" + (current?.option === oi ? " on" : "")}
                    onClick={() => { setAnswer(flowIdx, { option: oi }); advanceFlow(); }}>
                    {o.label}
                    {o.desc && <span className="exp-opt-desc">{o.desc}</span>}
                  </button>
                ))}
              </div>
              {back && <div className="exp-actions">{back}</div>}
            </div>
          );
        }
        // free-text input step
        return (
          <div className="exp-screen">
            {dots}
            <h3>{s.prompt}</h3>
            <input
              className="exp-input"
              value={current?.text || ""}
              onChange={(e) => setAnswer(flowIdx, { text: e.target.value })}
              onKeyDown={(e) => e.key === "Enter" && advanceFlow()}
              placeholder={s.placeholder || "Type your answer…"}
              autoFocus
            />
            <div className="exp-actions">{back}<button className="pill-btn primary" onClick={advanceFlow}>Continue</button></div>
          </div>
        );
      }
      return (
        <div className="demo-cta">
          <button className="pill-btn primary big" onClick={handleStart} disabled={busy}>
            {busy ? "Connecting…" : site.cta || "Start the conversation"}
          </button>
          <span className="demo-cta-hint">Camera and microphone required</span>
        </div>
      );
    }
    if (cvi === undefined) {
      return <span className="demo-cta-hint">Loading…</span>;
    }
    if (cvi) {
      const { CVIProvider, Conversation, MagicCanvas } = cvi;
      // Only wide stages split for canvas cards — the phone screen, the framed
      // kiosk, and the hologram panel are too narrow (or too stylized), so
      // cards keep the overlay behavior there. Scripted cards use the same
      // panel; an interactive Magic Canvas card wins when both are active.
      const wide = format === "desktop" || (format === "kiosk" && kioskLive);
      const split = (canvasPanel.active || !!scCard) && wide;
      // Coach mode claims a persistent right sidebar on wide stages; the
      // canvas/card panel then uses the left side so the two never collide.
      const coach = wide && controls.coach && Array.isArray(controls.coach.criteria) && controls.coach.criteria.length ? controls.coach : null;
      // Hidden coaching still scores, but claims no screen — so the stage must
      // not split for a sidebar nobody can see.
      const coachShown = !!coach && coach.visible !== false;
      const cardSide = coachShown ? "left" : canvasPanel.side;
      // A UI screenshot is unreadable at note-card width. Image cards claim a
      // wider panel; the video pane already resizes into whatever is left.
      const liveCard = scCard && !canvasPanel.active && wide ? scCard.card : null;
      return (
        <CVIProvider>
          <div className={"cvi-wrap" + (split ? ` canvas-split canvas-split-${cardSide}` : "") + (coachShown ? " coach-split" : "") + (liveCard?.style === "image" ? " canvas-wide" : "")}>
            {/* The video pane resizes into the space the canvas panel doesn't
                claim, so active cards get their own screen region beside the
                video instead of cutting into it. */}
            <div className="cvi-video-pane">
              <Conversation conversationUrl={conversationUrl} onLeave={handleLeave} />
              {coachShown && coachEvents.length === 0 && (
                <div className="coach-scene">
                  <div className="coach-scene-badge">{(coach.title || "GO").split(/[\s·]+/).filter(Boolean).slice(-2).map((w) => w[0]).join("").toUpperCase()}</div>
                  <div className="coach-scene-title">{coach.scene || "They're about to pick up…"}</div>
                  <div className="coach-scene-sub">Allow your camera and microphone when the browser asks.</div>
                  <div className="coach-scene-bar"><span /></div>
                </div>
              )}
            </div>
            <div className={`canvas-panel canvas-panel-${cardSide}`} aria-hidden={scCard && !canvasPanel.active ? undefined : "true"}>
              {scCard && !canvasPanel.active && wide && (
                <ScriptedCard
                  key={scCard.seq}
                  card={scCard.card}
                  onAnswer={(opt) => {
                    scCard.answer?.(opt);
                    // The pick lands with the call record (Results / webhook).
                    if (conversationId) {
                      fetch("/api/experience", {
                        method: "POST",
                        headers: { "Content-Type": "application/json" },
                        body: JSON.stringify({
                          kind: "attend",
                          conversation_id: conversationId,
                          ...(slug ? { slug } : {}),
                          answers: [{ q: scCard.card.title || "Card question", a: opt }],
                        }),
                      }).catch(() => {});
                    }
                  }}
                />
              )}
            </div>
            {/* Contained inside the stage instead of a full-viewport overlay */}
            {coach && <CoachPanel coach={coach} events={coachEvents} conversationId={conversationId} slug={slug} maxSeconds={Number(controls.maxSeconds) || 0} hidden={!coachShown} />}
            {controls.annot && annotChips.length > 0 && (
              <div className="annot-rail" aria-hidden="true">
                {annotChips.map((c) => (
                  <div key={c.id} className={`annot-chip annot-${c.kind}`}>
                    <span className="annot-icon">{c.icon}</span>{c.text}
                  </div>
                ))}
              </div>
            )}
            <MagicCanvas className="canvas-contained" onError={(e) => console.error("canvas error", e)} onLayoutEffectChange={onCanvasLayout} />
            <CallExtras controls={controls} conversationId={conversationId} onForceLeave={handleLeave} visitor={visitor} onScriptedCard={setScCard} onCoachSpeech={coach ? pushCoachEvent : null} onAnnot={controls.annot ? pushAnnot : null} />
          </div>
        </CVIProvider>
      );
    }
    // Load failed — never fall back to the Daily prebuilt UI; ask for a reload.
    return (
      <div className="demo-cta">
        <span className="demo-cta-hint">The call interface didn't load — usually a momentary network blip.</span>
        <button className="pill-btn primary" onClick={() => window.location.reload()}>Reload</button>
      </div>
    );
  };

  // Legacy "designed" pages (the deleted design studio) — including immutable
  // shared-link snapshots — render as desktop; applyConfig can't reach those.
  const format = site.format === "designed" ? "desktop" : (site.format || "desktop");

  // Kiosk has two faces: the framed totem preview (default — visualize the
  // experience on the hardware) and "live" (chrome-less full-viewport for an
  // actual kiosk/tablet). Fullscreen needs a user gesture, so it rides on the
  // Go-live click; leaving fullscreen (Escape) drops back to the framed view.
  const [kioskLive, setKioskLive] = useState(false);
  const goFullscreen = () => document.documentElement.requestFullscreen?.().catch(() => {});
  const exitFullscreen = () => { if (document.fullscreenElement) document.exitFullscreen?.().catch(() => {}); };
  const goLive = () => { setKioskLive(true); goFullscreen(); };
  useEffect(() => {
    const onFs = () => { if (!document.fullscreenElement) setKioskLive(false); };
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);
  const beginCall = () => {
    if (format === "kiosk" && kioskLive) goFullscreen();
    onStart(prefsRef.current || undefined);
  };
  const handleStart = () => {
    // First start walks the guided flow; "talk again" reuses the answers.
    if (flowLen > 0 && !prefsRef.current) { setFlowIdx(0); return; }
    beginCall();
  };
  // Ref mirrors the answers state — an option click can advance and finish
  // the flow in the same tick, before React commits the state update.
  const flowAnswersRef = useRef([]);
  const setAnswer = (stepIdx, ans) => {
    flowAnswersRef.current = [...flowAnswersRef.current.filter((a) => a.step !== stepIdx), { step: stepIdx, ...ans }];
    setFlowAnswers(flowAnswersRef.current);
  };
  const finishFlow = (email) => {
    prefsRef.current = { email: email || "", answers: flowAnswersRef.current };
    if (email) setVisitorEmail(email);
    setFlowIdx(-1);
    beginCall();
  };
  const advanceFlow = () => {
    if (flowIdx + 1 < flowLen) setFlowIdx(flowIdx + 1);
    else finishFlow(""); // no email gate configured — journey ends straight into the call
  };
  const submitGate = () => {
    const e = gateEmail.trim();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(e)) { setGateErr("That doesn't look like an email address."); return; }
    finishFlow(e);
  };
  // Call over: with any post-call element configured, land on the feedback
  // screen (clearing just the conversation) instead of leaving the page.
  // useCallback matters here: this is a prop of the memoized <Conversation>
  // — a fresh function every render broke the memo, so per-utterance state
  // (coach feed) re-rendered the whole call surface and janked audio playout.
  const handleLeave = useCallback(() => {
    if (postEnabled && conversationId) {
      setPostCall(conversationId);
      setFbRating(0); setFbComment(""); setFbSent(false);
      if (onCallEnd) onCallEnd(); else onExit();
      return;
    }
    onExit();
  }, [postEnabled, conversationId, onCallEnd, onExit]);
  const handleExit = () => { exitFullscreen(); onExit(); };

  // Theme override: Claude-extracted brand colors/font applied as CSS vars.
  const t = site.theme || null;
  const themeVars = t ? Object.fromEntries(
    [
      ["--canvas", t.canvas], ["--surface", t.surface], ["--border", t.border],
      ["--text", t.text], ["--muted", t.muted], ["--accent", t.accent],
      ["--font", t.font],
    ].filter(([, v]) => v)
  ) : undefined;

  // 📸 Screenshot facade: the prospect's real site as the page itself, the
  // call stage floating over it. Desktop + phone only (kiosk/holo are
  // physical-surface stories).
  const shot = (format === "desktop" || format === "phone") && String(site.shot || "").trim() ? site.shot : null;

  // Brand the browser tab itself: title + favicon from the logo. Small, but
  // it's half of what makes a page read as "theirs" instead of a tool.
  useEffect(() => {
    if (!site.brand) return;
    const prevTitle = document.title;
    document.title = `${site.brand} — Live demo`;
    let link = null;
    if (site.logoUrl) {
      link = document.createElement("link");
      link.rel = "icon";
      link.href = site.logoUrl;
      document.head.appendChild(link);
    }
    return () => { document.title = prevTitle; if (link) link.remove(); };
  }, [site.brand, site.logoUrl]);

  return (
    <div className={`demo-root demo-${format}${format === "kiosk" && kioskLive ? " demo-kiosk-live" : ""}${t ? " demo-themed" : ""}${shot ? " demo-shot" : ""}`} style={themeVars}>
      {format === "kiosk" && kioskLive && (
        <button className="kiosk-exit" onClick={handleExit} title="Back to builder">×</button>
      )}
      <nav className="demo-nav">
        <div className="demo-brandwrap">
          {site.logoUrl ? (
            <img
              src={site.logoUrl}
              alt={site.brand || ""}
              className="demo-logo"
              // Wide image = a wordmark that already spells the brand name —
              // printing it again reads as "Sendoso Sendoso". Square-ish = a
              // glyph, so keep the name beside it.
              onLoad={(e) => setLogoIsWordmark(e.currentTarget.naturalWidth > e.currentTarget.naturalHeight * 2.2)}
              onError={(e) => { e.currentTarget.style.display = "none"; setLogoIsWordmark(false); }}
            />
          ) : (
            <span className="demo-monogram">{(site.brand || "T")[0].toUpperCase()}</span>
          )}
          {!(site.logoUrl && logoIsWordmark) && <span className="demo-brand">{site.brand || "Your Brand"}</span>}
        </div>
        {/* Facade nav: the prospect's REAL nav labels (pulled from their live
            site by brand theming) — half of what makes it read as "our site". */}
        {!shot && Array.isArray(site.nav) && site.nav.length > 0 && (
          <div className="dz-navlinks" aria-hidden="true">
            {site.nav.slice(0, 6).map((l, i) => <span key={i}>{String(l)}</span>)}
          </div>
        )}
        {!visitor && (
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pill-btn ghost" onClick={onExit}>← Builder</button>
          </div>
        )}
      </nav>

      <main className="demo-main">
        {format === "desktop" && !shot && (site.headline || !conversationUrl) && (
          <header className="demo-header">
            {site.brand && <span className="demo-eyebrow">{site.brand} · Live demo</span>}
            <h1>{site.headline || "Talk to our AI expert"}</h1>
            {site.tagline && <p>{site.tagline}</p>}
          </header>
        )}

        {format === "phone" ? (
          /* A screen of "their app": status bar, app header, hero with the CTA,
             and skeleton cards standing in for the host app's own content so
             the screen scrolls like a real app. In-call, the conversation
             takes the phone over full-bleed, FaceTime-style. */
          <div className="phone-frame">
            <div className="phone-island" />
            <div className="phone-screen">
              {conversationUrl || flowIdx >= 0 || (postEnabled && postCall) ? (
                <div className="demo-stage">{stage()}</div>
              ) : shot ? (
                /* 📸 Their real app screen: the screenshot IS the phone's
                   content; the CTA floats at the bottom like an in-app sheet. */
                <div className="shot-phone">
                  <img className="shot-img" src={shot} alt="" draggable={false} />
                  <div className="shot-phone-cta">
                    <button className="pill-btn primary" onClick={handleStart} disabled={busy}>
                      {busy ? "Connecting…" : site.cta || "Start the conversation"}
                    </button>
                  </div>
                </div>
              ) : (
                <>
                  <div className="app-status">
                    <span>9:41</span>
                    <span className="app-status-icons">▂▄▆█ ⏻</span>
                  </div>
                  <div className="app-scroll">
                    <div className="app-header">
                      {site.logoUrl
                        ? <img src={site.logoUrl} alt="" className="app-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                        : <span className="app-monogram">{(site.brand || "T")[0].toUpperCase()}</span>}
                      <span>{site.brand || "Your Brand"}</span>
                    </div>
                    <div className="app-hero">
                      <h2>{site.headline || "Talk to our AI expert"}</h2>
                      {site.tagline && <p>{site.tagline}</p>}
                      <button className="pill-btn primary" onClick={handleStart} disabled={busy}>
                        {busy ? "Connecting…" : site.cta || "Start the conversation"}
                      </button>
                      <span className="demo-cta-hint">Camera and microphone required</span>
                    </div>
                    <div className="app-skeleton" aria-hidden="true">
                      {[
                        ["42%", "78%"], ["58%", "86%"], ["36%", "70%"],
                        ["50%", "82%"], ["44%", "74%"], ["60%", "80%"],
                      ].map(([w1, w2], i) => (
                        <div key={i} className="app-card">
                          <div className="app-line" style={{ width: w1 }} />
                          <div className="app-line dim" style={{ width: w2 }} />
                          {i % 2 === 0 && <div className="app-line dim" style={{ width: "64%" }} />}
                        </div>
                      ))}
                    </div>
                  </div>
                  <div className="app-tabbar" aria-hidden="true">
                    <span className="on">⬤</span><span>⬤</span><span>⬤</span><span>⬤</span>
                  </div>
                </>
              )}
            </div>
          </div>
        ) : format === "kiosk" && !kioskLive ? (
          /* Framed totem preview — visualize the demo on the hardware it'll
             run on. "Go live" strips the frame for the real thing. */
          <div className="kiosk-scene">
            <div className="kiosk-totem">
              <div className="kiosk-screen">
                {conversationUrl || flowIdx >= 0 || (postEnabled && postCall) ? (
                  <div className="demo-stage">{stage()}</div>
                ) : (
                  <div className="kiosk-attract">
                    {site.logoUrl
                      ? <img src={site.logoUrl} alt="" className="kiosk-logo" onError={(e) => { e.currentTarget.style.display = "none"; }} />
                      : <span className="demo-monogram">{(site.brand || "T")[0].toUpperCase()}</span>}
                    <h2>{site.headline || "Talk to our AI expert"}</h2>
                    {site.tagline && <p>{site.tagline}</p>}
                    <button className="kiosk-cta" onClick={handleStart} disabled={busy}>
                      {busy ? "Connecting…" : site.cta || "Touch to start"}
                    </button>
                    <span className="demo-cta-hint">Camera and microphone required</span>
                  </div>
                )}
              </div>
              <div className="kiosk-neck" />
              <div className="kiosk-base" />
            </div>
            <button className="pill-btn" onClick={goLive} title="Chrome-less fullscreen for real kiosk or tablet hardware — Esc comes back to this preview">
              ⛶ Go live — fullscreen kiosk
            </button>
          </div>
        ) : format === "hologram" ? (
          /* Proto-style holobox: white enclosure, speaker grilles, glowing
             portrait screen. The call underneath is the same custom CVI
             stage as every other format — the box is pure chrome. */
          <div className="holo-scene">
            {(site.headline || site.tagline) && (
              <div className="holo-head">
                <h2>{site.headline || "Talk to our AI expert"}</h2>
                {site.tagline && <p>{site.tagline}</p>}
              </div>
            )}
            <div className="holo-box">
              <div className="holo-topbar">
                <span className="holo-brand">{site.brand || "Holobox"}</span>
                <span className="holo-tag">Beam in — live</span>
              </div>
              <div className="holo-screen">
                <div className="demo-stage holo-stage">{stage()}</div>
              </div>
              <div className="holo-foot">powered by tavus</div>
            </div>
          </div>
        ) : shot ? (
          /* 📸 "Their site comes alive": the screenshot's real header stays
             crisp at the top (instant that's-OUR-site recognition), the rest
             of their page becomes a blurred, dimmed backdrop, and the call
             rises out of it on a clean centered stage — theirs everywhere,
             nothing competing. (Replaced the flat overlay-on-busy-page look.) */
          <div className="shot-wrap">
            <div className="shot-topbar"><img src={shot} alt="" draggable={false} /></div>
            <div className="shot-backdrop"><img src={shot} alt="" draggable={false} /></div>
            <div className="shot-overlay">
              {(site.headline || site.tagline) && !conversationUrl && (
                <div className="shot-head">
                  {site.headline && <h2>{site.headline}</h2>}
                  {site.tagline && <p>{site.tagline}</p>}
                </div>
              )}
              <div className="demo-stage shot-stage">{stage()}</div>
            </div>
          </div>
        ) : (
          /* Their real hero image (og:image off the live site) as the stage
             poster pre-call — themed pages stop looking like an empty card. */
          <div className="demo-stage" style={!conversationUrl && /^https?:\/\//i.test(String(site.heroImage || ""))
            ? { backgroundImage: `linear-gradient(rgba(10,12,16,.52), rgba(10,12,16,.72)), url("${String(site.heroImage).replace(/["\\]/g, "")}")`, backgroundSize: "cover", backgroundPosition: "center" }
            : undefined}>{stage()}</div>
        )}

        <span className="demo-powered">powered by tavus</span>
      </main>
    </div>
  );
}

/* ── Main app ──────────────────────────────────────────────── */

export default function TavusExperienceBuilder() {
  // Duet joiner frames (?duet=join&…) bypass everything — they're the
  // per-room pages the DuetStage iframes load.
  const [duetJoin] = useState(() => {
    const p = new URLSearchParams(window.location.search);
    return p.get("duet") === "join" && p.get("url")
      ? { url: p.get("url"), id: p.get("id") || "", side: p.get("side") === "b" ? "b" : "a", hold: p.get("hold") === "1" }
      : null;
  });

  // Visitor mode: shared demo links (/d/{slug} or ?demo=slug) bypass the
  // builder and its login entirely — the link itself is the access.
  const [demoSlug] = useState(() => {
    const m = window.location.pathname.match(/^\/d\/([A-Za-z0-9_-]{6,24})/);
    return m ? m[1] : new URLSearchParams(window.location.search).get("demo");
  });

  const [step, setStep] = useState("start");
  const [humanHover, setHumanHover] = useState(""); // anatomy-hub hotspot sync
  // Feature walkthroughs: app-level video library — a ▶ next to each rail
  // step plays a short recording, narrated live by the Tavus voice stack.
  const [walkthroughs, setWalkthroughs] = useState({});
  const [wtPlaying, setWtPlaying] = useState(null); // stepId open in the player
  const [wtNarrOn, setWtNarrOn] = useState(true);
  const [wtUploading, setWtUploading] = useState("");
  const [wtEditStep, setWtEditStep] = useState("human");
  const [wtDraft, setWtDraft] = useState({ url: "", narration: "" });
  const wtVideoRef = useRef(null);
  const wtAudioRef = useRef(null);
  const wtFileRef = useRef(null);
  // Tavus Memories: persistent cross-conversation memory via memory_stores
  // on the conversation — separate from (and on top of) the Knowledge Base.
  const [memoryEnabled, setMemoryEnabled] = useState(false);
  const [memoryMode, setMemoryMode] = useState("visitor"); // visitor: per-email store | demo: one shared store
  const [memoryKey, setMemoryKey] = useState("");

  // Login gate. Accounts mode (email+password, invite-code signup) when the
  // server has BUILDER_PASSWORD + Redis; shared-code mode without Redis;
  // fully open when BUILDER_PASSWORD is unset (local dev).
  const [auth, setAuth] = useState({ checked: false, required: false, accounts: false, authed: false, email: null });
  const [authView, setAuthView] = useState("signin"); // signin | signup
  const [passcode, setPasscode] = useState("");       // legacy shared code
  const [authEmail, setAuthEmail] = useState("");
  const [authPassword, setAuthPassword] = useState("");
  const [authInvite, setAuthInvite] = useState("");
  const [authErr, setAuthErr] = useState("");
  const [authBusy, setAuthBusy] = useState(false);

  useEffect(() => {
    fetch("/api/login")
      .then((r) => (r.ok ? r.json() : { authRequired: false, authed: true }))
      .then((d) => setAuth({ checked: true, required: !!d.authRequired, accounts: !!d.accounts, authed: !!d.authed, email: d.email || null }))
      .catch(() => setAuth({ checked: true, required: false, accounts: false, authed: true, email: null })); // no backend (bare vite) → open
  }, []);

  const submitLogin = async (e) => {
    e.preventDefault();
    setAuthErr("");
    setAuthBusy(true);
    try {
      const body = auth.accounts
        ? { mode: authView, email: authEmail, password: authPassword, invite: authInvite }
        : { password: passcode };
      const r = await fetch("/api/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      const d = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(d.error || "Sign-in failed.");
      setAuth((a) => ({ ...a, authed: true, email: d.email || null }));
      setPasscode(""); setAuthPassword(""); setAuthInvite("");
    } catch (err) {
      setAuthErr(err.message);
    } finally {
      setAuthBusy(false);
    }
  };

  const signOut = async () => {
    await fetch("/api/login", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ mode: "signout" }) }).catch(() => {});
    setAuth((a) => ({ ...a, authed: false, email: null }));
  };

  // Setup
  const [apiKey, setApiKey] = useState("");
  const [faceId, setFaceId] = useState("");
  const [palId, setPalId] = useState("");
  const [languages, setLanguages] = useState(["en"]);
  const [langQuery, setLangQuery] = useState("");
  const [conversationName, setConversationName] = useState("");
  // Webhook is account plumbing, not demo content — remembered per browser
  // (like the API key and S3 fields) so scenario loads/reloads can't wipe it.
  const [callbackUrl, setCallbackUrl] = useState(() => store.get(WEBHOOK_KEY, ""));
  useEffect(() => { store.set(WEBHOOK_KEY, callbackUrl); }, [callbackUrl]);
  const [greeting, setGreeting] = useState("");

  // Persona (Claude-drafted system prompt)
  const [personaBrief, setPersonaBrief] = useState({
    vibe: "", product: "", audience: "", goal: "", tone: "", emotions: "", mustCover: "", avoid: "",
  });
  const setBriefField = (k, v) => setPersonaBrief((b) => ({ ...b, [k]: v }));
  const [personaDraft, setPersonaDraft] = useState("");
  // How the prompt gets authored: "brief" = describe it and Claude drafts;
  // "paste" = bring your own system prompt (written in Claude or anywhere)
  // and attach it as-is. Same draft box, same attach/revise machinery.
  const [personaMode, setPersonaMode] = useState("brief");
  const [personaFeedback, setPersonaFeedback] = useState("");

  // Version control for the prompt: every generate / revise / inject / attach
  // snapshots automatically (per PAL, in this browser), restorable one click.
  const [promptHistory, setPromptHistory] = useState(() => store.get(PROMPT_HISTORY_KEY, {}));

  // Test drive: text-only conversation against the PAL (chat mode — same PAL
  // config, no video pipeline). Validates behavior before booting a real call.
  const [chatConvId, setChatConvId] = useState("");
  const [chatLog, setChatLog] = useState([]); // {role: "user"|"pal"|"sys", text}
  const [chatInput, setChatInput] = useState("");
  const [chatBusy, setChatBusy] = useState(false);
  const [chatError, setChatError] = useState(""); // shown inline — the launch log isn't visible on this step
  const [generating, setGenerating] = useState(false);
  const [personaAttached, setPersonaAttached] = useState(false);

  // Vision (perception layer)
  const [visionEnabled, setVisionEnabled] = useState(false);
  const [visionVibe, setVisionVibe] = useState("");
  const [visualQueriesText, setVisualQueriesText] = useState("");
  // On-stage annotations ("X-ray mode"): chips over the call that SHOW the
  // AI sensing — 🎭 emotion (heard + reacted to), 👁 vision (what it sees),
  // 💭 memory/knowledge recall. Emotion + vision ride inline perception
  // TOOLS (fire-and-forget conversation.perception_tool_call app-messages);
  // memory is a spoken-recall context line + recall-phrase detection.
  const [annotEmotion, setAnnotEmotion] = useState(false);
  const [annotVision, setAnnotVision] = useState(false);
  const [annotMemory, setAnnotMemory] = useState(false);
  const [audioQueriesText, setAudioQueriesText] = useState("");
  const [visionGenerating, setVisionGenerating] = useState(false);

  // Pronunciation dictionary + expressive delivery
  const [speechEnabled, setSpeechEnabled] = useState(false);
  const [pronunciationText, setPronunciationText] = useState("");
  // Pronunciation manager: row editor over the DSL + account dictionaries.
  const [pronRows, setPronRows] = useState([]);
  const [pronDicts, setPronDicts] = useState(null); // null = not loaded yet
  const [pronDictsLoading, setPronDictsLoading] = useState(false);
  const [pronDictName, setPronDictName] = useState("");
  const [pronDictId, setPronDictId] = useState(""); // saved dictionary chosen for this demo
  const applyPronRows = (rows) => { setPronRows(rows); setPronunciationText(pronTextFromRows(rows)); };
  const fetchPronDicts = async () => {
    if (!apiKey.trim()) { addLog("err", "Enter your Tavus API key in Setup first."); return; }
    setPronDictsLoading(true);
    try {
      const d = await tavusFetch("GET", "/pronunciation-dictionaries");
      setPronDicts(Array.isArray(d) ? d : d?.data || d?.pronunciation_dictionaries || []);
    } catch (e) {
      addLog("err", `Dictionaries: ${e.message}`);
    } finally {
      setPronDictsLoading(false);
    }
  };
  const savePronDict = async () => {
    const rules = parsePronunciation(pronunciationText);
    if (!rules.length) { addLog("err", "No valid rules yet — add at least one word first."); return; }
    try {
      const name = pronDictName.trim() || `${(site.brand || conversationName || "builder").slice(0, 240)} dictionary`;
      addLog("info", `Saving dictionary "${name}" (${rules.length} rule${rules.length > 1 ? "s" : ""})…`);
      const d = await tavusFetch("POST", "/pronunciation-dictionaries", { name, rules });
      const id = d.pronunciation_dictionary_id || d.uuid || d.id;
      addLog("ok", `Dictionary "${name}" saved${id ? ` (${id})` : ""} — reusable across every demo on this account.`);
      if (id) setPronDictId(id);
      fetchPronDicts();
    } catch (e) {
      addLog("err", `Save dictionary: ${e.message}`);
    }
  };
  const deletePronDict = async (id, name) => {
    if (!window.confirm(`Delete dictionary “${name || id}”? Any PAL still pointing at it loses these pronunciations.`)) return;
    try {
      await tavusFetch("DELETE", `/pronunciation-dictionaries/${id}`);
      addLog("info", `Dictionary “${name || id}” deleted.`);
      if (pronDictId === id) setPronDictId("");
      fetchPronDicts();
    } catch (e) {
      addLog("err", `Delete dictionary: ${e.message}`);
    }
  };
  const attachPronDict = async (id) => {
    setPronDictId(id);
    if (!palId.trim()) { addLog("info", "Dictionary selected — it attaches to the PAL's voice on launch."); return; }
    try {
      await tavusFetch("PATCH", `/pals/${palId.trim()}`, [{ op: "add", path: "/layers/tts/pronunciation_dictionary_id", value: id }]);
      addLog("ok", "Dictionary attached to the PAL's voice (persists until you change it).");
    } catch (e) {
      addLog("err", `Attach dictionary: ${e.message}`);
    }
  };
  const loadPronDictRules = async (id, name) => {
    try {
      const d = await tavusFetch("GET", `/pronunciation-dictionaries/${id}`);
      const rules = Array.isArray(d?.rules) ? d.rules : Array.isArray(d?.data?.rules) ? d.data.rules : [];
      if (!rules.length) { addLog("info", "That dictionary has no readable rules to load."); return; }
      applyPronRows(rules.map((r) => ({
        word: String(r.text ?? r.word ?? ""),
        pron: String(r.pronunciation ?? ""),
        ipa: r.type === "ipa" || r.type === "phoneme",
        cs: !!r.case_sensitive,
      })));
      setPronDictName(name || "");
      addLog("ok", `Loaded ${rules.length} rule${rules.length > 1 ? "s" : ""} from “${name || id}” — edit away, then Save as a dictionary.`);
    } catch (e) {
      addLog("err", `Load rules: ${e.message}`);
    }
  };
  const [emotionControl, setEmotionControl] = useState(true);

  // Voice & accent (Cartesia catalog via /api/voices)
  const [externalVoiceId, setExternalVoiceId] = useState("");
  const [externalVoiceName, setExternalVoiceName] = useState("");
  const [voiceQuery, setVoiceQuery] = useState("");
  const [voiceResults, setVoiceResults] = useState(null);
  const [voiceLoading, setVoiceLoading] = useState(false);
  const [voiceApply, setVoiceApply] = useState({ busy: false, appliedId: "", err: "" });
  const [voiceOnPal, setVoiceOnPal] = useState(null); // {engine, voiceId} readback | {err}
  const [voicePreviewing, setVoicePreviewing] = useState("");

  // Tavus-authored skills (PUT /pals/{id}/skills/{skill_id}; persist on the PAL)
  const [internetSearchEnabled, setInternetSearchEnabled] = useState(false);
  const [browserUseEnabled, setBrowserUseEnabled] = useState(false);
  const [browserUseConfig, setBrowserUseConfig] = useState(""); // optional JSON — the skill is new, config schema may grow
  const [browsePlan, setBrowsePlan] = useState(""); // the "talk track" for browsing: when -> which page, one per line
  // Browser Use config, schema-driven: the form is rendered from the skill's
  // OWN config schema pulled from the account's registry (GET /skills), so
  // fields stay correct as Tavus evolves the brand-new skill. Values live in
  // browserUseConfig (JSON string) — one source of truth with the raw box.
  const browserCfgObj = useMemo(() => { try { return JSON.parse(browserUseConfig || "{}") || {}; } catch { return {}; } }, [browserUseConfig]);
  // Drop blank flows/steps before any PUT — "+ Add flow"/"+ Step" leave empty
  // husks behind, and one husk makes Tavus reject the WHOLE config (which at
  // launch is a single quiet log line). Also strips empty step URLs (a
  // cleared ⚡ field leaves url:"" — a navigation target to nowhere) and
  // enforces Tavus's 20-flow/50-step caps.
  const sanitizeBrowserCfg = (cfg) => {
    const flows = (Array.isArray(cfg?.guided_flows) ? cfg.guided_flows : [])
      .map((f) => ({
        ...f,
        steps: (Array.isArray(f?.steps) ? f.steps : [])
          .map((st) => {
            const s = { ...st };
            if (typeof s.url === "string" && !s.url.trim()) delete s.url;
            return s;
          })
          .filter((s) => String(s.task ?? "").trim() || String(s.prompt ?? "").trim() || s.slide != null)
          .slice(0, 50),
      }))
      .filter((f) => String(f?.name ?? "").trim() && f.steps.length)
      .slice(0, 20);
    return { ...cfg, guided_flows: flows };
  };
  const setBrowserCfgField = (k, v) => {
    const next = { ...browserCfgObj };
    const empty = v === "" || v === null || v === undefined || (Array.isArray(v) && !v.length);
    if (empty) delete next[k]; else next[k] = v;
    setBrowserUseConfig(Object.keys(next).length ? JSON.stringify(next, null, 2) : "");
  };
  /* ✨ Draft a guided flow: describe the walkthrough → Claude scripts it per
     Tavus's best practices (small single-action steps, 1-2 sentences of
     narration each — the narration covers the browser's think time). */
  const [browserFlowDesc, setBrowserFlowDesc] = useState("");
  const [browserFlowBusy, setBrowserFlowBusy] = useState(false);
  const draftBrowserFlow = async () => {
    const desc = browserFlowDesc.trim();
    if (!desc || browserFlowBusy) return;
    setBrowserFlowBusy(true);
    try {
      addLog("info", "Scripting the guided flow — small steps, narration per step…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "browserflow", vibe: desc, context: { brand: site.brand, product: personaBrief.product || personaBrief.vibe, brief: buildBrief() } }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: scripting failed`);
      }
      const flow = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!flow?.name || !Array.isArray(flow.steps) || !flow.steps.length) throw new Error("The flow came back incomplete — describe the walkthrough more concretely (site, what to show, in what order).");
      const cur = Array.isArray(browserCfgObj.guided_flows) ? browserCfgObj.guided_flows : [];
      setBrowserCfgField("guided_flows", [...cur, flow]);
      setBrowserUseEnabled(true);
      setBrowserFlowDesc("");
      addLog("ok", `Flow "${flow.name}" scripted — ${flow.steps.length} steps. Review each step's narration, then 🧪 Validate & attach.`);
    } catch (e) {
      addLog("err", `Flow: ${e.message}`);
    } finally {
      setBrowserFlowBusy(false);
    }
  };
  /* Paste a JD or curriculum → rubric rows. Editable after, like everything. */
  const draftRubric = async () => {
    if (gradeBusy || !gradeSource.trim()) return;
    setGradeBusy(true);
    try {
      addLog("info", "Reading the source and drafting the rubric…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "rubric",
          vibe: gradeSource.trim(),
          context: { role: gradeRole.trim(), objectives: objectivesText },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: drafting failed`);
      }
      const rows = JSON.parse(text.slice(text.indexOf("["), text.lastIndexOf("]") + 1));
      if (!Array.isArray(rows) || !rows.length) throw new Error("The rubric came back empty — paste more of the role or curriculum.");
      setGradeRubricText(rows.map((r) =>
        `${String(r.label || "").trim()} | ${String(r.good || "").trim()} | ${Math.min(3, Math.max(1, parseInt(r.weight, 10) || 1))}`
      ).filter((l) => l.trim().length > 4).join("\n"));
      setGradeEnabled(true);
      addLog("ok", `Rubric drafted — ${rows.length} competencies. Edit any line; weights are the last number.`);
    } catch (e) {
      addLog("err", `Rubric: ${e.message}`);
    } finally {
      setGradeBusy(false);
    }
  };

  /* Grade one finished call. The transcript comes straight from Tavus — no
     recording, no webhook, nothing to have gone missing mid-call. */
  const gradeCall = async (id, transcript) => {
    if (gradingId) return;
    if (!parsedRubric.length) { addLog("err", "No rubric yet — build one on the Scorecard step first."); return; }
    const lines = (Array.isArray(transcript) ? transcript : [])
      .filter((m) => m.role !== "system")
      .map((m) => `${m.role === "assistant" ? "INTERVIEWER" : "CANDIDATE"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n");
    if (!lines.trim()) { addLog("err", "That call has no transcript yet — Tavus takes a minute after a call ends."); return; }
    setGradingId(id);
    try {
      addLog("info", `Grading ${id} against ${parsedRubric.length} competencies…`);
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "grade",
          vibe: lines,
          context: { rubric: parsedRubric.map(({ label, good }) => ({ label, good })), role: gradeRole.trim() },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: grading failed`);
      }
      const g = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!Array.isArray(g?.rows) || !g.rows.length) throw new Error("The grade came back empty.");
      // The weighted mean is computed HERE, not by the model — arithmetic is
      // the one part of this it has no business doing. Unscored rows are left
      // out of both halves rather than counted as zero.
      const byLabel = new Map(parsedRubric.map((r) => [r.label, r.weight]));
      let num = 0, den = 0;
      for (const row of g.rows) {
        const sc = Number(row.score);
        if (!Number.isFinite(sc)) continue;
        const w = byLabel.get(row.label) ?? 1;
        num += sc * w; den += w;
      }
      const graded = {
        ...g,
        overall: den ? Math.round((num / den) * 10) / 10 : null,
        scored: den ? g.rows.filter((r) => Number.isFinite(Number(r.score))).length : 0,
        total: g.rows.length,
        at: new Date().toISOString(),
      };
      setGradeResults((m) => ({ ...m, [id]: graded }));
      addLog("ok", `Graded — ${graded.overall ?? "—"}/5 across ${graded.scored}/${graded.total} competencies.`);
    } catch (e) {
      addLog("err", `Grade: ${e.message}`);
    } finally {
      setGradingId("");
    }
  };

  const draftCoach = async () => {
    if (coachBusy) return;
    setCoachBusy(true);
    try {
      addLog("info", "Drafting the roleplay scorecard…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "coach",
          vibe: coachVibe.trim(),
          context: {
            brand: site.brand,
            personaSummary: personaDraft.slice(0, 3000),
            objectives: objectivesText,
          },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: drafting failed`);
      }
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!Array.isArray(j?.criteria) || !j.criteria.length) throw new Error("The scorecard came back empty — describe what the trainee should practice.");
      setCoachTitle(j.title || "");
      setCoachScene(j.scene || "");
      if (j.talkHint) setCoachTalkHint(j.talkHint);
      setCoachCriteriaText(j.criteria.map((c) => `${String(c.label || "").trim()}${String(c.keywords || "").trim() ? ` | ${String(c.keywords).trim()}` : ""}`).filter((l) => l.trim()).join("\n"));
      setCoachEnabled(true);
      addLog("ok", `Scorecard drafted — ${j.criteria.length} behaviors. Edit any line, then launch.`);
    } catch (e) {
      addLog("err", `Scorecard: ${e.message}`);
    } finally {
      setCoachBusy(false);
    }
  };

  const validateBrowserUse = async () => {
    if (!palId.trim()) { addLog("err", "Validation needs a PAL ID (Setup step) — Tavus checks the config on attach."); return; }
    let cfg = {};
    if (browserUseConfig.trim()) {
      try { cfg = JSON.parse(browserUseConfig); } catch { addLog("err", "The Browser Use config isn't valid JSON — fix it first."); return; }
    }
    cfg = sanitizeBrowserCfg(cfg); // launch PUTs the same sanitized shape — keep the two in lockstep
    if (!cfg.guided_flows.length) {
      addLog("err", "Browser Use needs at least one COMPLETE guided flow — a name plus at least one filled-in step (blank flows/steps are dropped before the attach). Add or ✨ script one first.");
      return;
    }
    if (cfg.guided_flows.some((f) => (Array.isArray(f?.steps) ? f.steps : []).some((st) => st?.slide != null && st.slide !== "")) && !cfg.slide_document_id) {
      addLog("err", "A flow has 🖼 slide steps but no slide deck — set slide_document_id (Tavus rejects the config without it).");
      return;
    }
    try {
      addLog("info", "Attaching Browser Use with this config (Tavus validates it server-side)…");
      await tavusFetch("PUT", `/pals/${palId.trim()}/skills/browser_use`, { config: cfg });
      setBrowserUseEnabled(true);
      addLog("ok", "✓ Tavus accepted the config — Browser Use is attached to the PAL now (persists until detached).");
    } catch (e) {
      addLog("err", `Tavus rejected the config: ${e.message}`);
    }
  };

  // Integrations (custom LLM tools → any webhook)
  const [toolsEnabled, setToolsEnabled] = useState(false);
  const [toolRows, setToolRows] = useState([{ name: "", desc: "", fields: "", delivery: "app_message" }]);
  const [toolWebhook, setToolWebhook] = useState("");
  const [toolEcho, setToolEcho] = useState("");

  // Team invites (per-person, single-use sign-up codes)
  const [invites, setInvites] = useState(null);
  const [invitesLoading, setInvitesLoading] = useState(false);
  const [inviteCreating, setInviteCreating] = useState(false);
  const [inviteError, setInviteError] = useState("");
  // Account self-service (change password) + team accounts directory
  const [teamUsers, setTeamUsers] = useState(null);
  const [acctCur, setAcctCur] = useState("");
  const [acctNew, setAcctNew] = useState("");
  const [acctMsg, setAcctMsg] = useState(null); // {ok, text}
  const [acctBusy, setAcctBusy] = useState(false);

  // Demo dashboard (per-slug stats from Redis)
  const [demoStats, setDemoStats] = useState(null);
  const [demoStatsLoading, setDemoStatsLoading] = useState(false);
  const [demoDetail, setDemoDetail] = useState(null);

  // Calls & data (pulled straight from Tavus)
  const [callsList, setCallsList] = useState(null);
  const [callsLoading, setCallsLoading] = useState(false);
  const [callDetail, setCallDetail] = useState(null);
  const [callDetailLoading, setCallDetailLoading] = useState(false);
  const [callsError, setCallsError] = useState(""); // inline — launch log isn't visible on the Results step
  const [callsFilter, setCallsFilter] = useState(""); // the API key is account-wide; scope the view here
  const [onlyMyPal, setOnlyMyPal] = useState(false);
  const [callsPage, setCallsPage] = useState(0); // client-side pagination, 25 per page
  const [recMap, setRecMap] = useState({}); // conversation_id → recording location
  const [expMap, setExpMap] = useState({}); // conversation_id → attendee/feedback record

  // Timing & controls
  const [maxMinutes, setMaxMinutes] = useState("");          // blank = Tavus default (60 min)
  const [timeWarning, setTimeWarning] = useState("");        // spoken with 2 minutes left
  const [inactivitySeconds, setInactivitySeconds] = useState(""); // blank = off
  const [inactivityUtterance, setInactivityUtterance] = useState("");
  const [wakePhrase, setWakePhrase] = useState("");
  // Conversational Flow layer (Sparrow turn-taking) — blank = Tavus default;
  // only set fields are patched, and the layer persists on the PAL.
  // Sparrow-2 by default (per explicit user direction) — Tavus's own default
  // is still sparrow-1, so the launch PATCH must say it out loud every time.
  const [sparrowModel, setSparrowModel] = useState("sparrow-2");
  const [sparrowPatience, setSparrowPatience] = useState("");
  const [sparrowInterrupt, setSparrowInterrupt] = useState("");
  const [sparrowIsolation, setSparrowIsolation] = useState("");
  const [sparrowIdle, setSparrowIdle] = useState("");
  const [interruptButton, setInterruptButton] = useState(false);
  const [guardrailEcho, setGuardrailEcho] = useState("");

  // Recording → your S3 bucket (Tavus uploads server-side; no AWS keys here,
  // just non-secret identifiers — access comes from a one-time IAM role trust).
  // ON by default, and the bucket details are remembered on this browser
  // (REC_KEY) so they're entered once, not per demo.
  const [recordingEnabled, setRecordingEnabled] = useState(() => store.get(REC_KEY, {}).enabled ?? true);
  const [recS3Bucket, setRecS3Bucket] = useState(() => store.get(REC_KEY, {}).bucket ?? "");
  const [recS3Region, setRecS3Region] = useState(() => store.get(REC_KEY, {}).region ?? "");
  const [recS3RoleArn, setRecS3RoleArn] = useState(() => store.get(REC_KEY, {}).roleArn ?? "");
  const [recS3ExternalId, setRecS3ExternalId] = useState(() => store.get(REC_KEY, {}).externalId ?? "");
  const [recLayout, setRecLayout] = useState(() => store.get(REC_KEY, {}).layout ?? "everyone"); // everyone | speaker | pal
  useEffect(() => {
    store.set(REC_KEY, { enabled: recordingEnabled, bucket: recS3Bucket, region: recS3Region, roleArn: recS3RoleArn, externalId: recS3ExternalId, layout: recLayout });
  }, [recordingEnabled, recS3Bucket, recS3Region, recS3RoleArn, recS3ExternalId, recLayout]);

  // New-PAL creation (Persona step)
  const [newPalName, setNewPalName] = useState("");
  const [creatingPal, setCreatingPal] = useState(false);
  const [palLlm, setPalLlm] = useState("tavus-gemma-4");

  // Knowledge Base
  const [kbDocs, setKbDocs] = useState(null); // null = not loaded yet
  const [kbLoading, setKbLoading] = useState(false);
  const [kbUrl, setKbUrl] = useState("");
  const [kbName, setKbName] = useState("");
  const [kbCrawl, setKbCrawl] = useState(false);
  const [kbAdding, setKbAdding] = useState(false);
  const [knowledgeIdsRaw, setKnowledgeIdsRaw] = useState(""); // docs the PAL can reference in-call

  // Presentation
  const [presentationEnabled, setPresentationEnabled] = useState(false);
  const [docIdsRaw, setDocIdsRaw] = useState("");
  const [slidesTrigger, setSlidesTrigger] = useState("walk_the_deck");
  const [presentPrompt, setPresentPrompt] = useState("");
  const [talkTrack, setTalkTrack] = useState([]); // per-slide speaker notes
  const [talkTrackDrafting, setTalkTrackDrafting] = useState(false);
  // Session-only slide images (base64) for vision-grounded talk-track drafts —
  // deliberately NOT saved with scenarios (too big; the notes are the artifact).
  const [slideShots, setSlideShots] = useState([]);
  const visionFileRef = useRef(null);
  // Session-only frames of the real scene (base64) for vision-grounded
  // perception queries — never saved, same handling as slideShots.
  const [visionShots, setVisionShots] = useState([]);
  const slideFileRef = useRef(null);

  // Objectives & Guardrails
  const [objectivesEnabled, setObjectivesEnabled] = useState(false);
  const [objectivesText, setObjectivesText] = useState("");
  const [confirmationMode, setConfirmationMode] = useState("auto");
  const [guardrailsEnabled, setGuardrailsEnabled] = useState(false);
  const [guardrailsText, setGuardrailsText] = useState("");

  // Canvas
  const [canvasEnabled, setCanvasEnabled] = useState(false);
  const [components, setComponents] = useState(
    Object.fromEntries(CANVAS_COMPONENTS.map((c) => [c.key, true]))
  );
  const [schedulingUrl, setSchedulingUrl] = useState("");
  // Verified links the PAL is allowed to share — the ONLY cure for link
  // cards pointing at invented URLs (the model has no idea what pages exist).
  const [linkCatalog, setLinkCatalog] = useState([]);
  const [linkFinder, setLinkFinder] = useState({ url: "", q: "", busy: false, results: null, err: "" });
  const [placement, setPlacement] = useState("auto");
  const [canvasStyle, setCanvasStyle] = useState("balanced");
  const [componentRules, setComponentRules] = useState(
    Object.fromEntries(CANVAS_COMPONENTS.map((c) => [c.key, ""]))
  );
  const [canvasPlaybook, setCanvasPlaybook] = useState("");
  // Scripted cards — deterministic canvas content (editor shape; compiled
  // into controlsConfig.scriptedCards so it rides shared links).
  const [scCards, setScCards] = useState([]);

  // Studio — scripted takes recorded as MP4 feature demos.
  const [studioLines, setStudioLines] = useState([{ text: "" }]);
  const [studioActive, setStudioActive] = useState(false);
  const [studioStatus, setStudioStatus] = useState("");
  const [ttsAvail, setTtsAvail] = useState(null); // null=unknown, {available, voice}, or false (probe failed)
  // Duet — self-contained: describe the conversation, Claude plans the talk
  // track FIRST, both personas embed it, and the cards derive from it — so
  // nothing bleeds and the cards line up with what actually gets said.
  const [duetDesc, setDuetDesc] = useState("");
  const [duetPlan, setDuetPlan] = useState(null); // {title, outline, featured, host, cards}
  const [duetPlanBusy, setDuetPlanBusy] = useState(false);
  const [duetPromoteBusy, setDuetPromoteBusy] = useState(false); // sales handoff: duet persona → permanent live PAL
  const [duetFaceA, setDuetFaceA] = useState(""); // featured speaker's face
  const [duetFaceB, setDuetFaceB] = useState(""); // host's face
  const [duetOpener, setDuetOpener] = useState(""); // featured opener — seeded from the plan, editable
  const [duetOpenerB, setDuetOpenerB] = useState(""); // host's scripted reply — plays instantly, hides LLM latency
  // On-video narrator lines — seeded from the plan, editable before recording.
  const [duetNarrIntro, setDuetNarrIntro] = useState(""); // summarizes the interaction
  const [duetNarrFeatures, setDuetNarrFeatures] = useState(""); // summarizes the Tavus features shown
  const [duetTurns, setDuetTurns] = useState("6");
  // On-screen surfaces for the featured side: the deck (Presentation step's
  // documents) and/or Browser Use — both arrive as the replica's screen track
  // and open in their own panel beside the face.
  const [duetDeck, setDuetDeck] = useState(false);
  const [duetBrowser, setDuetBrowser] = useState(false);
  // Scheduled surface opens (1-indexed talk-track beat; 0 = let the AI decide).
  // At the scheduled beat the stage injects a (Stage direction: …) into the
  // relayed turn so the featured AI actually brings the surface up on cue.
  const [duetDeckBeat, setDuetDeckBeat] = useState("0");
  const [duetBrowserBeat, setDuetBrowserBeat] = useState("0");
  const [duetBrowserShow, setDuetBrowserShow] = useState(""); // what the browser should pull up (URL or task)
  const [duetRehearse, setDuetRehearse] = useState(false); // free storyboard playback on a mock stage
  // The point of a duet is replacing a hand-recorded avatar call — so the
  // default look reads like a saved Zoom/Meet recording, not a demo stage.
  const [duetLook, setDuetLook] = useState("meeting"); // "meeting" | "stage"
  const [duetCaptions, setDuetCaptions] = useState(true); // CC: live transcript of what's said
  // Two reusable Studio PALs — their prompts get PATCHed per plan, so duets
  // never pile up new PALs on the account.
  const [studioPalA, setStudioPalA] = useState("");
  const [studioPalB, setStudioPalB] = useState("");
  const [duetRun, setDuetRun] = useState(null); // {a, b, stream} while a duet is live
  const [scriptBusy, setScriptBusy] = useState(false);
  const [scriptFocus, setScriptFocus] = useState("");
  const [cardsBusy, setCardsBusy] = useState(false);
  const [cardsPrompt, setCardsPrompt] = useState("");

  // Demo page
  const [site, setSite] = useState({
    brand: "", logoUrl: "", headline: "", tagline: "", cta: "Start the conversation", format: "desktop",
  });
  const setSiteField = (k, v) => setSite((s) => ({ ...s, [k]: v }));

  /* 🎙 Dictation (browser speech recognition — Chrome/Edge) + Spin-up: talk
     out your thoughts on the persona, flow, and rules; the transcript streams
     into the vibe box live, then one click turns the brain-dump into a clean
     brief + objectives + guardrails and auto-drafts the prompt on top. */
  const dictationRef = useRef(null);
  const [dictating, setDictating] = useState(""); // "" | "vibe" | "edit"
  // Wispr Flow dictation (preferred when WISPR_API_KEY is set server-side):
  // record raw PCM, encode 16kHz WAV, transcribe via /api/dictate on stop.
  // Falls back to the browser's live speech recognition automatically.
  const [dictEngine, setDictEngine] = useState(""); // "" = browser fallback | "cartesia" | "wisprflow"
  const [transcribing, setTranscribing] = useState(false);
  const wavRecRef = useRef(null);
  const dictApplyRef = useRef(null);
  useEffect(() => {
    if (demoSlug || duetJoin || (auth.required && !auth.authed)) return;
    fetch("/api/dictate").then((r) => (r.ok ? r.json() : null)).then((d) => setDictEngine(d?.available ? String(d.provider || "server") : "")).catch(() => { /* bare vite — browser engine only */ });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.authed]);
  const dictEngineName = dictEngine === "cartesia" ? "Cartesia Ink" : dictEngine === "wisprflow" ? "Wispr Flow" : "the browser's built-in engine";
  const finishWisprDictation = async () => {
    const rec = wavRecRef.current;
    if (!rec) return;
    wavRecRef.current = null;
    clearTimeout(rec.capTimer);
    try { rec.proc.disconnect(); rec.src.disconnect(); rec.stream.getTracks().forEach((tr) => tr.stop()); rec.ctx.close(); } catch { /* torn down */ }
    const total = rec.chunks.reduce((n, c) => n + c.length, 0);
    if (total < (rec.ctx.sampleRate || 16000) / 2) return; // under half a second — nothing said
    setTranscribing(true);
    try {
      const b64 = encodeWavBase64(rec.chunks, total, rec.ctx.sampleRate || 16000);
      const r = await fetch("/api/dictate", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ audio: b64 }) });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || `${r.status}`);
      if (String(j.text || "").trim()) dictApplyRef.current?.(String(j.text).trim());
      else addLog("info", "Wispr Flow heard nothing usable — try again, a touch closer to the mic.");
    } catch (e) {
      addLog("err", `Dictation (Wispr Flow): ${e.message}`);
    } finally {
      setTranscribing(false);
    }
  };
  const startWisprDictation = async (target) => {
    try {
      const stream = await navigator.mediaDevices.getUserMedia({ audio: { channelCount: 1 } });
      let ctx;
      try { ctx = new (window.AudioContext || window.webkitAudioContext)({ sampleRate: 16000 }); }
      catch { ctx = new (window.AudioContext || window.webkitAudioContext)(); }
      const src = ctx.createMediaStreamSource(stream);
      const proc = ctx.createScriptProcessor(4096, 1, 1);
      const chunks = [];
      proc.onaudioprocess = (e) => { chunks.push(new Float32Array(e.inputBuffer.getChannelData(0))); };
      src.connect(proc);
      proc.connect(ctx.destination);
      // Hard cap keeps the payload comfortably under serverless body limits.
      const capTimer = setTimeout(() => { if (wavRecRef.current) { finishWisprDictation(); setDictating(""); } }, 75_000);
      wavRecRef.current = { stream, ctx, src, proc, chunks, capTimer };
      setDictating(target);
    } catch (e) {
      addLog("err", `Microphone: ${e.message}`);
    }
  };
  const toggleDictation = (target, apply) => {
    if (dictating) {
      if (wavRecRef.current) finishWisprDictation();
      else { try { dictationRef.current?.stop(); } catch { /* already stopped */ } }
      setDictating("");
      return;
    }
    dictApplyRef.current = apply;
    if (dictEngine) { startWisprDictation(target); return; }
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition;
    if (!SR) { addLog("err", "Dictation isn't available — CARTESIA_API_KEY on Vercel enables server-side dictation (same key as Studio TTS), or use Chrome/Edge for the built-in engine."); return; }
    const rec = new SR();
    rec.continuous = true;
    rec.interimResults = true;
    rec.lang = navigator.language || "en-US";
    rec.onresult = (e) => {
      let final = "";
      for (let i = e.resultIndex; i < e.results.length; i++) if (e.results[i].isFinal) final += e.results[i][0].transcript;
      if (final.trim()) apply(final.trim());
    };
    rec.onend = () => setDictating("");
    rec.onerror = (e) => { if (e.error !== "aborted" && e.error !== "no-speech") addLog("err", `Dictation: ${e.error}`); };
    try { rec.start(); } catch { addLog("err", "Couldn't start the microphone — check the browser's mic permission."); return; }
    dictationRef.current = rec;
    setDictating(target);
  };
  /* Describe-the-flow (typed or dictated) → kind:"flow" structures it into
     the objectives DSL, revising existing steps rather than clobbering them.
     The decision-tree diagram re-renders live from the result. */
  const [flowDesc, setFlowDesc] = useState("");
  const [flowBusy, setFlowBusy] = useState(false);
  const structureFlow = async () => {
    const desc = flowDesc.trim();
    if (!desc || flowBusy) return;
    if (dictating) toggleDictation(dictating, () => {});
    setFlowBusy(true);
    try {
      addLog("info", "Structuring the flow from your description…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "flow",
          vibe: desc,
          context: { objectives: objectivesText, guardrails: guardrailsText, brand: site.brand, product: personaBrief.product || personaBrief.vibe },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: structuring failed`);
      }
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!out?.objectives || !String(out.objectives).trim()) throw new Error("No flow came back — describe the steps a little more concretely.");
      setObjectivesText(String(out.objectives).trim());
      setObjectivesEnabled(true);
      if (typeof out.guardrails === "string" && out.guardrails.trim()) { setGuardrailsText(out.guardrails.trim()); setGuardrailsEnabled(true); }
      addLog("ok", `${out.note || "Flow structured."} Check the decision tree — goals attach on the next launch.`);
      setFlowDesc("");
    } catch (e) {
      addLog("err", `Flow: ${e.message}`);
    } finally {
      setFlowBusy(false);
    }
  };

  const [spinBusy, setSpinBusy] = useState(false);
  const [autoDraft, setAutoDraft] = useState(false); // fires generatePersona AFTER spin-up state lands
  const spinUp = async () => {
    const dump = String(personaBrief.vibe || "").trim();
    if (!dump || spinBusy) return;
    if (dictating) toggleDictation(dictating, () => {});
    setSpinBusy(true);
    try {
      addLog("info", "Spinning up from your dictation — brief, objectives, guardrails…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "spinup", vibe: dump, context: { brand: site.brand } }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: spin-up failed`);
      }
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (out.brief && String(out.brief).trim()) setBriefField("vibe", String(out.brief).trim());
      const gotObj = typeof out.objectives === "string" && out.objectives.trim();
      const gotGr = typeof out.guardrails === "string" && out.guardrails.trim();
      if (gotObj) { setObjectivesText(out.objectives.trim()); setObjectivesEnabled(true); }
      if (gotGr) { setGuardrailsText(out.guardrails.trim()); setGuardrailsEnabled(true); }
      if (typeof out.greeting === "string" && out.greeting.trim()) setGreeting(out.greeting.trim());
      addLog("ok", `${out.note || "Spun up."} ${[gotObj && "objectives", gotGr && "guardrails"].filter(Boolean).join(" + ") || "brief"} set — drafting the system prompt on top…`);
      setAutoDraft(true); // generate AFTER the new state commits, so the prompt reads the fresh objectives/guardrails
    } catch (e) {
      addLog("err", `Spin-up: ${e.message}`);
    } finally {
      setSpinBusy(false);
    }
  };
  useEffect(() => {
    if (!autoDraft) return;
    setAutoDraft(false);
    generatePersona();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [autoDraft]);

  /* Chat with the demo — the seamless edit path. One instruction edits every
     implicated piece together (prompt, objectives, guardrails, greeting,
     page copy, canvas playbook). Nothing applies until the operator approves
     the change list: hand edits are sacred. */
  const [editAsk, setEditAsk] = useState("");
  const [editBusy, setEditBusy] = useState(false);
  const [editPending, setEditPending] = useState(null); // {ask, note, changes, labels}
  const EDIT_LABELS = {
    prompt: "persona prompt", objectives: "objectives", guardrails: "guardrails", greeting: "greeting",
    headline: "headline", tagline: "tagline", cta: "button label", canvasPlaybook: "canvas playbook",
  };
  const runDemoEdit = async () => {
    const ask = editAsk.trim();
    if (!ask || editBusy) return;
    setEditBusy(true);
    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "edit",
          vibe: ask,
          context: {
            prompt: personaDraft, objectives: objectivesText, guardrails: guardrailsText, greeting,
            headline: site.headline, tagline: site.tagline, cta: site.cta, canvasPlaybook, brand: site.brand,
            brief: buildBrief(),
          },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: edit failed`);
      }
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      const changes = out?.changes && typeof out.changes === "object" ? out.changes : {};
      const keys = Object.keys(EDIT_LABELS).filter((k) => typeof changes[k] === "string" && changes[k].trim());
      if (!keys.length) throw new Error("Nothing changed — try a more specific instruction.");
      setEditPending({ ask, note: String(out.note || ""), changes, keys });
    } catch (e) {
      addLog("err", `Edit: ${e.message}`);
    } finally {
      setEditBusy(false);
    }
  };
  const applyDemoEdit = () => {
    const c = editPending?.changes;
    if (!c) return;
    const applied = [];
    const put = (k, fn) => { if (typeof c[k] === "string" && c[k].trim()) { fn(c[k]); applied.push(EDIT_LABELS[k]); } };
    put("prompt", (v) => { setPersonaDraft(v); setPersonaAttached(false); });
    put("objectives", (v) => { setObjectivesText(v); setObjectivesEnabled(true); });
    put("guardrails", (v) => { setGuardrailsText(v); setGuardrailsEnabled(true); });
    put("greeting", setGreeting);
    put("headline", (v) => setSiteField("headline", v));
    put("tagline", (v) => setSiteField("tagline", v));
    put("cta", (v) => setSiteField("cta", v));
    put("canvasPlaybook", setCanvasPlaybook);
    addLog("ok", `Edited ${applied.join(", ")}.${c.prompt ? " The prompt changed — re-attach it on the Persona step before the next launch." : ""} Goals re-attach on launch automatically.`);
    setEditPending(null);
    setEditAsk("");
  };


  // Experience arc — guided pre-call journey + email gate (table stakes:
  // default ON) + attendance alert + post-call feedback.
  // Journey steps the builder composes per demo — the editor shape (question
  // options as one-per-line text) lives here; experienceConfig compiles it.
  const [expJourney, setExpJourney] = useState([]);
  const [expEmailGate, setExpEmailGate] = useState(true);
  const [expEmailRequired, setExpEmailRequired] = useState(true);
  const [expEmailPrompt, setExpEmailPrompt] = useState("");
  const [expNotifyWebhook, setExpNotifyWebhook] = useState("");
  const [expRating, setExpRating] = useState(false);
  const [expBooking, setExpBooking] = useState(false);
  const [expTalkAgain, setExpTalkAgain] = useState(false);
  const [expThanks, setExpThanks] = useState("");
  // Coach mode — a live roleplay scorecard beside the call (Rilla-style):
  // criteria tick as the trainee demonstrates them, talk/listen meter,
  // transcript, REC countdown, scene line while connecting.
  // Post-call grading: the rubric is authored here, the grade runs on demand
  // from Results. Nothing about it reaches the PAL or the conversation.
  const [gradeEnabled, setGradeEnabled] = useState(false);
  const [gradeRole, setGradeRole] = useState("");
  const [gradeRubricText, setGradeRubricText] = useState("");
  const [gradeSource, setGradeSource] = useState("");   // JD / curriculum paste
  const [gradeBusy, setGradeBusy] = useState(false);    // drafting the rubric
  const [gradingId, setGradingId] = useState("");       // conversation being graded
  const [gradeResults, setGradeResults] = useState({}); // conversation_id → grade
  const [coachEnabled, setCoachEnabled] = useState(false);
  // Whether the person ON the call sees the scorecard. True for roleplay
  // training (the panel is the product); false for any assessment, where the
  // criteria are the answer key.
  const [coachVisible, setCoachVisible] = useState(true);
  const [coachTitle, setCoachTitle] = useState("");
  const [coachScene, setCoachScene] = useState("");
  const [coachTalkHint, setCoachTalkHint] = useState("Keep them talking.");
  const [coachCriteriaText, setCoachCriteriaText] = useState("");
  const [coachVibe, setCoachVibe] = useState("");
  const [coachBusy, setCoachBusy] = useState(false);

  // Launch
  const [busy, setBusy] = useState(false);
  const [log, setLog] = useState([]);
  const [toast, setToast] = useState(null); // latest log line, shown on every step
  const toastTimer = useRef(null);
  const [conversation, setConversation] = useState(null);
  const [siteMode, setSiteMode] = useState(false);
  const [copied, setCopied] = useState("");
  const [shareUrl, setShareUrl] = useState("");
  const [sharing, setSharing] = useState(false);

  // "Start from an idea" — Claude drafts the entire template
  const [ideaText, setIdeaText] = useState("");
  const [demoIntent, setDemoIntent] = useState(""); // legacy scenarios only — no longer asked
  const [demoReplacing, setDemoReplacing] = useState(""); // the conversation this demo replaces
  const [demoHandoff, setDemoHandoff] = useState(""); // when a human must take over — seeds guardrails + escalation
  // Rehearsal refinement loop — ephemeral (not saved with scenarios).
  const [rehearsal, setRehearsal] = useState({ busy: false, turns: null, note: "", err: "" });
  const [demoFeatures, setDemoFeatures] = useState(defaultDemoFeatures); // feature checklist → toggles
  const [draftReport, setDraftReport] = useState(null); // what the last draft set up, shown on the start step
  const [ideating, setIdeating] = useState(false);

  // Scenarios (named snapshots of the full builder config).
  // localStorage is the instant/offline cache; the durable copy lives
  // server-side per account (/api/scenarios) so scenarios survive cleared
  // browser storage and follow the user across devices.
  const [scenarios, setScenarios] = useState(() => store.get(SCENARIOS_KEY, {}));
  const [cloudNames, setCloudNames] = useState([]); // scenario names synced to the account
  const [cloudSync, setCloudSync] = useState("unknown"); // "unknown" | "on" | "off"
  const [scenMeta, setScenMeta] = useState(() => store.get(SCENMETA_KEY, {})); // name → {updatedAt, savedBy}
  const [scenarioName, setScenarioName] = useState("");
  // Demo library panel (replaces the old flat dropdown) + post-launch save prompt.
  const [libOpen, setLibOpen] = useState(false);
  const [libQuery, setLibQuery] = useState("");
  const [savePrompt, setSavePrompt] = useState(false);
  const [savePromptName, setSavePromptName] = useState("");
  const promptOnReturn = useRef(false); // set by a successful launch; checked when leaving the demo page
  const [savedFlash, setSavedFlash] = useState(false); // "Saved ✓" blink on the footer Save
  const [activeScenario, setActiveScenario] = useState("");
  const [rememberKey, setRememberKey] = useState(() => !!store.get(APIKEY_KEY, ""));
  const importRef = useRef(null);
  const logoFileRef = useRef(null);
  const shotFileRef = useRef(null);
  const kbFileRef = useRef(null);
  const deckFileRef = useRef(null);
  const [brandUrl, setBrandUrl] = useState("");
  const [theming, setTheming] = useState(false);
  const [showApi, setShowApi] = useState(() => store.get(SHOWAPI_KEY, true));

  // Load remembered API key once on mount.
  useEffect(() => {
    const saved = store.get(APIKEY_KEY, "");
    if (saved) setApiKey(saved);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Probe TTS availability when Studio is opened, so the step can show setup
  // guidance instead of failing mid-take.
  useEffect(() => {
    if (step !== "studio" || ttsAvail !== null) return;
    fetch("/api/tts")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => setTtsAvail(d))
      .catch(() => setTtsAvail(false));
  }, [step, ttsAvail]);

  // Pull the account's cloud-saved scenario names once signed in. A failure
  // (no Redis attached, bare vite dev) just means localStorage-only mode.
  useEffect(() => {
    if (demoSlug || !auth.checked || (auth.required && !auth.authed)) return;
    let alive = true;
    fetch("/api/scenarios")
      .then((r) => (r.ok ? r.json() : Promise.reject(new Error(String(r.status)))))
      .then((d) => {
        if (!alive) return;
        setCloudNames(Array.isArray(d.names) ? d.names : []);
        if (d.meta && typeof d.meta === "object") setScenMeta((m) => ({ ...m, ...d.meta })); // cloud timestamps win
        setCloudSync("on");
      })
      .catch(() => { if (alive) setCloudSync("off"); });
    return () => { alive = false; };
  }, [demoSlug, auth.checked, auth.required, auth.authed]);

  const toggleRememberKey = (on) => {
    setRememberKey(on);
    store.set(APIKEY_KEY, on ? apiKey : "");
  };
  useEffect(() => { if (rememberKey) store.set(APIKEY_KEY, apiKey); }, [apiKey, rememberKey]);

  const collectConfig = () => ({
    v: 1,
    faceId, palId, languages, conversationName, callbackUrl, greeting,
    personaBrief, personaDraft,
    visionEnabled, visionVibe, visualQueriesText, audioQueriesText,
    speechEnabled, pronunciationText, pronDictId, pronDictName, emotionControl, externalVoiceId, externalVoiceName,
    maxMinutes, timeWarning, inactivitySeconds, inactivityUtterance, wakePhrase, interruptButton, guardrailEcho,
    sparrowModel, sparrowPatience, sparrowInterrupt, sparrowIsolation, sparrowIdle,
    recordingEnabled, recS3Bucket, recS3Region, recS3RoleArn, recS3ExternalId, recLayout,
    toolsEnabled, toolRows, toolWebhook, toolEcho,
    internetSearchEnabled, browserUseEnabled, browserUseConfig, browsePlan,
    presentationEnabled, docIdsRaw, slidesTrigger, presentPrompt, talkTrack,
    objectivesEnabled, objectivesText, confirmationMode, guardrailsEnabled, guardrailsText,
    canvasEnabled, components, schedulingUrl, placement, canvasStyle, componentRules, canvasPlaybook, linkCatalog,
    scCards, studioLines,
    duetDesc, duetPlan, duetFaceA, duetFaceB, duetOpener, duetOpenerB, duetNarrIntro, duetNarrFeatures, duetTurns, duetDeck, duetBrowser,
    duetDeckBeat, duetBrowserBeat, duetBrowserShow, duetLook, duetCaptions, studioPalA, studioPalB,
    palLlm, knowledgeIdsRaw, personaMode, demoIntent, demoReplacing, demoHandoff, demoFeatures,
    memoryEnabled, memoryMode, memoryKey,
    annotEmotion, annotVision, annotMemory,
    site,
    expJourney,
    expEmailGate, expEmailRequired, expEmailPrompt, expNotifyWebhook,
    expRating, expBooking, expTalkAgain, expThanks,
    gradeEnabled, gradeRole, gradeRubricText, gradeSource,
    coachEnabled, coachVisible, coachTitle, coachScene, coachTalkHint, coachCriteriaText, coachVibe,
  });

  const applyConfig = (c) => {
    if (!c || typeof c !== "object") return;
    setFaceId(c.faceId ?? ""); setPalId(c.palId ?? "");
    // Scenarios saved before the multi-language switch carry one full name
    // ("spanish"), or "multilingual", which named nothing at all.
    setLanguages(Array.isArray(c.languages) && c.languages.length
      ? c.languages.filter((x) => LANGUAGES.some((l) => l.c === x)).slice(0, 42)
      : [LANG_LEGACY[String(c.language ?? "").toLowerCase()] || "en"]);
    setConversationName(c.conversationName ?? "");
    // Older scenarios without a webhook must not wipe the remembered one.
    setCallbackUrl(c.callbackUrl || store.get(WEBHOOK_KEY, ""));
    setGreeting(c.greeting ?? "");
    setPersonaBrief({ vibe: "", product: "", audience: "", goal: "", tone: "", emotions: "", mustCover: "", avoid: "", ...(c.personaBrief || {}) });
    setPersonaDraft(c.personaDraft ?? "");
    setPersonaAttached(false);
    setVisionEnabled(!!c.visionEnabled); setVisionVibe(c.visionVibe ?? "");
    setVisualQueriesText(c.visualQueriesText ?? ""); setAudioQueriesText(c.audioQueriesText ?? "");
    setSpeechEnabled(!!c.speechEnabled); setPronunciationText(c.pronunciationText ?? "");
    setPronRows(pronRowsFromText(c.pronunciationText ?? ""));
    setPronDictId(c.pronDictId ?? ""); setPronDictName(c.pronDictName ?? "");
    setEmotionControl(c.emotionControl !== false);
    setExternalVoiceId(c.externalVoiceId ?? ""); setExternalVoiceName(c.externalVoiceName ?? "");
    setMaxMinutes(c.maxMinutes ?? ""); setTimeWarning(c.timeWarning ?? "");
    setInactivitySeconds(c.inactivitySeconds ?? ""); setInactivityUtterance(c.inactivityUtterance ?? "");
    setWakePhrase(c.wakePhrase ?? ""); setInterruptButton(!!c.interruptButton); setGuardrailEcho(c.guardrailEcho ?? "");
    setSparrowModel(c.sparrowModel ?? "sparrow-2"); setSparrowPatience(c.sparrowPatience ?? "");
    setSparrowInterrupt(c.sparrowInterrupt ?? ""); setSparrowIsolation(c.sparrowIsolation ?? ""); setSparrowIdle(c.sparrowIdle ?? "");
    // Recording: scenarios saved before this feature (or without it) fall back
    // to this browser's remembered defaults instead of wiping them.
    const savedRec = store.get(REC_KEY, {});
    setRecordingEnabled(c.recordingEnabled ?? savedRec.enabled ?? true);
    setRecS3Bucket(c.recS3Bucket ?? savedRec.bucket ?? "");
    setRecS3Region(c.recS3Region ?? savedRec.region ?? "");
    setRecS3RoleArn(c.recS3RoleArn ?? savedRec.roleArn ?? "");
    setRecS3ExternalId(c.recS3ExternalId ?? savedRec.externalId ?? "");
    setRecLayout(c.recLayout ?? savedRec.layout ?? "everyone");
    setToolsEnabled(!!c.toolsEnabled);
    setInternetSearchEnabled(!!c.internetSearchEnabled);
    setBrowserUseEnabled(!!c.browserUseEnabled); setBrowserUseConfig(c.browserUseConfig ?? "");
    setBrowsePlan(c.browsePlan ?? "");
    setToolRows(Array.isArray(c.toolRows) && c.toolRows.length ? c.toolRows : [{ name: "", desc: "", fields: "" }]);
    setToolWebhook(c.toolWebhook ?? ""); setToolEcho(c.toolEcho ?? "");
    setPresentationEnabled(!!c.presentationEnabled); setDocIdsRaw(c.docIdsRaw ?? "");
    setSlidesTrigger(c.slidesTrigger ?? "walk_the_deck"); setPresentPrompt(c.presentPrompt ?? "");
    setTalkTrack(Array.isArray(c.talkTrack) ? c.talkTrack : []);
    setObjectivesEnabled(!!c.objectivesEnabled); setObjectivesText(c.objectivesText ?? "");
    setConfirmationMode(c.confirmationMode ?? "auto");
    setGuardrailsEnabled(!!c.guardrailsEnabled); setGuardrailsText(c.guardrailsText ?? "");
    setCanvasEnabled(!!c.canvasEnabled);
    setComponents({ ...Object.fromEntries(CANVAS_COMPONENTS.map((x) => [x.key, true])), ...(c.components || {}) });
    setSchedulingUrl(c.schedulingUrl ?? ""); setPlacement(c.placement ?? "auto");
    setCanvasStyle(c.canvasStyle ?? "balanced");
    setComponentRules({ ...Object.fromEntries(CANVAS_COMPONENTS.map((x) => [x.key, ""])), ...(c.componentRules || {}) });
    setCanvasPlaybook(c.canvasPlaybook ?? "");
    setLinkCatalog(Array.isArray(c.linkCatalog) ? c.linkCatalog : []);
    setPalLlm(c.palLlm ?? "tavus-gemma-4"); // scenarios that chose a model keep it; new/legacy default to Gemma
    setPersonaMode(c.personaMode === "paste" ? "paste" : "brief");
    setDemoIntent(c.demoIntent ?? "");
    setDemoReplacing(c.demoReplacing ?? ""); setDemoHandoff(c.demoHandoff ?? "");
    setMemoryEnabled(!!c.memoryEnabled); setMemoryMode(c.memoryMode === "demo" ? "demo" : "visitor"); setMemoryKey(c.memoryKey ?? "");
    setAnnotEmotion(!!c.annotEmotion); setAnnotVision(!!c.annotVision); setAnnotMemory(!!c.annotMemory);
    setDemoFeatures({ ...defaultDemoFeatures(), ...(c.demoFeatures || {}) });
    setKnowledgeIdsRaw(c.knowledgeIdsRaw ?? "");
    {
      // Legacy scenarios may carry format "designed" + a design spec — the
      // design studio is gone (replaced by screenshot facade); fall back to
      // desktop and drop the spec.
      const s2 = { brand: "", logoUrl: "", headline: "", tagline: "", cta: "Start the conversation", format: "desktop", theme: null, shot: "", nav: null, heroImage: "", ...(c.site || {}) };
      if (s2.format === "designed") s2.format = "desktop";
      delete s2.design; delete s2.designVibe;
      setSite(s2);
    }
    setScCards(Array.isArray(c.scCards) ? c.scCards : []);
    setStudioLines(Array.isArray(c.studioLines) && c.studioLines.length ? c.studioLines : [{ text: "" }]);
    setDuetDesc(c.duetDesc ?? "");
    setDuetPlan(c.duetPlan && typeof c.duetPlan === "object" ? c.duetPlan : null);
    setDuetFaceA(c.duetFaceA ?? ""); setDuetFaceB(c.duetFaceB ?? "");
    setDuetOpener(c.duetOpener ?? ""); setDuetOpenerB(c.duetOpenerB ?? "");
    setDuetNarrIntro(c.duetNarrIntro ?? ""); setDuetNarrFeatures(c.duetNarrFeatures ?? "");
    setDuetTurns(c.duetTurns ?? "6");
    setDuetDeck(!!c.duetDeck); setDuetBrowser(!!c.duetBrowser);
    setDuetDeckBeat(String(c.duetDeckBeat ?? "0")); setDuetBrowserBeat(String(c.duetBrowserBeat ?? "0"));
    setDuetBrowserShow(c.duetBrowserShow ?? "");
    setDuetLook(c.duetLook === "stage" ? "stage" : "meeting");
    setDuetCaptions(c.duetCaptions !== false); // CC default on; only explicit false turns it off
    setStudioPalA(c.studioPalA ?? ""); setStudioPalB(c.studioPalB ?? "");
    setExpJourney(Array.isArray(c.expJourney) ? c.expJourney : []);
    // Email capture is table stakes — scenarios saved before the field
    // existed default ON; only an explicit false keeps it off.
    setExpEmailGate(c.expEmailGate === undefined ? true : !!c.expEmailGate);
    setExpEmailRequired(c.expEmailRequired !== false);
    setExpEmailPrompt(c.expEmailPrompt ?? "");
    setExpNotifyWebhook(c.expNotifyWebhook ?? "");
    setExpRating(!!c.expRating);
    setExpBooking(!!c.expBooking);
    setExpTalkAgain(!!c.expTalkAgain);
    setExpThanks(c.expThanks ?? "");
    setGradeEnabled(!!c.gradeEnabled);
    setGradeRole(c.gradeRole ?? ""); setGradeRubricText(c.gradeRubricText ?? "");
    setGradeSource(c.gradeSource ?? "");
    setCoachEnabled(!!c.coachEnabled);
    setCoachVisible(c.coachVisible !== false); // older scenarios showed it
    setCoachTitle(c.coachTitle ?? ""); setCoachScene(c.coachScene ?? "");
    setCoachTalkHint(c.coachTalkHint ?? "Keep them talking.");
    setCoachCriteriaText(c.coachCriteriaText ?? ""); setCoachVibe(c.coachVibe ?? "");
  };

  /* Push one scenario to the account's cloud store. Throws on failure so
     callers can report "saved locally only" instead of pretending. */
  const syncScenarioToCloud = async (name, config) => {
    const r = await fetch("/api/scenarios", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ name, config }),
    });
    const d = await r.json().catch(() => ({}));
    if (!r.ok) throw new Error(d.error || `sync failed (${r.status})`);
    setCloudSync("on");
    setCloudNames((ns) => (ns.includes(name) ? ns : [...ns, name].sort()));
  };

  const saveScenario = async (nameArg) => {
    // Falls back to a sensible name so the footer Save works on any step
    // without first typing a name in the top bar. nameArg is a string when
    // called from the library panel / save prompt (onClick passes an event).
    const override = typeof nameArg === "string" ? nameArg : "";
    const name = (override || scenarioName || activeScenario || site.brand || conversationName || "My demo").trim();
    if (!name) return;
    const config = collectConfig();
    const next = { ...scenarios, [name]: config };
    setScenarios(next);
    const localOk = store.set(SCENARIOS_KEY, next);
    const metaNext = { ...scenMeta, [name]: { ...(scenMeta[name] || {}), updatedAt: new Date().toISOString() } };
    setScenMeta(metaNext);
    store.set(SCENMETA_KEY, metaNext);
    setActiveScenario(name);
    setScenarioName("");
    setSavePrompt(false);
    setSavedFlash(true);
    setTimeout(() => setSavedFlash(false), 1600);
    if (cloudSync !== "off") {
      try {
        await syncScenarioToCloud(name, config);
        addLog("ok", `Scenario "${name}" saved & synced to your account ☁.`);
        return;
      } catch (e) {
        if (cloudSync === "unknown") setCloudSync("off");
        addLog(localOk ? "info" : "err", `Scenario "${name}" saved in this browser only — cloud sync unavailable (${e.message}).`);
        return;
      }
    }
    addLog(localOk ? "ok" : "info", localOk ? `Scenario "${name}" saved in this browser.` : `Scenario "${name}" saved for this session only — storage is blocked in this environment. Use Export for a file.`);
  };

  /* One-click blank slate. The autosave draft restores the previous demo on
     every visit, so "New Demo" used to show the old demo's ghost until a
     draft ran — this makes starting clean an explicit, safe action. */
  const startFresh = async (saveFirst = true) => {
    const hadWork = isConfigDirty() && !!(personaDraft.trim() || objectivesText.trim() || site.brand || conversationName || activeScenario);
    if (saveFirst && hadWork) await saveScenario();
    applyConfig({ faceId, studioPalA, studioPalB });
    setActiveScenario("");
    setIdeaText(""); setBrandUrl(""); setDemoReplacing(""); setDemoHandoff("");
    setDraftReport(null);
    setRehearsal({ busy: false, turns: null, note: "", err: "" });
    setStep("start");
    addLog("ok", saveFirst && hadWork ? "Previous demo saved to the library — you're on a fresh slate." : "Fresh slate.");
  };

  const loadScenario = async (name) => {
    if (!name) { setActiveScenario(""); return; }
    const local = scenarios[name] || null;
    // Local copy applies instantly (and covers offline); the cloud copy is
    // the durable source of truth, so it wins when the two differ.
    if (local) {
      applyConfig(local);
      setActiveScenario(name);
    }
    if (cloudSync === "on" && cloudNames.includes(name)) {
      try {
        const r = await fetch(`/api/scenarios?name=${encodeURIComponent(name)}`);
        if (!r.ok) throw new Error(String(r.status));
        const d = await r.json();
        if (d?.config) {
          if (JSON.stringify(d.config) !== JSON.stringify(local)) applyConfig(d.config);
          setActiveScenario(name);
          const next = { ...scenarios, [name]: d.config };
          setScenarios(next);
          store.set(SCENARIOS_KEY, next);
          addLog("info", `Scenario "${name}" loaded from your account ☁.`);
          return;
        }
      } catch {
        if (local) { addLog("info", `Scenario "${name}" loaded from this browser (cloud copy unreachable).`); return; }
        addLog("err", `Couldn't load "${name}" — the cloud copy is unreachable and there's no local copy in this browser.`);
        setActiveScenario("");
        return;
      }
    }
    if (local) { addLog("info", `Scenario "${name}" loaded.`); return; }
    setActiveScenario("");
  };

  const deleteScenario = (nameArg) => {
    const name = typeof nameArg === "string" && nameArg ? nameArg : activeScenario;
    if (!name) return;
    const next = { ...scenarios };
    delete next[name];
    setScenarios(next);
    store.set(SCENARIOS_KEY, next);
    const metaNext = { ...scenMeta };
    delete metaNext[name];
    setScenMeta(metaNext);
    store.set(SCENMETA_KEY, metaNext);
    if (cloudSync === "on" && cloudNames.includes(name)) {
      fetch(`/api/scenarios?name=${encodeURIComponent(name)}`, { method: "DELETE" })
        .then((r) => { if (!r.ok) throw new Error(); setCloudNames((ns) => ns.filter((n) => n !== name)); })
        .catch(() => addLog("err", `"${name}" was removed from this browser but its cloud copy may remain — load it and delete again to retry.`));
    }
    addLog("info", `Demo "${name}" deleted.`);
    if (name === activeScenario) setActiveScenario("");
  };

  /* Unsaved-work detection: the current config differs from the loaded
     demo's saved copy (or nothing is loaded at all). Drives the post-launch
     save prompt. */
  const isConfigDirty = () => {
    const saved = activeScenario ? scenarios[activeScenario] : null;
    if (!saved) return true;
    try { return JSON.stringify(saved) !== JSON.stringify(collectConfig()); } catch { return true; }
  };
  const promptSaveIfDirty = () => {
    if (!isConfigDirty()) return;
    setSavePromptName(activeScenario || conversationName || site.brand || "");
    setSavePrompt(true);
  };

  /* Library metadata (status + purpose line) — lives in the meta hash, never
     in the config, so editing it doesn't touch the demo itself. Synced to the
     account like scenario meta (the GET already merges it back down). */
  const updateScenarioMeta = (name, patch) => {
    const metaNext = { ...scenMeta, [name]: { ...(scenMeta[name] || {}), ...patch } };
    setScenMeta(metaNext);
    store.set(SCENMETA_KEY, metaNext);
    if (cloudSync !== "off") {
      fetch("/api/scenarios", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ name, meta: patch }),
      }).catch(() => { /* offline — local meta still applies */ });
    }
  };

  /* A PAL ID must never be orphaned from the demo it belongs to — creating
     or changing the PAL re-saves the active demo (debounced), so loading it
     later always brings the PAL back. (The old failure: create the PAL after
     saving, never re-save, load the demo → prompt present, PAL gone → a
     duplicate PAL gets created.) */
  useEffect(() => {
    if (!draftReady.current || !activeScenario || !palId.trim()) return undefined;
    const t = setTimeout(() => { if (isConfigDirty()) saveScenario(activeScenario); }, 1500);
    return () => clearTimeout(t);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [palId]);

  /* ── Never lose work again ──
     1. Rolling autosave: every change writes a draft (debounced) that is
        restored on the next load — browser Back, refresh, closed tab, crash:
        the builder reopens exactly where it was.
     2. Browser Back on the demo page closes the demo instead of navigating
        away (the demo is an overlay in this same SPA — leaving the page was
        what nuked the state). */
  const draftReady = useRef(false);
  const lastDraftJsonRef = useRef("");
  useEffect(() => {
    // Restore the NEWEST draft across this browser and the account's cloud
    // copy — so two computers on the same account always resume from
    // wherever work happened last. ISO timestamps compare lexicographically.
    (async () => {
      let best = null;
      try {
        const local = store.get(DRAFT_KEY, null);
        if (local?.config && typeof local.config === "object") best = { ...local, from: "this browser's autosave" };
      } catch { /* corrupt local draft — ignore */ }
      try {
        const r = await fetch("/api/scenarios?draft=1");
        if (r.ok) {
          const cloud = await r.json().catch(() => null);
          if (cloud?.config && typeof cloud.config === "object" && (!best || String(cloud.at || "") > String(best.at || ""))) {
            best = { ...cloud, from: "your account ☁ — the newest across your computers" };
          }
        }
      } catch { /* offline / no Redis — the local draft still applies */ }
      if (best) {
        applyConfig(best.config);
        if (best.active) setActiveScenario(best.active);
        lastDraftJsonRef.current = JSON.stringify(best.config);
        addLog("info", `Restored your work in progress from ${best.from}.`);
      }
      draftReady.current = true;
    })();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  useEffect(() => {
    if (!draftReady.current) return undefined; // don't overwrite the draft before it's restored
    const t = setTimeout(() => {
      const config = collectConfig();
      const json = JSON.stringify(config);
      if (json === lastDraftJsonRef.current) return; // nothing actually changed
      lastDraftJsonRef.current = json;
      const draft = { at: new Date().toISOString(), active: activeScenario, config };
      store.set(DRAFT_KEY, draft);
      // Cloud copy makes the draft follow the account across computers. The
      // cloud draft slot caps at 400KB — a site screenshot can blow that, so
      // the shot stays local/scenario-only when the payload runs heavy.
      if (cloudSync !== "off") {
        let cloudDraft = draft;
        if (json.length > 380_000 && config.site?.shot) {
          cloudDraft = { ...draft, config: { ...config, site: { ...config.site, shot: "" } } };
        }
        fetch("/api/scenarios", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ draft: cloudDraft }),
        }).catch(() => { /* offline — the local draft still protects this machine */ });
      }
    }, 1200);
    return () => clearTimeout(t);
  });
  useEffect(() => {
    if (!siteMode) return undefined;
    window.history.pushState({ tavusDemo: true }, "");
    const onPop = () => {
      setSiteMode(false);
      if (promptOnReturn.current) { promptOnReturn.current = false; promptSaveIfDirty(); }
    };
    window.addEventListener("popstate", onPop);
    return () => window.removeEventListener("popstate", onPop);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [siteMode]);

  const exportScenario = () => {
    const name = activeScenario || scenarioName.trim() || "scenario";
    const blob = new Blob([JSON.stringify({ name, config: collectConfig() }, null, 2)], { type: "application/json" });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = `tavus-scenario-${name.replace(/[^a-z0-9-_]+/gi, "-")}.json`;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  // Imported files and starter demos both become the operator's own saved
  // scenario — durable, cloud-synced, editable — not a read-only template.
  const adoptScenario = (name, rawConfig, how) => {
    const config = withThisOrigin(rawConfig);
    applyConfig(config);
    const next = { ...scenarios, [name]: config };
    setScenarios(next);
    store.set(SCENARIOS_KEY, next);
    setActiveScenario(name);
    addLog("ok", `Scenario "${name}" ${how} and loaded.`);
    if (cloudSync !== "off") {
      syncScenarioToCloud(name, config)
        .then(() => addLog("ok", `Scenario "${name}" synced to your account ☁.`))
        .catch(() => {});
    }
  };

  const importScenario = (file) => {
    const reader = new FileReader();
    reader.onload = () => {
      try {
        const parsed = JSON.parse(reader.result);
        adoptScenario((parsed.name || file.name.replace(/\.json$/i, "")).trim(), parsed.config || parsed, "imported");
      } catch {
        addLog("err", "Import failed — that file isn't a valid scenario JSON.");
      }
    };
    reader.readAsText(file);
  };

  const docIds = useMemo(
    () => docIdsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    [docIdsRaw]
  );
  const knowledgeIds = useMemo(
    () => knowledgeIdsRaw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean),
    [knowledgeIdsRaw]
  );
  // Toggle an id inside a whitespace/comma-separated raw string (order-preserving).
  const toggleIdIn = (raw, id) => {
    const ids = raw.split(/[\s,]+/).map((s) => s.trim()).filter(Boolean);
    return (ids.includes(id) ? ids.filter((x) => x !== id) : [...ids, id]).join("\n");
  };

  /* ── Payloads ── */

  const presentationPayload = useMemo(() => {
    const config = { document_ids: docIds };
    if (slidesTrigger) config.slides_trigger = slidesTrigger;
    const promptParts = [];
    if (presentPrompt.trim()) promptParts.push(presentPrompt.trim());
    const track = talkTrack.map((t, i) => ({ t: String(t || "").trim(), n: i + 1 })).filter((x) => x.t);
    if (track.length) {
      promptParts.push(
        "Slide-by-slide talk track — follow it as you present, in your own natural voice:\n" +
        track.map(({ t, n }) => `Slide ${n}: ${t}`).join("\n")
      );
    }
    if (promptParts.length) config.prompt = promptParts.join("\n\n");
    return { config };
  }, [docIds, slidesTrigger, presentPrompt, talkTrack]);

  const canvasPayload = useMemo(() => {
    const overlay = {};
    for (const [k, on] of Object.entries(components)) {
      if (!on) overlay[k] = { enabled: false };
    }
    if (components.scheduling_embed && schedulingUrl.trim()) {
      overlay.scheduling_embed = { provider: "calendly", scheduling_url: schedulingUrl.trim() };
    }
    return { config: Object.keys(overlay).length ? { components: overlay } : {} };
  }, [components, schedulingUrl]);

  const conversationPayload = useMemo(() => {
    const body = { face_id: faceId.trim(), pal_id: palId.trim() };
    if (conversationName.trim()) body.conversation_name = conversationName.trim();
    if (callbackUrl.trim()) body.callback_url = callbackUrl.trim();
    if (greeting.trim()) body.custom_greeting = greeting.trim();

    // When recording is on, route callbacks through our hook so the Calls &
    // Data step can show where each recording landed. A user-configured
    // webhook still gets every event — the hook forwards via ?fwd=.
    const recordingActive = recordingEnabled && !!(recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim());
    if (recordingActive && typeof window !== "undefined") {
      const hook = `${window.location.origin}/api/recording-hook`;
      body.callback_url = callbackUrl.trim() ? `${hook}?fwd=${encodeURIComponent(callbackUrl.trim())}` : hook;
    }

    const parts = [];

    // The scripted greeting plays automatically — without this line the model
    // doesn't know what it "said" first and re-introduces itself (the classic
    // greeting-vs-prompt mismatch).
    if (greeting.trim()) {
      parts.push(`Your first spoken line is already scripted and plays automatically at the start of the call: "${greeting.trim()}" — never introduce yourself a second time. If that line already asked a question, treat it as asked: don't repeat it, work with whatever they answer.`);
    }

    if (wakePhrase.trim()) {
      parts.push(
        (greeting.trim()
          ? `Wake phrase: your scripted opening line has already played. After it, stay quiet and do not respond to speech until someone says "${wakePhrase.trim()}" (or a close variation) — then engage normally for the rest of the conversation.`
          : `Wake phrase: after greeting the user once, stay quiet and do not respond to speech until someone says "${wakePhrase.trim()}" (or a close variation) — then engage normally for the rest of the conversation.`)
      );
    }

    // The flows live on the PAL, but the model invokes them BY NAME — without
    // this line it narrates the walkthrough instead of opening the browser,
    // and stalls between steps waiting for the visitor (both seen live).
    const guidedFlows = browserUseEnabled && Array.isArray(browserCfgObj.guided_flows)
      ? browserCfgObj.guided_flows.filter((f) => String(f?.name ?? "").trim())
      : [];
    if (guidedFlows.length) {
      parts.push(
        `You can run live guided browser walkthroughs — start one by its exact name when its moment comes: ${guidedFlows.map((f) => `"${String(f.name).trim()}"${String(f?.description || "").trim() ? ` (${String(f.description).trim().slice(0, 90)})` : ""}`).join("; ")}. Once started, run it straight through step by step without waiting for the visitor between steps — pause only if they interrupt, then resume where you left off.`
      );
    }

    // Browse plan rides conversational_context (per-demo, like canvas rules).
    if (browserUseEnabled && browsePlan.trim()) {
      parts.push(
        "Browsing plan - drive the live browser to these pages at these moments (never read URLs aloud, never announce that you are opening a browser; bring the page up and talk about what is on it):\n" +
        browsePlan.trim()
      );
    }

    // The deck lives on the PAL as a skill, but nothing else tells the MODEL
    // it exists — in on_demand mode nobody ever opened it, and a net-new
    // persona drafted before the doc id was pasted has no presenting section.
    if (presentationEnabled && docIds.length) {
      parts.push(slidesTrigger === "walk_the_deck"
        // No conditional cue here. "Bring it up once their opening question is
        // handled" left the deck waiting for a question that never came — the
        // PAL said "let's get started" and then stood there.
        ? "A slide deck is attached. Open slide 1 and start presenting as your first action, on your own initiative. Talk to each slide briefly rather than reading it; if they interrupt with a question, answer it and pick up where you left off."
        : "A slide deck is attached: open it whenever the visitor asks to see slides, the deck, or a walkthrough — and offer it once, naturally, when it would clearly help.");
    }

    if (recordingEnabled && recLayout === "stage") {
      parts.push(
        "If a screen share from the visitor appears, ignore it completely and never mention it — it is a recording tap of this same call, not content to look at or discuss."
      );
    }

    if (canvasEnabled) {
      // A live deck owns the screen beside the face, so the style dial is the
      // wrong instruction to send — "use cards proactively" plus a deck walk is
      // how cards ended up standing in for slides. One line replaces it.
      const deckLive = presentationEnabled && docIds.length > 0;
      const styleText = deckLive
        // "Show a Text card with the steps" on its own asks for A card, not a
        // card about the question — a tickets question came back as a Managing
        // Forms card, because the tickets material talks about forms. Bind the
        // card to the thing asked, and make skipping it the easy option.
        ? "While the deck is up, the slides are your visual — talk to them. Between slides, a card is for one thing: the exact topic they just asked about, as steps they could follow. If the answer is broader than that, say it out loud and show nothing."
        : {
            eager: "Use Magic Canvas cards frequently and proactively — whenever a card could make information clearer or capture input, show one.",
            balanced: "",
            minimal: "Use Magic Canvas cards sparingly — only when a card is clearly more effective than speaking.",
            on_request: "Do not show Magic Canvas cards unless the user explicitly asks to see one, or a rule below says to.",
          }[canvasStyle];
      if (styleText) parts.push(styleText);

      // Card contract, imperative and tight — the default PAL model is small
      // (gemma-4) and long justificatory prose degrades into ignored rules.
      parts.push(
        "Magic Canvas cards:\n" +
        "- Format: cards render markdown; every list = one \"- item\" per line (never a run-on paragraph); title 2-5 words; ≤6 bullets; ≤8 words per bullet — say detail aloud instead.\n" +
        "- One idea per card; new topic = new card.\n" +
        "- Prefer the structured card for the job (Question for choices, Input for details, Calendar for dates) over a Text card."
      );

      const rules = CANVAS_COMPONENTS
        .filter((c) => components[c.key] && componentRules[c.key].trim())
        .map((c) => `- ${c.label} card: ${componentRules[c.key].trim()}`);
      if (rules.length) parts.push("Rules for when to show specific cards:\n" + rules.join("\n"));

      if (canvasPlaybook.trim()) parts.push("Canvas playbook:\n" + canvasPlaybook.trim());

      if (placement !== "auto")
        parts.push(`When you show Magic Canvas cards, always set layout.preferred_slot to "safe-area-${placement}" so cards appear on the ${placement} side of the video.`);
    }

    // Approved links: without ground truth the model invents URLs (or punts
    // to the homepage) — with a catalog it may only share links that exist.
    const approvedLinks = linkCatalog.filter((l) => String(l?.url || "").trim());
    if (approvedLinks.length) {
      // No fallback-push clause: "share the closest page instead" turned every
      // off-catalog ask into a link offer — the same 2-3 URLs on repeat.
      parts.push(
        "Approved links — the ONLY URLs you may share, and only when the user asks or it clearly helps. Never invent, modify, or shorten a URL; if it isn't listed, say so:\n" +
        approvedLinks.map((l) => `- ${String(l.label || "").trim() || String(l.url).trim()}: ${String(l.url).trim()}`).join("\n")
      );
      const withPhotos = approvedLinks.filter((l) => String(l.image || "").trim());
      if (withPhotos.length) {
        parts.push(
          `Photos of these items appear beside you automatically when they come up: ${withPhotos.map((l) => String(l.label || "").trim() || String(l.url).trim()).join("; ")}. Refer to them naturally when they do.`
        );
      }
    }

    // Tavus Memories: the store key must be STABLE to remember across calls.
    // Builder launches use the demo-level store; per-visitor stores (keyed by
    // the gate email) are injected server-side by demo-launch — the email
    // isn't known at build time.
    if (memoryEnabled) {
      const memSlug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60);
      const key = memSlug(memoryKey || conversationName || "demo") || "demo";
      body.memory_stores = [memoryMode === "visitor" ? `${key}_operator` : key];
      // Annotated memory: recall is invisible unless spoken — this line makes
      // the PAL show its memory working, and the recall phrasing is what the
      // on-stage 💭 chip detects.
      if (annotMemory) {
        parts.push('When your memory of this person offers something relevant, reference it out loud naturally — "last time you mentioned…" — once or twice in the call, never as a recited list.');
      }
    }

    if (parts.length) body.conversational_context = parts.join("\n\n");

    if (knowledgeIds.length) body.document_ids = knowledgeIds;

    // Ordered — Tavus opens the call in the first entry. Sending this REPLACES
    // whatever the PAL carries; the two sets are never merged.
    body.properties = { languages: languages.length ? languages : ["en"] };
    const mins = parseInt(maxMinutes, 10);
    if (mins > 0) body.properties.max_call_duration = mins * 60;

    // Recording to the customer's S3 bucket. Tavus does the upload server-side;
    // the browser only ever handles non-secret identifiers (bucket/role names).
    if (recordingEnabled && recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim()) {
      body.properties.enable_recording = true;
      body.properties.recording_storage = {
        provider: "s3",
        bucket_name: recS3Bucket.trim(),
        bucket_region: recS3Region.trim(),
        assume_role_arn: recS3RoleArn.trim(),
      };
      if (recS3ExternalId.trim()) body.properties.recording_storage.external_id = recS3ExternalId.trim();
    }
    return body;
  }, [faceId, palId, conversationName, callbackUrl, greeting, languages, canvasEnabled, placement, canvasStyle, components, componentRules, canvasPlaybook, linkCatalog, knowledgeIds, wakePhrase, maxMinutes, recordingEnabled, recS3Bucket, recS3Region, recS3RoleArn, recS3ExternalId, recLayout, browserUseEnabled, browsePlan, browserCfgObj, memoryEnabled, memoryMode, memoryKey, annotMemory, presentationEnabled, docIds, slidesTrigger]);

  const objectivesPayload = useMemo(
    () => ({ data: parseObjectives(objectivesText, confirmationMode) }),
    [objectivesText, confirmationMode]
  );
  const guardrailsParsed = useMemo(() => parseGuardrails(guardrailsText), [guardrailsText]);


  const visionPayload = useMemo(() => {
    const lines = (t) => t.split("\n").map((s) => s.trim().replace(/^[-*•]\s*/, "")).filter(Boolean);
    const value = { perception_model: "raven-1" };
    const visual = lines(visualQueriesText);
    const audio = lines(audioQueriesText);
    if (visual.length) value.visual_awareness_queries = visual;
    if (audio.length) value.audio_awareness_queries = audio;
    // On-stage annotations ride inline perception tools: Raven fires them as
    // fire-and-forget conversation.perception_tool_call app-messages (the PAL
    // keeps talking — no interruption), which the demo page renders as chips.
    if (annotEmotion) {
      value.audio_tool_prompt = "You have a tool named note_emotion. Call it whenever the user's tone of voice clearly shows an emotion — frustration, excitement, confusion, hesitation, relief — and again when the emotion shifts.";
      value.audio_tools = [{
        type: "function",
        function: {
          name: "note_emotion",
          description: "Trigger when the user's tone of voice clearly shows an emotion, and when it shifts",
          parameters: {
            type: "object",
            properties: {
              emotion: { type: "string", description: "the emotion, one or two words" },
              evidence: { type: "string", description: "very short reason, a few words" },
            },
            required: ["emotion"],
          },
        },
      }];
    }
    if (annotVision) {
      value.visual_tool_prompt = "You have a tool named note_scene. Call it when something noteworthy becomes visible: an item held up to the camera, a badge or ID, a phone or document, safety gear, a new person, or a strong facial expression.";
      value.visual_tools = [{
        type: "function",
        function: {
          name: "note_scene",
          description: "Trigger when something noteworthy is visible on camera or changes in the scene",
          parameters: {
            type: "object",
            properties: {
              seen: { type: "string", description: "what is visible, one short phrase" },
            },
            required: ["seen"],
          },
        },
      }];
    }
    return value;
  }, [visualQueriesText, audioQueriesText, annotEmotion, annotVision]);

  /* Plain-English tool rows → OpenAI function-shape tools for the PAL's LLM. */
  /* Tools are standalone objects in the registry (POST /v2/tools) attached to
     a PAL (POST /pals/{id}/tools) — NOT the deprecated inline layers.llm.tools.
     The reason that matters: inline tools can only be delivered to the browser
     and the result never re-enters the conversation. A registry tool with
     delivery.api + on_resolve:"generate_response" lets the PAL call a real
     endpoint and SPEAK the answer, which is the whole point of a tool in a
     demo. */
  const toolDefs = useMemo(() => toolRows
    .filter((r) => r.name.trim() && r.desc.trim())
    .map((r) => {
      const name = r.name.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_").replace(/^_+|_+$/g, "").slice(0, 60) || "tool";
      const fields = r.fields.split(",").map((f) => f.trim().toLowerCase().replace(/[^a-z0-9_]+/g, "_")).filter(Boolean);
      const api = r.delivery === "api" && String(r.url || "").trim().startsWith("https://");
      const def = {
        name,
        description: r.desc.trim(),
        parameters: {
          type: "object",
          properties: Object.fromEntries(fields.map((f) => [f, { type: "string" }])),
          required: fields,
        },
        origin: "llm",
        // Defaults ARE the feature: an API tool that narrates itself and then
        // ignores its own result is the useless version.
        on_call: r.onCall || (api ? "silent" : "generate_filler"),
        on_resolve: r.onResolve || (api ? "generate_response" : "fire_and_forget"),
      };
      if (def.on_call === "static_filler") def.static_filler = String(r.filler || "").trim() || "One moment.";
      if (api) {
        const auth = { type: r.authType || "none" };
        if (auth.type === "bearer" && String(r.authValue || "").trim()) auth.token = r.authValue.trim();
        if (auth.type === "api_key") { auth.name = String(r.authName || "").trim() || "x-api-key"; auth.value = String(r.authValue || "").trim(); }
        const method = r.method || "POST";
        def.delivery = {
          app_message: false,
          api: {
            url: r.url.trim(),
            method,
            timeout: Math.min(60, Math.max(1, parseInt(r.timeout, 10) || 10)),
            auth,
            // The body writes itself from the fields — every {placeholder} must
            // be a declared property, and hand-written JSON is where that breaks.
            ...(["GET", "HEAD", "DELETE"].includes(method) || !fields.length
              ? {}
              : { body_template: Object.fromEntries(fields.map((f) => [f, `{${f}}`])) }),
          },
        };
      } else {
        def.delivery = { app_message: true };
      }
      return def;
    }), [toolRows]);

  /* Editor shape → the scripted cards that ship. Incomplete cards drop out
     silently (missing content or an unusable trigger). */
  // A booking card with no URL of its own uses the demo's scheduling link —
  // the same one the Canvas scheduling card and the post-call screen use, so
  // it's entered once per demo rather than per card.
  const compiledScriptedCards = useMemo(
    () => compileScriptedCards(scCards.map((c) => (
      c.style === "link" && !String(c.href || "").trim() && schedulingUrl.trim()
        ? { ...c, href: schedulingUrl.trim() }
        : c
    ))),
    [scCards, schedulingUrl]
  );

  /* Approved-links rows with a photo become deterministic image cards: the
     moment EITHER side says the item's words, the product appears beside the
     video — no model involved, so it can't show the wrong item (or none). */
  const productCards = useMemo(() => linkCatalog
    .filter((l) => String(l?.image || "").trim())
    .map((l) => {
      const label = String(l.label || "").trim();
      const kw = String(l.keywords || "").trim() ||
        (label || decodeURIComponent(String(l.url || "")).split("/").filter(Boolean).pop() || "")
          .toLowerCase().split(/[^\p{L}\p{N}]+/u).filter((w) => w.length >= 4).slice(0, 4).join(", ");
      if (!kw) return null;
      return {
        style: "image", trigger: "keyword", title: label, body: "",
        url: String(l.image).trim(), href: String(l.url || "").trim(),
        keywords: kw, atBeat: 0, atSeconds: 0, hideAfter: 45, owner: "featured",
      };
    })
    .filter(Boolean), [linkCatalog]);

  /* Coach criteria: one per line, "behavior label | instant-tick keywords"
     (keywords optional — the live Claude judge covers the rest). */
  /* Rubric rows: "competency | what strong looks like | weight". Weight is
     optional and defaults to 1 — the format has to survive being typed by
     hand, so only the label is required. */
  const parsedRubric = useMemo(() => gradeRubricText
    .split("\n")
    .map((line) => {
      const [label, good, w] = line.split("|").map((x) => x.trim());
      const weight = Math.min(3, Math.max(1, parseInt(w, 10) || 1));
      return { label: label || "", good: good || "", weight };
    })
    .filter((r) => r.label)
    .slice(0, 12), [gradeRubricText]);

  const parsedCoachCriteria = useMemo(() => coachCriteriaText
    .split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 8)
    .map((l) => { const [label, kw = ""] = l.split("|"); return { label: label.trim(), keywords: kw.trim() }; })
    .filter((c) => c.label), [coachCriteriaText]);

  /* ── Cross-check: does this demo still hang together? ──────────────────
     Every finding is a FACT about the config, computed here — never a model's
     opinion, so it can't invent a problem. It reports and offers one fix at a
     time; it never reconciles anything on its own. A button that quietly
     rewrote the persona, objectives and cards together would change a demo in
     the one way you can't catch before you're live in front of someone. */
  const crossCheck = useMemo(() => {
    const f = [];
    const add = (level, title, why, stepId, fix) => f.push({ level, title, why, step: stepId, fix });

    if (palId.trim() && personaDraft.trim() && !personaAttached) {
      add("break", "The PAL is running an older prompt than the one you're looking at",
        "The draft on the Persona step has never been attached, so the call uses whatever was attached last.",
        "persona", { label: "Attach it now", run: () => attachPersona() });
    }
    if (visionEnabled && visualQueriesText.trim() && personaDraft.trim() && !/perception/i.test(personaDraft)) {
      add("look", "Perception checks exist, but the prompt never mentions them",
        "Raven will answer these every second and nothing will act on the answers.",
        "vision", { label: "🪡 Weave them in", run: () => injectVisionIntoPrompt() });
    }
    if (presentationEnabled && docIds.length > 0 && personaDraft.trim() && !/slide|deck|present/i.test(personaDraft)) {
      add("look", "A deck is attached, but the prompt has no presenting section",
        "The persona has no instruction about when to open the deck or how to walk it.",
        "presentation", { label: "🪡 Weave it in", run: () => injectPresentationIntoPrompt() });
    }
    // Tavus rejects this pair at the API: "Browser Use and Presentation cannot
    // be attached together; move presentation slides into Browser Use instead."
    // Launch attaches Browser Use first, so the deck is the one that 400s and
    // the fail-safe deletes it — the PAL then looks like no deck was ever set.
    if (presentationEnabled && docIds.length && browserUseEnabled &&
        (browserCfgObj.guided_flows || []).some((f) => String(f?.name || "").trim())) {
      add("break", "Browser Use and Slides can't both be on",
        "Tavus refuses the pair outright. Launch attaches Browser Use first, so the deck attach 400s and gets cleared — the PAL ends up with no slides at all. Put the deck inside Browser Use as a slide step, or turn Browser Use off.",
        "presentation");
    }
    if (presentationEnabled && !docIds.length) {
      add("break", "Slides are on with no documents chosen",
        "Launch will skip the deck entirely and clear whatever deck the PAL was carrying.", "presentation");
    }
    // The inverse of the check above it, and the one that actually bit: the
    // deck inject writes a presenting section into the persona, and nothing
    // removes it when the deck goes away. The PAL then insists on showing a
    // diagram it cannot show, and reaches for any other screen it has.
    if (personaDraft.trim() && !(presentationEnabled && docIds.length) &&
        /##\s*present|slide deck|the deck\b|bring up the .{0,24}diagram/i.test(personaDraft)) {
      add("break", "The prompt promises a deck that isn't attached",
        "The persona has presenting instructions but no deck is configured, so it can't show slides — it will talk about a diagram nobody can see, or open whatever other screen it has (a browser flow).",
        "presentation", { label: "Strip the deck talk", run: () => stripDeckFromPrompt() });
    }
    if (canvasEnabled && presentationEnabled && docIds.length > 0 && slidesTrigger === "walk_the_deck") {
      add("look", "The deck and Magic Canvas both want the screen beside the face",
        "Slides lead and cards are held for questions — the canvas style dial is overridden while a deck is attached.", "canvas");
    }
    if (objectivesEnabled && !objectivesPayload.data.length) {
      add("break", "Objectives are on but nothing parsed", "The call runs with no flow at all.", "guide");
    }
    if (guardrailsEnabled && !guardrailsParsed.length) {
      add("break", "Guardrails are on but nothing parsed", "No rules will be attached to the PAL.", "guide");
    }
    if (scCards.length > compiledScriptedCards.length) {
      add("break", `${scCards.length - compiledScriptedCards.length} scripted card${scCards.length - compiledScriptedCards.length > 1 ? "s" : ""} won't appear`,
        "Missing content or a trigger, so the card is dropped before the call and never fires.", "canvas");
    }
    // Substring matching + first-match-wins: a shared word means the later
    // card is unreachable for the whole call.
    const seen = new Map();
    for (const [i, c] of compiledScriptedCards.entries()) {
      if (c.trigger !== "keyword") continue;
      for (const k of c.keywords.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean)) {
        if (seen.has(k)) {
          add("break", `Cards ${seen.get(k) + 1} and ${i + 1} both trigger on "${k}"`,
            `Whichever fires first wins, and card ${i + 1} never appears. Give them distinct trigger words.`, "canvas");
        } else seen.set(k, i);
      }
    }
    if (coachEnabled && parsedCoachCriteria.length > 0 && coachVisible && (gradeEnabled || parsedRubric.length > 0)) {
      add("break", "The person on the call can read your scorecard",
        "Coach mode is showing its criteria beside the video, and you're grading this conversation — that's the answer key, on screen, during the assessment.",
        "experience", { label: "Hide it from them", run: () => setCoachVisible(false) });
    }
    if (coachEnabled && !parsedCoachCriteria.length) {
      add("break", "Coach mode is on with no criteria", "The scorecard panel renders empty.", "experience");
    }
    if (browserUseEnabled && !(browserCfgObj.guided_flows || []).some((x) => String(x?.name || "").trim())) {
      add("break", "Browser Use is on with no complete flow",
        "Launch will skip the attach and clear any flows the PAL carries.", "presentation");
    }
    if (memoryEnabled && memoryMode === "visitor" && !expEmailGate) {
      add("break", "Per-visitor memory needs the email gate",
        "The store is keyed to the email a visitor enters; with the gate off nobody has a key, so nobody is remembered.",
        "experience", { label: "Turn the gate on", run: () => setExpEmailGate(true) });
    }
    const wantsBooking = expBooking || components.scheduling_embed || compiledScriptedCards.some((c) => c.style === "link");
    if (wantsBooking && !schedulingUrl.trim()) {
      add("break", "Something offers booking but there's no scheduling link",
        "The booking card, the scheduling component and the post-call screen all read one URL, and it's empty.", "canvas");
    }
    if (gradeEnabled && !parsedRubric.length) {
      add("look", "The scorecard is on with no rubric", "Grading a call will refuse until there's at least one competency.", "grade");
    }
    if (!gradeEnabled && parsedRubric.length > 0) {
      add("look", "You have a rubric but the scorecard is switched off",
        "The Grade button won't appear on a call in Results.", "grade", { label: "Switch it on", run: () => setGradeEnabled(true) });
    }
    if (languages[0] && languages[0] !== "en" && greeting.trim()) {
      add("look", `The call opens in ${LANG_NAME(languages[0])} — check the greeting matches`,
        "The scripted greeting plays verbatim before anyone speaks, so it can't adapt the way the rest of the call does.", "setup");
    }
    if (recordingEnabled && !(recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim())) {
      add("look", "Recording is on but the S3 details are incomplete", "The call will run and simply not be recorded.", "controls");
    }
    return f;
  }, [palId, personaDraft, personaAttached, visionEnabled, visualQueriesText, presentationEnabled, docIds,
      canvasEnabled, slidesTrigger, objectivesEnabled, objectivesPayload, guardrailsEnabled, guardrailsParsed,
      scCards, compiledScriptedCards, coachEnabled, parsedCoachCriteria, browserUseEnabled, browserCfgObj,
      memoryEnabled, memoryMode, expEmailGate, expBooking, components, schedulingUrl, gradeEnabled, coachVisible,
      parsedRubric, languages, greeting, recordingEnabled, recS3Bucket, recS3Region, recS3RoleArn]);
  const crossBreaks = crossCheck.filter((x) => x.level === "break").length;

  const controlsConfig = useMemo(() => ({
    // Gated on the canvas toggle: "remove magic canvas" must remove the
    // cards too — magic moments and product cards are canvas features, and
    // features that are off ship nothing (rule 3).
    scriptedCards: canvasEnabled ? [...compiledScriptedCards, ...productCards].slice(0, 16) : [],
    coach: coachEnabled && parsedCoachCriteria.length ? {
      title: coachTitle.trim(),
      scene: coachScene.trim(),
      talkHint: coachTalkHint.trim(),
      criteria: parsedCoachCriteria,
      visible: coachVisible,
    } : undefined,
    maxSeconds: parseInt(maxMinutes, 10) > 0 ? parseInt(maxMinutes, 10) * 60 : 0,
    timeWarning: timeWarning.trim(),
    inactivitySeconds: parseInt(inactivitySeconds, 10) > 0 ? parseInt(inactivitySeconds, 10) : 0,
    inactivityUtterance: inactivityUtterance.trim(),
    interruptButton,
    guardrailEcho: guardrailEcho.trim(),
    toolWebhook: toolsEnabled ? toolWebhook.trim() : "",
    toolEcho: toolsEnabled ? toolEcho.trim() : "",
    // Recording doesn't start on its own — the call UI must call
    // daily.startRecording() once joined. CallExtras does that when this is set.
    recording: recordingEnabled && !!(recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim()),
    recordingLayout: recLayout,
    // On-stage annotation chips — rides share links like everything here.
    annot: (annotEmotion || annotVision || annotMemory) ? {
      emotion: annotEmotion, vision: annotVision, memory: annotMemory,
      memoryOn: annotMemory && memoryEnabled,
    } : undefined,
  }), [canvasEnabled, compiledScriptedCards, productCards, coachEnabled, coachVisible, parsedCoachCriteria, coachTitle, coachScene, coachTalkHint, maxMinutes, timeWarning, inactivitySeconds, inactivityUtterance, interruptButton, guardrailEcho, toolsEnabled, toolWebhook, toolEcho, recordingEnabled, recS3Bucket, recS3Region, recS3RoleArn, recLayout, annotEmotion, annotVision, annotMemory, memoryEnabled]);

  /* Journey editor helpers — steps the builder composes for the guided
     pre-call flow (waiver questions, persona pickers, videos, …). */
  const addJourneyStep = (type) => setExpJourney((j) => (j.length >= 8 ? j : [
    ...j,
    type === "personas"
      ? { type, prompt: "", options: [{ label: "", desc: "", context: "" }, { label: "", desc: "", context: "" }] }
      : { type },
  ]));
  const patchJourneyStep = (i, patch) => setExpJourney((j) => j.map((s, x) => (x === i ? { ...s, ...patch } : s)));
  const moveJourneyStep = (i, d) => setExpJourney((j) => {
    if (!j[i + d]) return j;
    const n = [...j];
    [n[i], n[i + d]] = [n[i + d], n[i]];
    return n;
  });
  const removeJourneyStep = (i) => setExpJourney((j) => j.filter((_, x) => x !== i));
  const patchPersonaOption = (i, oi, patch) => setExpJourney((j) => j.map((s, x) =>
    (x === i ? { ...s, options: (s.options || []).map((o, y) => (y === oi ? { ...o, ...patch } : o)) } : s)
  ));

  /* Editor shape → the compiled journey that ships (incomplete steps drop out
     silently so a half-edited step never breaks a live link). */
  const compiledJourney = useMemo(() => expJourney.map((s) => {
    const t = (v) => String(v ?? "").trim();
    if (s.type === "info") return (t(s.title) || t(s.body)) ? { type: "info", title: t(s.title), body: t(s.body) } : null;
    if (s.type === "video") return t(s.url) ? { type: "video", title: t(s.title), url: t(s.url) } : null;
    if (s.type === "question") {
      // "Label :: instructions" — the label is the visitor-facing choice; the
      // part after :: is a conversational-context override injected when that
      // option is picked (e.g. Hard :: Be a demanding interviewer…).
      const pairs = String(s.optionsText ?? "").split("\n").map((l) => l.trim()).filter(Boolean).slice(0, 6)
        .map((l) => { const ix = l.indexOf("::"); return ix >= 0 ? [l.slice(0, ix).trim(), l.slice(ix + 2).trim()] : [l, ""]; })
        .filter(([label]) => label);
      const options = pairs.map(([label]) => label);
      const optionContext = pairs.map(([, ctx]) => ctx.slice(0, 600));
      return t(s.prompt) && options.length >= 2
        ? { type: "question", prompt: t(s.prompt), options, ...(optionContext.some(Boolean) ? { optionContext } : {}) }
        : null;
    }
    if (s.type === "input") return t(s.prompt) ? { type: "input", prompt: t(s.prompt), placeholder: t(s.placeholder) } : null;
    if (s.type === "personas") {
      const options = (s.options || [])
        .map((o) => ({ label: t(o.label), desc: t(o.desc), context: t(o.context), greeting: t(o.greeting), palId: t(o.palId) }))
        .filter((o) => o.label)
        .slice(0, 4);
      return options.length >= 2 ? { type: "personas", prompt: t(s.prompt) || "Choose your experience", options } : null;
    }
    return null;
  }).filter(Boolean), [expJourney]);

  /* Experience arc config — travels to DemoSite (preview) and into the stored
     demo snapshot (shared links). notifyWebhook is stripped from the public
     demo GET server-side; only /api/experience reads it, at alert time. */
  const experienceConfig = useMemo(() => ({
    journey: compiledJourney,
    emailGate: expEmailGate,
    emailRequired: expEmailRequired,
    emailPrompt: expEmailPrompt.trim(),
    notifyWebhook: expNotifyWebhook.trim(),
    rating: expRating,
    booking: expBooking,
    schedulingUrl: schedulingUrl.trim(),
    talkAgain: expTalkAgain,
    thanks: expThanks.trim(),
    // Memories config rides the snapshot server-side (stripped from the
    // public GET); demo-launch derives the per-visitor store key from it.
    memory: memoryEnabled ? { enabled: true, mode: memoryMode, key: memoryKey.trim() } : undefined,
  }), [compiledJourney, expEmailGate, expEmailRequired, expEmailPrompt, expNotifyWebhook, expRating, expBooking, schedulingUrl, expTalkAgain, expThanks, memoryEnabled, memoryMode, memoryKey]);

  /* Conversational Flow layer (Sparrow) — only fields the operator set;
     null when everything is on Tavus defaults (then launch doesn't touch it). */
  const conversationalFlowPayload = useMemo(() => {
    const v = {};
    if (sparrowModel) v.turn_detection_model = sparrowModel;
    if (sparrowPatience) v.turn_taking_patience = sparrowPatience;
    if (sparrowInterrupt) v.replica_interruptibility = sparrowInterrupt;
    if (sparrowIsolation) v.voice_isolation = sparrowIsolation;
    if (sparrowIdle) v.idle_engagement = sparrowIdle;
    return Object.keys(v).length ? v : null;
  }, [sparrowModel, sparrowPatience, sparrowInterrupt, sparrowIsolation, sparrowIdle]);

  const pronunciationRules = useMemo(() => parsePronunciation(pronunciationText), [pronunciationText]);
  const pronunciationPayload = useMemo(
    () => ({ name: `${(site.brand || conversationName || "builder").slice(0, 240)} dictionary`, rules: pronunciationRules }),
    [site.brand, conversationName, pronunciationRules]
  );

  /* ── curl preview ── */

  const curlFor = (method, path, body) =>
    [
      `curl -X ${method} ${API_BASE}${path} \\`,
      `  -H "Content-Type: application/json" \\`,
      `  -H "x-api-key: ${apiKey ? "••••••••" : "<your-api-key>"}" \\`,
      `  -d '${JSON.stringify(body, null, 2).replace(/'/g, "\\'")}'`,
    ].join("\n");

  const preview = useMemo(() => {
    const pal = palId.trim() || "{pal_id}";
    if (step === "persona")
      return {
        title: "PATCH /pals/… (system_prompt)",
        text: curlFor("PATCH", `/pals/${pal}`, [
          { op: "add", path: "/system_prompt", value: personaDraft.trim() || "<generated persona prompt>" },
        ]),
      };
    if (step === "guide") {
      if (guardrailsEnabled && guardrailsParsed.length && !(objectivesEnabled && objectivesPayload.data.length))
        return { title: "POST /guardrails (one per rule)", text: curlFor("POST", "/guardrails", guardrailsParsed[0]) };
      return { title: "POST /objectives", text: curlFor("POST", "/objectives", objectivesPayload) };
    }
    if (step === "vision")
      return { title: "PATCH /pals/… (perception)", text: curlFor("PATCH", `/pals/${pal}`, [{ op: "add", path: "/layers/perception", value: visionPayload }]) };
    if (step === "kb")
      return { title: "POST /documents", text: curlFor("POST", "/documents", { document_url: kbUrl.trim() || "https://…/deck.pdf", ...(kbName.trim() ? { document_name: kbName.trim() } : {}), ...(kbCrawl ? { crawl: { depth: 2, max_pages: 25 } } : {}) }) };
    if (step === "speech")
      return { title: "POST /pronunciation-dictionaries", text: curlFor("POST", "/pronunciation-dictionaries", pronunciationPayload) };
    if (step === "tools")
      return { title: "POST /tools  →  POST /pals/…/tools", text: curlFor("POST", "/tools", toolDefs[0] || {}) };
    if (step === "calls")
      return {
        title: "GET /conversations/{id}?verbose=true",
        text: [
          `curl ${API_BASE}/conversations/{conversation_id}?verbose=true \\`,
          `  -H "x-api-key: ${apiKey ? "••••••••" : "<your-api-key>"}"`,
        ].join("\n"),
      };
    if (step === "presentation")
      return { title: "PUT /pals/…/skills/presentation", text: curlFor("PUT", `/pals/${pal}/skills/presentation`, presentationPayload) };
    if (step === "canvas")
      return { title: "PUT /pals/…/skills/magic_canvas", text: curlFor("PUT", `/pals/${pal}/skills/magic_canvas`, canvasPayload) };
    if (step === "experience")
      // Not a Tavus API — this one hits the builder's own backend.
      return {
        title: "POST /api/experience (builder backend)",
        text: [
          `curl -X POST ${window.location.origin}/api/experience \\`,
          `  -H "Content-Type: application/json" \\`,
          `  -d '${JSON.stringify({ kind: "attend", slug: "<demo-slug>", conversation_id: "<c…>", email: "visitor@company.com" }, null, 2)}'`,
        ].join("\n"),
      };
    return { title: "POST /conversations", text: curlFor("POST", "/conversations", conversationPayload) };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step, palId, apiKey, personaDraft, visionPayload, pronunciationPayload, presentationPayload, canvasPayload, conversationPayload, objectivesPayload, guardrailsParsed, objectivesEnabled, guardrailsEnabled, kbUrl, kbName, kbCrawl, toolDefs]);

  /* ── API ── */

  /* Log entries also flash as a global toast — the full log only renders on
     the Launch step, and errors elsewhere used to vanish into it silently. */
  const addLog = (kind, msg) => {
    setLog((l) => [...l, { kind, msg, t: new Date().toLocaleTimeString() }]);
    setToast({ kind, msg });
    clearTimeout(toastTimer.current);
    toastTimer.current = setTimeout(() => setToast(null), kind === "err" ? 15000 : 6000);
  };

  const tavusFetch = async (method, path, body) => {
    const res = await fetch(`${API_BASE}${path}`, {
      method,
      headers: { "Content-Type": "application/json", "x-api-key": apiKey },
      body: body ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    let data;
    try { data = JSON.parse(text); } catch { data = { raw: text }; }
    // 304 = "already in that state" (e.g. a PATCH that changes nothing) — success.
    if (!res.ok && res.status !== 304) throw new Error(`${res.status}: ${data.message || data.error || text || "request failed"}`);
    return data;
  };

  /* ── Persona: Claude drafts the system prompt via the backend ── */

  /* Presentation setup as Claude context. Generate AND revise send this —
     the persona can only integrate the deck when Claude knows the trigger
     mode, the operator's directions, and the talk track (was a bare boolean,
     which is why revise feedback about presenting had nothing to work with). */
  const presentationContext = () => {
    if (!presentationEnabled || docIds.length === 0) return null;
    const track = talkTrack
      .map((t, i) => ({ n: i + 1, t: String(t || "").trim() }))
      .filter((x) => x.t);
    return {
      slidesTrigger,
      prompt: presentPrompt.trim(),
      slideCount: talkTrack.length,
      talkTrack: track.map(({ n, t }) => `Slide ${n}: ${t}`).join("\n").slice(0, 3000),
    };
  };

  const generatePersona = async () => {
    setGenerating(true);
    snapshotManualEdits(); // don't lose hand-edits to a regenerate
    setPersonaDraft("");
    setPersonaAttached(false);

    // "Must avoid" doubles as guardrails — merge those lines into the
    // Guardrails step (deduped) so rules live in one place.
    const avoidLines = personaBrief.avoid.split("\n").map((s) => s.trim()).filter(Boolean);
    if (avoidLines.length) {
      const existing = new Set(
        guardrailsText.split("\n").map((s) => s.trim().toLowerCase()).filter(Boolean)
      );
      const fresh = avoidLines.filter((l) => !existing.has(l.toLowerCase()));
      if (fresh.length) {
        setGuardrailsText((t) => (t.trim() ? `${t.replace(/\s+$/, "")}\n` : "") + fresh.join("\n"));
        setGuardrailsEnabled(true);
        addLog("info", `Moved ${fresh.length} "must avoid" item${fresh.length > 1 ? "s" : ""} into Guardrails — they'll attach as real guardrails on launch.`);
      }
    }

    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          brief: personaBrief,
          context: {
            brand: site.brand,
            greeting: greeting.trim(), // the scripted first line — the prompt's opening must continue from it, not fight it
            objectives: objectivesEnabled ? objectivesText.trim() : "",
            guardrails: guardrailsEnabled ? guardrailsText.trim() : "",
            presentation: presentationContext(),
            canvas: canvasEnabled,
            canvasPlaybook: canvasEnabled ? canvasPlaybook.trim() : "",
            // The prompt should know every attached capability, not just flow:
            vision: visionEnabled ? [visualQueriesText, audioQueriesText].map((t) => t.trim()).filter(Boolean).join("\n") : "",
            knowledge: knowledgeIds.length > 0,
            tools: toolsEnabled ? toolRows.map((r) => r.name).filter((n) => n.trim()).join(", ") : "",
          },
        }),
      });
      if (!res.ok && !res.body) throw new Error(`${res.status}: generation failed`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
        setPersonaDraft(text);
      }
      if (text.startsWith("[error]") || !res.ok) {
        setPersonaDraft("");
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        // 401 → login required (session expired, or the password was set after
        // this tab loaded). Force `required` too, so the lock screen appears
        // even when the initial /api/login check predates the password.
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: generation failed`);
      }
      pushPromptVersion("Generated from brief", text);
      addLog("ok", "Persona prompt drafted — review it, then attach to the PAL.");
    } catch (e) {
      addLog("err", `Persona generation: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  /* ── Prompt version control ── */

  const promptHistoryKey = () => palId.trim() || "unassigned";
  const promptVersions = promptHistory[promptHistoryKey()] || [];

  const pushPromptVersion = (source, text = personaDraft, extra = {}) => {
    const t = String(text || "").trim();
    if (!t) return;
    setPromptHistory((h) => {
      const key = palId.trim() || "unassigned";
      const list = h[key] || [];
      const next = { ...h };
      if (list[0]?.text === t) {
        // Same text — merge flags (e.g. mark the current version as attached).
        next[key] = [{ ...list[0], ...extra }, ...list.slice(1)];
      } else {
        next[key] = [{ text: t, at: new Date().toISOString(), source, ...extra }, ...list].slice(0, 25);
      }
      store.set(PROMPT_HISTORY_KEY, next);
      return next;
    });
  };

  // Uncommitted hand-edits get their own snapshot before anything overwrites them.
  const snapshotManualEdits = () => {
    const cur = personaDraft.trim();
    if (cur && cur !== (promptVersions[0]?.text || "")) pushPromptVersion("Manual edits");
  };

  const restorePromptVersion = (v) => {
    snapshotManualEdits();
    setPersonaDraft(v.text);
    setPersonaAttached(false);
    addLog("ok", `Restored the "${v.source}" version from ${String(v.at).slice(0, 16).replace("T", " ")} — re-attach to make it live.`);
  };

  /* Revise from plain-English feedback ("less salesy", "stop looping on the
     email ask", …) — an edit, not a regenerate. Prompt AND objectives are
     revised together: objectives drive the flow mechanically, so flow feedback
     has to land there, not just in prompt prose. */
  const revisePersona = async (feedbackOverride, sourceLabel) => {
    // Callable two ways: from the feedback field (uses personaFeedback state)
    // or programmatically with an instruction string (canvas/slides inject).
    const feedback = typeof feedbackOverride === "string" ? feedbackOverride : personaFeedback;
    if (!personaDraft.trim() || !feedback.trim()) return;
    setGenerating(true);
    const previous = personaDraft;
    snapshotManualEdits(); // hand-edits survive even if the revision lands
    setPersonaAttached(false);
    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "revise",
          draft: previous,
          vibe: feedback,
          context: {
            objectives: objectivesEnabled ? objectivesText : "",
            guardrails: guardrailsEnabled ? guardrailsText : "",
            presentation: presentationContext(),
            greeting: greeting.trim(),
            brief: buildBrief(),
          },
        }),
      });
      if (!res.ok && !res.body) throw new Error(`${res.status}: revision failed`);
      const reader = res.body.getReader();
      const decoder = new TextDecoder();
      let text = "";
      for (;;) {
        const { done, value } = await reader.read();
        if (done) break;
        text += decoder.decode(value, { stream: true });
      }
      if (text.startsWith("[error]") || !res.ok) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: revision failed`);
      }
      const jsonMatch = text.match(/\{[\s\S]*\}/);
      if (!jsonMatch) throw new Error("Claude's revision came back malformed — try again.");
      const rev = JSON.parse(jsonMatch[0]);
      if (!rev.prompt || !String(rev.prompt).trim()) throw new Error("Claude's revision came back empty — try again.");

      setPersonaDraft(String(rev.prompt));
      pushPromptVersion(sourceLabel || `Revised: "${feedback.slice(0, 48)}${feedback.length > 48 ? "…" : ""}"`, String(rev.prompt));
      const changed = ["prompt"];
      if (Array.isArray(rev.objectives)) {
        // Branch entries need indentation or they compile as literal steps.
        setObjectivesText(rev.objectives.map((o) => (/^if\s/i.test(String(o).trim()) ? `  ${String(o).trim()}` : String(o).trim())).join("\n"));
        setObjectivesEnabled(true);
        changed.push("objectives");
      }
      if (Array.isArray(rev.guardrails)) {
        setGuardrailsText(rev.guardrails.join("\n"));
        setGuardrailsEnabled(true);
        changed.push("guardrails");
      }
      // A feedback like "open by asking who they are" changes the OPENING —
      // the scripted greeting must move with the prompt or they contradict.
      if (typeof rev.greeting === "string" && rev.greeting.trim()) {
        setGreeting(rev.greeting.trim());
        changed.push("greeting");
      }
      setPersonaFeedback("");
      if (rev.note) addLog("info", `Revision: ${rev.note}`);
      addLog("ok", `Revised ${changed.join(" + ")}. Re-attach the prompt now; ${changed.includes("objectives") ? "the updated objectives re-attach on your next launch." : "objectives were untouched."}`);
    } catch (e) {
      setPersonaDraft(previous); // never lose the draft to a failed revision
      addLog("err", `Persona revision: ${e.message}`);
    } finally {
      setGenerating(false);
    }
  };

  /* Slides → prompt: the presentation skill shares the deck, but the persona
     only presents WELL when the prompt owns the beat — when the deck starts,
     the pacing, resuming after questions, closing it. Same revise machinery
     as the canvas inject. */
  /* Raven answers the queries whether or not anything reads them. This weaves
     them into the persona so seeing something actually changes what it does —
     without it, perception observes into the void. */
  const injectVisionIntoPrompt = async () => {
    if (!personaDraft.trim()) {
      addLog("err", "Perception inject: draft a persona first (Persona step) — there's no prompt to weave the checks into.");
      return;
    }
    const visual = visualQueriesText.split("\n").map((l) => l.trim().replace(/^[-•]\s*/, "")).filter(Boolean);
    const audio = audioQueriesText.split("\n").map((l) => l.trim().replace(/^[-•]\s*/, "")).filter(Boolean);
    if (!visionEnabled || (!visual.length && !audio.length)) {
      addLog("err", "Perception inject: turn on Perception and generate the checks first.");
      return;
    }
    const parts = [
      "Update the persona's Perception section so what it SEES and HEARS changes what it does. For each check below, name the observation and the specific response it should trigger — a different question, a slower pace, skipping a step, an escalation. Keep them as natural conversational moves, never announcements: it must never narrate that it is observing, never say what the camera shows, and never mention a check by name.",
      `Visual checks running continuously:\n${visual.map((q) => `- ${q}`).join("\n")}`,
    ];
    if (audio.length) parts.push(`Audio/tone checks running continuously:\n${audio.map((q) => `- ${q}`).join("\n")}`);
    parts.push("If a check maps to a moment in the flow, mirror it in the objectives so the step actually waits for what it needs to see. Checks that shouldn't change the conversation at all can stay out of the prompt.");
    await revisePersona(parts.join("\n\n"), "Perception woven into prompt");
  };

  /* The mirror of the deck inject. injectPresentationIntoPrompt writes a
     presenting section into the persona, and NOTHING took it back out when the
     deck went away — so the PAL kept being told to bring up a diagram it had no
     way to show, and reached for whatever screen surface it did have. */
  const stripDeckFromPrompt = async () => {
    if (!personaDraft.trim()) {
      addLog("err", "No persona draft to edit.");
      return;
    }
    await revisePersona(
      "This demo has NO slide deck attached. Remove every instruction about presenting: delete the presenting/deck section entirely, and any line telling it to bring up, open, walk, resume or close a slide, deck or diagram. Do not replace them with anything. Leave the rest of the persona exactly as it is.",
      "Deck instructions removed",
    );
  };

  const injectPresentationIntoPrompt = async () => {
    if (!personaDraft.trim()) {
      addLog("err", "Slides inject: draft a persona first (Persona step) — there's no prompt to weave the deck into.");
      return;
    }
    if (!presentationEnabled || docIds.length === 0) {
      addLog("err", "Slides inject: turn on Slides and attach a deck first.");
      return;
    }
    const parts = [
      slidesTrigger === "walk_the_deck"
        ? "Integrate the slide deck into the persona as the backbone of the call. Add or adjust a dedicated presenting section: open with a short personal beat to build rapport, then transition into the deck and WALK IT — one slide at a time, a couple of spoken sentences per slide in the persona's own voice, and a check-in question every slide or two so it stays a conversation, not a lecture. Mirror the deck walk in the objectives so the flow actually reaches the deck and finishes it."
        : "Integrate the slide deck into the persona as an on-demand asset. Add or adjust a dedicated presenting section: the persona offers or opens slides only when the visitor asks or the moment clearly calls for one, presents the relevant slide in its own voice, then returns to open conversation. Mirror any beat this needs in the objectives.",
      "Hard rules to include: while a slide is up, speak to THAT slide only — never read it verbatim, never describe slides that aren't visible. When the visitor interrupts with a question, answer it fully, then resume exactly where the deck left off. Close the deck cleanly before moving to next steps (booking, wrap-up). Never speak stage directions — no 'let me show slide three', no narrating that it is presenting; transitions happen naturally in speech.",
    ];
    if (presentPrompt.trim()) parts.push(`Operator's presenting directions — fold these in:\n${presentPrompt.trim()}`);
    const track = talkTrack
      .map((t, i) => ({ n: i + 1, t: String(t || "").trim() }))
      .filter((x) => x.t);
    if (track.length) {
      parts.push(
        `Slide-by-slide talk track (already attached to the presentation skill — make the persona's flow consistent with it, don't copy it verbatim):\n` +
        track.map(({ n, t }) => `Slide ${n}: ${t}`).join("\n").slice(0, 3000)
      );
    }
    await revisePersona(parts.join("\n\n"), "Slides woven into prompt");
  };

  /* Canvas → prompt: cards only appear when the conversation creates their
     moment; this asks Claude to weave those moments (and show-instructions)
     into the persona itself, via the same revise machinery. */
  const injectCanvasIntoPrompt = async () => {
    if (!personaDraft.trim()) {
      addLog("err", "Canvas inject: draft a persona first (Persona step) — there's no prompt to weave the cards into.");
      return;
    }
    const cards = CANVAS_COMPONENTS
      .filter((c) => components[c.key])
      .map((c) => `- ${c.label} card${componentRules[c.key].trim() ? `: ${componentRules[c.key].trim()}` : " (no rule written — pick a sensible moment or ignore it)"}`);
    const parts = [
      "Weave the Magic Canvas cards into the persona so the conversation actually CREATES the moment each card needs, then shows it. Add or adjust a section instructing the persona, for each card below, to (a) steer the conversation toward that moment naturally and (b) show the card the instant the moment happens. If a card's moment requires a beat the conversation doesn't have yet (e.g. 'added to cart' needs an add-to-cart beat), add that beat to the flow — and mirror it in the objectives.",
      "Three hard rules to include: the persona NEVER speaks stage directions — never says 'show card', reads card instructions aloud, or narrates that it is displaying something; cards happen silently alongside natural speech. Whenever the visitor offers a specific detail worth capturing (a size, an email, a preference), that is an input-card moment — capture it with the card while acknowledging it in speech. And card content is formatted for scanning: markdown bullets one item per line (never a run-on paragraph with inline dashes), title of 2-5 words, at most 6 bullets of under 8 words each.",
      `Enabled cards:\n${cards.join("\n")}`,
    ];
    if (canvasPlaybook.trim()) parts.push(`Canvas playbook:\n${canvasPlaybook.trim()}`);
    if (schedulingUrl.trim()) parts.push("A live Calendly booking card is available — treat booking time as a real closing move.");
    await revisePersona(parts.join("\n\n"), "Canvas woven into prompt");
  };

  /* Browsing → prompt: same pattern as canvas/slides. The browse plan rides
     each conversation; this weaves the MOMENTS into the persona + objectives
     so the flow actually reaches them. */
  const injectBrowsingIntoPrompt = async () => {
    if (!personaDraft.trim()) {
      addLog("err", "Browsing inject: draft a persona first (Persona step) — there's no prompt to weave the browsing into.");
      return;
    }
    const flowsList = (Array.isArray(browserCfgObj.guided_flows) ? browserCfgObj.guided_flows : [])
      .filter((f) => String(f?.name ?? "").trim())
      .map((f) => `- "${f.name}"${f.description ? ` — ${f.description}` : ""} (${Array.isArray(f.steps) ? f.steps.length : 0} steps)`)
      .join("\n");
    const parts = [
      "The persona has the Browser Use skill: it can run PRE-AUTHORED, NAMED guided browser flows — scripted walkthroughs it narrates while a live browser streams to the participant. It cannot free-browse; it can only run these flows. Weave this into the persona: add or adjust a section instructing it to (a) steer the conversation toward each flow's moment, (b) run the right flow BY NAME at that moment and narrate what's on screen, and (c) mirror any new beats in the objectives so the flow gets reached.",
      "Hard rules to include: never read URLs aloud; never announce mechanics ('let me open a browser', 'I'm starting a flow') — the walkthrough just begins while it talks naturally; if a flow fails or stalls, continue the conversation from its own knowledge without comment.",
    ];
    if (flowsList) parts.push(`Its guided flows:\n${flowsList}`);
    if (browsePlan.trim()) parts.push(`When to run which flow:\n${browsePlan.trim()}`);
    await revisePersona(parts.join("\n\n"), "Guided flows woven into prompt");
  };

  /* ── Test drive: text-only chat against the PAL (no video, no camera).
        POST /conversations {chat:true} → /respond per turn (poll until ready).
        Runs the PAL's ATTACHED config — attach the latest prompt first. ── */

  const startTestDrive = async () => {
    if (!apiKey.trim() || !palId.trim()) { setChatError("Needs the Tavus API key and PAL ID from the Account step first."); return; }
    setChatBusy(true);
    setChatError("");
    try {
      const body = { persona_id: palId.trim(), chat: true, conversation_name: "Builder test drive" };
      if (greeting.trim()) body.custom_greeting = greeting.trim();
      const d = await tavusFetch("POST", "/conversations", body);
      setChatConvId(d.conversation_id);
      setChatLog(greeting.trim() ? [{ role: "pal", text: greeting.trim() }] : []);
      addLog("ok", `Test drive started (${d.conversation_id}) — type at your PAL below. Text turns are billed like conversation time, but there's no video.`);
    } catch (e) {
      const msg = /<html|<!doctype/i.test(e.message) ? `${e.message.slice(0, 3)}: Tavus server error — try again in a moment` : e.message;
      setChatError(`Couldn't start: ${msg}`);
      addLog("err", `Test drive: ${msg}`);
    } finally {
      setChatBusy(false);
    }
  };

  const sendTestTurn = async () => {
    const text = chatInput.trim();
    if (!text || !chatConvId || chatBusy) return;
    setChatInput("");
    setChatLog((l) => [...l, { role: "user", text }]);
    setChatBusy(true);
    try {
      // The chat pipeline can 500 transiently right after start (still warming
      // up) — retry sends with backoff instead of surfacing the first blip.
      let sent = null;
      for (let attempt = 0; ; attempt++) {
        try {
          sent = await tavusFetch("POST", `/conversations/${chatConvId}/respond`, { text, timeout_s: 30 });
          break;
        } catch (e) {
          if (attempt >= 2 || !/^5\d\d/.test(e.message)) throw e;
          setChatLog((l) => (l[l.length - 1]?.role === "sys" ? l : [...l, { role: "sys", text: "warming up, retrying…" }]));
          await new Promise((r) => setTimeout(r, 1800 * (attempt + 1)));
        }
      }
      let reply = sent?.status === "ready" ? sent.text : null;
      if (reply == null) {
        const deadline = Date.now() + 45_000;
        while (Date.now() < deadline) {
          await new Promise((r) => setTimeout(r, 800));
          try {
            const poll = await tavusFetch("GET", `/conversations/${chatConvId}/respond`);
            if (poll?.status === "ready") { reply = poll.text; break; }
          } catch { /* transient poll errors — keep polling until the deadline */ }
        }
      }
      if (reply == null) throw new Error("no reply within 45s");
      setChatLog((l) => [...l.filter((m) => m.role !== "sys"), { role: "pal", text: reply || "(empty reply)" }]);
    } catch (e) {
      // Raw HTML 500 pages help nobody — translate, and check whether the
      // conversation quietly ended (idle test conversations shut down).
      let msg = /<html|<!doctype/i.test(e.message) ? `${e.message.slice(0, 3)}: Tavus server error` : e.message;
      try {
        const c = await tavusFetch("GET", `/conversations/${chatConvId}`);
        if (c?.status === "ended") msg = "This test conversation has ended (idle test drives shut down after a few minutes). Hit End, then start a fresh one.";
      } catch { /* keep original message */ }
      setChatLog((l) => [...l, { role: "sys", text: `⚠ ${msg}` }]);
    } finally {
      setChatBusy(false);
    }
  };

  const endTestDrive = async () => {
    const id = chatConvId;
    setChatConvId("");
    setChatBusy(false);
    if (id) {
      try { await tavusFetch("POST", `/conversations/${id}/end`); addLog("info", "Test drive ended."); }
      catch { /* already ended is fine */ }
    }
  };

  /* ── Preflight: validate the full launch config without starting a call.
        Objectives → POST /objectives/validate (shape check, nothing saved);
        conversation → POST /conversations {test_mode:true} (Tavus validates
        and creates it pre-ended — no PAL joins, no cost, no concurrency). ── */

  const [preflighting, setPreflighting] = useState(false);
  const preflight = async () => {
    if (!canLaunch) { addLog("err", "API key, Face ID, and PAL ID are required — see Setup."); return; }
    setPreflighting(true);
    let ok = true;
    try {
      if (objectivesEnabled && objectivesPayload.data.length) {
        try {
          await tavusFetch("POST", "/objectives/validate", objectivesPayload);
          addLog("ok", `Preflight: goals check out (${objectivesPayload.data.length} steps, chain is valid).`);
        } catch (e) {
          ok = false;
          addLog("err", `Preflight: goals failed validation — ${e.message}`);
        }
      }
      try {
        await tavusFetch("POST", "/conversations", { ...conversationPayload, properties: { ...conversationPayload.properties }, test_mode: true });
        addLog("ok", "Preflight: Tavus accepted the full conversation config (test mode — nothing was started, no cost). Recording storage, IDs, and properties are all valid.");
      } catch (e) {
        ok = false;
        addLog("err", `Preflight: conversation config rejected — ${e.message}`);
      }
      if (ok) addLog("ok", "Preflight passed ✓ — this demo should launch cleanly.");
    } finally {
      setPreflighting(false);
    }
  };

  /* ── Vision: Claude drafts awareness queries from a plain-English vibe ── */

  const generateVision = async () => {
    const visionImages = imageBlocks(visionShots, "frames");
    if (visionImages === null) return;
    setVisionGenerating(true);
    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "vision",
          vibe: visionVibe,
          images: visionImages,
          context: {
            product: personaBrief.product,
            brand: site.brand,
            brief: buildBrief(),
            objectives: objectivesEnabled ? objectivesText : "",
            guardrails: guardrailsEnabled ? guardrailsText : "",
          },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || "generation failed");
      }
      const { visual, audio } = parseVisionDraft(text);
      if (!visual.length && !audio.length) throw new Error("Couldn't parse the draft — try rephrasing the description.");
      setVisualQueriesText(visual.join("\n"));
      setAudioQueriesText(audio.join("\n"));
      addLog("ok", `Vision drafted: ${visual.length} visual, ${audio.length} audio checks — edit freely, attach on launch.`);
    } catch (e) {
      addLog("err", `Vision generation: ${e.message}`);
    } finally {
      setVisionGenerating(false);
    }
  };

  /* ── Create a brand-new PAL (Persona step) ── */

  const createPal = async () => {
    if (!apiKey.trim()) { addLog("err", "API key is required — see Setup."); return; }
    if (!faceId.trim()) { addLog("err", "Face ID is required (Setup) — a new PAL needs a default face."); return; }
    if (!newPalName.trim()) { addLog("err", "Give the new PAL a name."); return; }
    setCreatingPal(true);
    try {
      addLog("info", `Creating PAL "${newPalName.trim()}" (${palLlm})…`);
      const body = {
        pal_name: newPalName.trim(),
        default_face_id: faceId.trim(),
        system_prompt: personaDraft.trim() ||
          `You are a friendly, knowledgeable representative${site.brand ? ` for ${site.brand}` : ""}. Speak naturally and concisely, listen more than you talk, and help the person you're speaking with understand the product. Never invent pricing or commitments.`,
        layers: { llm: { model: palLlm } },
      };
      const data = await tavusFetch("POST", "/pals", body);
      const id = data.pal_id || data.uuid || data.id;
      if (!id) throw new Error("PAL created but no pal_id in the response.");
      setPalId(id);
      setPersonaAttached(!!personaDraft.trim()); // its prompt is already the draft
      setNewPalName("");
      addLog("ok", `PAL created: ${id} — set as your PAL ID${personaDraft.trim() ? " with your persona prompt" : ""}.`);
    } catch (e) {
      addLog("err", `Create PAL: ${e.message}`);
    } finally {
      setCreatingPal(false);
    }
  };

  /* ── Knowledge Base: add by URL, list, rename, delete ── */

  const fetchKbDocs = async (silent = false) => {
    if (!apiKey.trim()) { if (!silent) addLog("err", "Enter your Tavus API key in Setup first."); return; }
    setKbLoading(true);
    try {
      const d = await tavusFetch("GET", "/documents");
      setKbDocs(d.data || d.documents || []);
    } catch (e) {
      if (!silent) addLog("err", `Knowledge Base: ${e.message}`);
    } finally {
      setKbLoading(false);
    }
  };

  // Upload self-diagnosis: probe once when the Knowledge step opens, so a
  // missing Blob store shows as a clear banner instead of a mid-upload error.
  const [blobReady, setBlobReady] = useState(null);
  useEffect(() => {
    if (step !== "kb") return; // re-probe every visit — the store may have just been attached
    fetch("/api/blob-upload")
      .then((r) => (r.ok ? r.json() : null))
      .then((d) => setBlobReady(d ? { configured: !!d.configured, mode: d.mode || "" } : { configured: false, mode: "" }))
      .catch(() => setBlobReady({ configured: false, mode: "" }));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [step]);

  const addKbDoc = async () => {
    const url = kbUrl.trim();
    if (!url) return;
    if (!/^https?:\/\//i.test(url)) { addLog("err", "That doesn't look like a URL — it needs to start with https://"); return; }
    setKbAdding(true);
    try {
      const body = { document_url: url };
      if (kbName.trim()) body.document_name = kbName.trim();
      if (kbCrawl) body.crawl = { depth: 2, max_pages: 25 };
      addLog("info", kbCrawl ? "Crawling the site into the Knowledge Base…" : "Adding to the Knowledge Base…");
      const doc = await tavusFetch("POST", "/documents", body);
      addLog("ok", `"${doc.document_name || url}" added (${doc.document_id}) — processing takes a few minutes; hit Refresh to check.`);
      setKbUrl(""); setKbName(""); setKbCrawl(false);
      fetchKbDocs(true);
    } catch (e) {
      addLog("err", `Add document: ${e.message}`);
    } finally {
      setKbAdding(false);
    }
  };

  /* Upload a local file → Vercel Blob (direct from the browser) → Tavus KB.
     From the Slides step, the new doc also joins the deck automatically. */
  /* Shared Blob upload (KB docs + walkthrough videos): preflight picks the
     right path — RW-token browser stream (50MB) vs OIDC server relay
     (~3.5MB) — and returns the public URL. The blob client hides the token
     endpoint's real errors, so ground truth comes from __diag first. */
  const blobUploadSmart = async (file) => {
    const pre = await fetch("/api/blob-upload", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ __diag: true }) });
    const pj = await pre.json().catch(() => ({}));
    if (pre.status === 401) throw new Error("Your builder session expired — sign in again, then retry the upload.");
    if (!pre.ok) throw new Error(pj.error || `token endpoint returned ${pre.status}`);
    if (pj.hasToken) {
      addLog("info", `Storage OK (store ${pj.store}) — uploading "${file.name}" (${(file.size / 1e6).toFixed(1)}MB)…`);
      const blob = await blobUpload(file.name, file, { access: "public", handleUploadUrl: "/api/blob-upload" });
      return blob.url;
    }
    if (pj.hasStoreId && file.size <= 3.5 * 1024 * 1024) {
      addLog("info", `Storage is in OIDC mode — uploading "${file.name}" (${(file.size / 1e6).toFixed(1)}MB) through the server…`);
      const b64 = await new Promise((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(String(r.result).split(",")[1] || "");
        r.onerror = () => reject(new Error("couldn't read the file"));
        r.readAsDataURL(file);
      });
      const up = await fetch("/api/blob-upload", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ __direct: true, name: file.name, contentType: file.type || "application/octet-stream", data: b64 }),
      });
      const uj = await up.json().catch(() => ({}));
      if (!up.ok) throw new Error(uj.error || `direct upload failed (${up.status})`);
      return uj.url;
    }
    if (pj.hasStoreId) {
      throw new Error(`"${file.name}" is ${(file.size / 1e6).toFixed(1)}MB — OIDC-mode storage handles up to ~3.5MB through the server. For bigger files: Vercel → Storage → your store → the tavus1 connection's settings → enable BLOB_READ_WRITE_TOKEN → redeploy. Browser uploads (up to 50MB) light up automatically.`);
    }
    throw new Error("The RUNNING deployment has no Blob credentials at all — connect the store under the tavus1 project's Storage tab (Production ticked) and redeploy.");
  };

  /* ── Feature walkthroughs: shared team library of per-step videos ── */
  const refreshWalkthroughs = async () => {
    try {
      const r = await fetch("/api/walkthroughs");
      if (r.ok) { const j = await r.json(); if (j && typeof j === "object") setWalkthroughs(j); }
    } catch { /* offline / no redis — the feature just stays invisible */ }
  };
  useEffect(() => {
    if (auth.checked && (!auth.required || auth.authed)) refreshWalkthroughs();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [auth.checked, auth.required, auth.authed]);
  useEffect(() => {
    const w = walkthroughs[wtEditStep] || {};
    setWtDraft({ url: w.url || "", narration: w.narration || "" });
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [wtEditStep, walkthroughs]);

  const saveWalkthrough = async (stepId, patch = {}) => {
    const cur = walkthroughs[stepId] || {};
    const next = { url: (patch.url ?? cur.url ?? "").trim(), narration: (patch.narration ?? cur.narration ?? "").trim() };
    setWalkthroughs((w) => ({ ...w, [stepId]: { ...next, updatedAt: new Date().toISOString() } }));
    try {
      const r = await fetch("/api/walkthroughs", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ stepId, ...next }) });
      if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || r.status); }
      addLog("ok", `Walkthrough for "${STEPS.find((s) => s.id === stepId)?.label || stepId}" saved — the ▶ is live for the whole team.`);
    } catch (e) {
      addLog("err", `Walkthrough save: ${e.message}`);
    }
  };
  const deleteWalkthrough = async (stepId) => {
    setWalkthroughs((w) => { const n = { ...w }; delete n[stepId]; return n; });
    try { await fetch(`/api/walkthroughs?stepId=${encodeURIComponent(stepId)}`, { method: "DELETE" }); } catch { /* refresh heals */ }
  };
  const uploadWalkthroughVideo = async (stepId, file) => {
    if (!file) return;
    if (!file.type.startsWith("video/")) { addLog("err", "That file isn't a video."); return; }
    setWtUploading(stepId);
    try {
      const url = await blobUploadSmart(file);
      setWtDraft((d) => ({ ...d, url }));
      await saveWalkthrough(stepId, { url, narration: wtDraft.narration });
    } catch (e) {
      addLog("err", `Video upload: ${e.message}`);
    } finally {
      setWtUploading("");
    }
  };
  const openWalkthrough = async (stepId) => {
    setWtPlaying(stepId);
    setWtNarrOn(true);
    wtAudioRef.current?.pause();
    wtAudioRef.current = null;
    const n = String(walkthroughs[stepId]?.narration || "").trim();
    if (!n) return;
    try {
      // Narration renders live through the same voice stack as the calls —
      // swapping a video never means re-editing audio into it.
      const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text: n.slice(0, 600) }) });
      if (!r.ok) return;
      const a = new Audio(URL.createObjectURL(await r.blob()));
      wtAudioRef.current = a;
      const v = wtVideoRef.current;
      if (v && !v.paused) { a.currentTime = Math.min(v.currentTime, 0); a.play().catch(() => {}); }
    } catch { /* video plays silent */ }
  };
  const closeWalkthrough = () => {
    wtAudioRef.current?.pause();
    wtAudioRef.current = null;
    setWtPlaying(null);
  };

  const uploadKbFile = async (file, { addToDeck = false } = {}) => {
    if (!file) return;
    if (!apiKey.trim()) { addLog("err", "Enter your Tavus API key in Setup first."); return; }
    if (file.size > 50 * 1024 * 1024) { addLog("err", "That file is over Tavus's 50MB document limit."); return; }
    setKbAdding(true);
    try {
      const blobUrl = await blobUploadSmart(file);
      addLog("info", "Uploaded — adding to the Knowledge Base…");
      const doc = await tavusFetch("POST", "/documents", {
        document_url: blobUrl,
        document_name: kbName.trim() || file.name.replace(/\.[^.]+$/, ""),
      });
      addLog("ok", `"${doc.document_name || file.name}" added (${doc.document_id}) — processing takes a few minutes; hit Refresh to check.`);
      if (addToDeck && doc.document_id) {
        setDocIdsRaw((raw) => (raw.trim() ? `${raw.trim()}\n${doc.document_id}` : doc.document_id));
        setPresentationEnabled(true);
        addLog("info", "Added to the deck — it can present once the document shows \"ready\".");
      }
      setKbName("");
      fetchKbDocs(true);
    } catch (e) {
      const msg = String(e.message || e);
      addLog("err", `Upload: ${/BLOB_READ_WRITE_TOKEN|No token|client token|not set up/i.test(msg) ? `File storage isn't set up — in Vercel: Storage → Create Database → Blob, attach it, redeploy. (${msg.slice(0, 160)})` : msg}`);
    } finally {
      setKbAdding(false);
    }
  };

  /* ── The Brief (portal AI spec): one block sent on every AI call so no
     generation happens blind. Compiled from existing intake state — the
     replace-a-flow arc + fine-tune drawer ARE the form; no new inputs. ── */

  const buildBrief = () => {
    const L = [];
    const add = (k, v) => { const s = String(v ?? "").trim(); if (s) L.push(`${k}: ${s.slice(0, 320)}`); };
    add("Use case", demoReplacing || personaBrief.vibe || ideaText);
    add("Audience", personaBrief.audience);
    L.push("Presenter: ai_avatar (a Tavus AI human on live video)");
    add("Goal when the conversation ends", personaBrief.goal);
    add("Tone", personaBrief.tone);
    add("Must cover", personaBrief.mustCover);
    add("Must avoid", personaBrief.avoid);
    add("Product context", personaBrief.product);
    add("Brand", site.brand);
    return L.length > 1 ? `<brief>\n${L.join("\n")}\n</brief>` : "";
  };

  /* ── Talk track: Claude drafts per-slide speaker notes. With slide images
     uploaded, the draft is VISION-GROUNDED — one image block per slide, notes
     grounded in what's actually on each one. ── */

  /* Files → downscaled JPEG data URLs for Claude's vision blocks. Shared by
     the deck's slide images and the vision step's scene frames; the indexed
     insert keeps selection order even when reads finish out of order. */
  const readShrunkImages = (files, { have, cap, setter, noun }) => {
    const room = cap - have;
    const list = [...files].filter((f) => f.type.startsWith("image/")).slice(0, Math.max(0, room));
    if (!list.length) { if (room <= 0) addLog("err", `${cap} ${noun} max per draft — clear them to start over.`); return; }
    const base = have;
    list.forEach((file, idx) => {
      const reader = new FileReader();
      reader.onload = () => {
        const img = new Image();
        img.onload = () => {
          let data = "";
          for (const [w, q] of [[1280, 0.75], [1100, 0.66], [960, 0.58]]) {
            const scale = Math.min(1, w / img.width);
            const canvas = document.createElement("canvas");
            canvas.width = Math.max(1, Math.round(img.width * scale));
            canvas.height = Math.max(1, Math.round(img.height * scale));
            canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
            data = canvas.toDataURL("image/jpeg", q);
            if (data.length <= 240_000) break;
          }
          setter((s) => { const n = [...s]; n[base + idx] = data; return n; });
        };
        img.onerror = () => addLog("err", `Couldn't read ${file.name}.`);
        img.src = reader.result;
      };
      reader.readAsDataURL(file);
    });
  };

  const onSlideFiles = (files) => readShrunkImages(files, {
    have: slideShots.filter(Boolean).length, cap: 20, setter: setSlideShots, noun: "slides",
  });
  const onVisionFiles = (files) => readShrunkImages(files, {
    have: visionShots.filter(Boolean).length, cap: 20, setter: setVisionShots, noun: "frames",
  });

  /* data-URL frames → Claude image blocks, with the one limit that's real:
     the serverless request body. Say so plainly instead of letting a 413
     come back as "generation failed". */
  const imageBlocks = (shots, label) => {
    const blocks = shots.filter(Boolean).map((d) => {
      const m = /^data:(image\/\w+);base64,(.+)$/s.exec(d);
      return m ? { media_type: m[1], data: m[2] } : null;
    }).filter(Boolean);
    const bytes = blocks.reduce((n, b) => n + b.data.length, 0);
    if (bytes > 3_600_000) {
      addLog("err", `${blocks.length} ${label} is more than the request can carry (~${(bytes / 1e6).toFixed(1)}MB). Remove a few and draft again — they're already downscaled, so the only lever is fewer.`);
      return null;
    }
    return blocks;
  };

  const draftTalkTrack = async () => {
    const shots = slideShots.filter(Boolean);
    const slideCount = shots.length || talkTrack.length || 8;
    const vibe = [
      ideaText.trim(),
      `The deck has ${slideCount} slides.`,
      talkTrack.some((t) => t?.trim()) && `Current notes to improve on:\n${talkTrack.map((t, i) => `${i + 1}: ${t || "(empty)"}`).join("\n")}`,
    ].filter(Boolean).join("\n");
    if (!shots.length && !ideaText.trim() && !personaBrief.product) {
      addLog("err", "Upload slide images, or describe the demo first (New Demo or Persona step), so Claude knows what the deck is about.");
      return;
    }
    setTalkTrackDrafting(true);
    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "talktrack",
          vibe,
          context: { brief: buildBrief() },
          images: shots.map((d) => { const m = /^data:(image\/\w+);base64,(.+)$/s.exec(d); return m ? { media_type: m[1], data: m[2] } : null; }).filter(Boolean),
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || "drafting failed");
      }
      const rows = [];
      let inFlags = false;
      for (const line of text.split("\n")) {
        const t = line.trim();
        if (/^FLAGS:?\s*$/i.test(t)) { inFlags = true; continue; }
        if (inFlags) {
          const f = t.replace(/^-\s*/, "").trim();
          if (f) addLog("err", `Review: ${f}`);
          continue;
        }
        const m = t.match(/^(?:slide\s*)?(\d+)\s*[:.)-]\s*(.+)/i);
        if (m) rows[parseInt(m[1], 10) - 1] = m[2].trim();
      }
      if (!rows.length) throw new Error("Couldn't parse the draft — try again.");
      setTalkTrack(rows.map((r) => r || ""));
      addLog("ok", shots.length
        ? `Talk track drafted from your ${shots.length} slide image${shots.length > 1 ? "s" : ""} — every note is grounded in what's on that slide.`
        : `Talk track drafted for ${rows.length} slides — align it with your actual deck (upload slide images and redraft to ground it), Claude hasn't seen the slides.`);
    } catch (e) {
      addLog("err", `Talk track: ${e.message}`);
    } finally {
      setTalkTrackDrafting(false);
    }
  };

  /* ── Voice search: Cartesia catalog by accent/vibe ── */

  const searchVoices = async () => {
    setVoiceLoading(true);
    try {
      const res = await fetch(`/api/voices?q=${encodeURIComponent(voiceQuery.trim())}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(j.error || "voice search failed");
      }
      setVoiceResults(j.voices || []);
    } catch (e) {
      addLog("err", `Voices: ${e.message}`);
    } finally {
      setVoiceLoading(false);
    }
  };

  // Tavus is strict about external voices: the TTS engine must be cartesia,
  // and a PAL that never touched its tts layer may not have one to patch
  // into — so set both fields, falling back to creating the whole layer.
  const patchPalVoice = async (pal, vid) => {
    try {
      await tavusFetch("PATCH", `/pals/${pal}`, [
        { op: "add", path: "/layers/tts/tts_engine", value: "cartesia" },
        { op: "add", path: "/layers/tts/external_voice_id", value: vid },
      ]);
    } catch (err) {
      if (/does not exist|not found|invalid path|no such/i.test(String(err?.message || ""))) {
        await tavusFetch("PATCH", `/pals/${pal}`, [
          { op: "add", path: "/layers/tts", value: { tts_engine: "cartesia", external_voice_id: vid } },
        ]);
      } else {
        throw err;
      }
    }
  };

  // Ground truth: read the PAL back and show what its TTS layer actually
  // holds — the only way to be sure the attached voice is the one in use.
  const checkPalVoice = async () => {
    if (!apiKey.trim() || !palId.trim()) {
      setVoiceOnPal({ err: "Add your API key and PAL ID on Setup first." });
      return null;
    }
    try {
      const p = await tavusFetch("GET", `/pals/${palId.trim()}`);
      const tts = p?.layers?.tts || {};
      const read = { engine: tts.tts_engine || "(replica default)", voiceId: tts.external_voice_id || "" };
      setVoiceOnPal(read);
      return read;
    } catch (e) {
      setVoiceOnPal({ err: e.message || "couldn't read the PAL" });
      return null;
    }
  };

  // Audition a voice before (or after) picking it — Cartesia renders a
  // sample line server-side; nothing touches the PAL.
  const previewVoice = async (v) => {
    const lang = String(v.language || "").slice(0, 2).toLowerCase();
    const samples = {
      es: "¡Hola! Así es como sueno. ¿Comenzamos la demostración?",
      de: "Hallo! So klinge ich. Sollen wir mit der Demo beginnen?",
      fr: "Bonjour ! Voici ma voix. On commence la démo ?",
      pt: "Olá! É assim que eu soo. Vamos começar a demonstração?",
      it: "Ciao! Questa è la mia voce. Iniziamo la demo?",
    };
    setVoicePreviewing(v.id);
    try {
      const r = await fetch("/api/tts", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          text: samples[lang] || "Hi there! This is how I sound. Shall we start the demo?",
          voice: v.id,
          language: lang,
        }),
      });
      if (!r.ok) {
        const j = await r.json().catch(() => ({}));
        throw new Error(j.error || "preview failed");
      }
      const url = URL.createObjectURL(await r.blob());
      const audio = new Audio(url);
      audio.onended = () => { URL.revokeObjectURL(url); setVoicePreviewing(""); };
      audio.onerror = () => { URL.revokeObjectURL(url); setVoicePreviewing(""); };
      await audio.play();
    } catch (e) {
      addLog("err", `Voice preview: ${e.message}`);
      setVoicePreviewing("");
    }
  };

  const applyVoiceNow = async (vid, name) => {
    if (!vid) return;
    if (!apiKey.trim() || !palId.trim()) {
      setVoiceApply({ busy: false, appliedId: "", err: "Add your API key and PAL ID on Setup first — the voice attaches to the PAL. (It will still apply automatically at launch.)" });
      return;
    }
    setVoiceApply((s) => ({ ...s, busy: true, err: "" }));
    try {
      await patchPalVoice(palId.trim(), vid);
      // Don't trust the 200 — read the PAL back and confirm the voice stuck.
      const read = await checkPalVoice();
      if (read && read.voiceId && read.voiceId !== vid) {
        throw new Error(`Tavus accepted the patch but the PAL still reports voice ${read.voiceId} — it may take a moment, hit "Check the PAL" to re-read.`);
      }
      setVoiceApply({ busy: false, appliedId: vid, err: "" });
      addLog("ok", `Voice "${name || vid}" is now on the PAL (verified — persists until you change it).`);
    } catch (e) {
      setVoiceApply({ busy: false, appliedId: "", err: e.message || "voice apply failed" });
      addLog("err", `Voice: ${e.message}`);
    }
  };

  // Link finder: crawl one real page server-side and surface its links, so
  // the approved-links catalog is built from ground truth, not memory.
  const findSiteLinks = async () => {
    const pageUrl = linkFinder.url.trim();
    if (!pageUrl) return;
    setLinkFinder((s) => ({ ...s, busy: true, err: "" }));
    try {
      const r = await fetch(`/api/site-links?url=${encodeURIComponent(pageUrl)}&q=${encodeURIComponent(linkFinder.q.trim())}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) {
        if (r.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(j.error || "couldn't read that page");
      }
      setLinkFinder((s) => ({ ...s, busy: false, results: j.links || [] }));
    } catch (e) {
      setLinkFinder((s) => ({ ...s, busy: false, err: e.message }));
    }
  };

  // Protected sites (Akamai/Cloudflare) 403 server visits — but the operator's
  // browser already has the page, and copying a chunk of it puts HTML with the
  // <a href>s AND product <img>s on the clipboard. Extract client-side.
  const onLinkPaste = (e) => {
    e.preventDefault();
    const html = e.clipboardData?.getData("text/html") || "";
    const text = e.clipboardData?.getData("text/plain") || "";
    const base = linkFinder.url.trim() || undefined;
    const abs = (href) => { try { const u = new URL(href, base); return /^https?:$/.test(u.protocol) ? u.href : ""; } catch { return ""; } };
    const results = [];
    if (html) {
      try {
        const doc = new DOMParser().parseFromString(html, "text/html");
        doc.querySelectorAll("a[href]").forEach((a) => {
          const url = abs(a.getAttribute("href"));
          if (!url) return;
          const img = a.querySelector("img");
          results.push({
            text: (a.textContent || "").replace(/\s+/g, " ").trim().slice(0, 120) || (img?.getAttribute("alt") || "").trim().slice(0, 120),
            url,
            image: img ? abs(img.currentSrc || img.getAttribute("src") || "") : "",
          });
        });
      } catch { /* fall through to plain text */ }
    }
    if (!results.length && text) {
      for (const m of text.matchAll(/https?:\/\/[^\s"'<>]+/g)) results.push({ text: "", url: m[0], image: "" });
    }
    const seen = new Set();
    let links = results.filter((l) => !seen.has(l.url) && seen.add(l.url));
    const terms = linkFinder.q.trim().toLowerCase().split(/\s+/).filter(Boolean);
    if (terms.length) links = links.filter((l) => terms.every((t) => `${l.text} ${l.url}`.toLowerCase().includes(t)));
    setLinkFinder((s) => ({
      ...s, busy: false, results: links.slice(0, 60),
      err: links.length ? "" : "No links in that paste — on the site, SELECT around the products (or Ctrl/Cmd-A), Copy, then paste here. Pasting a bare URL only works for full https:// links.",
    }));
  };

  // Pull a catalog row's title + preview photo (og:image) off its live page.
  const fetchLinkMeta = async (i) => {
    const u = String(linkCatalog[i]?.url || "").trim();
    if (!u) return;
    setLinkFinder((s) => ({ ...s, busy: true, err: "" }));
    try {
      const r = await fetch(`/api/site-links?meta=1&url=${encodeURIComponent(u)}`);
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "couldn't read that page");
      setLinkCatalog((c) => c.map((x, jx) => (jx === i ? { ...x, image: j.image || x.image || "", label: String(x.label || "").trim() || j.title || "" } : x)));
      setLinkFinder((s) => ({
        ...s, busy: false,
        err: j.image ? "" : "That page doesn't declare a preview image — right-click the product photo in your browser, Copy image address, and paste it into the photo field.",
      }));
    } catch (e) {
      setLinkFinder((s) => ({ ...s, busy: false, err: e.message }));
    }
  };

  const renameKbDoc = async (id, name) => {
    try {
      await tavusFetch("PATCH", `/documents/${id}`, { document_name: name });
      setKbDocs((docs) => docs?.map((d) => (d.document_id === id ? { ...d, document_name: name } : d)) ?? docs);
      addLog("ok", `Renamed to "${name}".`);
    } catch (e) {
      addLog("err", `Rename: ${e.message}`);
    }
  };

  const deleteKbDoc = async (id, name) => {
    if (!window.confirm(`Delete "${name || id}" from the Knowledge Base? This removes it for every PAL that uses it.`)) return;
    try {
      await tavusFetch("DELETE", `/documents/${id}`);
      setKbDocs((docs) => docs?.filter((d) => d.document_id !== id) ?? docs);
      setKnowledgeIdsRaw((raw) => raw.split(/[\s,]+/).filter((x) => x && x !== id).join("\n"));
      setDocIdsRaw((raw) => raw.split(/[\s,]+/).filter((x) => x && x !== id).join("\n"));
      addLog("ok", "Document deleted.");
    } catch (e) {
      addLog("err", `Delete: ${e.message}`);
    }
  };

  /* ── Demo dashboard: per-link stats stored by /api/demo-launch ── */

  const fetchDemoStats = async (slug = "") => {
    setDemoStatsLoading(true);
    try {
      const res = await fetch(`/api/demo-stats${slug ? `?slug=${encodeURIComponent(slug)}` : ""}`);
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(j.error || "couldn't load stats");
      }
      if (slug) {
        setDemoDetail(j);
        fetchRecordings((j.convos || []).map((c) => c.id).filter(Boolean));
      }
      else { setDemoStats(j.demos || []); setDemoDetail(null); }
    } catch (e) {
      addLog("err", `Dashboard: ${e.message}`);
    } finally {
      setDemoStatsLoading(false);
    }
  };

  /* ── Calls & data: pulled straight from Tavus (source of truth) ── */

  const fetchCalls = async () => {
    // Errors render inline — the launch log isn't visible on this step.
    if (!apiKey.trim()) { setCallsError("Needs the Tavus API key — set it on the Account step, or load a saved scenario from the top bar."); return; }
    setCallsLoading(true);
    setCallsError("");
    setCallDetail(null);
    try {
      // The list endpoint is paginated OLDEST-FIRST — walking from page 1
      // returns the account's ancient history and recent calls never appear.
      // Read the total, fetch the LAST pages, and sort newest-first (500 cap).
      const PER = 50, MAX_PAGES = 10;
      const first = await tavusFetch("GET", `/conversations?limit=${PER}&page=1`);
      const firstBatch = first.data || first.conversations || [];
      const total = first.total_count ?? first.total ?? null;
      let all = [...firstBatch];
      if (total != null && total > PER) {
        const lastPage = Math.ceil(total / PER);
        const startPage = Math.max(2, lastPage - MAX_PAGES + 1);
        const pages = [];
        for (let pg = startPage; pg <= lastPage; pg++) pages.push(pg);
        const chunks = await Promise.all(pages.map((pg) =>
          tavusFetch("GET", `/conversations?limit=${PER}&page=${pg}`).then((d) => d.data || d.conversations || []).catch(() => [])
        ));
        all = startPage > 2 ? chunks.flat() : [...firstBatch, ...chunks.flat()];
      } else if (total == null && firstBatch.length === PER) {
        // No total reported — fall back to a forward walk.
        for (let pg = 2; pg <= MAX_PAGES; pg++) {
          const d = await tavusFetch("GET", `/conversations?limit=${PER}&page=${pg}`);
          const batch = d.data || d.conversations || [];
          all.push(...batch);
          if (batch.length < PER) break;
        }
      }
      const seen = new Set();
      all = all
        .filter((c) => c.conversation_id && !seen.has(c.conversation_id) && seen.add(c.conversation_id))
        .sort((a, b) => String(b.created_at || "").localeCompare(String(a.created_at || "")))
        .slice(0, 500);
      setCallsList(all);
      if (total != null && total > all.length) addLog("info", `Results shows the ${all.length} most recent of ${total} lifetime calls.`);
      const ids = all.map((c) => c.conversation_id).filter(Boolean);
      for (let i = 0; i < ids.length; i += 100) fetchRecordings(ids.slice(i, i + 100));
    } catch (e) {
      setCallsError(`Couldn't load calls: ${e.message}`);
      addLog("err", `Calls: ${e.message}`);
    } finally {
      setCallsLoading(false);
    }
  };

  /* Recording locations captured by /api/recording-hook — best-effort. */
  const fetchRecordings = async (ids) => {
    if (!ids.length) return;
    try {
      const res = await fetch(`/api/recordings?ids=${ids.slice(0, 100).join(",")}`);
      if (!res.ok) return;
      const map = await res.json();
      if (map && typeof map === "object") setRecMap((m) => ({ ...m, ...map }));
    } catch { /* recordings panel is optional decoration */ }
    // Attendee/feedback records from /api/experience ride the same id batches.
    try {
      const res = await fetch(`/api/experience?ids=${ids.slice(0, 100).join(",")}`);
      if (!res.ok) return;
      const map = await res.json();
      if (map && typeof map === "object") setExpMap((m) => ({ ...m, ...map }));
    } catch { /* optional decoration */ }
  };

  const openCall = async (id) => {
    setCallDetailLoading(true);
    try {
      const d = await tavusFetch("GET", `/conversations/${id}?verbose=true`);
      setCallDetail(d);
      setCallsError("");
      if (!recMap[id]) fetchRecordings([id]);
    } catch (e) {
      setCallsError(`Couldn't open that call: ${e.message}`);
      addLog("err", `Call detail: ${e.message}`);
    } finally {
      setCallDetailLoading(false);
    }
  };

  const saveFile = (filename, text, type = "text/plain") => {
    const blob = new Blob([text], { type });
    const url = URL.createObjectURL(blob);
    const a = document.createElement("a");
    a.href = url;
    a.download = filename;
    a.click();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  };

  /* Each kind of call data as its own artifact — transcripts and analyses
     feed different systems than raw events, so don't force one blob. */
  const callTranscript = () =>
    (callDetail?.events || []).find((e) => /transcription/i.test(e.event_type || ""))?.properties?.transcript;
  const callPerception = () =>
    (callDetail?.events || []).filter((e) => /perception/i.test(e.event_type || ""))
      .map((e) => (typeof e.properties?.analysis === "string" ? e.properties.analysis : JSON.stringify(e.properties, null, 2)));

  const downloadCall = () => {
    if (!callDetail) return;
    saveFile(`tavus-call-${callDetail.conversation_id || "data"}.json`, JSON.stringify(callDetail, null, 2), "application/json");
  };
  const downloadTranscript = (fmt) => {
    const t = callTranscript();
    if (!Array.isArray(t) || !callDetail) return;
    const id = callDetail.conversation_id || "call";
    if (fmt === "json") { saveFile(`tavus-transcript-${id}.json`, JSON.stringify(t, null, 2), "application/json"); return; }
    const text = t.filter((m) => m.role !== "system")
      .map((m) => `${m.role === "assistant" ? (site.brand || "PAL") : "Visitor"}: ${typeof m.content === "string" ? m.content : JSON.stringify(m.content)}`)
      .join("\n\n");
    saveFile(`tavus-transcript-${id}.txt`, text);
  };
  const downloadPerception = () => {
    const p = callPerception();
    if (!p.length || !callDetail) return;
    saveFile(`tavus-perception-${callDetail.conversation_id || "call"}.txt`, p.join("\n\n---\n\n"));
  };

  /* ── Studio: record a scripted take as an MP4 feature demo ── */

  const endStudioRuntime = (message) => {
    const rt = getStudioRuntime();
    try { rt?.displayStream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
    try { rt?.ctx?.close(); } catch { /* gone */ }
    setStudioRuntime(null);
    setStudioActive(false);
    if (message) setStudioStatus(message);
  };

  const startStudioTake = async () => {
    const lines = studioLines.map((l) => String(l.text || "").trim()).filter(Boolean);
    if (!lines.length) { addLog("err", "Studio: write at least one visitor line first."); return; }
    if (!canLaunch) { addLog("err", "Studio: needs your Tavus key + Face + PAL (Account step) before recording a take."); return; }
    if (!(recordingEnabled && recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim())) {
      addLog("err", "Studio: takes are captured via S3 recording — configure it on the Timing step first.");
      return;
    }
    // Tab capture must happen inside this click (browser gesture rule) —
    // it's what puts Magic Canvas cards and slides in the file.
    setStudioStatus("Pick this tab in the share dialog — that capture IS the video.");
    let displayStream = null;
    try {
      displayStream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 15 },
        audio: false,
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
    } catch {
      setStudioStatus("Tab capture declined — a take needs it so Magic Canvas and slides are in the video.");
      return;
    }
    try {
      const ctx = new (window.AudioContext || window.webkitAudioContext)();
      await ctx.resume();
      setStudioStatus(`Rendering ${lines.length} visitor line${lines.length > 1 ? "s" : ""} with TTS…`);
      const buffers = [];
      for (const text of lines) {
        const r = await fetch("/api/tts", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ text }) });
        if (!r.ok) { const j = await r.json().catch(() => ({})); throw new Error(j.error || `TTS failed (${r.status})`); }
        buffers.push(await ctx.decodeAudioData(await r.arrayBuffer()));
      }
      const dest = ctx.createMediaStreamDestination();
      setStudioRuntime({ ctx, dest, buffers, displayStream });
      setStudioActive(true);
      setStudioStatus("Take running — the demo page drives the whole call and ends on its own. Don't switch tabs.");
      addLog("info", `Studio take: ${lines.length} scripted line${lines.length > 1 ? "s" : ""}, full-stage capture.`);
      await launch();
    } catch (e) {
      try { displayStream?.getTracks().forEach((t) => t.stop()); } catch { /* gone */ }
      endStudioRuntime(`Take failed: ${e.message}`);
      addLog("err", `Studio: ${e.message}`);
    }
  };

  /* Pre-take forecast: what will actually be on camera, computed from the
     config + the current script — so a take is never a surprise. Scripted
     cards and the deck are decidable; Magic Canvas is honestly a dice roll. */
  const takeForecast = useMemo(() => {
    const lines = studioLines.map((l) => String(l.text || "").toLowerCase());
    const rows = [];
    compiledScriptedCards.forEach((c) => {
      const icon = c.style === "chart" ? "📊" : c.style === "stat" ? "🔢" : c.style === "image" ? "🖼" : c.style === "question" ? "❓" : "📄";
      const label = `${icon} ${c.title || `${c.style} card`}`;
      if (c.trigger === "start") {
        rows.push({ k: "ok", label, detail: "appears at call start — guaranteed." });
      } else if (c.trigger === "time") {
        const m = Math.floor(c.atSeconds / 60), s = String(c.atSeconds % 60).padStart(2, "0");
        rows.push({ k: "ok", label, detail: `appears ${m}:${s} into the call — guaranteed if the take runs that long.` });
      } else {
        const kws = c.keywords.split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
        const hit = lines.findIndex((t) => kws.some((k) => t.includes(k)));
        if (hit >= 0) {
          rows.push({ k: "ok", label, detail: `fires on line ${hit + 1} (“${kws.find((k) => lines[hit].includes(k))}”) — guaranteed.` });
        } else {
          rows.push({ k: "warn", label, detail: `will probably NOT appear — no script line says ${kws.map((k) => `“${k}”`).join(" / ")}. Add one, or ✨ regenerate the script.` });
        }
      }
    });
    if (presentationEnabled && docIds.length) {
      if (slidesTrigger === "walk_the_deck") {
        rows.push({ k: "ok", label: "🖥 Presentation deck", detail: "walk-the-deck mode — it presents on its own; slides will be on camera." });
      } else {
        const hit = lines.findIndex((t) => /deck|slide|present|walk me|show me/.test(t));
        rows.push(hit >= 0
          ? { k: "ok", label: "🖥 Presentation deck", detail: `on-demand — the script asks for it on line ${hit + 1}; slides will be on camera.` }
          : { k: "warn", label: "🖥 Presentation deck", detail: "on-demand, and no script line asks for it — the deck won't appear. Add “can you walk me through the deck?” or switch to walk-the-deck (Presentation step)." });
      }
    }
    if (canvasEnabled) {
      const on = Object.values(components).filter(Boolean).length;
      rows.push({ k: "maybe", label: "🪄 Magic Canvas", detail: `${on}/7 components enabled — the AI decides in the moment, so cards are possible but never guaranteed. Anything that MUST be in the video belongs in a scripted card above.` });
    }
    if (!rows.length) rows.push({ k: "warn", label: "Nothing visual configured", detail: "This take records the AI human only — no cards or deck are set up to appear." });
    return rows;
  }, [studioLines, compiledScriptedCards, presentationEnabled, docIds, slidesTrigger, canvasEnabled, components]);

  /* Claude drafts the scripted cards themselves from a plain-English ask
     ("a pricing chart and a which-package question") + the demo's config. */
  const generateScriptedCards = async () => {
    setCardsBusy(true);
    try {
      addLog("info", "Designing scripted cards for this demo…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "cards",
          vibe: cardsPrompt,
          context: {
            product: personaBrief.product,
            brand: site.brand,
            personaSummary: personaDraft.slice(0, 1500),
            objectives: objectivesEnabled ? objectivesText.trim() : "",
            canvasPlaybook: canvasEnabled ? canvasPlaybook.trim() : "",
            presentation: presentationContext(),
          },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: generation failed`);
      }
      const jsonText = text.slice(text.indexOf("["), text.lastIndexOf("]") + 1);
      const drafted = JSON.parse(jsonText);
      if (!Array.isArray(drafted) || !drafted.length) throw new Error("Claude returned no cards — try a more specific ask.");
      setScCards(drafted.slice(0, 5).map((c) => ({
        style: ["note", "chart", "stat", "image", "question"].includes(c.style) ? c.style : "note",
        trigger: ["keyword", "time", "start"].includes(c.trigger) ? c.trigger : "keyword",
        title: String(c.title ?? "").slice(0, 200),
        body: String(c.body ?? "").slice(0, 2000),
        url: String(c.url ?? "").slice(0, 500),
        keywords: String(c.keywords ?? "").slice(0, 200),
        atMinutes: c.atMinutes ? String(c.atMinutes) : "",
        hideAfter: c.hideAfter ? String(c.hideAfter) : "",
      })));
      addLog("ok", `${Math.min(drafted.length, 5)} scripted cards drafted — review them on the Magic Canvas step (live previews there); the forecast below already reflects them.`);
    } catch (e) {
      addLog("err", `Cards: ${e.message}`);
    } finally {
      setCardsBusy(false);
    }
  };

  /* Claude writes the visitor script from the demo's own config — lines
     engineered to make scripted cards, canvas, the deck, and the objectives
     flow fire on camera during a Studio take. */
  const generateStudioScript = async () => {
    setScriptBusy(true);
    try {
      addLog("info", "Writing the visitor script from this demo's configuration…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "script",
          vibe: scriptFocus,
          context: {
            product: personaBrief.product,
            brand: site.brand,
            personaSummary: personaDraft.slice(0, 2000),
            objectives: objectivesEnabled ? objectivesText.trim() : "",
            guardrails: guardrailsEnabled ? guardrailsText.trim() : "",
            presentation: presentationContext(),
            canvasPlaybook: canvasEnabled ? canvasPlaybook.trim() : "",
            canvasRules: canvasEnabled
              ? Object.entries(componentRules).filter(([, v]) => String(v).trim()).map(([k, v]) => `${k}: ${v}`).join("\n")
              : "",
            scriptedCards: compiledScriptedCards.map((x) => ({ style: x.style, title: x.title, trigger: x.trigger, keywords: x.keywords })),
            scheduling: !!schedulingUrl.trim(),
          },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: generation failed`);
      }
      const lines = text
        .split("\n")
        .map((l) => l.replace(/^[\s"'\d.\-–—)]+/, "").replace(/["']\s*$/, "").trim())
        .filter(Boolean)
        .slice(0, 12);
      if (!lines.length) throw new Error("Claude returned an empty script — try again.");
      setStudioLines(lines.map((t) => ({ text: t })));
      addLog("ok", `Script drafted: ${lines.length} visitor lines, tuned to this demo's cards, deck, and flow. Edit freely, then 🎬 Record take.`);
    } catch (e) {
      addLog("err", `Script: ${e.message}`);
    } finally {
      setScriptBusy(false);
    }
  };

  /* Claude plans the whole duet from a description: talk track first, both
     personas embedding it, cards derived from it afterwards. */
  const planDuet = async () => {
    if (!duetDesc.trim()) { addLog("err", "Describe the conversation first — who talks to whom, about what."); return; }
    setDuetPlanBusy(true);
    try {
      addLog("info", "Planning the duet — talk track, both AI humans, then cards…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "duet",
          // If a deck / live browser will be on screen, the plan should have
          // a beat where the featured speaker actually brings it up.
          vibe: duetDesc + [
            duetDeck && docIds.length ? "\n\nThe featured speaker has a slide deck attached — include a beat where the host asks to see it and the featured speaker presents a slide or two." : "",
            duetBrowser ? "\n\nThe featured speaker can drive a live web browser on screen — the plan may include a beat where they pull up a real page." : "",
          ].join(""),
          context: { brand: site.brand },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: generation failed`);
      }
      const plan = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!plan?.featured?.prompt || !plan?.host?.prompt || !Array.isArray(plan.outline)) {
        throw new Error("The plan came back incomplete — try a more specific description.");
      }
      setDuetPlan(plan);
      setDuetOpener(String(plan.featured.opener || ""));
      setDuetOpenerB(String(plan.host?.opener || ""));
      setDuetNarrIntro(String(plan.summary || ""));
      setDuetNarrFeatures(String(plan.features || ""));
      addLog("ok", `Duet planned: “${plan.title || "untitled"}” — ${plan.outline.length} talk-track beats, ${Array.isArray(plan.cards) ? plan.cards.length : 0} cards derived from them. Pick two faces and record.`);
    } catch (e) {
      addLog("err", `Duet plan: ${e.message}`);
    } finally {
      setDuetPlanBusy(false);
    }
  };

  /* Sales handoff: mint a PERMANENT PAL from the duet's featured persona —
     same character, adapted by Claude to talk to a real human — and load it
     into the builder as the live demo (Setup gets the IDs, Persona gets the
     prompt, Goals get suggested objectives). It's a brand-new PAL, separate
     from the two reusable studio PALs, so future duet plans never touch it. */
  const promoteDuet = async () => {
    if (!duetPlan?.featured?.prompt) { addLog("err", "Handoff: plan the duet first."); return; }
    if (!apiKey.trim()) { addLog("err", "Handoff: needs your Tavus API key (Account step)."); return; }
    if (!duetFaceA.trim()) { addLog("err", "Handoff: pick the featured face first — the live PAL keeps it."); return; }
    setDuetPromoteBusy(true);
    try {
      addLog("info", "Adapting the duet persona for a real visitor (same character, no set dressing)…");
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "promote",
          plan: { prompt: duetPlan.featured.prompt, name: duetPlan.featured.name, title: duetPlan.title, outline: duetPlan.outline },
          context: { brand: site.brand, deck: !!(duetDeck && docIds.length), browser: !!duetBrowser },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain text */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || `${res.status}: generation failed`);
      }
      const out = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      if (!String(out?.prompt ?? "").trim()) throw new Error("The adapted persona came back empty — try again.");
      const name = String(out.name || duetPlan.featured.name || "Live demo PAL").slice(0, 80);
      addLog("info", `Creating the permanent PAL “${name}”…`);
      const p = await tavusFetch("POST", "/pals", {
        pal_name: name,
        default_face_id: duetFaceA.trim(),
        system_prompt: String(out.prompt),
      });
      const newId = p.pal_id || p.uuid || p.id;
      if (!newId) throw new Error("PAL creation returned no id.");
      // Load it as THE demo: Setup IDs, the attached prompt as the reviewable
      // draft, a visitor-facing greeting, suggested objectives, and the same
      // on-screen surfaces the duet showed (launch attaches those to this PAL).
      setPalId(newId);
      setFaceId(duetFaceA.trim());
      setConversationName(name);
      setPersonaDraft(String(out.prompt));
      if (out.greeting && String(out.greeting).trim()) setGreeting(String(out.greeting).trim());
      if (out.objectives && String(out.objectives).trim()) { setObjectivesText(String(out.objectives).trim()); setObjectivesEnabled(true); }
      if (duetDeck && docIds.length) setPresentationEnabled(true);
      if (duetBrowser) setBrowserUseEnabled(true);
      addLog("ok", `Sales handoff ready: “${name}” (${newId}) is a permanent PAL — duet plans never overwrite it. Its prompt is already attached; review it here, tune the goals, then launch or share the link like any demo.`);
      setStep("persona");
    } catch (e) {
      addLog("err", `Handoff: ${e.message}`);
    } finally {
      setDuetPromoteBusy(false);
    }
  };

  /* Reusable Studio PALs: PATCH the prompt on the cached PAL; create only
     when missing (or when the cached one was deleted account-side). */
  const ensureStudioPal = async (cachedId, setId, name, face, prompt) => {
    // Duet rooms have no camera or microphone — perception has nothing to see
    // or hear, so switching it off drops that pipeline work (snappier turns).
    const perceptionOff = { op: "add", path: "/layers/perception", value: { perception_model: "off" } };
    let id = String(cachedId || "").trim();
    if (id) {
      try {
        await tavusFetch("PATCH", `/pals/${id}`, [{ op: "add", path: "/system_prompt", value: prompt }, perceptionOff]);
        return id;
      } catch { id = ""; /* stale — recreate below */ }
    }
    const p = await tavusFetch("POST", "/pals", { pal_name: name, default_face_id: face, system_prompt: prompt, layers: { perception: { perception_model: "off" } } });
    id = p.pal_id || p.uuid || p.id;
    if (!id) throw new Error(`${name} creation returned no id.`);
    setId(id);
    return id;
  };

  /* Duet: PATCH/create the two Studio PALs from the plan, create both
     conversations, capture the tab (gesture!), open the duet stage. The
     FEATURED speaker (side A) opens; the host joins after the opener lands. */
  const startDuet = async () => {
    if (!apiKey.trim()) { addLog("err", "Duet: needs your Tavus API key (Account step)."); return; }
    if (!duetPlan) { addLog("err", "Duet: plan the conversation first (✨ Plan the duet)."); return; }
    if (!duetFaceA.trim() || !duetFaceB.trim()) { addLog("err", "Duet: pick a face for both AI humans."); return; }
    setStudioStatus("Pick this tab in the share dialog — the duet records locally from that capture.");
    let stream = null;
    try {
      stream = await navigator.mediaDevices.getDisplayMedia({
        video: { frameRate: 30 },
        audio: true, // tab audio = both replicas' voices
        preferCurrentTab: true,
        selfBrowserSurface: "include",
      });
      if (!stream.getAudioTracks().length) {
        addLog("err", "Duet: no tab audio in the capture — re-share and tick “Also share tab audio”, or the video will be silent.");
      }
    } catch {
      setStudioStatus("Tab capture declined — the duet needs it to record the video.");
      return;
    }
    try {
      setStudioStatus("Preparing both AI humans from the plan…");
      const palA = await ensureStudioPal(studioPalA, setStudioPalA, "Studio duet — featured", duetFaceA.trim(), String(duetPlan.featured.prompt));
      const palB = await ensureStudioPal(studioPalB, setStudioPalB, "Studio duet — host", duetFaceB.trim(), String(duetPlan.host.prompt));
      // On-screen surfaces ride the FEATURED side. Attach when on, detach
      // when off — the reusable PAL must not carry a stale deck or browser
      // into the next duet.
      if (duetDeck && docIds.length) {
        setStudioStatus("Attaching the deck to the featured AI human…");
        await tavusFetch("PUT", `/pals/${palA}/skills/presentation`, { config: { document_ids: docIds, slides_trigger: "on_demand" } });
      } else {
        try { await tavusFetch("DELETE", `/pals/${palA}/skills/presentation`); } catch { /* wasn't attached */ }
      }
      if (duetBrowser) {
        let browserCfg = {};
        if (String(browserUseConfig).trim()) {
          try { browserCfg = JSON.parse(browserUseConfig); }
          catch { throw new Error("The browser_use config isn't valid JSON — fix or clear it on the Presentation step."); }
        }
        setStudioStatus("Attaching Browser Use to the featured AI human…");
        await tavusFetch("PUT", `/pals/${palA}/skills/browser_use`, { config: browserCfg });
      } else {
        try { await tavusFetch("DELETE", `/pals/${palA}/skills/browser_use`); } catch { /* wasn't attached */ }
      }
      const outline = (duetPlan.outline || []).map((b2) => String(b2).trim()).filter(Boolean).map((b2, i) => `${i + 1}. ${b2}`).join("\n");
      const sharedCtx = `This is a recorded on-camera segment. Keep every turn short — one or two sentences, three only when a moment truly needs it. Never monologue. Follow the conversation plan in order:\n${outline}`;
      const surfaceCtx = [
        duetDeck && docIds.length ? "You have a slide deck attached. When the plan reaches material worth showing, present the relevant slide while you talk — don't narrate the mechanics, just bring it up." : "",
        duetBrowser ? `You have the Browser Use skill with pre-authored guided flows.${duetBrowserShow.trim() ? ` When directed (or when the plan calls for it), run the "${duetBrowserShow.trim().slice(0, 200)}" flow and narrate it as it moves.` : " When the plan calls for showing the product live, run the most relevant guided flow and narrate it as it moves."}` : "",
        (duetDeck && docIds.length) || duetBrowser ? "The other speaker's messages may contain a parenthetical note like (Stage direction: …). Those notes are cues for you, not spoken words — act on them immediately and silently; never read them aloud, repeat them, or mention them." : "",
      ].filter(Boolean).join("\n");
      setStudioStatus("Creating both conversations…");
      const a = await tavusFetch("POST", "/conversations", {
        face_id: duetFaceA.trim(),
        pal_id: palA,
        conversation_name: `Studio duet — ${String(duetPlan.title || "featured").slice(0, 60)}`,
        ...(duetOpener.trim() ? { custom_greeting: duetOpener.trim() } : {}),
        conversational_context: `${sharedCtx}\nYou open the conversation.${surfaceCtx ? `\n${surfaceCtx}` : ""}`,
        properties: { max_call_duration: 360 },
      });
      // The host joins HELD (silent, face visible) — its scripted reply is
      // spoken via conversation.echo the moment A's opener lands, so the
      // opening exchange plays instantly while the real LLM turns warm up.
      // No custom_greeting here: the echo IS its opener.
      const b = await tavusFetch("POST", "/conversations", {
        face_id: duetFaceB.trim(),
        pal_id: palB,
        conversation_name: "Studio duet — host",
        conversational_context: [
          sharedCtx,
          `Your guest opens with roughly: "${duetOpener.trim().slice(0, 300)}"`,
          duetOpenerB.trim() ? `You reply with: "${duetOpenerB.trim().slice(0, 300)}" — continue the conversation from there; never repeat that line.` : "React to what they said, then ask your first question.",
        ].join("\n"),
        properties: { max_call_duration: 360 },
      });
      setDuetRun({ a, b, stream });
      setStudioStatus("");
      addLog("ok", `Duet live: ${duetPlan.featured.name || "featured"} opens ↔ ${duetPlan.host.name || "host"}. It ends and saves the video on its own.`);
    } catch (e) {
      stream?.getTracks().forEach((t) => t.stop());
      setStudioStatus(`Duet failed: ${e.message}`);
      addLog("err", `Duet: ${e.message}`);
    }
  };

  /* ── Shareable demo link: store the snapshot server-side, mint /d/{slug} ── */

  const shareDemo = async () => {
    if (!palId.trim() || !faceId.trim()) { addLog("err", "The demo needs a Face ID and PAL ID before it can be shared — see Setup."); return; }
    setSharing(true);
    try {
      const res = await fetch("/api/demos", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          name: conversationName || site.brand || "demo",
          site,
          controls: controlsConfig,
          payload: conversationPayload,
          experience: experienceConfig,
          // Deck + guided flows live on the PAL, which any later builder
          // launch can rewrite — demo-launch re-attaches these per visitor
          // call so the link keeps working no matter what ran on the PAL.
          presentation: presentationEnabled && docIds.length ? presentationPayload : null,
          browserUse: (() => {
            const bc = sanitizeBrowserCfg(browserCfgObj);
            return browserUseEnabled && bc.guided_flows.length ? { config: bc } : null;
          })(),
        }),
      });
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(j.error || `${res.status}: sharing failed`);
      }
      const url = `${window.location.origin}/d/${j.slug}`;
      setShareUrl(url);
      addLog("ok", `Shareable link ready: ${url}`);
      if (presentationEnabled && !docIds.length) addLog("err", "Heads up: Presentation is on but has no document IDs — visitors on this link get NO slides. Add doc IDs on the Presentation step and share again.");
      promptSaveIfDirty(); // a shared demo should exist as a saved demo too
    } catch (e) {
      addLog("err", `Share: ${e.message}`);
    } finally {
      setSharing(false);
    }
  };

  /* ── "Start from an idea": Claude drafts the whole template, all editable ── */

  /* ── Rehearsal loop: Claude plays BOTH sides of a short call against the
     current config, faithfully — flaws included — so the operator refines by
     giving coach notes on a transcript instead of digging through steps. ── */
  const rehearsalText = () =>
    (rehearsal.turns || []).map((t) => `${t.role === "visitor" ? "VISITOR" : "AI"}: ${t.text}`).join("\n");

  const runRehearsal = async () => {
    if (!personaDraft.trim() || rehearsal.busy) return;
    setRehearsal((r) => ({ ...r, busy: true, err: "" }));
    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          kind: "rehearse",
          context: {
            personaSummary: personaDraft.slice(0, 8000),
            greeting: greeting.trim(),
            objectives: objectivesEnabled ? objectivesText : "",
            guardrails: guardrailsEnabled ? guardrailsText : "",
            replacing: demoReplacing.trim(),
          },
        }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || "rehearsal failed");
      }
      const j = JSON.parse(text.slice(text.indexOf("{"), text.lastIndexOf("}") + 1));
      const turns = (Array.isArray(j?.transcript) ? j.transcript : [])
        .map((t) => ({ role: t.role === "visitor" ? "visitor" : "ai", text: String(t.text || "").trim() }))
        .filter((t) => t.text)
        .slice(0, 24);
      if (!turns.length) throw new Error("empty rehearsal — try again");
      setRehearsal((r) => ({ ...r, busy: false, turns }));
    } catch (e) {
      setRehearsal((r) => ({ ...r, busy: false, err: `Rehearsal: ${e.message}` }));
    }
  };

  const applyRehearsalNotes = async () => {
    const note = rehearsal.note.trim();
    if (!note) return;
    // Route through the revise machinery with the transcript as evidence —
    // it already knows flow notes → objectives, rule notes → guardrails.
    await revisePersona(
      `These notes are about the REHEARSAL TRANSCRIPT below — fix the config so the next run plays right.\n\nNOTES:\n${note}\n\nREHEARSAL TRANSCRIPT:\n${rehearsalText().slice(0, 6000)}`,
      `Rehearsal notes: "${note.slice(0, 40)}${note.length > 40 ? "…" : ""}"`
    );
    setRehearsal((r) => ({ ...r, note: "" }));
  };

  const draftDemo = async (knownBrand = "", themeJ = null) => {
    if (!ideaText.trim()) return;
    setIdeating(true);
    setDraftReport(null);
    try {
      addLog("info", "Drafting the whole demo from your answers…");
      // Anchor the draft to the REAL company when we know it (from the URL /
      // theming) — otherwise Claude invents a plausible fictional brand.
      const parts = [];
      if (demoReplacing.trim()) parts.push(`THE CONVERSATION THIS DEMO REPLACES: ${demoReplacing.trim()}`);
      parts.push(`HOW A GOOD ONE GOES TODAY (derive the objectives from these steps, in this order; audience, tone, and the closing outcome live in here too):\n${ideaText}`);
      if (demoHandoff.trim()) parts.push(`HUMAN HANDOFF — moments a real person must take over: ${demoHandoff.trim()} (turn these into guardrails AND an escalation behavior in the flow — offer the handoff gracefully, never bluff past it).`);
      const featureNames = { canvas: "magic canvas", vision: "vision", coach: "coach mode", presentation: "presentation deck", browseruse: "browser use", emailGate: "email gate" };
      const picked = DEMO_FEATURES.filter((f) => demoFeatures[f.k]).map((f) => featureNames[f.k]);
      parts.push(`FEATURES SELECTED: ${picked.join(", ") || "none"}`);
      // Anchor ONLY to fresh signals (the theming result or the typed URL) —
      // site.brand at this point is the PREVIOUS demo's company, and using it
      // drafted new demos for the old brand.
      const company = String(knownBrand || "").trim();
      if (company) parts.push(`The prospect/company is ${company} — the REAL company. Use its real name and public positioning everywhere (page copy, greeting, persona, goals). Never invent a substitute brand name. Don't invent specific claims or product facts you're not sure of — stay accurate-but-general where unsure.`);
      else if (brandUrl.trim()) parts.push(`The prospect's website is ${brandUrl.trim()} — the REAL company behind that domain. Use its real name; never invent a substitute brand name.`);
      // Hard timeout: a hung serverless call must not freeze the wizard.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 90_000);
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "demo", vibe: parts.join("\n\n") }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || "drafting failed");
      }
      const t = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());

      // ── NET-NEW MEANS NET-NEW. Before applying the template, reset every
      // demo-content field to its default — a new demo must not inherit the
      // previous one's cards, catalog, vision, coach, journey, tools, deck,
      // duet plan, or pronunciation. Rides through the reset:
      // - palId + faceId: the PAL-hygiene sweep at launch makes reuse safe;
      //   wiping palId dead-ended every draft→launch at the canLaunch gate.
      // - the JUST-FETCHED brand theme (themeJ) — resetting it shipped the
      //   default look while the log claimed "themed to <brand>".
      // - account-level studio PALs; recording/webhook via store fallbacks.
      // (Reset happens AFTER the fetch succeeds, so a failed draft never
      // wipes the current demo.)
      const freshSite = themeJ
        ? {
            theme: themeJ.colors ? { ...(themeJ.colors || {}), font: themeJ.font || "" } : null,
            logoUrl: themeJ.logoUrl || "",
            // The facade fields ride too — resetting them made the just-fetched
            // real nav labels + hero image vanish on the main draft path.
            nav: Array.isArray(themeJ.navLabels) && themeJ.navLabels.length ? themeJ.navLabels.slice(0, 6).map((x) => String(x).slice(0, 30)) : null,
            heroImage: themeJ.heroImage || "",
          }
        : {};
      applyConfig({
        faceId, palId, studioPalA, studioPalB,
        site: freshSite,
        demoIntent, demoReplacing, demoHandoff, demoFeatures,
      });
      setActiveScenario(""); // saving must create a new library entry, not overwrite the old demo

      if (t.conversationName) setConversationName(t.conversationName);
      if (t.greeting) setGreeting(t.greeting);
      setSite((s) => ({
        ...s,
        brand: t.brand || s.brand,
        headline: t.headline || s.headline,
        tagline: t.tagline || s.tagline,
        cta: t.cta || s.cta,
      }));
      // The visible "Describe it" box must carry the brief — the structured
      // fields live in a collapsed drawer, so filling only them made the
      // Persona step look empty ("new demo not coupling with persona").
      if (t.personaBrief || ideaText.trim()) {
        setPersonaBrief((b) => ({
          ...b,
          ...(t.personaBrief || {}),
          vibe: String(t.personaBrief?.vibe || "").trim() || ideaText.trim() || b.vibe,
        }));
      }
      const report = [];
      report.push({ ok: true, text: `Page copy + greeting drafted${t.brand ? ` for ${t.brand}` : ""}` });
      report.push({ ok: true, text: "Persona brief filled — the prompt drafts on top automatically" });
      if (Array.isArray(t.objectives) && t.objectives.length) {
        // Branch entries ("if X -> Y") must be INDENTED or the parser treats
        // them as literal top-level steps (the PAL then asks "if returning
        // customer…" out loud — seen on live calls).
        setObjectivesText(t.objectives.map((o) => (/^if\s/i.test(String(o).trim()) ? `  ${String(o).trim()}` : String(o).trim())).join("\n"));
        setObjectivesEnabled(true);
        report.push({ ok: true, text: `Objectives: ${t.objectives.length} steps chained` });
      }
      if (Array.isArray(t.guardrails) && t.guardrails.length) {
        setGuardrailsText(t.guardrails.join("\n"));
        setGuardrailsEnabled(true);
        report.push({ ok: true, text: `Guardrails: ${t.guardrails.length} rules` });
      }
      // Feature picks drive the toggles 1:1 — never the template's whim
      // (canvas keyed on a model field the template may leave empty made
      // canvas randomly on/off per draft).
      setCanvasEnabled(!!demoFeatures.canvas);
      if (demoFeatures.canvas) {
        if (t.canvasPlaybook) setCanvasPlaybook(t.canvasPlaybook);
        report.push({ ok: true, text: `Magic Canvas on${t.canvasPlaybook ? " — card plan drafted" : ""}` });
      }
      if (demoFeatures.vision) {
        setVisionEnabled(true);
        if (t.visionVibe) setVisionVibe(t.visionVibe);
        report.push({ ok: true, text: "Vision on — generate the checks on the Vision step (one click)" });
      }
      if (demoFeatures.coach && t.coach && Array.isArray(t.coach.criteria) && t.coach.criteria.length) {
        setCoachEnabled(true);
        setCoachTitle(String(t.coach.title || ""));
        setCoachScene(String(t.coach.scene || ""));
        if (t.coach.talkHint) setCoachTalkHint(String(t.coach.talkHint));
        setCoachCriteriaText(t.coach.criteria.map((c) => String(c).trim()).filter(Boolean).join("\n"));
        report.push({ ok: true, text: `Coach scorecard drafted — ${t.coach.criteria.length} behaviors` });
      } else if (demoFeatures.coach) {
        setCoachEnabled(true);
        report.push({ ok: false, text: "Coach on — ✨ draft the scorecard on the Experience step" });
      }
      setExpEmailGate(!!demoFeatures.emailGate);
      if (demoFeatures.presentation) {
        setPresentationEnabled(true);
        report.push({ ok: false, text: "Slide deck on — add your Knowledge Base doc ID on the Presentation step before launch" });
      }
      if (demoFeatures.browseruse) {
        setBrowserUseEnabled(true);
        report.push({ ok: false, text: "Browser Use on — ✨ script a guided flow on the Presentation step before launch" });
      }
      setDraftReport(report);
      report.forEach((r) => addLog(r.ok ? "ok" : "info", r.text));
      setPersonaDraft(""); setPersonaAttached(false); // brief changed → draft is stale
      // Finish the coupling: generate the persona ON TOP of the fresh brief +
      // objectives/guardrails (the effect fires after this state commits, so
      // the generator reads the drafted values, not the stale ones).
      setAutoDraft(true);
      addLog("ok", "Demo drafted — drafting the persona prompt on top now…");
    } catch (e) {
      addLog("err", `Draft demo: ${e.name === "AbortError" ? "took too long (90s) and was cancelled — try again; if it keeps happening, shorten the idea text" : e.message}`);
    } finally {
      setIdeating(false);
    }
  };

  /* ── Brand theme: Claude restyles the demo page from a company URL ── */

  const themeFromUrl = async () => {
    const url = brandUrl.trim();
    if (!url) return;
    setTheming(true);
    try {
      addLog("info", "Reading the site and drafting a matching theme + copy…");
      // Give Claude the use case so page copy speaks the brand's diction FOR
      // this demo (HR copy for HR, sales diction for sales, etc.).
      const useCase = [
        ideaText.trim(),
        personaBrief.goal && `Goal: ${personaBrief.goal}`,
        personaBrief.audience && `Audience: ${personaBrief.audience}`,
        personaBrief.product && `Product focus: ${personaBrief.product}`,
      ].filter(Boolean).join("\n");
      // Hard timeout: a hung serverless call must not freeze the wizard.
      const ctrl = new AbortController();
      const timer = setTimeout(() => ctrl.abort(), 75_000);
      const res = await fetch("/api/brand-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: /^https?:\/\//i.test(url) ? url : `https://${url}`, useCase }),
        signal: ctrl.signal,
      }).finally(() => clearTimeout(timer));
      const j = await res.json().catch(() => ({}));
      if (!res.ok) {
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(j.error || `${res.status}: theming failed`);
      }
      setSite((s) => ({
        ...s,
        brand: j.brand || s.brand,
        headline: j.headline || s.headline,
        tagline: j.tagline || s.tagline,
        cta: j.cta || s.cta,
        logoUrl: s.logoUrl || j.logoUrl || "",
        theme: { ...(j.colors || {}), font: j.font || "" },
        // The facade pieces: their REAL nav labels + hero image, straight off
        // the live site — this is what makes the page read as "our site".
        nav: Array.isArray(j.navLabels) && j.navLabels.length ? j.navLabels.slice(0, 6).map((x) => String(x).slice(0, 30)) : s.nav,
        heroImage: j.heroImage || s.heroImage || "",
      }));
      // Updater form: the fetch takes up to 75s — a greeting typed (or drafted)
      // meanwhile must win over the theme's suggestion, not get clobbered.
      if (j.greeting) setGreeting((g) => (g.trim() ? g : j.greeting));
      addLog("ok", `Demo page themed to ${j.brand || url} — colors, copy${j.greeting && !greeting.trim() ? ", greeting" : ""} drafted for this use case.${j.note ? ` (${j.note})` : ""} Tweak anything below.`);
      return j; // so callers (Draft my demo) can hand the real brand to draftDemo
    } catch (e) {
      addLog("err", `Brand theme: ${e.name === "AbortError" ? "took too long (75s) and was skipped — draft continues; theme the page later from Page & Brand" : e.message}`);
      return null;
    } finally {
      setTheming(false);
    }
  };

  /* ── Canvas ideation: Claude plans which cards earn their place ── */

  const [canvasPlanning, setCanvasPlanning] = useState(false);
  const generateCanvasPlan = async () => {
    const vibe = [ideaText.trim(), personaBrief.product && `Product: ${personaBrief.product}`,
      personaBrief.goal && `Goal: ${personaBrief.goal}`, personaBrief.audience && `Audience: ${personaBrief.audience}`]
      .filter(Boolean).join("\n");
    if (!vibe) { addLog("err", "Describe the demo first (New Demo step) so Claude knows the use case."); return; }
    setCanvasPlanning(true);
    try {
      const res = await fetch("/api/generate-persona", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ kind: "canvas", vibe, context: { brief: buildBrief() } }),
      });
      const text = await res.text();
      if (!res.ok || text.startsWith("[error]")) {
        let msg = text.replace(/^\[error\]\s*/, "");
        try { msg = JSON.parse(text).error || msg; } catch { /* plain */ }
        if (res.status === 401) setAuth({ checked: true, required: true, authed: false });
        throw new Error(msg || "planning failed");
      }
      const plan = JSON.parse(text.replace(/^```(?:json)?\s*|\s*```$/g, "").trim());
      if (plan.style) setCanvasStyle(plan.style);
      if (plan.playbook) setCanvasPlaybook(plan.playbook);
      const validKeys = new Set(CANVAS_COMPONENTS.map((c) => c.key));
      if (plan.rules) {
        setComponentRules((prev) => ({
          ...prev,
          ...Object.fromEntries(Object.entries(plan.rules).filter(([k]) => validKeys.has(k)).map(([k, v]) => [k, String(v)])),
        }));
      }
      if (Array.isArray(plan.disable)) {
        setComponents((prev) => ({
          ...prev,
          ...Object.fromEntries(plan.disable.filter((k) => validKeys.has(k)).map((k) => [k, false])),
        }));
      }
      setCanvasEnabled(true);
      const ruleCount = plan.rules ? Object.keys(plan.rules).length : 0;
      addLog("ok", `Canvas plan drafted: ${plan.style || "balanced"} style, ${ruleCount} card rule${ruleCount === 1 ? "" : "s"}${plan.disable?.length ? `, ${plan.disable.length} cards off` : ""}. Edit anything below.`);
    } catch (e) {
      addLog("err", `Canvas plan: ${e.message}`);
    } finally {
      setCanvasPlanning(false);
    }
  };

  /* ── Logo upload: file → downscaled data URL (works offline, no hosting) ── */

  const onLogoFile = (file) => {
    if (!file || !file.type.startsWith("image/")) { addLog("err", "That file isn't an image."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        const MAX = 512;
        const scale = Math.min(1, MAX / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.max(1, Math.round(img.width * scale));
        canvas.height = Math.max(1, Math.round(img.height * scale));
        canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
        setSiteField("logoUrl", canvas.toDataURL("image/png"));
      };
      img.onerror = () => addLog("err", "Couldn't read that image.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  // Site screenshot → the demo page's backdrop ("that's OUR site"). JPEG at
  // ≤1600px wide keeps the data URL small enough to ride scenarios and the
  // shared-link snapshot.
  const onShotFile = (file) => {
    if (!file || !file.type.startsWith("image/")) { addLog("err", "That file isn't an image."); return; }
    const reader = new FileReader();
    reader.onload = () => {
      const img = new Image();
      img.onload = () => {
        // Step down width/quality until it fits comfortably inside the shared
        // demo snapshot (a 1600px q0.82 homepage is routinely 400-800KB —
        // too big to share).
        let data = "";
        for (const [w, q] of [[1600, 0.8], [1400, 0.7], [1200, 0.62], [1000, 0.55], [840, 0.5]]) {
          const scale = Math.min(1, w / img.width);
          const canvas = document.createElement("canvas");
          canvas.width = Math.max(1, Math.round(img.width * scale));
          canvas.height = Math.max(1, Math.round(img.height * scale));
          canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
          data = canvas.toDataURL("image/jpeg", q);
          if (data.length <= 300_000) break;
        }
        if (data.length > 300_000) { addLog("err", "That screenshot is huge even compressed — crop it to just the top of the page and retry."); return; }
        setSiteField("shot", data);
        addLog("ok", "Screenshot in — the demo page now IS their site, with the call on top. Rides saves and share links.");
      };
      img.onerror = () => addLog("err", "Couldn't read that image.");
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  };

  const attachPersona = async () => {
    if (!apiKey.trim() || !palId.trim()) { addLog("err", "API key and PAL ID are required — see Setup."); return; }
    if (!personaDraft.trim()) { addLog("err", "Nothing to attach — generate or write a persona prompt first."); return; }
    setGenerating(true);
    try {
      addLog("info", "Attaching persona prompt to the PAL…");
      await tavusFetch("PATCH", `/pals/${palId.trim()}`, [
        { op: "add", path: "/system_prompt", value: personaDraft.trim() },
      ]);
      setPersonaAttached(true);
      pushPromptVersion("Attached to PAL", personaDraft, { attached: true });
      addLog("ok", "Persona prompt attached (persists on the PAL until you change it).");
    } catch (e) {
      addLog("err", e.message + " — if this is a network/CORS block, copy the curl from the preview panel and run it from a terminal.");
    } finally {
      setGenerating(false);
    }
  };

  /* Skills persist on the PAL — give the toggle an explicit off-ramp. */
  const detachSkill = async (skillId) => {
    if (!apiKey.trim() || !palId.trim()) { addLog("err", "API key and PAL ID are required — see Account."); return; }
    try {
      await tavusFetch("DELETE", `/pals/${palId.trim()}/skills/${skillId}`);
      addLog("ok", `${skillId.replace("_", " ")} detached from the PAL.`);
    } catch (e) {
      addLog("err", `Detach ${skillId}: ${e.message}`);
    }
  };

  const canLaunch = apiKey.trim() && faceId.trim() && palId.trim();

  const launch = async (maybePrefs) => {
    // Guided-journey answers from DemoSite — the Launch button passes a click
    // event here instead, which this filters out.
    const journeyPrefs = maybePrefs && Array.isArray(maybePrefs.answers) ? maybePrefs : null;
    if (!canLaunch) { addLog("err", "API key, Face ID, and PAL ID are required — see Setup."); return; }
    setBusy(true);
    try {
      const pal = palId.trim();

      // NOTHING before the conversation POST may abort the launch: one bad
      // section used to kill the whole thing and read as "nothing works".
      // Each section attaches inside its own guard and logs its own failure.
      // onFail: fail-SAFE, not fail-stale — when attaching new objectives or
      // guardrails fails, the PAL still carries the PREVIOUS demo's set, and
      // launching on those is the "keeps repeating itself" pathology. Clear
      // the old counterpart before continuing.
      const section = async (label, fn, onFail) => {
        try { await fn(); } catch (e) {
          addLog("err", `${label} failed (launching without it): ${e.message}`);
          if (onFail) { try { await onFail(); } catch { /* best effort */ } }
        }
      };

      // ── PAL hygiene. A PAL keeps EVERYTHING ever attached to it, so a
      // section that's OFF in this demo must be actively cleared or the
      // previous demo bleeds through (stale objectives, rules, vision
      // checks, dictionary, tools, decks — all confirmed leak paths).
      // Read the PAL once and clear only what's actually there; every
      // clear is non-fatal.
      if (personaDraft.trim() && !personaAttached) {
        // The #1 greeting-vs-persona mismatch: a drafted prompt that never
        // got attached — this demo's greeting plays while the PAL speaks
        // the previous demo's persona.
        await section("Persona attach", async () => {
          addLog("info", "The persona draft was never attached — attaching it now so the PAL speaks THIS demo's persona…");
          await tavusFetch("PATCH", `/pals/${pal}`, [
            { op: "add", path: "/system_prompt", value: personaDraft },
          ]);
          setPersonaAttached(true);
          addLog("ok", "Persona prompt attached.");
        });
      }
      let palState = null;
      try { palState = await tavusFetch("GET", `/pals/${pal}`); } catch { addLog("info", "Couldn't read the PAL's current state — skipping the stale-config sweep."); }
      const clearPatch = async (label, ops, fallbackOps) => {
        try {
          await tavusFetch("PATCH", `/pals/${pal}`, ops);
          addLog("ok", `Cleared the previous demo's ${label} from the PAL (that section is off in this demo).`);
        } catch (err) {
          if (fallbackOps) {
            try {
              await tavusFetch("PATCH", `/pals/${pal}`, fallbackOps);
              addLog("ok", `Cleared the previous demo's ${label} from the PAL (that section is off in this demo).`);
              return;
            } catch { /* fall through to the error log */ }
          }
          addLog("err", `Couldn't clear old ${label} (continuing): ${err.message}`);
        }
      };
      if (palState) {
        if ((!objectivesEnabled || !objectivesPayload.data.length) && palState.objectives_id) {
          await clearPatch("objectives",
            [{ op: "remove", path: "/objectives_id" }],
            [{ op: "replace", path: "/objectives_id", value: null }]);
        }
        if ((!guardrailsEnabled || !guardrailsParsed.length) && Array.isArray(palState.guardrail_ids) && palState.guardrail_ids.length) {
          await clearPatch("guardrails",
            [{ op: "replace", path: "/guardrail_ids", value: [] }],
            [{ op: "add", path: "/guardrail_ids", value: [] }]);
        }
        const perc = palState.layers?.perception;
        // Annotations need raven even with no vision queries (their inline
        // tools ride the perception layer) — don't sweep perception off then.
        const perceptionWanted =
          (visionEnabled && (visionPayload.visual_awareness_queries || visionPayload.audio_awareness_queries)) ||
          annotEmotion || annotVision;
        if (!perceptionWanted && perc?.perception_model && perc.perception_model !== "off") {
          await clearPatch("vision checks",
            [{ op: "add", path: "/layers/perception", value: { perception_model: "off" } }]);
        }
        if ((!speechEnabled || (!pronunciationRules.length && !pronDictId)) && palState.layers?.tts?.pronunciation_dictionary_id) {
          await clearPatch("pronunciation dictionary",
            [{ op: "remove", path: "/layers/tts/pronunciation_dictionary_id" }],
            [{ op: "add", path: "/layers/tts/pronunciation_dictionary_id", value: null }]);
        }
        // Inline layers.llm.tools is the deprecated path and this builder no
        // longer writes it. Clear it ALWAYS, not just when tools are off: a PAL
        // built by an older version would otherwise offer every function twice,
        // once inline and once from the registry.
        if (Array.isArray(palState.layers?.llm?.tools) && palState.layers.llm.tools.length) {
          await clearPatch("legacy inline tools",
            [{ op: "replace", path: "/layers/llm/tools", value: [] }],
            [{ op: "add", path: "/layers/llm/tools", value: [] }]);
        }
        // Registry tools the operator has since switched off.
        if (!toolsEnabled || !toolDefs.length) {
          try {
            const attached = (await tavusFetch("GET", `/pals/${pal}/tools`))?.data || [];
            for (const t of attached) if (t?.tool_id && !t.is_system_tool) await tavusFetch("DELETE", `/pals/${pal}/tools/${t.tool_id}`);
            if (attached.some((t) => !t?.is_system_tool)) addLog("ok", "Detached the PAL's tools — this demo has tools off.");
          } catch { /* none attached */ }
        }
        // Asymmetric bleed: an old demo that turned expressive delivery OFF
        // left it off forever — turn it back on when this demo wants it on.
        if (emotionControl && palState.layers?.tts?.tts_emotion_control === false) {
          await clearPatch("expressive-delivery OFF setting",
            [{ op: "add", path: "/layers/tts/tts_emotion_control", value: true }]);
        }
      }
      // Skills the PAL carries but this demo TURNED OFF — detach (the duet
      // path proved this pattern). Two safety rules learned the hard way:
      // - detach keys on the operator's toggle alone, never on "toggle on but
      //   not configured yet" — unconfigured sections handle themselves at
      //   attach time (presentation clears a stale deck LOUDLY there, with a
      //   log line, instead of this sweep stripping it silently);
      // - if the PAL couldn't be read, do NOT blind-delete: a transient GET
      //   failure must not mutate the PAL.
      if (palState) {
        const palSkills = Array.isArray(palState.skills)
          ? palState.skills.map((s) => String(s?.skill_id || s?.id || s?.name || s)).filter(Boolean)
          : null; // shape unknown → attempt detach for off-toggles, ignore failures
        for (const [on2, skillId2, label2] of [
          [presentationEnabled, "presentation", "presentation deck"],
          [canvasEnabled, "magic_canvas", "Magic Canvas"],
          [browserUseEnabled, "browser_use", "Browser Use flows"],
          [internetSearchEnabled, "internet_search", "internet search"],
        ]) {
          if (on2) continue;
          if (palSkills && !palSkills.includes(skillId2)) continue;
          try {
            await tavusFetch("DELETE", `/pals/${pal}/skills/${skillId2}`);
            addLog("ok", `Detached the previous demo's ${label2} from the PAL (off in this demo).`);
          } catch { /* wasn't attached — nothing to clear */ }
        }
      }

      // Objectives: create the set, attach to the PAL (replaces any existing set).
      if (objectivesEnabled && objectivesPayload.data.length) await section("Objectives", async () => {
        addLog("info", `Creating objectives (${objectivesPayload.data.length} step${objectivesPayload.data.length > 1 ? "s" : ""})…`);
        const obj = await tavusFetch("POST", "/objectives", objectivesPayload);
        const objectivesId = obj.objectives_id || obj.uuid || obj.id;
        addLog("ok", `Objectives created: ${objectivesId}`);
        addLog("info", "Attaching objectives to the PAL…");
        await tavusFetch("PATCH", `/pals/${pal}`, [
          { op: "add", path: "/objectives_id", value: objectivesId },
        ]);
        addLog("ok", "Objectives attached (persists on the PAL until you remove it).");
      }, async () => {
        await clearPatch("objectives (stale set — new one failed to attach)",
          [{ op: "remove", path: "/objectives_id" }],
          [{ op: "replace", path: "/objectives_id", value: null }]);
      });

      // Guardrails: create each, then REPLACE the PAL's set with exactly these.
      // (Merging accumulated near-duplicates across relaunches until the PAL
      // hit Tavus's 50-guardrail cap and launches 400'd.)
      if (guardrailsEnabled && guardrailsParsed.length) await section("Guardrails", async () => {
        addLog("info", `Creating ${guardrailsParsed.length} guardrail${guardrailsParsed.length > 1 ? "s" : ""}…`);
        const newIds = [];
        for (const g of guardrailsParsed) {
          const created = await tavusFetch("POST", "/guardrails", g);
          const id = created.uuid || created.guardrail_uuid || created.id;
          newIds.push(id);
          addLog("ok", `Guardrail ${g.guardrail_name}: ${id}`);
        }
        addLog("info", "Attaching guardrails to the PAL (overwrites its previous set)…");
        try {
          // "replace" has unambiguous overwrite semantics; "add" on an array
          // can be treated as append by some servers (how the pile-up began).
          await tavusFetch("PATCH", `/pals/${pal}`, [
            { op: "replace", path: "/guardrail_ids", value: newIds },
          ]);
        } catch (err) {
          // A PAL created without guardrails may not have the member yet —
          // "replace" requires it to exist, so fall back to "add".
          if (/does not exist|not found|invalid path/i.test(err.message)) {
            await tavusFetch("PATCH", `/pals/${pal}`, [
              { op: "add", path: "/guardrail_ids", value: newIds },
            ]);
          } else {
            throw err;
          }
        }
        addLog("ok", `Guardrails set — the PAL now has exactly these ${newIds.length} rule${newIds.length > 1 ? "s" : ""}.`);
      }, async () => {
        await clearPatch("guardrails (stale set — new ones failed to attach)",
          [{ op: "replace", path: "/guardrail_ids", value: [] }],
          [{ op: "add", path: "/guardrail_ids", value: [] }]);
      });

      // Vision: attach the perception layer to the PAL (persists like
      // objectives). Also attaches when only the on-stage annotations are on —
      // their note_emotion/note_scene tools live in this same layer.
      if ((visionEnabled && (visionPayload.visual_awareness_queries || visionPayload.audio_awareness_queries)) || annotEmotion || annotVision) await section("Vision", async () => {
        // Vision toggled off but annotations on → attach the tools WITHOUT
        // any leftover awareness queries the operator turned off.
        const percValue = visionEnabled
          ? visionPayload
          : Object.fromEntries(Object.entries(visionPayload).filter(([k]) => !k.endsWith("awareness_queries")));
        const v = (visionEnabled && visionPayload.visual_awareness_queries?.length) || 0;
        const a = (visionEnabled && visionPayload.audio_awareness_queries?.length) || 0;
        addLog("info", `Attaching vision (${v} visual, ${a} audio checks${annotEmotion || annotVision ? ", + on-stage annotation tools" : ""})…`);
        await tavusFetch("PATCH", `/pals/${pal}`, [
          { op: "add", path: "/layers/perception", value: percValue },
        ]);
        addLog("ok", "Vision attached (persists on the PAL until you change it).");
      });

      // Conversational Flow (Sparrow turn-taking): persists on the PAL like
      // the other layers. PATCH merges only the fields the operator set —
      // blank dials stay on Tavus defaults.
      if (conversationalFlowPayload) await section("Conversational flow (Sparrow)", async () => {
        addLog("info", `Tuning turn-taking (${conversationalFlowPayload.turn_detection_model || "current Sparrow"})…`);
        await tavusFetch("PATCH", `/pals/${pal}`, [
          { op: "add", path: "/layers/conversational_flow", value: conversationalFlowPayload },
        ]);
        addLog("ok", "Conversational flow set (persists on the PAL until you change it).");
      });

      // Voice + expressive delivery: nice-to-haves — a failure here must never
      // stop the conversation from launching (some PALs reject TTS-layer ops).
      if (externalVoiceId.trim()) {
        try {
          addLog("info", `Setting the voice to ${externalVoiceName || externalVoiceId}…`);
          await patchPalVoice(pal, externalVoiceId.trim());
          addLog("ok", "Voice applied (persists on the PAL until you change it).");
        } catch (e) {
          addLog("err", `Voice couldn't be applied (continuing launch): ${e.message}`);
        }
      }
      if (!emotionControl) {
        // Only patch when turned OFF — Tavus defaults it to on.
        try {
          addLog("info", "Disabling expressive delivery…");
          await tavusFetch("PATCH", `/pals/${pal}`, [
            { op: "add", path: "/layers/tts/tts_emotion_control", value: false },
          ]);
          addLog("ok", "Expressive delivery off — flat, even delivery.");
        } catch (e) {
          addLog("err", `Expressive-delivery setting failed (continuing launch): ${e.message}`);
        }
      }

      // Pronunciation: create a dictionary, attach it to the PAL's voice.
      if (speechEnabled && (pronunciationRules.length || pronDictId)) await section("Pronunciation", async () => {
        // Editor rules win: they become a fresh dictionary. With an empty
        // editor, the saved dictionary picked on the Voice step attaches.
        let dictId = pronDictId;
        if (pronunciationRules.length) {
          addLog("info", `Creating pronunciation dictionary (${pronunciationRules.length} rule${pronunciationRules.length > 1 ? "s" : ""})…`);
          const dict = await tavusFetch("POST", "/pronunciation-dictionaries", {
            name: pronDictName.trim() || pronunciationPayload.name,
            rules: pronunciationRules,
          });
          dictId = dict.pronunciation_dictionary_id || dict.uuid || dict.id;
          addLog("ok", `Dictionary created: ${dictId}`);
        }
        addLog("info", "Attaching dictionary to the PAL's voice…");
        await tavusFetch("PATCH", `/pals/${pal}`, [
          { op: "add", path: "/layers/tts/pronunciation_dictionary_id", value: dictId },
        ]);
        addLog("ok", "Pronunciation attached (persists on the PAL until you change it).");
      });

      // Integrations: attach custom tools to the PAL's LLM (persists on the PAL).
      if (toolsEnabled && toolDefs.length) await section("Tools", async () => {
        addLog("info", `Registering ${toolDefs.length} tool${toolDefs.length > 1 ? "s" : ""}…`);
        const ids = [];
        for (const def of toolDefs) {
          // Tool names are unique per ACCOUNT, so a relaunch of the same demo
          // hits 409 on create. Look the name up first and PATCH it instead —
          // the tool_id stays stable and anything else using it keeps working.
          let existing = null;
          try {
            const found = await tavusFetch("GET", `/tools?type=user&name_or_uuid=${encodeURIComponent(def.name)}`);
            existing = (found?.data || []).find((t) => t.name === def.name) || null;
          } catch { /* treat as new */ }
          if (existing?.tool_id) {
            await tavusFetch("PATCH", `/tools/${existing.tool_id}`, def);
            ids.push(existing.tool_id);
            addLog("info", `↻ ${def.name} updated.`);
          } else {
            const made = await tavusFetch("POST", "/tools", def);
            const id = made?.tool_id || made?.data?.tool_id;
            if (!id) throw new Error(`Tavus didn't return a tool_id for "${def.name}".`);
            ids.push(id);
            addLog("info", `＋ ${def.name} created.`);
          }
        }
        await tavusFetch("POST", `/pals/${pal}/tools`, { tool_ids: ids });
        // Full replace, same principle as guardrails: this demo owns the PAL's
        // tool set, or a previous demo's tools ride along into this call.
        try {
          const attached = (await tavusFetch("GET", `/pals/${pal}/tools`))?.data || [];
          for (const t of attached) {
            if (t?.tool_id && !ids.includes(t.tool_id) && !t.is_system_tool) {
              await tavusFetch("DELETE", `/pals/${pal}/tools/${t.tool_id}`);
              addLog("info", `Detached "${t.name}" — left over from another demo.`);
            }
          }
        } catch { /* listing is best-effort; the attach above already landed */ }
        const speaks = toolDefs.filter((d) => d.on_resolve === "generate_response" || d.on_resolve === "response_in_result");
        addLog("ok", `Tools attached: ${toolDefs.map((t) => t.name).join(", ")}.`
          + (speaks.length ? ` ${speaks.length} of them answer back into the conversation.` : ""));
      }, async () => {
        try {
          const attached = (await tavusFetch("GET", `/pals/${pal}/tools`))?.data || [];
          for (const t of attached) if (t?.tool_id && !t.is_system_tool) await tavusFetch("DELETE", `/pals/${pal}/tools/${t.tool_id}`);
          addLog("info", "Cleared the PAL's tools so the call can't offer a half-registered one — fix and relaunch.");
        } catch { /* nothing attached */ }
      });

      // Browser Use runs pre-authored guided flows only — with no complete
      // flows we SKIP the attach and CLEAR any stale flows the PAL carries
      // (same fail-safe shape as presentation: a net-new demo must never run
      // the previous demo's walkthroughs).
      let browserCfg = null;
      if (browserUseEnabled) {
        let bc = {};
        let badJson = false;
        try { bc = browserUseConfig.trim() ? JSON.parse(browserUseConfig) : {}; } catch { badJson = true; }
        bc = sanitizeBrowserCfg(bc);
        if (bc.guided_flows.length) {
          browserCfg = bc;
        } else {
          addLog("err", badJson
            ? "The Browser Use config isn't valid JSON — SKIPPING it this launch. Fix it on the Presentation step."
            : "Browser Use is on but has no complete guided flows — SKIPPING it this launch. A flow needs a name and at least one filled-in step (Presentation step).");
          if (palState) {
            try {
              await tavusFetch("DELETE", `/pals/${pal}/skills/browser_use`);
              addLog("ok", "Cleared a previous demo's guided flows from the PAL so it can't run the wrong walkthrough.");
            } catch { /* nothing attached */ }
          }
        }
      }
      // Tavus-authored skills (internet_search / browser_use) — same PUT
      // pattern as presentation/canvas; they persist on the PAL. Fail-SAFE
      // like the deck: a rejected attach detaches rather than leaving the
      // call running on whatever config the PAL carried before.
      for (const [on, skillId, cfg] of [
        [internetSearchEnabled, "internet_search", {}],
        [!!browserCfg, "browser_use", browserCfg],
      ]) {
        if (!on) continue;
        await section(skillId.replace("_", " "), async () => {
          addLog("info", `Attaching the ${skillId.replace("_", " ")} skill…`);
          await tavusFetch("PUT", `/pals/${pal}/skills/${skillId}`, { config: cfg || {} });
          addLog("ok", `${skillId.replace("_", " ")} attached (persists on the PAL until detached).`);
        }, async () => {
          try {
            await tavusFetch("DELETE", `/pals/${pal}/skills/${skillId}`);
            addLog("info", `Cleared the PAL's ${skillId.replace("_", " ")} skill so the call can't run an older config — fix the config and relaunch. (If the error above says 403/404, the skill may not be granted on this Tavus account yet — ask your account team.)`);
          } catch { /* nothing attached */ }
        });
      }

      if (presentationEnabled && docIds.length && canvasEnabled) {
        addLog("info", "Deck + Magic Canvas: the slides lead and cards are reserved for questions (this replaces the canvas style dial for this call). Scripted cards and link photos still fire on their keywords — check those if a card lands mid-slide.");
      }
      const browserWins = browserCfg && Object.keys(browserCfg).length > 0;
      if (presentationEnabled && docIds.length && browserWins) {
        addLog("err", "SKIPPING the deck: Tavus won't attach Browser Use and Presentation to the same PAL. Move the deck into Browser Use (set its slide document and add a 🖼 slide step), or turn Browser Use off — the deck can't ride alongside it.");
      }
      if (presentationEnabled && !browserWins) {
        if (!docIds.length) {
          addLog("err", "Presentation is on but has no document IDs — SKIPPING the deck this launch. Add your Knowledge Base doc IDs on the Presentation step (a fresh demo starts with none).");
          // Without this, the PAL keeps whatever deck the LAST demo attached
          // and walk_the_deck opens the old slides in the new demo. Only when
          // the PAL was readable — a transient GET failure must not mutate it.
          if (palState) {
            try {
              await tavusFetch("DELETE", `/pals/${pal}/skills/presentation`);
              addLog("ok", "Cleared a previous demo's deck from the PAL so it can't present the wrong slides.");
            } catch { /* no deck on the PAL — nothing to clear */ }
          }
        } else {
          await section("Presentation", async () => {
            // Name the failure mode BEFORE it bites: a deck doc that's still
            // processing (or a bad id) is the top "no slides" cause, and the
            // attach itself won't always say so.
            for (const id of docIds) {
              try {
                const doc = await tavusFetch("GET", `/documents/${id}`);
                const st = String(doc?.status || doc?.data?.status || "").toLowerCase();
                const durl = String(doc?.document_url || doc?.data?.document_url || "");
                if (st && st !== "ready") addLog("err", `Deck doc ${id} ("${doc?.document_name || doc?.name || "?"}") is "${st}" — slides won't render until it's ready. A fresh upload takes a few minutes; relaunch after.`);
                else addLog("info", `Deck doc ${id} ("${doc?.document_name || doc?.name || id}") is ready.`);
                // The deck list is not the Knowledge Base. Articles and help-centre
                // pages read fine for RAG and render as nothing at all as slides.
                if (durl && !PRESENTABLE.test(durl)) addLog("err", `Deck doc ${id} ("${doc?.document_name || doc?.name || id}") doesn't look like a deck — reference material belongs on the Knowledge step ("PAL can use"), not in the deck. Only the PDF/PPTX/image deck should be here.`);
              } catch {
                addLog("err", `Deck doc ${id} can't be read — check the ID against the Knowledge Base step (this is usually a typo or a deleted doc).`);
              }
            }
            addLog("info", `Attaching presentation skill (${slidesTrigger}, ${docIds.length} doc${docIds.length > 1 ? "s" : ""})…`);
            await tavusFetch("PUT", `/pals/${pal}/skills/presentation`, presentationPayload);
            addLog("ok", "Presentation skill attached.");
          }, async () => {
            // Fail-SAFE like objectives/guardrails: a failed attach (doc still
            // processing, deleted id, >50 pages) must not launch on whatever
            // deck the PAL already carries.
            try {
              await tavusFetch("DELETE", `/pals/${pal}/skills/presentation`);
              addLog("info", "Cleared the PAL's presentation skill so the call can't run an older deck — fix the doc IDs and relaunch.");
            } catch { /* nothing attached */ }
          });
        }
      }
      if (canvasEnabled) await section("Magic Canvas", async () => {
        const on = Object.values(components).filter(Boolean).length;
        addLog("info", `Attaching Magic Canvas (${on}/7 components on${placement !== "auto" ? `, prefer ${placement} rail` : ""})…`);
        await tavusFetch("PUT", `/pals/${pal}/skills/magic_canvas`, canvasPayload);
        addLog("ok", "Magic Canvas skill attached.");
      });
      if (recordingEnabled) {
        if (conversationPayload.properties?.recording_storage) {
          addLog("info", `Recording is on — the call will record to s3://${conversationPayload.properties.recording_storage.bucket_name} once Tavus finishes it.`);
        } else {
          addLog("err", "Recording is toggled on but bucket / region / role ARN aren't all filled in (Timing step) — launching WITHOUT recording.");
        }
      }
      // The compiler drops cards that can't render. Silently, until now — a
      // booking card with no URL just never appeared mid-demo.
      if (scCards.length > compiledScriptedCards.length) {
        const bad = scCards.map((c, i) => ({ c, i })).filter(({ c }) => !scCardComplete(
          c.style === "link" && !String(c.href || "").trim() && schedulingUrl.trim() ? { ...c, href: schedulingUrl.trim() } : c
        ));
        addLog("err", `${bad.length} scripted card${bad.length > 1 ? "s" : ""} won't appear — missing content or a trigger: ${bad.map(({ c, i }) => `#${i + 1} ${c.title || c.style || "untitled"}`).join(", ")}. Fix them on the Magic Canvas step.`);
      }
      addLog("info", "Creating conversation…");
      const payload = journeyPrefs
        ? applyJourneyPrefs(conversationPayload, experienceConfig.journey, journeyPrefs)
        : conversationPayload;
      if (journeyPrefs?.answers?.length) addLog("info", `Weaving in the visitor's ${journeyPrefs.answers.length} pre-call answer${journeyPrefs.answers.length > 1 ? "s" : ""}…`);
      const data = await tavusFetch("POST", "/conversations", payload);
      setConversation(data);
      addLog("ok", `Live: ${data.conversation_id || ""}`);
      // Save BEFORE the demo page opens — nothing that happens on that page
      // (browser Back, refresh, closing the tab) can lose this config.
      if (isConfigDirty()) {
        saveScenario();
        addLog("info", "Auto-saved this demo to your library before opening the page.");
      }
      setSiteMode(true);
      // Belt-and-braces: if anything was still unsaved, prompt on return.
      promptOnReturn.current = true;
    } catch (e) {
      addLog("err", e.message + " — if this is a network/CORS block, copy the curl from the preview panel and run it from a terminal or backend.");
    } finally {
      setBusy(false);
    }
  };

  const copy = async (text, key) => {
    try {
      await navigator.clipboard.writeText(text.replace("••••••••", apiKey || "<your-api-key>"));
      setCopied(key);
      setTimeout(() => setCopied(""), 1500);
    } catch { /* clipboard blocked */ }
  };

  /* ── Team invites: per-person, single-use sign-up codes ── */

  const loadInvites = async () => {
    setInvitesLoading(true);
    setInviteError("");
    try {
      const r = await fetch("/api/invites");
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "couldn't load invites");
      setInvites(j.invites || []);
      // The team directory rides along — same panel, one click.
      try {
        const ra = await fetch("/api/account");
        const ja = await ra.json().catch(() => ({}));
        if (ra.ok) setTeamUsers(ja.users || []);
      } catch { /* directory is best-effort */ }
    } catch (e) {
      setInviteError(e.message);
    } finally {
      setInvitesLoading(false);
    }
  };

  const changeAccountPassword = async () => {
    setAcctBusy(true);
    setAcctMsg(null);
    try {
      const r = await fetch("/api/account", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ current: acctCur, next: acctNew }),
      });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "couldn't change the password");
      setAcctCur(""); setAcctNew("");
      setAcctMsg({ ok: true, text: "Password changed. Use the new one everywhere from now on — laptops already signed in stay signed in." });
    } catch (e) {
      setAcctMsg({ ok: false, text: e.message });
    } finally {
      setAcctBusy(false);
    }
  };

  const createInvite = async () => {
    setInviteCreating(true);
    setInviteError("");
    try {
      const r = await fetch("/api/invites", { method: "POST" });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) throw new Error(j.error || "couldn't create invite");
      setInvites((l) => [{ code: j.code, usedBy: null, expired: false, createdAt: new Date().toISOString() }, ...(l || [])]);
      copy(j.code, `inv-${j.code}`); // fresh code straight onto the clipboard
    } catch (e) {
      setInviteError(e.message);
    } finally {
      setInviteCreating(false);
    }
  };

  /* ── UI ── */

  if (duetJoin) return <DuetJoiner url={duetJoin.url} id={duetJoin.id} side={duetJoin.side} hold={duetJoin.hold} />;
  if (demoSlug) return <VisitorDemo slug={demoSlug} />;

  // Access-code gate renders before anything else. Self-contained styling so
  // the main <style> block (below) doesn't need to load for the lock screen.
  if (!auth.checked || (auth.required && !auth.authed)) {
    const s = {
      root: { minHeight: "100vh", display: "flex", alignItems: "center", justifyContent: "center", background: "#F5F4F1", color: "#17181A", fontFamily: "'Instrument Sans', system-ui, sans-serif" },
      card: { background: "#fff", border: "1px solid #E6E4DF", borderRadius: 16, padding: "36px 40px", width: "min(380px, 90vw)", boxShadow: "0 1px 3px rgba(20,20,20,.04)", textAlign: "center" },
      input: { width: "100%", border: "1px solid #E6E4DF", borderRadius: 12, padding: "11px 14px", font: "inherit", fontSize: 14, outline: "none", textAlign: "center", letterSpacing: 2, marginTop: 18 },
      btn: { width: "100%", marginTop: 12, background: "#17181A", color: "#fff", border: "none", borderRadius: 999, padding: "11px 18px", font: "inherit", fontWeight: 600, cursor: "pointer", opacity: authBusy ? 0.6 : 1 },
      err: { color: "#D64545", fontSize: 13, marginTop: 12, minHeight: 18 },
    };
    const canSubmit = auth.accounts
      ? authEmail && authPassword && (authView === "signin" || authInvite)
      : passcode;
    return (
      <div style={s.root}>
        {auth.checked && (
          <form style={s.card} onSubmit={submitLogin}>
            <svg width="30" height="30" viewBox="0 0 26 26" fill="none" style={{ marginBottom: 10 }}>
              <rect x="1" y="1" width="24" height="24" rx="8" stroke="#17181A" strokeWidth="2" />
              <circle cx="13" cy="13" r="4.5" fill="#FF6B5E" />
            </svg>
            <div style={{ fontWeight: 700, fontSize: 18, letterSpacing: -0.3 }}>tavus experience builder</div>
            {auth.accounts ? (
              <>
                <div style={{ color: "#7A7B74", fontSize: 13, marginTop: 6 }}>
                  {authView === "signin" ? "Sign in to continue." : "Create your account — you'll need the team invite code."}
                </div>
                <input style={{ ...s.input, letterSpacing: 0, textAlign: "left" }} type="email" autoFocus value={authEmail}
                  onChange={(e) => setAuthEmail(e.target.value)} placeholder="you@company.com" autoComplete="email" />
                <input style={{ ...s.input, marginTop: 8, letterSpacing: 0, textAlign: "left" }} type="password" value={authPassword}
                  onChange={(e) => setAuthPassword(e.target.value)} placeholder={authView === "signup" ? "choose a password (8+ characters)" : "password"}
                  autoComplete={authView === "signup" ? "new-password" : "current-password"} />
                {authView === "signup" && (
                  <input style={{ ...s.input, marginTop: 8 }} type="password" value={authInvite}
                    onChange={(e) => setAuthInvite(e.target.value)} placeholder="invite code" autoComplete="off" />
                )}
                <button style={s.btn} type="submit" disabled={authBusy || !canSubmit}>
                  {authBusy ? "One sec…" : authView === "signin" ? "Sign in" : "Create account"}
                </button>
                <button type="button" style={{ background: "none", border: "none", color: "#7A7B74", fontSize: 12.5, marginTop: 12, cursor: "pointer", font: "inherit" }}
                  onClick={() => { setAuthView((v) => (v === "signin" ? "signup" : "signin")); setAuthErr(""); }}>
                  {authView === "signin" ? "New here? Create an account" : "Already have an account? Sign in"}
                </button>
                <div style={{ color: "#A2A39B", fontSize: 11.5, marginTop: 10, lineHeight: 1.5 }}>
                  {authView === "signin"
                    ? "One account, any laptop — your saved demos follow your email. Lost your password? Ask a signed-in teammate for an invite code, then use \"Create an account\" with your email + that code to set a new one."
                    : "Signing up with an email that already exists + a fresh invite code resets that account's password — demos stay attached to the email."}
                </div>
              </>
            ) : (
              <>
                <div style={{ color: "#7A7B74", fontSize: 13, marginTop: 6 }}>Enter the access code to continue.</div>
                <input style={s.input} type="password" autoFocus value={passcode}
                  onChange={(e) => setPasscode(e.target.value)} placeholder="access code" />
                <button style={s.btn} type="submit" disabled={authBusy || !canSubmit}>
                  {authBusy ? "Checking…" : "Enter"}
                </button>
              </>
            )}
            <div style={s.err}>{authErr}</div>
          </form>
        )}
      </div>
    );
  }

  return (
    <div className="root">
      <style>{BUILDER_CSS}</style>

      {duetRun && (
        <DuetStage
          run={duetRun}
          brand={site.brand}
          maxTurns={Math.max(2, parseInt(duetTurns, 10) || 6)}
          cards={duetPlan ? compileScriptedCards(duetPlan.cards) : compiledScriptedCards}
          labels={duetPlan ? { a: duetPlan.featured?.name || "", b: duetPlan.host?.name || "" } : null}
          openerA={duetOpener.trim()}
          openerB={duetOpenerB.trim()}
          summary={duetNarrIntro.trim()}
          features={duetNarrFeatures.trim()}
          outline={(Array.isArray(duetPlan?.outline) ? duetPlan.outline : []).map((b2) => String(b2).trim()).filter(Boolean)}
          surfaces={{
            deckBeat: duetDeck && docIds.length ? parseInt(duetDeckBeat, 10) || 0 : 0,
            browserBeat: duetBrowser ? parseInt(duetBrowserBeat, 10) || 0 : 0,
            browserShow: duetBrowserShow.trim().slice(0, 200),
          }}
          look={duetLook}
          captions={duetCaptions}
          onExit={() => { setDuetRun(null); setStudioStatus("Duet saved — the .webm downloaded to this machine."); }}
        />
      )}

      {duetRehearse && duetPlan && !duetRun && (
        <DuetRehearsal
          brand={site.brand}
          maxTurns={Math.max(2, parseInt(duetTurns, 10) || 6)}
          cards={compileScriptedCards(duetPlan.cards)}
          labels={{ a: duetPlan.featured?.name || "Featured", b: duetPlan.host?.name || "Host" }}
          outline={(Array.isArray(duetPlan.outline) ? duetPlan.outline : []).map((b2) => String(b2).trim()).filter(Boolean)}
          surfaces={{
            deckOn: duetDeck && docIds.length > 0,
            deckBeat: parseInt(duetDeckBeat, 10) || 0,
            browserOn: duetBrowser,
            browserBeat: parseInt(duetBrowserBeat, 10) || 0,
          }}
          summary={duetNarrIntro.trim()}
          features={duetNarrFeatures.trim()}
          look={duetLook}
          onExit={() => setDuetRehearse(false)}
        />
      )}

      {siteMode && (
        <DemoSite
          site={site}
          conversationUrl={conversation?.conversation_url || null}
          conversationId={conversation?.conversation_id || null}
          controls={studioActive ? { ...controlsConfig, recordingLayout: "stage", studio: true } : controlsConfig}
          experience={studioActive ? {} : experienceConfig}
          onStart={launch}
          onExit={() => {
            setSiteMode(false);
            if (studioActive) endStudioRuntime("Take finished — the MP4 lands in Results (⏺ badge) a minute or two after processing.");
            if (promptOnReturn.current) { promptOnReturn.current = false; promptSaveIfDirty(); }
          }}
          onCallEnd={() => setConversation(null)}
          busy={busy}
        />
      )}

      <header className="topbar">
        <div className="logo-wrap">
          <svg width="26" height="26" viewBox="0 0 26 26" fill="none">
            <rect x="1" y="1" width="24" height="24" rx="8" stroke="var(--text)" strokeWidth="2" />
            <circle cx="13" cy="13" r="4.5" fill="var(--accent)" />
          </svg>
          <span className="logo-word">tavus</span>
          <span className="logo-sub">experience builder</span>
        </div>
        <div className="scenario-bar">
          <button
            className="pill-btn"
            style={{ padding: "8px 16px", fontSize: 13, maxWidth: 280, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}
            onClick={() => { setLibQuery(""); setStep("demos"); }}
            title="Open the demo library — search, load, and manage every saved demo. Name demos “Client / Use case” to group them."
          >
            📁 {activeScenario || "Demos"}{" "}
            <span style={{ color: "var(--muted)" }}>({Array.from(new Set([...Object.keys(scenarios), ...cloudNames])).length})</span>
          </button>
          <input
            style={{ width: 170 }}
            value={scenarioName}
            onChange={(e) => setScenarioName(e.target.value)}
            placeholder={activeScenario ? `save as… (${activeScenario})` : "Client / demo name"}
            onKeyDown={(e) => e.key === "Enter" && saveScenario()}
          />
          <button className="pill-btn" style={{ padding: "8px 14px", fontSize: 13 }} onClick={saveScenario} disabled={!scenarioName.trim() && !activeScenario}>
            {savedFlash ? "Saved ✓" : "Save"}
          </button>
          <input ref={importRef} type="file" accept=".json,application/json" style={{ display: "none" }}
            onChange={(e) => { const f = e.target.files?.[0]; if (f) importScenario(f); e.target.value = ""; }} />
        </div>
        <div className="status-pill">
          {apiKey ? <>key <b>set</b></> : "key not set"} · {palId ? <>pal <b>{palId.slice(0, 10)}</b></> : "no pal"} · {faceId ? <>face <b>{faceId.slice(0, 10)}</b></> : "no face"}
          {auth.required && auth.authed && (
            <> · {auth.email ? auth.email.split("@")[0] : "team"}{" "}
              <button onClick={signOut} title="Sign out"
                style={{ background: "none", border: "none", color: "var(--muted)", cursor: "pointer", font: "inherit", fontSize: 11, textDecoration: "underline", padding: 0 }}>
                sign out
              </button>
            </>
          )}
        </div>
      </header>

      <div className="layout">
        <nav className="rail">
          {STEPS.map((s, i) => (
            <div key={s.id}>
              {(i === 0 || STEPS[i - 1].group !== s.group) && <div className="rail-group">{s.group}</div>}
            <button className={"rail-btn" + (step === s.id ? " active" : "")} onClick={() => setStep(s.id)}>
              <span className="rail-label">{s.label}</span>
              {walkthroughs[s.id]?.url && (
                <span className="rail-play" role="button" tabIndex={0} title={`Watch: ${s.label}`}
                  onClick={(e) => { e.stopPropagation(); openWalkthrough(s.id); }}
                  onKeyDown={(e) => { if (e.key === "Enter") { e.stopPropagation(); openWalkthrough(s.id); } }}>▶</span>
              )}
              {s.id === "start" && (personaBrief.product || site.theme) && <span className="rail-check">●</span>}
              {s.id === "setup" && canLaunch && <span className="rail-check">●</span>}
              {s.id === "persona" && personaDraft.trim() && <span className="rail-check">●</span>}
              {s.id === "guide" && (objectivesEnabled || guardrailsEnabled) && <span className="rail-check">●</span>}
              {s.id === "vision" && visionEnabled && <span className="rail-check">●</span>}
              {s.id === "kb" && knowledgeIds.length > 0 && <span className="rail-check">●</span>}
              {s.id === "speech" && speechEnabled && <span className="rail-check">●</span>}
              {s.id === "tools" && toolsEnabled && toolDefs.length > 0 && <span className="rail-check">●</span>}
              {s.id === "controls" && (maxMinutes || inactivitySeconds || wakePhrase.trim() || interruptButton || guardrailEcho.trim() || recordingEnabled) && <span className="rail-check">●</span>}
              {s.id === "presentation" && presentationEnabled && docIds.length > 0 && <span className="rail-check">●</span>}
              {s.id === "grade" && gradeEnabled && parsedRubric.length > 0 && <span className="rail-check">●</span>}
              {s.id === "launch" && crossBreaks > 0 && <span className="rail-warn" title={`${crossBreaks} will misbehave on this call`}>{crossBreaks}</span>}
              {s.id === "canvas" && canvasEnabled && <span className="rail-check">●</span>}
              {s.id === "site" && site.brand && <span className="rail-check">●</span>}
            </button>
            </div>
          ))}
        </nav>

        <main className="main">
          {step === "demos" && (
            <>
              <h1>Demo library</h1>
              <p className="lede">
                Every saved demo{cloudSync === "on" ? " — synced to your account ☁ —" : ""} grouped by the “Client / Use case” naming convention.
                Give each one a status and a one-line purpose so anyone can tell what it is without loading it.
              </p>
              <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap", maxWidth: 760 }}>
                <input className="lib-search" style={{ flex: "1 1 240px", margin: 0 }} placeholder="Search names and purposes…" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} />
                <button className="pill-btn" onClick={exportScenario}>Export</button>
                <button className="pill-btn" onClick={() => importRef.current?.click()}>Import</button>
              </div>
              {(() => {
                const all = Array.from(new Set([...Object.keys(scenarios), ...cloudNames]));
                const q = libQuery.trim().toLowerCase();
                const filtered = q ? all.filter((n) => n.toLowerCase().includes(q) || String(scenMeta[n]?.desc || "").toLowerCase().includes(q)) : all;
                if (!filtered.length) {
                  return <p className="field-hint">{all.length ? "Nothing matches that search." : "No saved demos yet — build one and hit Save (launching auto-saves too)."}</p>;
                }
                const groupOf = (n) => { const m = n.match(/^(.+?)\s*\/\s*.+$/); return m ? m[1].trim() : ""; };
                const time = (n) => scenMeta[n]?.updatedAt || "";
                const groups = {};
                filtered.forEach((n) => { (groups[groupOf(n)] ||= []).push(n); });
                const keys = Object.keys(groups).sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
                const STATUS = [["draft", "🟡 Draft"], ["ready", "🟢 Ready"], ["shared", "📤 Shared"], ["archived", "🗄 Archived"]];
                return keys.map((g) => (
                  <div key={g || "(ungrouped)"} style={{ marginBottom: 20 }}>
                    {(g || keys.length > 1) && <div className="lib-group" style={{ padding: "0 2px 8px" }}>{g || "Ungrouped"}</div>}
                    {groups[g].sort((a, b) => time(b).localeCompare(time(a)) || a.localeCompare(b)).map((n) => {
                      const cfg = scenarios[n] || null;
                      const meta = scenMeta[n] || {};
                      const t2 = time(n);
                      const badges = demoBadges(cfg);
                      return (
                        <div key={n} className="demolib-card">
                          <div className="demolib-top">
                            <button className="lib-name" style={{ fontSize: 15 }} onClick={() => loadScenario(n)} title={`Load “${n}”`}>
                              {g ? n.replace(/^.+?\s*\/\s*/, "") : n}
                              {activeScenario === n && <span className="lib-active">loaded</span>}
                            </button>
                            {cloudNames.includes(n) && <span title="Synced to your account">☁</span>}
                            {t2 && <span className="lib-time" title={`${t2}${meta.savedBy ? ` · saved by ${meta.savedBy}` : ""}`}>{new Date(t2).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                            <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => loadScenario(n)}>Load</button>
                            <button className="kb-del" title={`Delete “${n}”`} onClick={() => { if (window.confirm(`Delete “${n}”? This removes the saved copy everywhere.`)) deleteScenario(n); }}>✕</button>
                          </div>
                          <input
                            key={`desc-${n}`}
                            className="demolib-desc"
                            defaultValue={meta.desc || ""}
                            placeholder="What is this demo? e.g. “Pricing-objection flow for the exec team — deck + booking”"
                            onBlur={(e) => { const v = e.target.value.trim().slice(0, 300); if (v !== (meta.desc || "")) updateScenarioMeta(n, { desc: v }); }}
                          />
                          <div className="demolib-foot">
                            <div className="seg" style={{ fontSize: 11.5 }}>
                              {STATUS.map(([v, l]) => (
                                <button key={v} className={(meta.status || "draft") === v ? "on" : ""} onClick={() => updateScenarioMeta(n, { status: v })}>{l}</button>
                              ))}
                            </div>
                            <div className="demolib-badges">
                              {(badges || ["☁ cloud copy — load once here to see its loadout"]).map((b, i) => <span key={i}>{b}</span>)}
                            </div>
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
              {STARTER_DEMOS.length > 0 && (
                <div style={{ marginTop: 8, maxWidth: 760 }}>
                  <div className="lib-group" style={{ padding: "0 2px 8px" }}>Starter demos</div>
                  {STARTER_DEMOS.map((d) => (
                    <div key={d.name} className="demolib-card">
                      <div className="demolib-top">
                        <span className="lib-name" style={{ fontSize: 15, cursor: "default" }}>{d.name}</span>
                        <button className="pill-btn primary" style={{ padding: "4px 12px", fontSize: 12 }}
                          onClick={() => {
                            if (scenarios[d.name] && !window.confirm(`You already have “${d.name}”. Replace your copy with the original starter?`)) return;
                            adoptScenario(d.name, d.config, "added from starters");
                            if (d.desc && !scenMeta[d.name]?.desc) updateScenarioMeta(d.name, { desc: d.desc });
                          }}>
                          ＋ Add to my library
                        </button>
                      </div>
                      {d.desc && <p className="field-hint" style={{ margin: "6px 0 0" }}>{d.desc}</p>}
                    </div>
                  ))}
                </div>
              )}
            </>
          )}

          {step === "start" && (
            <>
              <h1>New Demo</h1>
              <p className="lede">
                Answer a few questions, check off the features you want, and Claude builds the whole demo — persona, goals, rules, page, features — all editable afterwards. Only the first question is required.
              </p>

              {(activeScenario || site.brand || personaDraft.trim() || conversationName) && (
                <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap", padding: "10px 14px", border: "1px solid var(--border)", borderRadius: 12, marginBottom: 16, maxWidth: 680, background: "var(--surface)" }}>
                  <span style={{ fontSize: 13 }}>
                    📝 On the bench: <b>{activeScenario || conversationName || site.brand || "an unsaved demo"}</b> — building below starts NEW and won't touch it, but the other steps still show it until you build or clear.
                  </span>
                  <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => startFresh(true)}>💾 Save it & clear the bench</button>
                  <button className="pill-btn ghost" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => startFresh(false)}>Clear without saving</button>
                </div>
              )}

              <div className="idea-box">
                <Field label="1 · What conversation is this replacing?" hint="Every good demo replaces something a human does today — name it.">
                  <input value={demoReplacing} onChange={(e) => setDemoReplacing(e.target.value)}
                    placeholder='e.g. "the first call our SDRs have with inbound leads" · "front-desk check-in at our clinics"' />
                </Field>
                <Field label="2 · Walk me through how a good one goes" hint="Talk like you're training a new hire — the steps, what gets asked, how it ends. 🎙 works best here. The only required answer.">
                  <textarea
                    style={{ minHeight: 96, ...(dictating === "idea" ? { outline: "2px solid var(--accent)" } : {}) }}
                    value={ideaText}
                    onChange={(e) => setIdeaText(e.target.value)}
                    placeholder={"They come in nervous on day one. We say hi, figure out what team they're on, get their laptop sorted, walk benefits enrollment together — people always ask about the healthcare options — and before they leave we book their IT setup session."}
                  />
                  <div style={{ marginTop: 8 }}>
                    <button className={"pill-btn" + (dictating === "idea" ? " primary" : "")} disabled={transcribing}
                      title={`Dictation by ${dictEngineName}`}
                      onClick={() => toggleDictation("idea", (t2) => setIdeaText((v) => (v ? v + " " : "") + t2))}>
                      {dictating === "idea" ? "⏹ Stop — I'm done" : transcribing ? "🎙 Transcribing…" : "🎙 Talk it out"}
                    </button>
                  </div>
                </Field>
                <Field label="3 · When should a real person take over?" hint="The one safety question that matters — it becomes the demo's guardrails and a graceful hand-off. Claude drafts the rest of the rules for you to prune.">
                  <input value={demoHandoff} onChange={(e) => setDemoHandoff(e.target.value)}
                    placeholder='e.g. "anything about salary or visas" · "if they mention fraud or want to cancel"' />
                  <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginTop: 8 }}>
                    <span style={{ fontSize: 13, color: "var(--muted)", flexShrink: 0 }}>🌐 Their website:</span>
                    <input className="mono" style={{ flex: "1 1 240px" }} value={brandUrl} onChange={(e) => setBrandUrl(e.target.value)} placeholder="https://prospect.com — real name, colors, logo (optional)" />
                  </div>
                </Field>
                <Field label="4 · Check off the features" hint="Each one becomes a working part of the demo — drafted now, tuned on its own step later.">
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                    {DEMO_FEATURES.map((f) => (
                      <button key={f.k} type="button"
                        className={"pill-btn" + (demoFeatures[f.k] ? " primary" : "")}
                        style={{ padding: "6px 14px", fontSize: 13 }}
                        title={f.desc}
                        onClick={() => setDemoFeatures((d) => ({ ...d, [f.k]: !d[f.k] }))}>
                        {demoFeatures[f.k] ? "✓ " : ""}{f.label}
                      </button>
                    ))}
                  </div>
                  {demoFeatures.presentation && (
                    <span className="field-hint">
                      With both the deck and Magic Canvas on, the slides lead and cards answer questions — the demo won't card over its own slides.
                      You'll pick the deck document (just the deck, not your whole Knowledge Base) on the Presentation step.
                    </span>
                  )}
                </Field>
                <button className="pill-btn primary big" onClick={async () => {
                  // Theme FIRST: it reads the real site and returns the real
                  // company name + colors, which the draft builds around AND
                  // keeps through the net-new reset.
                  const theme = brandUrl.trim() ? await themeFromUrl() : null;
                  if (ideaText.trim()) await draftDemo(theme?.brand || "", theme);
                }} disabled={ideating || theming || !ideaText.trim()}>
                  {theming ? "Matching their brand…" : ideating ? "Drafting the demo…" : "✨ Build my demo"}
                </button>
                <p className="field-hint" style={{ marginTop: 10 }}>
                  Takes ~30 seconds. The checklist below shows everything it set up; review the persona next — every word stays editable.
                </p>
                {Array.isArray(draftReport) && draftReport.length > 0 && (
                  <div style={{ marginTop: 14, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12, maxWidth: 640 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>What got built</div>
                    {draftReport.map((r, i) => (
                      <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", fontSize: 13, marginBottom: 5 }}>
                        <span style={{ flexShrink: 0 }}>{r.ok ? "✅" : "🔶"}</span>
                        <span>{r.text}</span>
                      </div>
                    ))}
                    {guardrailsText.trim() && (
                      <div style={{ marginTop: 10 }}>
                        <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 6 }}>Rules it drafted — kill any that don't fit</div>
                        {guardrailsText.split("\n").map((l) => l.trim()).filter(Boolean).map((rule, i) => (
                          <div key={i} style={{ display: "flex", gap: 8, alignItems: "center", fontSize: 13, marginBottom: 4 }}>
                            <button className="pill-btn" title="Remove this rule" style={{ padding: "1px 9px", fontSize: 11, flexShrink: 0 }}
                              onClick={() => setGuardrailsText((t2) => t2.split("\n").filter((x) => x.trim() !== rule).join("\n"))}>✕</button>
                            <span>{rule}</span>
                          </div>
                        ))}
                      </div>
                    )}
                    <div style={{ display: "flex", gap: 8, marginTop: 10, flexWrap: "wrap" }}>
                      <button className="pill-btn primary" disabled={!personaDraft.trim() || generating || rehearsal.busy} onClick={runRehearsal}>
                        {rehearsal.busy ? "Rehearsing…" : generating ? "Persona drafting…" : "🎬 Rehearse the conversation"}
                      </button>
                      <button className="pill-btn" onClick={() => setStep("persona")}>Review the persona →</button>
                      <button className="pill-btn" onClick={() => setStep("launch")}>Straight to Launch</button>
                    </div>
                  </div>
                )}
                {rehearsal.err && <p className="field-hint" style={{ color: "#c0392b", marginTop: 8 }}>{rehearsal.err}</p>}
                {Array.isArray(rehearsal.turns) && (
                  <div style={{ marginTop: 14, padding: "12px 14px", border: "1px solid var(--border)", borderRadius: 12, maxWidth: 680 }}>
                    <div style={{ fontSize: 12, fontWeight: 700, letterSpacing: ".08em", textTransform: "uppercase", color: "var(--muted)", marginBottom: 8 }}>
                      Rehearsal — how this demo would play out
                    </div>
                    <div style={{ maxHeight: 320, overflowY: "auto", display: "flex", flexDirection: "column", gap: 8, marginBottom: 10 }}>
                      {rehearsal.turns.map((t2, i) => (
                        <div key={i} style={{
                          alignSelf: t2.role === "visitor" ? "flex-end" : "flex-start",
                          maxWidth: "82%", padding: "8px 12px", borderRadius: 12, fontSize: 13, lineHeight: 1.45,
                          background: t2.role === "visitor" ? "var(--accent)" : "var(--surface)",
                          border: "1px solid var(--border)",
                        }}>
                          <b style={{ fontSize: 10.5, letterSpacing: ".06em", textTransform: "uppercase", opacity: .65, display: "block", marginBottom: 2 }}>
                            {t2.role === "visitor" ? "Visitor" : "AI human"}
                          </b>
                          {t2.text}
                        </div>
                      ))}
                    </div>
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      <input style={{ flex: "1 1 260px", ...(dictating === "rehearse" ? { outline: "2px solid var(--accent)" } : {}) }}
                        value={rehearsal.note} onChange={(e) => setRehearsal((r) => ({ ...r, note: e.target.value }))}
                        onKeyDown={(e) => e.key === "Enter" && rehearsal.note.trim() && !generating && applyRehearsalNotes()}
                        placeholder='Give notes like a coach — "too pushy at the start", "ask about team size before benefits"…' />
                      <button className={"pill-btn" + (dictating === "rehearse" ? " primary" : "")} disabled={transcribing}
                        onClick={() => toggleDictation("rehearse", (t3) => setRehearsal((r) => ({ ...r, note: (r.note ? r.note + " " : "") + t3 })))}>
                        {dictating === "rehearse" ? "⏹ Stop" : "🎙"}
                      </button>
                      <button className="pill-btn primary" disabled={!rehearsal.note.trim() || generating || rehearsal.busy} onClick={applyRehearsalNotes}>
                        {generating ? "Applying…" : "Apply the notes"}
                      </button>
                      <button className="pill-btn" disabled={rehearsal.busy || generating} onClick={runRehearsal}>↻ Rehearse again</button>
                    </div>
                    <p className="field-hint" style={{ margin: "8px 0 0" }}>
                      Notes route to the right place automatically — flow notes reshape the objectives, rule notes the guardrails, tone notes the persona. Rehearse again after applying to see the difference.
                    </p>
                  </div>
                )}
              </div>

              <p className="field-hint" style={{ maxWidth: 560 }}>
                Returning to a demo you saved? Open <b>📁 Demos</b> in the top bar and load it from your library instead.
              </p>
            </>
          )}

          {step === "setup" && (
            <>
              <h1>Account</h1>
              <p className="lede">One-time plumbing: your Tavus account and which AI human to use. Everything else layers on top.</p>
              <Field label="Tavus API key" hint="For production, calls belong on your backend.">
                <input className="mono" type="password" value={apiKey} onChange={(e) => setApiKey(e.target.value)} placeholder="tvs-…" />
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 12, color: "var(--muted)", cursor: "pointer" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={rememberKey} onChange={(e) => toggleRememberKey(e.target.checked)} />
                  Remember key on this device (never included in scenario exports)
                </label>
              </Field>
              <Field label="Face" hint="The face that appears on the call — pick a go-to, or paste any r… face ID.">
                <div className="face-row">
                  {FACE_PRESETS.map((f) => (
                    <button key={f.id} type="button" className={"face-chip" + (faceId.trim() === f.id ? " on" : "")} onClick={() => setFaceId(f.id)} title={f.id}>
                      <span className="face-chip-name">{f.name}</span>
                      <span className="face-chip-vibe">{f.vibe}</span>
                    </button>
                  ))}
                </div>
                <input className="mono" value={faceId} onChange={(e) => setFaceId(e.target.value)} placeholder="r…" />
              </Field>
              <Field label="PAL ID" hint="Filled automatically when you create a persona in the Persona step — or paste an existing p… ID here.">
                <input className="mono" value={palId} onChange={(e) => setPalId(e.target.value)} placeholder="p… (or create one in the Persona step)" />
              </Field>
              <Field label="Languages" hint="Name only the languages you expect — a narrower set is recognised more accurately than a wide one. The call opens in the first, and switches as the visitor does.">
                <div className="lang-picked">
                  {languages.map((code, i) => (
                    <span key={code} className={"lang-chip" + (i === 0 ? " lang-first" : "")}>
                      {i === 0 && <b className="lang-open">opens in</b>}
                      {LANG_NAME(code)}
                      <button type="button" title="Make this the opening language" disabled={i === 0}
                        onClick={() => setLanguages((ls) => [code, ...ls.filter((x) => x !== code)])}>↑</button>
                      <button type="button" title="Remove" disabled={languages.length === 1}
                        onClick={() => setLanguages((ls) => (ls.length > 1 ? ls.filter((x) => x !== code) : ls))}>✕</button>
                    </span>
                  ))}
                </div>
                <input value={langQuery} onChange={(e) => setLangQuery(e.target.value)}
                  placeholder={`Add a language — ${languages.length}/42 chosen`} />
                {langQuery.trim() && (
                  <div className="lang-opts">
                    {LANGUAGES
                      .filter((l) => !languages.includes(l.c) && l.n.toLowerCase().includes(langQuery.trim().toLowerCase()))
                      .slice(0, 8)
                      .map((l) => (
                        <button key={l.c} type="button" className="pill-btn" style={{ padding: "4px 11px", fontSize: 12.5 }}
                          onClick={() => { setLanguages((ls) => (ls.length < 42 ? [...ls, l.c] : ls)); setLangQuery(""); }}>
                          + {l.n} <span style={{ color: "var(--muted)" }}>{l.c}</span>
                        </button>
                      ))}
                  </div>
                )}
              </Field>
              {languages.length > 1 && greeting.trim() && (
                <p className="field-hint" style={{ maxWidth: 560, marginTop: -8, marginBottom: 16 }}>
                  Your scripted greeting plays verbatim before anyone speaks, so write it in <b>{LANG_NAME(languages[0])}</b> —
                  it can't adapt to the visitor the way the rest of the conversation does.
                </p>
              )}
              <Field label="Conversation name" hint="Optional label for your dashboard.">
                <input value={conversationName} onChange={(e) => setConversationName(e.target.value)} placeholder="e.g. Acme demo — presentation" />
              </Field>
              <Field label="Callback URL" hint="Optional webhook. Required if you want Canvas interactions and transcripts delivered server-side.">
                <input className="mono" value={callbackUrl} onChange={(e) => setCallbackUrl(e.target.value)} placeholder="https://yourapp.example.com/webhooks/tavus" />
              </Field>
              <Field label="Custom greeting" hint="Optional. The PAL speaks this first, uninterrupted.">
                <textarea value={greeting} onChange={(e) => setGreeting(e.target.value)} placeholder="Hi — I'm ready to walk you through the deck whenever you are." />
              </Field>

              {auth.required && auth.authed && (
                <>
                  <div className="subhead" style={{ marginTop: 26 }}>👤 Your account</div>
                  {auth.email ? (
                    <>
                      <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                        Signed in as <b>{auth.email}</b>. <b>Your account works on any laptop</b> — open the builder there and sign in
                        with the same email + password; your saved demos are cloud-synced to your account and follow you.
                        The only per-browser thing is the Tavus API key (never stored server-side): paste it once on the new
                        laptop with "Remember key" checked.
                      </p>
                      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", maxWidth: 640 }}>
                        <input type="password" style={{ width: 200 }} value={acctCur} onChange={(e) => setAcctCur(e.target.value)}
                          placeholder="current password" autoComplete="current-password" />
                        <input type="password" style={{ width: 200 }} value={acctNew} onChange={(e) => setAcctNew(e.target.value)}
                          placeholder="new password (8+ chars)" autoComplete="new-password" />
                        <button className="pill-btn" disabled={acctBusy || !acctCur || acctNew.length < 8} onClick={changeAccountPassword}>
                          {acctBusy ? "Changing…" : "Change password"}
                        </button>
                      </div>
                      {acctMsg && <p className="field-hint" style={{ color: acctMsg.ok ? "var(--ok, #2E7D46)" : "var(--danger)", maxWidth: 640 }}>{acctMsg.text}</p>}
                    </>
                  ) : (
                    <p className="field-hint" style={{ maxWidth: 640 }}>
                      You're signed in with the legacy shared code. Create a personal account (sign out, then "Create account" with an
                      invite code from a teammate) to get a cloud-synced demo library that follows you across laptops.
                    </p>
                  )}

                  <div className="skill-head" style={{ marginTop: 26 }}>
                    <div className="subhead" style={{ margin: 0 }}>Team access</div>
                    <button className="pill-btn primary" style={{ padding: "6px 14px", fontSize: 13 }} onClick={createInvite} disabled={inviteCreating}>
                      {inviteCreating ? "Creating…" : "+ New invite code"}
                    </button>
                  </div>
                  <p className="field-hint" style={{ maxWidth: 560, marginBottom: 10 }}>
                    Each code admits <b>one</b> teammate: send it to them, they hit "Create account" on the lock screen with their own
                    email + password + the code. Codes burn on use and expire after 30 days unused — the list shows who used what.
                    <b> Lost password?</b> Mint them a fresh code — signing up again with their email + the code sets a new password
                    and keeps all their demos (they're attached to the email).
                  </p>
                  {inviteError && <p className="field-hint" style={{ color: "var(--danger)" }}>{inviteError}</p>}
                  {invites === null ? (
                    <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={loadInvites} disabled={invitesLoading}>
                      {invitesLoading ? "Loading…" : "Show invites"}
                    </button>
                  ) : invites.length === 0 ? (
                    <p className="field-hint">No invites yet — mint one with the button above.</p>
                  ) : (
                    <div className="kb-list" style={{ maxWidth: 640 }}>
                      {invites.map((inv) => (
                        <div key={inv.code} className="kb-row">
                          <span className="mono" style={{ flex: 1, fontSize: 12.5 }}>{inv.code}</span>
                          {inv.expired ? (
                            <span className="kb-status">expired</span>
                          ) : inv.usedBy ? (
                            <span style={{ color: "var(--muted)", fontSize: 11.5 }} title={inv.usedAt}>used by {inv.usedBy}</span>
                          ) : (
                            <>
                              <span className="kb-status kb-ready">unused</span>
                              <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }}
                                onClick={() => copy(inv.code, `inv-${inv.code}`)}>
                                {copied === `inv-${inv.code}` ? "Copied" : "Copy"}
                              </button>
                            </>
                          )}
                        </div>
                      ))}
                    </div>
                  )}
                  {teamUsers && teamUsers.length > 0 && (
                    <>
                      <div className="subhead" style={{ marginTop: 18 }}>Accounts on this deployment</div>
                      <div className="kb-list" style={{ maxWidth: 640 }}>
                        {teamUsers.map((u) => (
                          <div key={u.email} className="kb-row">
                            <span style={{ flex: 1, fontSize: 12.5 }}>{u.email}{u.email === auth.email ? " — you" : ""}</span>
                            <span style={{ color: "var(--muted)", fontSize: 11.5 }}>
                              {u.resetAt ? `password reset ${String(u.resetAt).slice(0, 10)}` : u.createdAt ? `since ${String(u.createdAt).slice(0, 10)}` : ""}
                            </span>
                          </div>
                        ))}
                      </div>
                    </>
                  )}
                </>
              )}

              <div className="subhead" style={{ marginTop: 26 }}>🎬 Feature walkthroughs</div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                Give any step a ▶ in the left rail: a short video of that feature in action (a Studio take, a call recording, a screen capture — up to 50MB), with narration spoken live by the same voice stack as your calls. Shared with the whole team.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center", marginBottom: 8, maxWidth: 680 }}>
                <select style={{ width: "auto" }} value={wtEditStep} onChange={(e) => setWtEditStep(e.target.value)}>
                  {STEPS.map((s) => <option key={s.id} value={s.id}>{walkthroughs[s.id]?.url ? "▶ " : ""}{s.label}</option>)}
                </select>
                <button className="pill-btn" disabled={!!wtUploading} onClick={() => wtFileRef.current?.click()}>
                  {wtUploading ? "Uploading…" : "⬆ Upload video"}
                </button>
                {wtDraft.url && <button className="pill-btn" onClick={() => openWalkthrough(wtEditStep)}>▶ Preview</button>}
                {walkthroughs[wtEditStep]?.url && <button className="pill-btn ghost" onClick={() => deleteWalkthrough(wtEditStep)}>✕ Remove</button>}
              </div>
              <input ref={wtFileRef} type="file" accept="video/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadWalkthroughVideo(wtEditStep, f); e.target.value = ""; }} />
              <Field label="Video URL" hint="Filled by the upload — or paste any public https video link (an S3 recording, a Loom download, …).">
                <input className="mono" value={wtDraft.url} onChange={(e) => setWtDraft((d) => ({ ...d, url: e.target.value }))} placeholder="https://…" />
              </Field>
              <Field label="Narration (optional)" hint="Spoken over the video by your Tavus voice stack when someone hits ▶ — about 600 characters ≈ 45 seconds plays. Viewers can mute it.">
                <textarea style={{ minHeight: 70 }} value={wtDraft.narration} onChange={(e) => setWtDraft((d) => ({ ...d, narration: e.target.value }))}
                  placeholder="This is Magic Canvas — watch the card land the moment she says 'pricing'…" />
              </Field>
              <button className="pill-btn primary" style={{ marginBottom: 8 }} disabled={!wtDraft.url.trim()} onClick={() => saveWalkthrough(wtEditStep, wtDraft)}>
                💾 Save walkthrough
              </button>
            </>
          )}

          {step === "human" && (() => {
            /* The anatomy hub: the AI human as the navigation. Each body part
               is a live hotspot — shows what's configured, routes to its step.
               Built for showing the APP itself: "click the eyes to give it
               sight" lands better than any settings list. */
            /* The parts ARE the pitch: a digital human is architected the way
               a person works in a conversation. Verb-first, layman-first —
               every label answers "what does it DO like a human?" */
            const parts = [
              { k: "mind", icon: "🧠", label: "Thinks", desc: "Has a personality and a way of talking — who this human is.", target: "persona", on: !!personaDraft.trim(), status: personaDraft.trim() ? (personaAttached ? "personality written & attached" : "written — attach on Persona") : "no personality yet", x: 50, y: 5, side: "left" },
              { k: "memory", icon: "💭", label: "Remembers you", desc: "Next call, it picks up where you left off — like a person would.", target: "kb", on: memoryEnabled, status: memoryEnabled ? (memoryMode === "visitor" ? "remembers each visitor" : "one shared memory") : "forgets after each call", x: 39, y: 9.5, side: "left" },
              { k: "eyes", icon: "👁", label: "Sees you", desc: "Reacts to what's on camera — a document held up, a second person, your mood.", target: "vision", on: visionEnabled, status: visionEnabled ? "watching & reacting" : "not looking", x: 50, y: 11.5, side: "left" },
              { k: "mouth", icon: "💬", label: "Speaks", desc: "A real voice with the right accent — and your product names said right.", target: "speech", on: !!(externalVoiceId.trim() || pronunciationText.trim()), status: externalVoiceId.trim() ? (externalVoiceName || "voice picked") : "face's default voice", x: 50, y: 15.5, side: "left" },
              { k: "face", icon: "👤", label: "Face", desc: "The human face on the call — eye contact, expressions, presence.", target: "setup", on: !!faceId.trim(), status: faceId.trim() ? (FACE_PRESETS.find((f) => f.id === faceId.trim())?.name || "custom face") : "not picked", x: 43, y: 16.5, side: "right" },
              { k: "ears", icon: "👂", label: "Hears you", desc: "Sparrow turn-taking — knows when to talk, when to yield, when you're just thinking.", target: "controls", on: !!(sparrowModel || sparrowPatience || interruptButton || wakePhrase.trim() || inactivitySeconds), status: [sparrowModel, interruptButton && "interruptible", wakePhrase.trim() && "wake phrase"].filter(Boolean).join(" · ") || "default listening", x: 61.5, y: 13, side: "right" },
              { k: "gut", icon: "🫀", label: "Instincts", desc: "A great rep's training: where to steer the conversation, and what it must never say.", target: "guide", on: objectivesEnabled || guardrailsEnabled, status: [objectivesEnabled && `${parseObjectives(objectivesText, confirmationMode).length}-step instinct`, guardrailsEnabled && "hard lines set"].filter(Boolean).join(" · ") || "untrained", x: 50, y: 42, side: "right" },
              { k: "knowledge", icon: "📖", label: "Did the homework", desc: "Read your docs before the meeting — answers come from them, not thin air.", target: "kb", on: !!knowledgeIdsRaw.trim(), status: knowledgeIdsRaw.trim() ? "docs in hand" : "no reading assigned", x: 28.5, y: 42.5, side: "left" },
              { k: "hands", icon: "✋", label: "Shows you things", desc: "Doesn't just talk — presents a deck, drives a live browser, puts cards on screen.", target: "presentation", on: presentationEnabled || browserUseEnabled || canvasEnabled, status: [presentationEnabled && "deck", browserUseEnabled && "browser", canvasEnabled && "cards"].filter(Boolean).join(" + ") || "empty-handed", x: 75.5, y: 47, side: "right" },
            ];
            // Descriptors only — status/on-off lines crowded the demo screen.
            const card = (p) => (
              <button key={p.k} type="button"
                className={"human-card" + (humanHover === p.k ? " hot" : "")}
                onMouseEnter={() => setHumanHover(p.k)} onMouseLeave={() => setHumanHover("")}
                onClick={() => setStep(p.target)}>
                <span className="human-card-icon">{p.icon}</span>
                <span style={{ minWidth: 0 }}>
                  <b>{p.label}</b>
                  <small>{p.desc}</small>
                </span>
              </button>
            );
            return (
              <>
                <h1>Your AI human</h1>
                <p className="lede">
                  It's architected the way a person works in a conversation — it sees you, hears you, remembers you, did the homework, and knows where the conversation should go. Click any part to configure it.
                </p>
                <div className="human-hub">
                  <div className="human-col">{parts.filter((p) => p.side === "left").map(card)}</div>
                  <div className="human-fig">
                    <svg viewBox="0 0 200 360" aria-hidden="true">
                      <defs>
                        <radialGradient id="hglow" cx="50%" cy="28%" r="72%">
                          <stop offset="0%" stopColor="var(--accent)" stopOpacity="0.28" />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0" />
                        </radialGradient>
                        <linearGradient id="hshirt" x1="0" y1="0" x2="0" y2="1">
                          <stop offset="0%" stopColor="var(--accent)" />
                          <stop offset="100%" stopColor="var(--accent)" stopOpacity="0.8" />
                        </linearGradient>
                      </defs>
                      <ellipse cx="100" cy="125" rx="96" ry="118" fill="url(#hglow)" />
                      {/* legs + shoes */}
                      <path d="M80 186 L76 334 L95 334 L98 224 L102 224 L105 334 L124 334 L120 186 Z" fill="#2b2f3a" />
                      <path d="M72 334 h25 a4 4 0 0 1 4 4 v3 h-33 v-2 a5 5 0 0 1 4-5 Z" fill="#1c1f27" />
                      <path d="M103 334 h25 a5 5 0 0 1 4 5 v2 h-33 v-3 a4 4 0 0 1 4-4 Z" fill="#1c1f27" />
                      {/* right arm: relaxed out, open palm mid-gesture */}
                      <path d="M136 94 C 148 102 154 118 156 136 C 158 150 156 160 153 166 L 140 161 C 141 146 138 122 130 108 Z" fill="url(#hshirt)" />
                      <ellipse cx="151" cy="170" rx="8.5" ry="10" fill="#e9bd93" />
                      <path d="M145 162 q6 -4 12 -1" stroke="#d8a577" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                      {/* left arm: bent, holding the book */}
                      <path d="M64 94 C 54 102 48 116 46 132 C 45 142 46 150 49 156 L 62 150 C 61 136 63 118 70 106 Z" fill="url(#hshirt)" />
                      {/* the homework: a real book in hand */}
                      <g transform="rotate(-9 57 152)">
                        <rect x="40" y="139" width="36" height="25" rx="3" fill="#8a4a3b" />
                        <rect x="43" y="142" width="30" height="19" rx="2" fill="#fdf7f0" />
                        <line x1="58" y1="142" x2="58" y2="161" stroke="#d9cfc2" strokeWidth="1.4" />
                        <line x1="47" y1="148" x2="55" y2="148" stroke="#cfc4b4" strokeWidth="1.2" />
                        <line x1="61" y1="148" x2="69" y2="148" stroke="#cfc4b4" strokeWidth="1.2" />
                        <line x1="47" y1="153" x2="55" y2="153" stroke="#cfc4b4" strokeWidth="1.2" />
                        <line x1="61" y1="153" x2="69" y2="153" stroke="#cfc4b4" strokeWidth="1.2" />
                      </g>
                      <circle cx="66" cy="158" r="7" fill="#e9bd93" />
                      {/* torso */}
                      <path d="M100 78 C 82 78 70 85 65 96 C 59 109 59 132 61 154 C 62 170 65 181 67 188 L 133 188 C 135 181 138 170 139 154 C 141 132 141 109 135 96 C 130 85 118 78 100 78 Z" fill="url(#hshirt)" />
                      {/* collar + placket */}
                      <path d="M89 78 L100 93 L111 78 Z" fill="#fdf7f0" />
                      <line x1="100" y1="94" x2="100" y2="120" stroke="rgba(255,255,255,.35)" strokeWidth="2" />
                      {/* neck + head */}
                      <path d="M92 62 h16 v12 c0 5 -3.5 8 -8 8 s-8 -3 -8 -8 Z" fill="#e2b489" />
                      <ellipse cx="100" cy="44" rx="22" ry="25" fill="#ecc39a" />
                      {/* ears */}
                      <ellipse cx="78" cy="46" rx="4.5" ry="6" fill="#e6b88d" />
                      <ellipse cx="122" cy="46" rx="4.5" ry="6" fill="#e6b88d" />
                      <path d="M120.5 44 q2.5 2 1 5" stroke="#c9976b" strokeWidth="1.2" fill="none" strokeLinecap="round" />
                      {/* hair: side part, natural hairline */}
                      <path d="M78 42 C 76 24 84 12 100 12 C 116 12 124 22 122 40 C 121 32 116 26 108 25 C 104 24.6 99 25.4 93 27 C 86 29 80 34 78 42 Z" fill="#3d3229" />
                      {/* face: eyes, brows, nose hint, warm smile */}
                      <circle cx="92" cy="42" r="2.5" fill="#2c2620" />
                      <circle cx="108" cy="42" r="2.5" fill="#2c2620" />
                      <path d="M87.5 35.5 q4.5 -3 9 -1" stroke="#3d3229" strokeWidth="1.9" fill="none" strokeLinecap="round" />
                      <path d="M103.5 34.5 q4.5 -2 9 1" stroke="#3d3229" strokeWidth="1.9" fill="none" strokeLinecap="round" />
                      <path d="M100 45 q-1.6 4.5 1 7" stroke="#d8a577" strokeWidth="1.6" fill="none" strokeLinecap="round" />
                      <path d="M93 56 Q100 61.5 107 56" stroke="#b9805a" strokeWidth="2.3" fill="none" strokeLinecap="round" />
                      <ellipse cx="100" cy="348" rx="52" ry="5" fill="rgba(10,12,16,.2)" />
                    </svg>
                    {parts.map((p) => (
                      <button key={p.k} type="button"
                        className={"human-dot" + (humanHover === p.k ? " hot" : "")}
                        style={{ left: `${p.x}%`, top: `${p.y}%` }}
                        title={p.label}
                        onMouseEnter={() => setHumanHover(p.k)} onMouseLeave={() => setHumanHover("")}
                        onClick={() => setStep(p.target)} />
                    ))}
                  </div>
                  <div className="human-col">{parts.filter((p) => p.side === "right").map(card)}</div>
                </div>
                <p className="field-hint" style={{ maxWidth: 620, marginTop: 14 }}>
                  A great screen to leave up while you talk through what an AI human is made of — click the part you're describing.
                </p>
              </>
            );
          })()}

          {step === "persona" && (
            <>
              <h1>Persona</h1>
              <p className="lede">
                {personaMode === "paste"
                  ? "Bring your own system prompt — written in Claude, another tool, or by hand. Paste it below and attach; that exact text becomes the persona. Revise-with-feedback and prompt history work on it just like a generated draft."
                  : "Describe the demo in plain English and Claude drafts the PAL's system prompt — voice-first, demo-ready, aware of your objectives, guardrails, and Canvas setup. Review and edit the draft, then attach it. Like objectives, the prompt lives on the PAL itself and persists across conversations."}
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                {[["brief", "✨ Draft it with Claude"], ["paste", "✍️ I have my own prompt"]].map(([v, l]) => (
                  <button key={v} type="button" className={"pill-btn" + (personaMode === v ? " primary" : "")} style={{ padding: "5px 14px", fontSize: 12.5 }} onClick={() => setPersonaMode(v)}>{l}</button>
                ))}
              </div>
              {personaMode === "brief" && (<>
              <Field label="Describe it" hint="One box — type it, or 🎙 talk it out: ramble about the product, who it talks to, the flow you want, the rules, the personality. “Spin it all up” cleans the brain-dump into a brief, writes the Objectives & Guardrails steps from it, and drafts the prompt on top — one breath, whole demo.">
                <textarea
                  style={{ minHeight: 110, ...(dictating === "vibe" ? { outline: "2px solid var(--accent)" } : {}) }}
                  value={personaBrief.vibe || ""}
                  onChange={(e) => setBriefField("vibe", e.target.value)}
                  placeholder={"e.g. A warm, sharp intake specialist for Acme Health demoing AI patient intake to clinic ops leads. Wins the call when they see the 5-minute setup and book a follow-up. Confident, a little playful, never salesy — lights up when showing the product."}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    className={"pill-btn" + (dictating === "vibe" ? " primary" : "")}
                    onClick={() => toggleDictation("vibe", (t2) => setPersonaBrief((b) => ({ ...b, vibe: (b.vibe ? b.vibe + " " : "") + t2 })))}
                    disabled={transcribing}
                    title={`Dictation by ${dictEngineName}`}
                  >
                    {dictating === "vibe" ? "⏹ Stop — I'm done talking" : transcribing ? "🎙 Transcribing…" : "🎙 Talk it out"}
                  </button>
                  <button className="pill-btn primary" onClick={spinUp} disabled={spinBusy || generating || transcribing || !String(personaBrief.vibe || "").trim()}>
                    {spinBusy ? "Spinning up…" : "✨ Spin it all up — prompt + objectives + guardrails"}
                  </button>
                </div>
              </Field>
              <details style={{ marginBottom: 16, maxWidth: 640 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                  Fine-tune (optional) — pin down specifics the one-liner shouldn't carry
                </summary>
                <div style={{ paddingTop: 12 }}>
                  <Field label="Product / company">
                    <input value={personaBrief.product} onChange={(e) => setBriefField("product", e.target.value)} placeholder="Acme Health — AI-powered patient intake for clinics" />
                  </Field>
                  <Field label="Audience">
                    <input value={personaBrief.audience} onChange={(e) => setBriefField("audience", e.target.value)} placeholder="Clinic operations leads evaluating intake tools" />
                  </Field>
                  <Field label="Goal of the conversation">
                    <input value={personaBrief.goal} onChange={(e) => setBriefField("goal", e.target.value)} placeholder="Qualify their needs and book a follow-up with sales" />
                  </Field>
                  <Field label="Tone / personality">
                    <input value={personaBrief.tone} onChange={(e) => setBriefField("tone", e.target.value)} placeholder="Warm, expert, gets to the point" />
                  </Field>
                  <Field label="Emotional vibe" hint="How it should feel and react — Tavus performs this through the voice and face automatically.">
                    <textarea style={{ minHeight: 64 }} value={personaBrief.emotions} onChange={(e) => setBriefField("emotions", e.target.value)}
                      placeholder={"Warm and upbeat by default. Gets genuinely excited showing the product. If the visitor sounds frustrated, slows down and reassures."} />
                  </Field>
                  <p className="field-hint" style={{ margin: "0 0 4px" }}>
                    Looking for “must cover” / “must avoid”? They moved: conversation steps live on <b>Objectives &amp; Guardrails</b> — one home, no duplicates — and the generator always reads them from there.
                  </p>
                </div>
              </details>

              <button className="pill-btn primary" style={{ marginBottom: 18 }} onClick={generatePersona} disabled={generating}>
                {generating && !personaDraft ? "Drafting…" : personaDraft ? "Regenerate" : "Generate with Claude"}
              </button>
              </>)}

              <Field label={personaMode === "paste" ? "Your system prompt" : "System prompt draft"} hint={personaMode === "paste"
                ? "Paste the full prompt here — it's attached verbatim, nothing is rewritten. Tip: prompts following the Tavus Prompting Guide structure (Identity & Role, Personality, Conversation Flow…) perform best on video calls."
                : personaDraft
                  ? "Edit freely — this exact text becomes the persona."
                  : "Generated here; you can also paste or write your own."}>
                <textarea
                  style={{ minHeight: 260, fontSize: 13, lineHeight: 1.6 }}
                  value={personaDraft}
                  onChange={(e) => { setPersonaDraft(e.target.value); setPersonaAttached(false); }}
                  placeholder="You are…"
                />
              </Field>

              {personaDraft.trim() && (
                <Field label="Revise with feedback" hint='Watched a call and want it different? Say what to change — "less salesy", "stop looping on the email ask", "book the demo earlier" — and Claude edits the draft above AND the Objectives & Guardrails step together (objectives drive the conversation flow, so flow fixes land there, not just in the prompt). Re-attach the prompt afterwards; updated objectives re-attach on your next launch.'>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={personaFeedback} onChange={(e) => setPersonaFeedback(e.target.value)}
                      placeholder="e.g. Too formal — make it warmer, and stop asking two questions in a row"
                      onKeyDown={(e) => e.key === "Enter" && !generating && revisePersona()} />
                    <button className="pill-btn primary" style={{ flexShrink: 0 }} onClick={revisePersona} disabled={generating || !personaFeedback.trim()}>
                      {generating ? "Revising…" : "Revise"}
                    </button>
                  </div>
                </Field>
              )}

              {promptVersions.length > 0 && (
                <details style={{ marginBottom: 22 }}>
                  <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>
                    🕘 Prompt history ({promptVersions.length}) — every generate, revision, and attach is saved
                  </summary>
                  <div className="kb-list" style={{ maxWidth: 640, marginTop: 10 }}>
                    {promptVersions.map((v, i) => (
                      <div key={`${v.at}-${i}`} className="kb-row" style={{ alignItems: "flex-start" }}>
                        <span style={{ flex: 1, fontSize: 12.5, minWidth: 0 }}>
                          <b>{v.source}</b>{v.attached ? <span style={{ color: "var(--ok)" }}> · attached ✓</span> : ""}
                          <span style={{ color: "var(--muted)" }}> · {String(v.at).slice(5, 16).replace("T", " ")} · {v.text.split(/\s+/).length} words</span>
                          <div style={{ color: "var(--muted)", fontSize: 11.5, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.text.slice(0, 120)}</div>
                        </span>
                        <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                          disabled={personaDraft.trim() === v.text}
                          onClick={() => restorePromptVersion(v)}>
                          {personaDraft.trim() === v.text ? "Current" : "Restore"}
                        </button>
                      </div>
                    ))}
                  </div>
                </details>
              )}

              <div className="subhead">Create the persona</div>
              <Field label="Face" hint="Every Phoenix-4 default face, right here — no trip to the platform UI. Picking one fills the Face ID everywhere (Setup included); paste a custom r… ID below if you have one.">
                <div className="face-row">
                  {FACE_PRESETS.map((f) => (
                    <button key={f.id} type="button" className={"face-chip" + (faceId.trim() === f.id ? " on" : "")} onClick={() => setFaceId(f.id)} title={f.id}>
                      <span className="face-chip-name">{f.name}</span>
                      <span className="face-chip-vibe">{f.vibe}</span>
                    </button>
                  ))}
                </div>
                <input className="mono" value={faceId} onChange={(e) => setFaceId(e.target.value)} placeholder="r… (or pick a face above)" />
              </Field>
              <Field label="" hint="Creates a brand-new PAL with this prompt as its brain and the face above, and sets it as your PAL ID — the demo auto-saves so the PAL stays tied to it.">
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                  <input style={{ flex: "1 1 180px" }} value={newPalName} onChange={(e) => setNewPalName(e.target.value)} placeholder="Name it — e.g. Acme Sales Expert"
                    onKeyDown={(e) => e.key === "Enter" && !creatingPal && createPal()} />
                  <select style={{ width: "auto", flex: "0 1 auto" }} value={palLlm} onChange={(e) => setPalLlm(e.target.value)} title="The LLM that powers this PAL">
                    {PAL_LLMS.map((m) => <option key={m.v} value={m.v}>{m.label}</option>)}
                  </select>
                  <button className="pill-btn primary" style={{ flexShrink: 0 }} onClick={createPal} disabled={creatingPal || !newPalName.trim()}>
                    {creatingPal ? "Creating…" : "Create PAL"}
                  </button>
                </div>
                <span className="field-hint">{PAL_LLMS.find((m) => m.v === palLlm)?.desc}</span>
              </Field>

              <div className="subhead" style={{ marginTop: 8 }}>…or update an existing PAL</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 10 }}>
                {palId.trim() ? <>Attaches this prompt to <span className="mono">{palId.trim()}</span> (replaces its current one).</> : "Paste a PAL ID in Setup first."}
              </p>
              <button className="pill-btn" onClick={attachPersona} disabled={generating || personaAttached || !personaDraft.trim() || !palId.trim()}>
                {personaAttached ? "Attached ✓" : "Attach to existing PAL"}
              </button>

              <div className="subhead" style={{ marginTop: 26 }}>Test drive — no video</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 10 }}>
                Type at your PAL before booting a real call. Runs the exact config on the PAL — persona, goals, rules, knowledge —
                just without the video pipeline, so turns come back in seconds. <b>Tests what's attached</b>: hit Attach above after
                drafting or revising, or you'll be talking to the old prompt. Covers persona, goals, rules, and knowledge —
                video-only skills (slides, canvas) don't run in text mode. Billed like conversation time (a text turn is tiny).
              </p>
              {!chatConvId ? (
                <>
                  <button className="pill-btn primary" onClick={startTestDrive} disabled={chatBusy || !palId.trim() || !apiKey.trim()}>
                    {chatBusy ? "Starting…" : "▶ Start test drive"}
                  </button>
                  {(!apiKey.trim() || !palId.trim()) && (
                    <p className="field-hint" style={{ marginTop: 8 }}>
                      Grayed out because {[!apiKey.trim() && "the Tavus API key", !palId.trim() && "the PAL ID"].filter(Boolean).join(" and ")}{" "}
                      {!apiKey.trim() && !palId.trim() ? "are" : "is"} missing — set it on the <b>Account</b> step (or load a saved scenario from the top bar).
                    </p>
                  )}
                  {chatError && <p className="field-hint" style={{ color: "var(--danger)", marginTop: 8, maxWidth: 560 }}>{chatError}</p>}
                </>
              ) : (
                <div style={{ maxWidth: 640 }}>
                  <div className="transcript" style={{ maxHeight: 300, overflowY: "auto", marginBottom: 10 }}>
                    {chatLog.length === 0 && <p className="field-hint" style={{ padding: 10 }}>Say something — "hi" is a fine start.</p>}
                    {chatLog.map((m, i) => (
                      <div key={i} className={`t-row t-${m.role === "pal" ? "assistant" : m.role}`}>
                        <span className="t-role">{m.role === "pal" ? (site.brand || "PAL") : m.role === "user" ? "You" : "!"}</span>
                        <span>{m.text}</span>
                      </div>
                    ))}
                    {chatBusy && <div className="t-row t-assistant"><span className="t-role">{site.brand || "PAL"}</span><span style={{ opacity: 0.5 }}>thinking…</span></div>}
                  </div>
                  <div style={{ display: "flex", gap: 8 }}>
                    <input value={chatInput} onChange={(e) => setChatInput(e.target.value)}
                      placeholder="Try the openers a real visitor would use…"
                      onKeyDown={(e) => e.key === "Enter" && sendTestTurn()} disabled={chatBusy} />
                    <button className="pill-btn primary" style={{ flexShrink: 0 }} onClick={sendTestTurn} disabled={chatBusy || !chatInput.trim()}>Send</button>
                    <button className="pill-btn" style={{ flexShrink: 0 }} onClick={endTestDrive}>End</button>
                  </div>
                </div>
              )}
            </>
          )}

          {step === "guide" && (
            <>
              <h1>Objectives &amp; Guardrails</h1>
              <p className="lede">
                Tavus's flow engine: <b>Objectives</b> drive the conversation through your steps mechanically (with if/then branching),
                and <b>Guardrails</b> keep it safe and on-brand. Both attach to the PAL and persist for every future conversation until you change them.
              </p>

              <div className="skill-head">
                <div className="subhead" style={{ margin: 0 }}>Objectives</div>
                <Toggle on={objectivesEnabled} onChange={setObjectivesEnabled} />
              </div>
              <Field label="Describe the flow" hint="Type it or 🎙 talk it — “first ask which product, if budget's under 10k pitch the starter tier, end by booking a meeting”. Claude structures it into the decision tree below; rules you mention land in Guardrails. Existing steps get revised, never clobbered.">
                <textarea
                  style={{ minHeight: 64, ...(dictating === "flow" ? { outline: "2px solid var(--accent)" } : {}) }}
                  disabled={!objectivesEnabled}
                  value={flowDesc}
                  onChange={(e) => setFlowDesc(e.target.value)}
                  placeholder="First figure out which product they care about, then budget — under $10k pitch the starter tier. No timeline? Dig into urgency. Get their email, end by booking a follow-up."
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    className={"pill-btn" + (dictating === "flow" ? " primary" : "")}
                    disabled={!objectivesEnabled || transcribing}
                    title={`Dictation by ${dictEngineName}`}
                    onClick={() => toggleDictation("flow", (t2) => setFlowDesc((v) => (v ? v + " " : "") + t2))}
                  >
                    {dictating === "flow" ? "⏹ Stop — I'm done" : transcribing ? "🎙 Transcribing…" : "🎙 Talk it out"}
                  </button>
                  <button className="pill-btn primary" onClick={structureFlow} disabled={flowBusy || !objectivesEnabled || !flowDesc.trim()}>
                    {flowBusy ? "Structuring…" : "✨ Structure the flow"}
                  </button>
                </div>
              </Field>
              {objectivesEnabled && objectivesText.trim() ? (
                <FlowDiagram text={objectivesText} />
              ) : (
                <p className="field-hint" style={{ maxWidth: 600, marginBottom: 10 }}>
                  Best for templated flows (intake, interview, qualification) — describe one above and the decision tree appears here. Free-flowing conversations usually don't need objectives.
                </p>
              )}
              <details style={{ maxWidth: 640, marginBottom: 10 }}>
                <summary style={{ cursor: "pointer", fontSize: 13, fontWeight: 600, color: "var(--muted)" }}>✏️ Edit the steps as text (advanced)</summary>
                <p className="field-hint" style={{ margin: "10px 0 8px" }}>
                  One objective per line, top to bottom. <b>Branch with if/then</b>: indent a line as <span className="mono">if &lt;condition&gt; -&gt; &lt;detour objective&gt;</span> under
                  a step — the detour rejoins the main flow (a catch-all is added for you). Append <span className="mono">| var</span> to capture data. The tree above updates as you type.
                </p>
                <textarea
                  style={{ minHeight: 130, width: "100%" }}
                  disabled={!objectivesEnabled}
                  value={objectivesText}
                  onChange={(e) => setObjectivesText(e.target.value)}
                  placeholder={"Ask which product they're evaluating\nUnderstand their budget and timeline\n  if budget is under $10k -> Suggest the starter tier and check it fits\n  if they have no timeline -> Explore what would make this urgent\nAsk who else is involved in the decision\nBook a follow-up meeting"}
                />
              </details>
              {objectivesEnabled && (
                <Field label="Completion check">
                  <div className="seg">
                    <button className={confirmationMode === "auto" ? "on" : ""} onClick={() => setConfirmationMode("auto")}>Auto</button>
                    <button className={confirmationMode === "manual" ? "on" : ""} onClick={() => setConfirmationMode("manual")}>Manual</button>
                  </div>
                  <span className="field-hint">Auto: the evaluator LLM decides when each step is complete. Manual: the participant is asked to confirm.</span>
                </Field>
              )}

              <div className="skill-head" style={{ marginTop: 18 }}>
                <div className="subhead" style={{ margin: 0 }}>Guardrails</div>
                <Toggle on={guardrailsEnabled} onChange={setGuardrailsEnabled} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 8 }}>
                One guardrail per line — what the PAL must never do, or what should be flagged. Add [visual] to a line for camera-enforced rules (e.g. "More than one person is visible [visual]"). Violations fire real-time events and hit your callback URL.
              </p>
              <Field label="" hint={guardrailsEnabled && guardrailsParsed.length
                ? `Will create ${guardrailsParsed.length} guardrail${guardrailsParsed.length > 1 ? "s" : ""} and merge with any already on the PAL.`
                : "Guardrails steer behavior and flag violations — they are guidance, not a hard guarantee."}>
                <textarea
                  style={{ minHeight: 110 }}
                  disabled={!guardrailsEnabled}
                  value={guardrailsText}
                  onChange={(e) => setGuardrailsText(e.target.value)}
                  placeholder={"Never discuss competitors or their products\nNever quote custom pricing — direct pricing questions to the sales team\nUser is sharing credit card numbers or passwords\nMore than one person is visible in camera view [visual]"}
                />
              </Field>
              <Field label="When a rule is hit, say… (optional)" hint="Spoken word-for-word the moment any rule above triggers. Leave blank for no spoken reaction.">
                <textarea disabled={!guardrailsEnabled} value={guardrailEcho} onChange={(e) => setGuardrailEcho(e.target.value)}
                  placeholder="That's outside what I can help with here — but I'm happy to get you to the right person." />
              </Field>
            </>
          )}

          {step === "vision" && (
            <>
              <div className="skill-head">
                <h1>Perception</h1>
                <Toggle on={visionEnabled} onChange={setVisionEnabled} />
              </div>
              <p className="lede">
                Give the PAL eyes and ears. Describe in plain English what it should notice — on camera, on a shared screen, or in the user's tone — and Claude turns that into the checks Tavus's perception model (raven-1) runs continuously during the call. Like objectives, this attaches to the PAL on launch and persists.
              </p>
              <Field label="What should it notice?" hint="Plain English — Claude converts this into precise visual and audio checks below.">
                <textarea
                  style={{ minHeight: 90 }}
                  disabled={!visionEnabled}
                  value={visionVibe}
                  onChange={(e) => setVisionVibe(e.target.value)}
                  placeholder={"Notice when they hold up their ID or a document, when someone else walks into frame, and when they sound confused or frustrated so it can slow down and help."}
                />
              </Field>
              <div className="skill-head" style={{ marginTop: 4 }}>
                <div className="subhead" style={{ margin: 0 }}>Frames of the real scene</div>
                <span className="field-hint" style={{ margin: 0 }}>
                  {visionShots.filter(Boolean).length || "no"} frame{visionShots.filter(Boolean).length === 1 ? "" : "s"} · never saved
                </span>
              </div>
              <p className="field-hint" style={{ maxWidth: 620, marginBottom: 10 }}>
                Without these, Claude is writing checks for a scene it has never seen, and you get generic ones —
                "is the user showing something to the camera". Upload a photo of the actual setup, a screenshot of what
                they'll share, or a still from a previous call, and the checks name what's really in shot. Add as many
                angles as the scene needs — frames are downscaled on the way in, and you'll be told if the set outgrows
                what one request can carry.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 12 }}>
                <button className="pill-btn" onClick={() => visionFileRef.current?.click()} disabled={!visionEnabled}>⬆ Add frames</button>
                {visionShots.filter(Boolean).length > 0 && (
                  <button className="pill-btn ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setVisionShots([])}>✕ Clear</button>
                )}
                <input ref={visionFileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                  onChange={(e) => { onVisionFiles(e.target.files); e.target.value = ""; }} />
              </div>
              {visionShots.filter(Boolean).length > 0 && (
                <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 14 }}>
                  {visionShots.filter(Boolean).map((d, i) => (
                    <img key={i} src={d} alt={`Scene ${i + 1}`}
                      style={{ width: 116, borderRadius: 8, border: "1px solid var(--border)" }} />
                  ))}
                </div>
              )}

              <button className="pill-btn primary" style={{ marginBottom: 22 }} onClick={generateVision} disabled={!visionEnabled || visionGenerating || !visionVibe.trim()}>
                {visionGenerating ? "Drafting…" : (visualQueriesText || audioQueriesText) ? "Regenerate checks" : "Generate checks with Claude"}
              </button>

              <div className="subhead">🔎 On-stage annotations</div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                Show the audience what's invisible: small chips over the call the moment the AI <b>senses</b> something. Works with or without the checks above (the annotations bring their own perception tools), on the builder launch and share links alike. Toggle off for a clean stage.
              </p>
              <div style={{ display: "flex", flexDirection: "column", gap: 8, maxWidth: 640, marginBottom: 22 }}>
                <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13.5 }}>
                  <Toggle on={annotEmotion} onChange={setAnnotEmotion} />
                  <span><b>🎭 Emotion</b> — "Senses frustration" when the tone shifts, then "↳ Reacting — tone and expression adjust" as the reply lands.</span>
                </label>
                <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13.5 }}>
                  <Toggle on={annotVision} onChange={setAnnotVision} />
                  <span><b>👁 Vision</b> — "Sees: a badge held up to the camera" when something noteworthy enters the frame.</span>
                </label>
              </div>

              <Field label="Visual checks" hint="One per line — what raven-1 continuously watches for in the camera/screen. Edit freely.">
                <textarea
                  style={{ minHeight: 110 }}
                  disabled={!visionEnabled}
                  value={visualQueriesText}
                  onChange={(e) => setVisualQueriesText(e.target.value)}
                  placeholder={"Is the user holding a document or ID up to the camera?\nIs more than one person visible in the frame?"}
                />
              </Field>
              <Field label="Audio checks" hint="One per line — tone and emotion cues from the user's voice (raven-1 only). Optional.">
                <textarea
                  style={{ minHeight: 80 }}
                  disabled={!visionEnabled}
                  value={audioQueriesText}
                  onChange={(e) => setAudioQueriesText(e.target.value)}
                  placeholder={"Does the user sound confused or frustrated?\nHas the user asked to speak to a human?"}
                />
              </Field>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                <button className="pill-btn" onClick={injectVisionIntoPrompt}
                  disabled={!visionEnabled || generating || !personaDraft.trim() || !(visualQueriesText.trim() || audioQueriesText.trim())}
                  title={personaDraft.trim() ? "Claude rewrites the persona so each check changes what it does" : "Draft a persona first — there's no prompt to inject into yet"}>
                  {generating ? "Weaving…" : "🪡 Inject into prompt"}
                </button>
              </div>
              <p className="field-hint" style={{ maxWidth: 620 }}>
                Raven answers these checks every second of the call whether or not anything acts on them — the queries alone
                change nothing. <b>Inject into prompt</b> weaves them into the persona so what it sees moves the conversation.
                Re-attach the prompt on the Persona step afterwards.
              </p>
            </>
          )}

          {step === "speech" && (
            <>
              <div className="skill-head">
                <h1>Voice</h1>
                <Toggle on={speechEnabled} onChange={setSpeechEnabled} />
              </div>
              <p className="lede">
                Teach the PAL how to say your product names, acronyms, and people. One rule per line: the word, then how to say it. On launch these become a pronunciation dictionary attached to the PAL's voice — it works with every Tavus voice engine.
              </p>

              <div className="subhead">Voice &amp; accent</div>
              <Field label="" hint='Search Cartesia&apos;s voice library by accent, language, or vibe — try "mexican", "spain", "british female". Picking a voice applies it to the PAL right away (and again at launch, so it never gets lost).'>
                <div style={{ display: "flex", gap: 8 }}>
                  <input value={voiceQuery} onChange={(e) => setVoiceQuery(e.target.value)} placeholder='e.g. "british female warm"'
                    onKeyDown={(e) => e.key === "Enter" && !voiceLoading && searchVoices()} />
                  <button className="pill-btn" style={{ flexShrink: 0 }} onClick={searchVoices} disabled={voiceLoading}>
                    {voiceLoading ? "Searching…" : "Search voices"}
                  </button>
                </div>
                {externalVoiceId && (
                  <span className="field-hint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                    Current pick: <b>{externalVoiceName || externalVoiceId}</b>
                    {voiceApply.appliedId === externalVoiceId
                      ? <span style={{ color: "#1a7f37", fontWeight: 600 }}>on the PAL ✓</span>
                      : <button className="pill-btn" style={{ padding: "2px 10px", fontSize: 11 }} disabled={voiceApply.busy}
                          onClick={() => applyVoiceNow(externalVoiceId, externalVoiceName)}>
                          {voiceApply.busy ? "Applying…" : "Apply to PAL now"}
                        </button>}
                    <button className="pill-btn" style={{ padding: "2px 10px", fontSize: 11 }} onClick={() => { setExternalVoiceId(""); setExternalVoiceName(""); setVoiceApply({ busy: false, appliedId: "", err: "" }); }}>Clear</button>
                  </span>
                )}
                {voiceApply.err && (
                  <span className="field-hint" style={{ color: "#c0392b" }}>Couldn't apply the voice: {voiceApply.err}</span>
                )}
                <span className="field-hint" style={{ display: "flex", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                  <button className="pill-btn" style={{ padding: "2px 10px", fontSize: 11 }} onClick={checkPalVoice}>
                    🔎 Check the PAL
                  </button>
                  {voiceOnPal && (voiceOnPal.err
                    ? <span style={{ color: "#c0392b" }}>{voiceOnPal.err}</span>
                    : voiceOnPal.voiceId
                      ? <span>
                          PAL voice right now: <b>{voiceOnPal.voiceId}</b> ({voiceOnPal.engine})
                          {externalVoiceId && (voiceOnPal.voiceId === externalVoiceId
                            ? <b style={{ color: "#1a7f37" }}> — matches your pick ✓</b>
                            : <b style={{ color: "#c0392b" }}> — does NOT match your pick</b>)}
                        </span>
                      : <span style={{ color: "#c0392b" }}>No external voice on the PAL — it's using the face's default voice. Click a voice below to attach one.</span>)}
                </span>
                <span className="field-hint">A voice change only affects <b>new</b> conversations — end the current call and launch again to hear it.</span>
              </Field>
              {voiceResults && (
                <div className="kb-list" style={{ marginBottom: 20 }}>
                  {voiceResults.length === 0 && <p className="field-hint">No matches — try broader words ("british", "german", "young").</p>}
                  {voiceResults.map((v) => (
                    <div key={v.id} className="kb-row">
                      <div style={{ flex: 1, minWidth: 0 }}>
                        <div style={{ fontSize: 13, fontWeight: 600 }}>{v.name} {v.language && <span className="kb-status" style={{ marginLeft: 6 }}>{v.language}</span>}</div>
                        <div style={{ fontSize: 12, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{v.description}</div>
                      </div>
                      <button className="pill-btn" title="Hear a sample" style={{ padding: "4px 10px", fontSize: 12, flexShrink: 0 }}
                        disabled={!!voicePreviewing}
                        onClick={() => previewVoice(v)}>
                        {voicePreviewing === v.id ? "🔊…" : "▶"}
                      </button>
                      <button className={"pill-btn" + (externalVoiceId === v.id ? " primary" : "")} style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                        disabled={voiceApply.busy}
                        onClick={() => { setExternalVoiceId(v.id); setExternalVoiceName(v.name); applyVoiceNow(v.id, v.name); }}>
                        {voiceApply.busy && externalVoiceId === v.id ? "Applying…"
                          : voiceApply.appliedId === v.id ? "On the PAL ✓"
                          : externalVoiceId === v.id ? "Selected ✓" : "Use this voice"}
                      </button>
                    </div>
                  ))}
                </div>
              )}

              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>Expressive delivery</span>
                <Toggle on={emotionControl} onChange={setEmotionControl} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 20 }}>
                On: the voice and face carry real emotion, guided by the "Emotional vibe" you set in the Persona step. Off: flat, even delivery (rarely what you want for demos). Applied on launch.
              </p>
              <div className="subhead">Pronunciation</div>
              <p className="field-hint" style={{ maxWidth: 620, marginBottom: 10 }}>
                Two formats per word: <b>say it like</b> spells the sound in plain letters (TAH-vuss) — right for 95% of cases;
                <b> IPA</b> takes the formal phonetic alphabet (ˈtɑːvəs) when you need exact precision. <b>Aa</b> makes a rule case-sensitive
                (so "NASA" and "nasa" can differ). Rules become a dictionary on the PAL's voice at launch — or save one below and reuse it across demos.
              </p>
              {speechEnabled && (
                <div style={{ maxWidth: 680, marginBottom: 10 }}>
                  {pronRows.map((r, i) => (
                    <div key={i} className="pron-row">
                      <input style={{ flex: "1 1 130px" }} placeholder="Word — e.g. Tavus" value={r.word}
                        onChange={(e) => applyPronRows(pronRows.map((x, j) => (j === i ? { ...x, word: e.target.value } : x)))} />
                      <span style={{ color: "var(--muted)" }}>→</span>
                      <input style={{ flex: "1 1 170px" }} placeholder={r.ipa ? "IPA — e.g. ˈtɑːvəs" : "Say it like — e.g. TAH-vuss"} value={r.pron}
                        onChange={(e) => applyPronRows(pronRows.map((x, j) => (j === i ? { ...x, pron: e.target.value } : x)))} />
                      <select style={{ width: "auto", flexShrink: 0 }} value={r.ipa ? "ipa" : "alias"}
                        onChange={(e) => applyPronRows(pronRows.map((x, j) => (j === i ? { ...x, ipa: e.target.value === "ipa" } : x)))}>
                        <option value="alias">say it like</option>
                        <option value="ipa">IPA</option>
                      </select>
                      <label title="Case-sensitive — only matches this exact capitalization" style={{ display: "flex", alignItems: "center", gap: 4, fontSize: 12.5, color: "var(--muted)", cursor: "pointer", flexShrink: 0 }}>
                        <input type="checkbox" style={{ width: "auto" }} checked={!!r.cs}
                          onChange={(e) => applyPronRows(pronRows.map((x, j) => (j === i ? { ...x, cs: e.target.checked } : x)))} />
                        Aa
                      </label>
                      <button className="kb-del" title="Remove this rule" onClick={() => applyPronRows(pronRows.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                  <button className="pill-btn" style={{ padding: "4px 14px", fontSize: 12.5 }}
                    onClick={() => setPronRows([...pronRows, { word: "", pron: "", ipa: false, cs: false }])}>
                    + Add word
                  </button>
                  <details style={{ marginTop: 10 }}>
                    <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>📋 Bulk paste (one “word = how to say it” per line)</summary>
                    <textarea
                      className="mono"
                      style={{ minHeight: 110, marginTop: 8, width: "100%" }}
                      value={pronunciationText}
                      onChange={(e) => { setPronunciationText(e.target.value); setPronRows(pronRowsFromText(e.target.value)); }}
                      placeholder={"Tavus = TAH-vuss\nCVI = C V I\nNguyen = win [case]\nlive demo = lyve demo"}
                    />
                  </details>
                </div>
              )}

              {speechEnabled && (
                <>
                  <div className="skill-head" style={{ marginTop: 16, marginBottom: 6 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>Your dictionaries</span>
                    <button className="pill-btn" style={{ padding: "5px 14px", fontSize: 12.5 }} onClick={fetchPronDicts} disabled={pronDictsLoading}>
                      {pronDictsLoading ? "Loading…" : pronDicts ? "Refresh" : "Load dictionaries"}
                    </button>
                  </div>
                  <div style={{ display: "flex", gap: 8, maxWidth: 620, marginBottom: 10, flexWrap: "wrap" }}>
                    <input style={{ flex: "1 1 220px" }} value={pronDictName} onChange={(e) => setPronDictName(e.target.value)} placeholder="Dictionary name — e.g. Acme product terms" />
                    <button className="pill-btn primary" style={{ flexShrink: 0 }} onClick={savePronDict} disabled={!pronunciationRules.length}>
                      💾 Save rules as a dictionary
                    </button>
                  </div>
                  {pronDicts !== null && !pronDicts.length && <p className="field-hint">No saved dictionaries on this account yet.</p>}
                  {!!pronDicts?.length && (
                    <div className="kb-list" style={{ maxWidth: 680 }}>
                      {pronDicts.map((d) => {
                        const id = d.pronunciation_dictionary_id || d.uuid || d.id;
                        const name = d.name || d.dictionary_name || id;
                        return (
                          <div key={id} className="kb-row">
                            <span style={{ flex: 1, minWidth: 0, fontSize: 13 }}>
                              <b>{name}</b>
                              {Array.isArray(d.rules) && <span style={{ color: "var(--muted)" }}> · {d.rules.length} rule{d.rules.length !== 1 ? "s" : ""}</span>}
                              <div style={{ fontSize: 11, color: "var(--muted)", fontFamily: "var(--mono)", overflow: "hidden", textOverflow: "ellipsis" }}>{id}</div>
                            </span>
                            <button className={"pill-btn" + (pronDictId === id ? " primary" : "")} style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                              onClick={() => attachPronDict(id)} title="Use this dictionary for this demo's PAL (attaches now if the PAL exists, else at launch)">
                              {pronDictId === id ? "In use ✓" : "Use for this demo"}
                            </button>
                            <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }} onClick={() => loadPronDictRules(id, name)} title="Copy its rules into the editor above">
                              ✏️ Edit rules
                            </button>
                            <button className="kb-del" title="Delete this dictionary from the account" onClick={() => deletePronDict(id, name)}>✕</button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  <p className="field-hint" style={{ maxWidth: 620, marginTop: 8 }}>
                    At launch: rules in the editor become a fresh dictionary on the PAL; an empty editor attaches the dictionary marked “In use”.
                  </p>
                </>
              )}
            </>
          )}

          {step === "kb" && (
            <>
              <h1>Knowledge</h1>
              <p className="lede">
                Give the PAL material to know and present. Add any public link — a PDF, deck, doc, image, spreadsheet, or a whole website — and Tavus processes it in the background (a few minutes). Tick "PAL can use" to let the PAL reference a document when answering in this demo.
              </p>

              <Field label="Add by link" hint="Supports .pdf .docx .pptx .txt .csv .xlsx .png .jpg — or any website URL. Files on your computer need a shareable link first (Drive, Dropbox, Slack…).">
                <input className="mono" value={kbUrl} onChange={(e) => setKbUrl(e.target.value)} placeholder="https://…/deck.pdf or https://yourcompany.com"
                  onKeyDown={(e) => e.key === "Enter" && !kbAdding && addKbDoc()} />
              </Field>
              <Field label="Name (optional)">
                <input value={kbName} onChange={(e) => setKbName(e.target.value)} placeholder="Q3 sales deck" />
              </Field>
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 8, maxWidth: 560 }}>
                <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, cursor: "pointer" }}>
                  <input type="checkbox" style={{ width: "auto" }} checked={kbCrawl} onChange={(e) => setKbCrawl(e.target.checked)} />
                  It's a website — crawl linked pages too
                </label>
                <button className="pill-btn primary" style={{ marginLeft: "auto" }} onClick={addKbDoc} disabled={kbAdding || !kbUrl.trim()}>
                  {kbAdding ? "Adding…" : "Add to Knowledge Base"}
                </button>
              </div>
              {blobReady && !blobReady.configured && (
                <p className="field-hint" style={{ color: "var(--danger)", maxWidth: 560, marginBottom: 8 }}>
                  ⚠ Direct file upload isn't configured on the server — in Vercel: <b>Storage → Create Database → Blob</b>, attach it to this project, redeploy.
                  Add-by-link (above) works regardless.
                </p>
              )}
              {blobReady?.configured && blobReady.mode === "oidc" && (
                <p className="field-hint" style={{ maxWidth: 560, marginBottom: 8 }}>
                  ✓ Storage connected (OIDC mode) — files up to <b>~3.5MB</b> upload through the server. For bigger decks, enable
                  <b> BLOB_READ_WRITE_TOKEN</b> in the store's project-connection settings and redeploy — browser uploads to 50MB then light up automatically.
                </p>
              )}
              <div style={{ display: "flex", alignItems: "center", gap: 10, marginBottom: 18, maxWidth: 560 }}>
                <span className="field-hint" style={{ margin: 0 }}>…or straight from your computer:</span>
                <button className="pill-btn" onClick={() => kbFileRef.current?.click()} disabled={kbAdding}>
                  {kbAdding ? "Working…" : "Upload a file"}
                </button>
                <input ref={kbFileRef} type="file" style={{ display: "none" }}
                  accept=".pdf,.pptx,.docx,.doc,.txt,.csv,.xlsx,.png,.jpg,.jpeg"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadKbFile(f); e.target.value = ""; }} />
              </div>

              <div className="skill-head" style={{ marginTop: 10 }}>
                <div className="subhead" style={{ margin: 0 }}>Your documents</div>
                <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => fetchKbDocs()} disabled={kbLoading}>
                  {kbLoading ? "Loading…" : kbDocs ? "Refresh" : "Load documents"}
                </button>
              </div>
              {kbDocs === null && <p className="field-hint" style={{ maxWidth: 560 }}>Click "Load documents" to list everything in this account's Knowledge Base.</p>}
              {kbDocs?.length === 0 && <p className="field-hint">No documents yet — add one above.</p>}
              {!!kbDocs?.length && (
                <div className="kb-list">
                  {kbDocs.map((d) => (
                    <div key={d.document_id} className="kb-row">
                      <input
                        className="kb-name"
                        defaultValue={d.document_name || d.document_id}
                        title="Click to rename — saves when you click away"
                        onBlur={(e) => {
                          const v = e.target.value.trim();
                          if (v && v !== (d.document_name || d.document_id)) renameKbDoc(d.document_id, v);
                        }}
                      />
                      <span className={`kb-status kb-${d.status}`}>{d.status}{d.status === "processing" && d.progress != null ? ` ${d.progress}%` : ""}</span>
                      <label className="kb-use" title="Let the PAL reference this document when answering in this demo">
                        <input type="checkbox" style={{ width: "auto" }}
                          checked={knowledgeIds.includes(d.document_id)}
                          onChange={() => setKnowledgeIdsRaw((raw) => toggleIdIn(raw, d.document_id))} />
                        PAL can use
                      </label>
                      <button className="kb-del" title="Delete from Knowledge Base" onClick={() => deleteKbDoc(d.document_id, d.document_name)}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              <p className="field-hint" style={{ marginTop: 12, maxWidth: 560 }}>
                {knowledgeIds.length
                  ? `${knowledgeIds.length} document${knowledgeIds.length > 1 ? "s" : ""} will be available to the PAL in this demo's conversations.`
                  : "Nothing selected yet — the PAL won't reference the Knowledge Base in this demo."} To have the PAL present a deck as slides, pick it in the Presentation step.
              </p>

              <div className="skill-head" style={{ marginTop: 26, marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>💭 Memory — remembers across calls</span>
                <Toggle on={memoryEnabled} onChange={setMemoryEnabled} />
              </div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                Knowledge is what it <b>knows</b>; Memory is what it <b>remembers about the person</b>. With Memories on
                (Tavus <span className="mono">memory_stores</span>), a returning caller picks up where they left off —
                "welcome back, how did the rollout go?" is the single most jaw-dropping beat in a second demo call.
              </p>
              {memoryEnabled && (
                <>
                  <div className="seg" style={{ marginBottom: 8 }}>
                    <button type="button" className={memoryMode === "visitor" ? "on" : ""} onClick={() => setMemoryMode("visitor")}>Per visitor</button>
                    <button type="button" className={memoryMode === "demo" ? "on" : ""} onClick={() => setMemoryMode("demo")}>One shared memory</button>
                  </div>
                  <p className="field-hint" style={{ maxWidth: 620, marginBottom: 10 }}>
                    {memoryMode === "visitor"
                      ? "Each visitor gets their own memory, keyed by the email they enter at the gate (scoped to this demo — never shared across demos). Anonymous visitors — no email gate, or gate skipped — get no cross-call memory. Your own builder launches use a separate operator store so your tests don't pollute a visitor's memory."
                      : "Every conversation on this demo shares ONE memory — good for kiosk/event setups where the AI accumulates context across the day."}
                  </p>
                  <Field label="Store name (optional)" hint="Stable identifier for the memory store — defaults to the demo name. Changing it later starts a fresh, blank memory.">
                    <input className="mono" value={memoryKey} onChange={(e) => setMemoryKey(e.target.value)} placeholder="acme_onboarding" />
                  </Field>
                  <p className="field-hint" style={{ maxWidth: 620 }}>
                    Heads up (Tavus early release): what's stored isn't viewable or editable yet — the memory shows up in how the conversation picks up, not in a dashboard.
                  </p>
                  <label style={{ display: "flex", gap: 10, alignItems: "center", fontSize: 13.5, maxWidth: 640, marginTop: 6 }}>
                    <Toggle on={annotMemory} onChange={setAnnotMemory} />
                    <span><b>💭 Make recall visible</b> — the AI says what it remembers out loud ("last time you mentioned…"), and on-stage chips mark the moment: memory active at call start, 💭 when a memory surfaces, 📚 when it pulls from the Knowledge Base.</span>
                  </label>
                </>
              )}
            </>
          )}

          {step === "presentation" && (
            <>
              <div className="skill-head">
                <h1>Slides</h1>
                <Toggle on={presentationEnabled} onChange={setPresentationEnabled} />
              </div>
              <p className="lede">The PAL presents PDF decks and images from your Knowledge Base as a live screen share. PDFs must be 50 pages or fewer and fully processed ("ready") before launching. Slides appear inside the conversation automatically.</p>
              <p className="field-hint" style={{ maxWidth: 620, marginTop: -6, marginBottom: 14 }}>
                <b>Pick the deck only.</b> Help-centre articles and other reference docs belong on the Knowledge step —
                the PAL reads those to answer questions; it can't present them, and adding them here is what turns a deck walk into a shrug.
              </p>

              <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 14 }}>
                <button className="pill-btn primary" onClick={() => deckFileRef.current?.click()} disabled={kbAdding || !presentationEnabled}>
                  {kbAdding ? "Uploading…" : "⬆ Upload a deck"}
                </button>
                <span className="field-hint" style={{ margin: 0 }}>PDF or PPTX from your computer — lands in the Knowledge Base and joins this deck.</span>
                <input ref={deckFileRef} type="file" style={{ display: "none" }} accept=".pdf,.pptx,.png,.jpg,.jpeg"
                  onChange={(e) => { const f = e.target.files?.[0]; if (f) uploadKbFile(f, { addToDeck: true }); e.target.value = ""; }} />
              </div>

              <div className="skill-head" style={{ marginTop: 4 }}>
                <div className="subhead" style={{ margin: 0 }}>…or pick from your Knowledge Base</div>
                <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => fetchKbDocs()} disabled={kbLoading}>
                  {kbLoading ? "Loading…" : kbDocs ? "Refresh" : "Load documents"}
                </button>
              </div>
              {kbDocs === null && <p className="field-hint" style={{ maxWidth: 560 }}>Load your Knowledge Base to pick decks — or upload one above.</p>}
              {kbDocs?.length === 0 && <p className="field-hint" style={{ maxWidth: 560 }}>Your Knowledge Base is empty — upload a deck above or add material in the Knowledge step.</p>}
              {!!kbDocs?.length && (
                <div className="kb-list" style={{ marginBottom: 6 }}>
                  {kbDocs.map((d) => (
                    <div key={d.document_id} className="kb-row">
                      <label className="kb-use" style={{ flex: 1, justifyContent: "flex-start" }}>
                        <input type="checkbox" style={{ width: "auto" }} disabled={!presentationEnabled}
                          checked={docIds.includes(d.document_id)}
                          onChange={() => setDocIdsRaw((raw) => toggleIdIn(raw, d.document_id))} />
                        {d.document_name || d.document_id}
                      </label>
                      {!PRESENTABLE.test(d.document_url || "") && (
                        <span className="kb-status" title="Couldn't verify the format from the link — slides need a PDF, PPTX, or image. If it is one, it'll present fine.">format?</span>
                      )}
                      <span className={`kb-status kb-${d.status}`}>{d.status}</span>
                    </div>
                  ))}
                </div>
              )}

              {!!kbDocs?.length && docIds.some((id) => {
                const d = kbDocs.find((x) => x.document_id === id);
                return d && d.document_url && !PRESENTABLE.test(d.document_url);
              }) && (
                <p className="field-hint" style={{ color: "var(--danger)", maxWidth: 620, marginTop: 4 }}>
                  ⚠ Some of the documents in this deck aren't PDFs, slides, or images. If they're reference articles, take them out —
                  add them on the Knowledge step instead, where the PAL can read them.
                </p>
              )}

              {docIds.length > 1 && (
                <>
                  <div className="subhead" style={{ marginTop: 14 }}>Deck order</div>
                  <div className="kb-list" style={{ maxWidth: 560 }}>
                    {docIds.map((id, i) => {
                      const doc = kbDocs?.find((d) => d.document_id === id);
                      return (
                        <div key={id} className="kb-row">
                          <span style={{ color: "var(--muted)", fontSize: 12, width: 18 }}>{i + 1}.</span>
                          <span style={{ flex: 1, fontSize: 13 }}>{doc?.document_name || id}</span>
                          <button className="kb-move" disabled={i === 0} onClick={() => {
                            const ids = [...docIds]; [ids[i - 1], ids[i]] = [ids[i], ids[i - 1]]; setDocIdsRaw(ids.join("\n"));
                          }}>↑</button>
                          <button className="kb-move" disabled={i === docIds.length - 1} onClick={() => {
                            const ids = [...docIds]; [ids[i + 1], ids[i]] = [ids[i], ids[i + 1]]; setDocIdsRaw(ids.join("\n"));
                          }}>↓</button>
                          <button className="kb-del" title="Remove from the deck" onClick={() => setDocIdsRaw(docIds.filter((x) => x !== id).join("\n"))}>✕</button>
                        </div>
                      );
                    })}
                  </div>
                </>
              )}

              <Field label="Document IDs (advanced)" hint="The picker fills this for you — but you can paste IDs directly too. Order here is the deck order.">
                <textarea className="mono" value={docIdsRaw} onChange={(e) => setDocIdsRaw(e.target.value)} placeholder={"d1234567890\nd2468101214"} />
              </Field>
              <Field label="Slides trigger">
                <div className="seg">
                  <button className={slidesTrigger === "walk_the_deck" ? "on" : ""} onClick={() => setSlidesTrigger("walk_the_deck")}>Walk the deck</button>
                  <button className={slidesTrigger === "on_demand" ? "on" : ""} onClick={() => setSlidesTrigger("on_demand")}>On demand</button>
                </div>
                <span className="field-hint">Walk the deck: the deck drives the conversation end to end. On demand: the PAL pulls the relevant slide when the conversation calls for it.</span>
              </Field>
              <Field label="Presenter style" hint="Optional — how it should present overall.">
                <textarea value={presentPrompt} onChange={(e) => setPresentPrompt(e.target.value)} placeholder="Walk the participant through the deck one slide at a time. Pause for questions after each section." />
              </Field>

              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <button className="pill-btn" onClick={injectPresentationIntoPrompt} disabled={!presentationEnabled || docIds.length === 0 || generating || !personaDraft.trim()}
                  title={personaDraft.trim() ? "Claude rewrites the persona (and goals if needed) so the call actually reaches the deck and presents it well" : "Draft a persona first — there's no prompt to inject into yet"}>
                  {generating ? "Weaving…" : "🪡 Inject into prompt"}
                </button>
              </div>
              <p className="field-hint" style={{ maxWidth: 620, marginBottom: 18 }}>
                The skill shares the slides, but the persona decides when the deck starts, the pacing, and how to resume after questions.
                <b> Inject into prompt</b> weaves the deck — trigger, presenter style, talk track — into the persona (and goals) so presenting actually happens.
                Re-attach the prompt on the Persona step afterwards, then relaunch.
              </p>

              <div className="skill-head" style={{ marginTop: 10 }}>
                <div className="subhead" style={{ margin: 0 }}>Talk track — what to say on each slide</div>
                <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={draftTalkTrack} disabled={!presentationEnabled || talkTrackDrafting}>
                  {talkTrackDrafting ? "Drafting…" : "✨ Draft talk track"}
                </button>
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 10 }}>
                Speaker notes per slide — the AI follows them in its own voice as it presents. <b>Upload slide images</b> (export your deck as PNG/JPG, pick them in order)
                and the draft is grounded in what's actually on each slide; without images Claude drafts from the use case, so give that version a read.
              </p>
              <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 8 }}>
                <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} disabled={!presentationEnabled} onClick={() => slideFileRef.current?.click()}>
                  ⬆ Slide images{slideShots.filter(Boolean).length ? ` (${slideShots.filter(Boolean).length}/20)` : ""}
                </button>
                {slideShots.filter(Boolean).length > 0 && (
                  <button className="pill-btn ghost" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setSlideShots([])}>✕ Clear images</button>
                )}
              </div>
              <input ref={slideFileRef} type="file" accept="image/*" multiple style={{ display: "none" }}
                onChange={(e) => { onSlideFiles(e.target.files || []); e.target.value = ""; }} />
              {slideShots.filter(Boolean).length > 0 && (
                <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginBottom: 10, maxWidth: 640 }}>
                  {slideShots.filter(Boolean).map((d, i) => (
                    <img key={i} src={d} alt={`Slide ${i + 1}`} title={`Slide ${i + 1}`}
                      style={{ height: 46, borderRadius: 6, border: "1px solid var(--border)" }} />
                  ))}
                </div>
              )}
              {talkTrack.length === 0 && (
                <button className="pill-btn" style={{ marginBottom: 8 }} disabled={!presentationEnabled}
                  onClick={() => setTalkTrack(["", "", "", ""])}>+ Start a talk track</button>
              )}
              {talkTrack.length > 0 && (
                <div className="kb-list" style={{ maxWidth: 640, marginBottom: 8 }}>
                  {talkTrack.map((note, i) => (
                    <div key={i} className="kb-row" style={{ alignItems: "flex-start" }}>
                      <span style={{ color: "var(--muted)", fontSize: 12, width: 52, paddingTop: 8, flexShrink: 0 }}>Slide {i + 1}</span>
                      <textarea
                        style={{ minHeight: 44, fontSize: 12.5, flex: 1 }}
                        disabled={!presentationEnabled}
                        value={note}
                        onChange={(e) => setTalkTrack((t) => t.map((x, j) => (j === i ? e.target.value : x)))}
                        placeholder="What should it say here? End with a question to keep it two-way."
                      />
                      <button className="kb-del" title="Remove this slide's note" onClick={() => setTalkTrack((t) => t.filter((_, j) => j !== i))}>✕</button>
                    </div>
                  ))}
                </div>
              )}
              {talkTrack.length > 0 && (
                <div style={{ display: "flex", gap: 8, marginBottom: 8 }}>
                  <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} disabled={!presentationEnabled}
                    onClick={() => setTalkTrack((t) => [...t, ""])}>+ Add slide</button>
                  <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12, color: "var(--danger)" }}
                    onClick={() => setTalkTrack([])}>Clear track</button>
                </div>
              )}

              <div className="skill-head" style={{ maxWidth: 660, marginTop: 26, marginBottom: 4 }}>
                <span style={{ fontSize: 15, fontWeight: 700 }}>🌐 Browser Use — guided live-browser walkthroughs</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => detachSkill("browser_use")}>Detach</button>
                  <Toggle on={browserUseEnabled} onChange={setBrowserUseEnabled} />
                </span>
              </div>
              <p className="field-hint" style={{ maxWidth: 660 }}>
                The AI human drives a REAL cloud browser and narrates walkthroughs you script ahead of time — pages stream into
                the stage exactly like slides (same screen track). It only runs your named flows; it never free-browses.
                Account-enabled: Tavus grants this skill on request via your account team.
              </p>
              {browserUseEnabled && (() => {
                const flows = Array.isArray(browserCfgObj.guided_flows) ? browserCfgObj.guided_flows : [];
                const setFlows = (f) => setBrowserCfgField("guided_flows", f);
                const patchFlow = (i, patch) => setFlows(flows.map((f, j) => (j === i ? { ...f, ...patch } : f)));
                const stepsOf = (f) => (Array.isArray(f?.steps) ? f.steps : []);
                const putStep = (i, j, next) => patchFlow(i, { steps: stepsOf(flows[i]).map((st, k) => (k === j ? next : st)).filter(Boolean) });
                const stepType = (st) => (st && st.slide != null && st.slide !== "" ? "slide" : st && Object.prototype.hasOwnProperty.call(st, "task") ? "task" : "speak");
                const inp2 = { fontSize: 12.5 };
                const hasSlideSteps = flows.some((f) => stepsOf(f).some((st) => st?.slide != null && st.slide !== ""));
                return (
                  <>
                    <div className="subhead" style={{ marginTop: 10 }}>Guided flows</div>
                    {flows.map((f, i) => (
                      <div key={i} className="jr-card" style={{ maxWidth: 680, marginBottom: 12 }}>
                        <div className="jr-head">
                          <span className="jr-type">🧭 flow {i + 1}{f.name ? ` — ${f.name}` : ""}</span>
                          <span className="jr-btns"><button className="kb-del" onClick={() => setFlows(flows.filter((_, j) => j !== i))} title="Delete this flow">✕</button></span>
                        </div>
                        <div style={{ display: "flex", gap: 6, marginBottom: 6, flexWrap: "wrap" }}>
                          <input style={{ ...inp2, flex: "1 1 180px" }} placeholder={'Name — e.g. "Onboarding" (the AI picks flows by name)'} value={f.name || ""} onChange={(e) => patchFlow(i, { name: e.target.value })} />
                          <input style={{ ...inp2, flex: "2 1 260px" }} placeholder="One-line description — what this flow covers" value={f.description || ""} onChange={(e) => patchFlow(i, { description: e.target.value })} />
                        </div>
                        <input className="mono" style={{ ...inp2, marginBottom: 8, width: "100%" }} placeholder="Start URL — the page this flow begins on" value={f.start_url || ""} onChange={(e) => patchFlow(i, { start_url: e.target.value })} />
                        {stepsOf(f).map((st, j) => {
                          const t3 = stepType(st);
                          return (
                            <div key={j} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 8, marginBottom: 6, background: "var(--canvas)" }}>
                              <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                                <span style={{ fontSize: 11, color: "var(--muted)", width: 16, flexShrink: 0 }}>{j + 1}</span>
                                <select
                                  style={{ ...inp2, width: "auto", flexShrink: 0 }}
                                  value={t3}
                                  onChange={(e) => {
                                    const v = e.target.value;
                                    putStep(i, j, v === "task" ? { task: st.task || "", prompt: st.prompt || "" } : v === "slide" ? { slide: st.slide || 1, prompt: st.prompt || "" } : { prompt: st.prompt || "" });
                                  }}
                                >
                                  <option value="task">🌐 Browser action</option>
                                  <option value="speak">💬 Speak only</option>
                                  <option value="slide">🖼 Slide</option>
                                </select>
                                {t3 === "task" && <input style={{ ...inp2, flex: 1 }} placeholder={'One small action — "Open the Projects tab"'} value={st.task || ""} onChange={(e) => putStep(i, j, { ...st, task: e.target.value })} />}
                                {t3 === "slide" && <input type="number" min="1" style={{ ...inp2, width: 84 }} title="1-based page of the slide deck" value={st.slide ?? 1} onChange={(e) => putStep(i, j, { ...st, slide: Number(e.target.value) || 1 })} />}
                                <button className="kb-del" onClick={() => putStep(i, j, null)} title="Remove step">✕</button>
                              </div>
                              <input
                                style={{ ...inp2, marginBottom: t3 === "task" ? 6 : 0, width: "100%" }}
                                placeholder={t3 === "slide" ? "Narration (optional — omit to narrate from the slide's own summary)" : "Narration — 1-2 sentences it speaks during this step (this covers the browser's think time)"}
                                value={st.prompt || ""}
                                onChange={(e) => putStep(i, j, { ...st, prompt: e.target.value })}
                              />
                              {t3 === "task" && (
                                <input className="mono" style={{ ...inp2, width: "100%" }} placeholder="⚡ Page URL — paste from your browser's address bar and the browser JUMPS here instantly (no URL = it scrolls & clicks its way there, slow)" value={st.url || ""} onChange={(e) => { const v = e.target.value; const s2 = { ...st }; if (v.trim()) s2.url = v; else delete s2.url; putStep(i, j, s2); }} />
                              )}
                              {t3 === "task" && !String(st.prompt || "").trim() && <span className="field-hint" style={{ color: "#b4552d" }}>⚠ browser steps need narration — silence here reads as dead air</span>}
                            </div>
                          );
                        })}
                        <button className="pill-btn" style={{ padding: "3px 12px", fontSize: 12 }} onClick={() => patchFlow(i, { steps: [...stepsOf(f), { task: "", prompt: "" }] })}>+ Step</button>
                        {!stepsOf(f).length && <span className="field-hint" style={{ marginLeft: 8, color: "#b4552d" }}>⚠ a flow needs at least one step</span>}
                      </div>
                    ))}
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12 }}>
                      <button className="pill-btn" onClick={() => setFlows([...flows, { name: "", description: "", start_url: "", steps: [{ prompt: "" }, { task: "", prompt: "" }] }])}>+ Add flow</button>
                      <button className="pill-btn primary" onClick={validateBrowserUse} title="PUT the skill to your PAL right now — Tavus validates the config server-side and the log shows the verdict">
                        🧪 Validate &amp; attach now
                      </button>
                    </div>
                    <Field label="✨ Script a flow" hint="Describe the walkthrough — the site, what to show, in what order. Claude writes it Tavus-style: a speak-only intro, small single-action steps, and a sentence or two of narration on every step (the narration is what covers the browser's load time).">
                      <textarea style={{ minHeight: 56 }} value={browserFlowDesc} onChange={(e) => setBrowserFlowDesc(e.target.value)}
                        placeholder={'e.g. "Walk tavus.io: land on the homepage, open Pricing and point at the starter tier, show the developer quickstart, end back on the homepage"'} />
                      <div style={{ marginTop: 8 }}>
                        <button className="pill-btn primary" onClick={draftBrowserFlow} disabled={browserFlowBusy || !browserFlowDesc.trim()}>
                          {browserFlowBusy ? "Scripting…" : "✨ Script this flow"}
                        </button>
                      </div>
                    </Field>
                    {(hasSlideSteps || browserCfgObj.slide_document_id) && (
                      <Field label="Slide deck for 🖼 slide steps" hint="Slide steps show pages from ONE Knowledge Base deck (required whenever any step uses a slide) — the same document type the Presentation skill uses. If the deck isn't display-ready at call time, slide steps gracefully become speak-only.">
                        <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                          <input className="mono" style={{ flex: "1 1 220px" }} value={browserCfgObj.slide_document_id || ""} onChange={(e) => setBrowserCfgField("slide_document_id", e.target.value)} placeholder="d…" />
                          {docIds.length > 0 && !browserCfgObj.slide_document_id && (
                            <button className="pill-btn" style={{ flexShrink: 0, fontSize: 12 }} onClick={() => setBrowserCfgField("slide_document_id", docIds[0])}>Use the Presentation deck</button>
                          )}
                        </div>
                        {hasSlideSteps && !browserCfgObj.slide_document_id && (
                          <span className="field-hint" style={{ color: "var(--danger)" }}>⚠ You have slide steps but no deck — Tavus rejects the config without slide_document_id.</span>
                        )}
                      </Field>
                    )}
                    <Field label="When to run which flow" hint="Steering, not configuration — one moment per line, referencing flows BY NAME. 🪡 Inject weaves the flows and these moments into the persona and goals so the conversation actually gets there.">
                      <textarea style={{ minHeight: 64, fontSize: 13 }} value={browsePlan}
                        onChange={(e) => setBrowsePlan(e.target.value)}
                        placeholder={'When they ask how setup works → run the "Onboarding" flow\nAfter pricing is settled → run the "Reporting tour" flow'} />
                      <div style={{ marginTop: 8 }}>
                        <button className="pill-btn" onClick={injectBrowsingIntoPrompt} disabled={generating || !personaDraft.trim()}
                          title={personaDraft.trim() ? "Claude weaves the flows and their moments into the persona (and goals)" : "Draft a persona first"}>
                          {generating ? "Weaving…" : "🪡 Inject into prompt"}
                        </button>
                      </div>
                    </Field>
                    <details style={{ maxWidth: 680, marginBottom: 8 }}>
                      <summary style={{ cursor: "pointer", fontSize: 12.5, fontWeight: 600, color: "var(--muted)" }}>{"{ }"} Raw config JSON</summary>
                      <textarea className="mono" style={{ minHeight: 90, fontSize: 12, marginTop: 8, width: "100%" }} value={browserUseConfig}
                        onChange={(e) => setBrowserUseConfig(e.target.value)} placeholder={'{ "guided_flows": [] }'} />
                      <p className="field-hint" style={{ margin: "6px 0 0" }}>The editor above and this box edit the same config — PUT …/skills/browser_use at attach.</p>
                    </details>
                  </>
                );
              })()}
            </>
          )}

          {step === "canvas" && (
            <>
              <div className="skill-head">
                <h1>Magic Canvas</h1>
                <Toggle on={canvasEnabled} onChange={setCanvasEnabled} />
              </div>
              <p className="lede">Visuals beside the video at exactly the right beat. Pin <b>magic moments</b> to your talk track below — each fires deterministically when its step comes up. The model-driven cards further down are the advanced layer.</p>

              {canvasEnabled && (() => {
                /* ── Magic moments: cards pinned to the objectives flow. The
                   diagram IS the talk track; a moment is a scripted card
                   whose trigger words come from its step — deterministic
                   firing, no model judgment, no vibe-writing required. ── */
                const steps = parseObjectives(objectivesText, confirmationMode)
                  .filter((o) => !o.objective_name.includes("_if") && !/_wrap$/.test(o.objective_name));
                const stop = new Set(["about", "their", "there", "which", "would", "should", "could", "where", "these", "those", "after", "before", "asking", "them"]);
                const kwFor = (prompt) => prompt.toLowerCase().split(/[^a-z0-9]+/)
                  .filter((w) => w.length >= 5 && !stop.has(w)).slice(0, 3).join(", ");
                const momentsAt = (i) => scCards.map((c, j) => ({ c, j })).filter((x) => x.c.objIndex === i);
                const setCardField = (j, k, v) => setScCards((cs) => cs.map((c, idx) => (idx === j ? { ...c, [k]: v } : c)));
                /* Moment editor body — shared by step-pinned and free moments. */
                const momentEditor = (c, j, { withTrigger = false } = {}) => (
                  <div key={j} className="mm-card">
                    <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                      <select style={{ width: "auto", fontSize: 12 }} value={c.style || "note"} onChange={(e) => setCardField(j, "style", e.target.value)}>
                        <option value="note">💬 text card</option>
                        <option value="image">🖼 image</option>
                        <option value="question">☑️ multiple choice</option>
                        <option value="stat">📈 big stat</option>
                        <option value="link">📅 booking link</option>
                      </select>
                      <input style={{ flex: "1 1 140px", fontSize: 12 }} placeholder="Card title" value={c.title || ""} onChange={(e) => setCardField(j, "title", e.target.value)} />
                      <button className="pill-btn" style={{ padding: "2px 9px", flexShrink: 0 }} onClick={() => setScCards((cs) => cs.filter((_, idx) => idx !== j))}>✕</button>
                    </div>
                    {c.style === "link" && (
                      <input className="mono" style={{ fontSize: 12, marginTop: 6 }}
                        placeholder={schedulingUrl.trim() ? "Booking URL — blank uses the scheduling link below" : "Booking URL — e.g. https://calendly.com/you/30min"}
                        value={c.href || ""} onChange={(e) => setCardField(j, "href", e.target.value)} />
                    )}
                    {c.style === "image"
                      ? <input className="mono" style={{ fontSize: 12, marginTop: 6 }} placeholder="Image URL (or 📷 a product from Approved links below)" value={c.url || ""} onChange={(e) => setCardField(j, "url", e.target.value)} />
                      : <textarea style={{ minHeight: 44, fontSize: 12, marginTop: 6 }} placeholder={c.style === "question" ? "One option per line" : c.style === "stat" ? "Big value on line 1, label on line 2" : c.style === "link" ? "Optional lines above the button" : "What the card says (one point per line)"} value={c.body || ""} onChange={(e) => setCardField(j, "body", e.target.value)} />}
                    {withTrigger ? (
                      <div style={{ display: "flex", gap: 6, flexWrap: "wrap", marginTop: 6 }}>
                        <select style={{ width: "auto", fontSize: 11.5 }} value={c.trigger || "keyword"} onChange={(e) => setCardField(j, "trigger", e.target.value)}>
                          <option value="keyword">when words are said</option>
                          <option value="time">at a time</option>
                          <option value="start">at call start</option>
                        </select>
                        {(c.trigger || "keyword") === "keyword" && (
                          <select style={{ width: "auto", fontSize: 11.5 }} value={c.speaker || "either"} onChange={(e) => setCardField(j, "speaker", e.target.value)}
                            title="Whose speech arms this card">
                            <option value="either">either of us</option>
                            <option value="visitor">the visitor</option>
                            <option value="ai">the AI human</option>
                          </select>
                        )}
                        {(c.trigger || "keyword") === "keyword" && (
                          <input style={{ flex: "1 1 180px", fontSize: 11.5 }} value={c.keywords || ""} onChange={(e) => setCardField(j, "keywords", e.target.value)}
                            placeholder="Trigger words — comma-separated" />
                        )}
                        {c.trigger === "time" && (
                          <input style={{ width: 140, fontSize: 11.5 }} value={c.atMinutes || ""} onChange={(e) => setCardField(j, "atMinutes", e.target.value)}
                            placeholder="minutes — e.g. 1.5" title="Minutes into the call (decimals fine: 1.5 = 90 seconds)" />
                        )}
                      </div>
                    ) : (
                      <input style={{ fontSize: 11.5, marginTop: 6 }} value={c.keywords || ""} onChange={(e) => setCardField(j, "keywords", e.target.value)}
                        placeholder="Fires when anyone says…" title="Comma-separated trigger words — the card appears the moment one is spoken (by either side)" />
                    )}
                  </div>
                );
                /* Your own moments: not tied to a flow step — full trigger control. */
                const free = scCards.map((c, j) => ({ c, j })).filter((x) => x.c.objIndex == null);
                const ownMoments = (
                  <div className="mm-own">
                    <div className="mm-label">✨ Your own moments — any trigger, no step required</div>
                    {free.map(({ c, j }) => momentEditor(c, j, { withTrigger: true }))}
                    <button className="pill-btn ghost" style={{ padding: "3px 12px", fontSize: 12, alignSelf: "flex-start" }}
                      onClick={() => setScCards((cs) => [...cs, { style: "note", trigger: "keyword", keywords: "", title: "", body: "", hideAfter: 45 }])}>
                      ＋ Add your own moment
                    </button>
                  </div>
                );
                if (!steps.length) return (
                  <div className="mm-board">
                    <div style={{ padding: "0 0 10px" }}>
                      <span style={{ fontSize: 13, color: "var(--muted)" }}>
                        Step-pinned moments need a conversation flow — write one on <b>Objectives &amp; Guardrails</b> (or let New Demo draft it).
                      </span>
                      <button className="pill-btn" style={{ marginLeft: 10 }} onClick={() => setStep("guide")}>Open the flow →</button>
                    </div>
                    {ownMoments}
                  </div>
                );
                return (
                  <div className="mm-board">
                    {steps.map((s2, i) => (
                      <div key={s2.objective_name} className="mm-step">
                        <div className="mm-rail"><span className="mm-node">{i + 1}</span></div>
                        <div className="mm-body">
                          <div className="mm-label">{shortLabel(s2.objective_prompt, 72)}</div>
                          {momentsAt(i).map(({ c, j }) => momentEditor(c, j))}
                          <button className="pill-btn ghost" style={{ padding: "3px 12px", fontSize: 12, alignSelf: "flex-start" }}
                            onClick={() => setScCards((cs) => [...cs, { style: "note", trigger: "keyword", keywords: kwFor(s2.objective_prompt), title: "", body: "", hideAfter: 45, objIndex: i }])}>
                            ＋ magic moment here
                          </button>
                        </div>
                      </div>
                    ))}
                    {ownMoments}
                  </div>
                );
              })()}
              <p className="field-hint" style={{ maxWidth: 640, margin: "10px 0 22px" }}>
                A moment fires the instant its trigger words are spoken — by the AI <i>or</i> the visitor — so it lands mid-sentence, exactly on beat. Trigger words are pre-filled from the step; tighten them to the words that really get said.
              </p>

              <div className="subhead">Model-driven cards (advanced)</div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 6 }}>
                <button className="pill-btn primary" onClick={generateCanvasPlan} disabled={!canvasEnabled || canvasPlanning}>
                  {canvasPlanning ? "Planning…" : "✨ Suggest a canvas plan"}
                </button>
                <button className="pill-btn" onClick={injectCanvasIntoPrompt} disabled={!canvasEnabled || generating || !personaDraft.trim()}
                  title={personaDraft.trim() ? "Claude rewrites the persona (and goals if needed) so the conversation creates each card's moment" : "Draft a persona first — there's no prompt to inject into yet"}>
                  {generating ? "Weaving…" : "🪡 Inject into prompt"}
                </button>
              </div>
              <p className="field-hint" style={{ maxWidth: 620, marginBottom: 18 }}>
                Cards only appear when the conversation reaches their moment — a rule alone can't fire if the moment never happens.
                <b> Inject into prompt</b> weaves each card's moment into the persona (and goals) so the conversation steers there.
                Re-attach the prompt on the Persona step afterwards, then relaunch.
              </p>

              <div className="comp-grid">
                {CANVAS_COMPONENTS.map((c) => (
                  <div key={c.key} className={"comp-card" + (components[c.key] ? "" : " off")}>
                    <div className="comp-top">
                      <span className="comp-name">{c.label}</span>
                      <Toggle on={components[c.key]} onChange={(v) => setComponents((p) => ({ ...p, [c.key]: v }))} />
                    </div>
                    <span className="comp-desc">{c.desc}</span>
                    {components[c.key] && (
                      <input
                        className="rule-input"
                        value={componentRules[c.key]}
                        onChange={(e) => setComponentRules((p) => ({ ...p, [c.key]: e.target.value }))}
                        placeholder="When should the PAL show this?"
                      />
                    )}
                  </div>
                ))}
              </div>

              {components.scheduling_embed && (
                <Field label="Calendly URL (activates Scheduling)" hint="Public https link. The Scheduling card stays inactive until this is set.">
                  <input className="mono" style={{ marginTop: 14 }} value={schedulingUrl} onChange={(e) => setSchedulingUrl(e.target.value)} placeholder="https://calendly.com/you/30min" />
                </Field>
              )}

              <div className="subhead">🔗 Approved links</div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                Link cards make up URLs — the AI has no idea what pages exist, so it guesses (usually the homepage). List the real pages here and it may <b>only</b> share these, never an invented one. Use the finder to pull links straight off the live site.
              </p>
              {canvasEnabled && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 8 }}>
                    <input className="mono" style={{ flex: "2 1 260px" }} value={linkFinder.url}
                      onChange={(e) => setLinkFinder((s) => ({ ...s, url: e.target.value }))}
                      placeholder="Page to scan — e.g. https://www.brand.com (or its sitemap.xml)" />
                    <input style={{ flex: "1 1 160px" }} value={linkFinder.q}
                      onChange={(e) => setLinkFinder((s) => ({ ...s, q: e.target.value }))}
                      onKeyDown={(e) => e.key === "Enter" && !linkFinder.busy && findSiteLinks()}
                      placeholder='Filter — e.g. "linen", "outlet"' />
                    <button className="pill-btn" style={{ flexShrink: 0 }} onClick={findSiteLinks} disabled={linkFinder.busy || !linkFinder.url.trim()}>
                      {linkFinder.busy ? "Scanning…" : "Find links"}
                    </button>
                  </div>
                  <textarea
                    readOnly
                    value=""
                    onPaste={onLinkPaste}
                    onChange={() => {}}
                    style={{ minHeight: 44, height: 44, resize: "none", border: "1.5px dashed var(--border)", background: "transparent", marginBottom: 8, fontSize: 12 }}
                    placeholder="Blocked site? Open the page in YOUR browser, select around the products (or Ctrl/Cmd-A), Copy — then click here and Paste. Links AND product photos come along."
                  />
                  {linkFinder.err && <p className="field-hint" style={{ color: "#c0392b" }}>{linkFinder.err}</p>}
                  {Array.isArray(linkFinder.results) && (
                    <div className="kb-list" style={{ marginBottom: 14, maxHeight: 260, overflowY: "auto" }}>
                      {linkFinder.results.length === 0 && <p className="field-hint" style={{ padding: 8 }}>No links matched — try a broader filter, or scan a category page / sitemap.xml.</p>}
                      {linkFinder.results.map((l, i) => {
                        const inCatalog = linkCatalog.some((x) => x.url === l.url);
                        return (
                          <div key={i} className="kb-row">
                            <div style={{ flex: 1, minWidth: 0 }}>
                              <div style={{ fontSize: 13, fontWeight: 600, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.text || "(untitled)"}</div>
                              <div className="mono" style={{ fontSize: 11, color: "var(--muted)", overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }}>{l.url}</div>
                            </div>
                            {l.image && <img src={l.image} alt="" style={{ width: 34, height: 34, objectFit: "cover", borderRadius: 6, flexShrink: 0 }} />}
                            <button className={"pill-btn" + (inCatalog ? " primary" : "")} style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                              disabled={inCatalog}
                              onClick={() => setLinkCatalog((c) => [...c, { label: l.text || "", url: l.url, image: l.image || "" }])}>
                              {inCatalog ? "Added ✓" : "+ Add"}
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  )}
                  {linkCatalog.length > 0 && (
                    <div style={{ maxWidth: 680, marginBottom: 16 }}>
                      <p className="field-hint" style={{ marginBottom: 8 }}>
                        Give a row a <b>photo</b> and it becomes a live product card: the moment anyone on the call says its trigger words, the picture appears beside the video (click-through to the page). 📷 pulls the photo off the page automatically.
                      </p>
                      {linkCatalog.map((l, i) => (
                        <div key={i} style={{ display: "flex", gap: 8, alignItems: "flex-start", marginBottom: 10, padding: "8px 10px", border: "1px solid var(--border)", borderRadius: 12 }}>
                          {String(l.image || "").trim() && (
                            <img src={l.image} alt="" style={{ width: 44, height: 44, objectFit: "cover", borderRadius: 8, flexShrink: 0, marginTop: 2 }} />
                          )}
                          <div style={{ flex: 1, minWidth: 0, display: "flex", flexDirection: "column", gap: 6 }}>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <input style={{ flex: "1 1 140px" }} placeholder="Label — e.g. Merino wool sweater" value={l.label || ""}
                                onChange={(e) => setLinkCatalog((c) => c.map((x, j) => (j === i ? { ...x, label: e.target.value } : x)))} />
                              <input className="mono" style={{ flex: "2 1 220px", fontSize: 12 }} placeholder="https://… (the page)" value={l.url || ""}
                                onChange={(e) => setLinkCatalog((c) => c.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} />
                            </div>
                            <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                              <input className="mono" style={{ flex: "2 1 220px", fontSize: 12 }} placeholder="Photo URL — or hit 📷" value={l.image || ""}
                                onChange={(e) => setLinkCatalog((c) => c.map((x, j) => (j === i ? { ...x, image: e.target.value } : x)))} />
                              <input style={{ flex: "1 1 150px", fontSize: 12 }} placeholder='Trigger words — e.g. "merino, burgundy"' value={l.keywords || ""}
                                onChange={(e) => setLinkCatalog((c) => c.map((x, j) => (j === i ? { ...x, keywords: e.target.value } : x)))} />
                            </div>
                          </div>
                          <div style={{ display: "flex", flexDirection: "column", gap: 6, flexShrink: 0 }}>
                            <button className="pill-btn" title="Pull the photo + title off the page" style={{ padding: "2px 10px" }} disabled={linkFinder.busy || !String(l.url || "").trim()} onClick={() => fetchLinkMeta(i)}>📷</button>
                            <button className="pill-btn" style={{ padding: "2px 10px" }} onClick={() => setLinkCatalog((c) => c.filter((_, j) => j !== i))}>✕</button>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                  <button className="pill-btn" style={{ marginBottom: 22, fontSize: 12 }} onClick={() => setLinkCatalog((c) => [...c, { label: "", url: "" }])}>+ Add a link by hand</button>
                </>
              )}

              <div className="subhead">How eagerly cards appear</div>
              <div className="seg" style={{ marginBottom: 6 }}>
                {[
                  { v: "eager", label: "Eager" },
                  { v: "balanced", label: "Balanced" },
                  { v: "minimal", label: "Minimal" },
                  { v: "on_request", label: "Only when asked" },
                ].map((o) => (
                  <button key={o.v} className={canvasStyle === o.v ? "on" : ""} onClick={() => setCanvasStyle(o.v)}>{o.label}</button>
                ))}
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: presentationEnabled && docIds.length ? 8 : 20 }}>
                Eager: cards at every opportunity. Balanced: the PAL's default judgment. Minimal: only when clearly better than speaking. Only when asked: nothing appears unless the user requests it or a rule triggers it.
              </p>
              {presentationEnabled && !!docIds.length && (
                <p className="field-hint" style={{ maxWidth: 560, marginBottom: 20 }}>
                  <b>This dial is overridden while a deck is attached.</b> The slides lead and cards are reserved for questions,
                  so the deck walk isn't interrupted by a card. Turn the deck off on the Presentation step to get the dial back.
                </p>
              )}

              <div className="subhead">Canvas playbook</div>
              <Field label="" hint="Plain-English direction the PAL follows for this conversation — sequencing, triggers, exclusions. Sent as conversation context on launch, so different demos can run different playbooks without touching the PAL.">
                <textarea
                  style={{ minHeight: 110 }}
                  value={canvasPlaybook}
                  onChange={(e) => setCanvasPlaybook(e.target.value)}
                  placeholder={"e.g. Open with a question card asking which product line they're evaluating. Show the pricing chart only after they mention budget. If they agree to a follow-up, show the scheduling card immediately. Never show alerts."}
                />
              </Field>

              <div className="subhead">Card placement</div>
              <p className="lede" style={{ marginBottom: 10 }}>
                Cards render in a side rail beside the PAL video — right or left are the only placements the platform offers. This steers the PAL's choice via conversation context.
              </p>
              <div className="placement-row">
                {[
                  { v: "auto", label: "PAL decides", right: true, left: true },
                  { v: "right", label: "Prefer right rail", right: true, left: false },
                  { v: "left", label: "Prefer left rail", right: false, left: true },
                ].map((o) => (
                  <div key={o.v} className={"placement-card" + (placement === o.v ? " on" : "")} onClick={() => setPlacement(o.v)}>
                    <div className="placement-viz">
                      <div className={"pv-rail" + (o.left ? "" : " ghost")} />
                      <div className="pv-video" />
                      <div className={"pv-rail" + (o.right ? "" : " ghost")} />
                    </div>
                    {o.label}
                  </div>
                ))}
              </div>
              <p className="field-hint" style={{ marginTop: 14, maxWidth: 560 }}>
                Canvas only fires on video conversations. One card on screen at a time; a new card replaces the current one. Interactions land at your callback URL as canvas.interaction events.
              </p>

              <div className="subhead" style={{ marginTop: 30 }}>Scripted cards — 100% deterministic</div>
              <p className="lede" style={{ marginBottom: 10 }}>
                Magic Canvas cards above are chosen by the AI. Scripted cards are <b>yours</b>: you author the exact
                content, and it appears when your rule fires — when a word is spoken (by either side, so it tracks
                your talk track), at a set time, or at call start. The AI is never consulted. Shows on desktop and
                live-kiosk pages; an interactive Magic Canvas card takes the panel over while it needs input.
              </p>
              <Field label="✨ Vibe-build the card set" hint="Type or 🎙 talk out what should appear and when — Claude designs the cards (real content, trigger words that match your talk track) straight into the editors below, all yours to tweak.">
                <textarea
                  style={{ minHeight: 56, ...(dictating === "cards" ? { outline: "2px solid var(--accent)" } : {}) }}
                  value={cardsPrompt}
                  onChange={(e) => setCardsPrompt(e.target.value)}
                  placeholder={'e.g. "a pricing chart when tiers come up, our three headline stats early on, and a which-package-fits question near the end"'}
                />
                <div style={{ display: "flex", gap: 8, marginTop: 8, flexWrap: "wrap" }}>
                  <button
                    className={"pill-btn" + (dictating === "cards" ? " primary" : "")}
                    disabled={transcribing}
                    title={`Dictation by ${dictEngineName}`}
                    onClick={() => toggleDictation("cards", (t2) => setCardsPrompt((v) => (v ? v + " " : "") + t2))}
                  >
                    {dictating === "cards" ? "⏹ Stop — I'm done" : transcribing ? "🎙 Transcribing…" : "🎙 Talk it out"}
                  </button>
                  <button className="pill-btn primary" onClick={generateScriptedCards} disabled={cardsBusy || !cardsPrompt.trim()}>
                    {cardsBusy ? "Designing…" : scCards.length ? "✨ Regenerate the card set" : "✨ Generate the card set"}
                  </button>
                </div>
              </Field>
              {scCards.length > 0 && (
                <div className="jr-list">
                  {scCards.map((c, i) => (
                    <div key={i} className="jr-card">
                      <div className="jr-head">
                        <span className="jr-num">{i + 1}</span>
                        <select style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} value={c.style || "note"}
                          onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, style: e.target.value } : x)))}>
                          <option value="note">📄 Note</option>
                          <option value="chart">📊 Chart</option>
                          <option value="stat">🔢 Big stat</option>
                          <option value="image">🖼 Image</option>
                          <option value="question">❓ Multiple choice</option>
                          <option value="link">📅 Booking link</option>
                        </select>
                        <select style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} value={c.trigger || "keyword"}
                          onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, trigger: e.target.value } : x)))}>
                          <option value="keyword">when a word is said</option>
                          <option value="time">at a set time</option>
                          <option value="start">at call start</option>
                        </select>
                        {(c.trigger || "keyword") === "keyword" && (
                          <select style={{ width: "auto", padding: "4px 10px", fontSize: 12 }} value={c.speaker || "either"}
                            title="Whose speech arms this card. The PAL says your trigger words far more often than the visitor does."
                            onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, speaker: e.target.value } : x)))}>
                            <option value="either">by either of us</option>
                            <option value="visitor">by the visitor</option>
                            <option value="ai">by the AI human</option>
                          </select>
                        )}
                        <span className="jr-btns">
                          <button className="kb-move" onClick={() => setScCards((cs) => { if (!cs[i - 1]) return cs; const n = [...cs]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} disabled={i === 0} title="Move up">↑</button>
                          <button className="kb-move" onClick={() => setScCards((cs) => { if (!cs[i + 1]) return cs; const n = [...cs]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} disabled={i === scCards.length - 1} title="Move down">↓</button>
                          <button className="kb-del" onClick={() => setScCards((cs) => cs.filter((_, j) => j !== i))} title="Remove card">✕</button>
                        </span>
                      </div>
                      <div style={{ display: "flex", gap: 14, flexWrap: "wrap" }}>
                        <div style={{ flex: "1 1 280px", minWidth: 240 }}>
                          {(c.trigger || "keyword") === "keyword" && (
                            <>
                              <input value={c.keywords || ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, keywords: e.target.value } : x)))}
                                placeholder='Trigger words, comma-separated — e.g. pricing, cost, tiers' />
                              {/* A comma-less sentence is one phrase, matched verbatim — it
                                  reads like a list and silently never fires. */}
                              {!(c.keywords || "").includes(",") && (c.keywords || "").trim().split(/\s+/).length >= 3 && (
                                <span className="field-hint" style={{ color: "var(--danger)" }}>
                                  No commas — this fires only if someone says “{(c.keywords || "").trim()}” word for word. Separate the alternatives with commas.
                                </span>
                              )}
                            </>
                          )}
                          {c.trigger === "time" && (
                            <input type="number" min="0.5" step="0.5" value={c.atMinutes ?? ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, atMinutes: e.target.value } : x)))}
                              placeholder="Minutes into the call — e.g. 2" />
                          )}
                          <input value={c.title || ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, title: e.target.value } : x)))}
                            placeholder={c.style === "question" ? "The question — e.g. Which package fits you best?" : "Card title (optional)"} />
                          {c.style === "link" && (
                            <>
                              <input className="mono" value={c.href || ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, href: e.target.value } : x)))}
                                placeholder={schedulingUrl.trim() ? `Booking URL — blank uses ${schedulingUrl.trim()}` : "Booking URL — e.g. https://calendly.com/you/30min"} />
                              <input value={c.linkLabel || ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, linkLabel: e.target.value } : x)))}
                                placeholder='Button label — e.g. "Book a session" (blank = Book a time)' />
                            </>
                          )}
                          {c.style === "image" ? (
                            <input className="mono" value={c.url || ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, url: e.target.value } : x)))} placeholder="Image URL" />
                          ) : (
                            <textarea value={c.body || ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, body: e.target.value } : x)))}
                              placeholder={c.style === "chart" ? "One bar per line — Label: number (e.g. Tier 1: 4900)" : c.style === "stat" ? "Big value on the first line, label on the second — e.g.\n87%\nless manual work" : c.style === "question" ? "One choice per line (2–4):\nClassic Santa\nBetter Santa" : c.style === "link" ? "Optional lines above the button — e.g.\nYour issue and full context are attached" : "The exact text to show, one paragraph per line."}
                              style={{ minHeight: 68 }} />
                          )}
                          <input type="number" min="0" value={c.hideAfter ?? ""} onChange={(e) => setScCards((cs) => cs.map((x, j) => (j === i ? { ...x, hideAfter: e.target.value } : x)))}
                            placeholder={`Auto-hide after N seconds (blank = ${DEFAULT_HIDE_S})`} />
                        </div>
                        {(() => {
                          const preview = compiledScriptedCards.find((_, k) => {
                            // map editor index → compiled index (incomplete cards drop out)
                            let n = -1;
                            for (let j = 0; j <= i; j++) {
                              // Same completeness test the compiler runs, so a
                              // booking card can't shift every preview below it.
                              if (scCardComplete(scCards[j].style === "link" && !String(scCards[j].href || "").trim() && schedulingUrl.trim()
                                ? { ...scCards[j], href: schedulingUrl.trim() }
                                : scCards[j])) n++;
                            }
                            return k === n && n >= 0;
                          });
                          return preview ? (
                            <div className="sc-preview" title="Live preview — exactly what the visitor sees">
                              <ScriptedCard card={preview} />
                            </div>
                          ) : (
                            <div className="sc-preview sc-preview-empty">
                              <b style={{ color: "var(--danger)" }}>⚠ This card won't appear.</b><br />
                              {c.style === "link" && !String(c.href || "").trim() && !schedulingUrl.trim()
                                ? "It needs a booking URL — either here, or the scheduling link on this step."
                                : c.style === "image" && !String(c.url || "").trim()
                                ? "It needs an image URL."
                                : !String(c.body || "").trim()
                                ? "It needs card text."
                                : "It needs a trigger — words, a time, or call start."}
                            </div>
                          );
                        })()}
                      </div>
                    </div>
                  ))}
                </div>
              )}
              <button className="pill-btn" onClick={() => setScCards((cs) => (cs.length >= 12 ? cs : [...cs, { style: "note", trigger: "keyword" }]))}>+ Scripted card</button>
            </>
          )}

          {step === "tools" && (
            <>
              <div className="skill-head">
                <h1>Integrations</h1>
                <Toggle on={toolsEnabled} onChange={setToolsEnabled} />
              </div>
              <p className="lede">
                Give the PAL abilities in plain English — "check a seat count", "book a meeting", "file a ticket". When it decides to use one mid-conversation, Tavus can either fire the call at your frontend and any webhook you point at, or <b>call your API, wait for the answer, and let the PAL say it out loud</b>. The second is what makes a tool demo land: the AI human looks something real up and tells them what it found.
              </p>

              {toolRows.map((row, i) => (
                <div key={i} className="kb-row" style={{ maxWidth: 640, marginBottom: 8, flexWrap: "wrap", gap: 8 }}>
                  <input style={{ flex: "1 1 140px" }} disabled={!toolsEnabled} value={row.name} placeholder="Ability — e.g. Book a meeting"
                    onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, name: e.target.value } : r))} />
                  <input style={{ flex: "2 1 220px" }} disabled={!toolsEnabled} value={row.desc} placeholder="When to use it — e.g. When they agree to a follow-up call"
                    onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, desc: e.target.value } : r))} />
                  <input style={{ flex: "1 1 150px" }} disabled={!toolsEnabled} value={row.fields} placeholder="Details to collect — name, email"
                    onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, fields: e.target.value } : r))} />
                  {toolRows.length > 1 && (
                    <button className="kb-del" onClick={() => setToolRows((rs) => rs.filter((_, j) => j !== i))}>✕</button>
                  )}
                  <div style={{ flexBasis: "100%", display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
                    <select style={{ width: "auto", fontSize: 12.5, padding: "5px 9px" }} disabled={!toolsEnabled}
                      value={row.delivery || "app_message"}
                      onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, delivery: e.target.value } : r))}>
                      <option value="app_message">→ the browser (fire & forget)</option>
                      <option value="api">→ your API (it speaks the answer)</option>
                    </select>
                    {row.delivery === "api" && (
                      <>
                        <select style={{ width: "auto", fontSize: 12.5, padding: "5px 9px" }} disabled={!toolsEnabled}
                          value={row.method || "POST"}
                          onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, method: e.target.value } : r))}>
                          {["POST", "GET", "PUT", "PATCH", "DELETE"].map((m) => <option key={m} value={m}>{m}</option>)}
                        </select>
                        <input className="mono" style={{ flex: "1 1 240px", fontSize: 12.5 }} disabled={!toolsEnabled}
                          value={row.url || ""} placeholder="https://your-api.example.com/lookup"
                          onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, url: e.target.value } : r))} />
                        <select style={{ width: "auto", fontSize: 12.5, padding: "5px 9px" }} disabled={!toolsEnabled}
                          value={row.authType || "none"}
                          onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, authType: e.target.value } : r))}>
                          <option value="none">no auth</option>
                          <option value="bearer">bearer token</option>
                          <option value="api_key">API key header</option>
                        </select>
                        {row.authType === "api_key" && (
                          <input className="mono" style={{ width: 130, fontSize: 12.5 }} disabled={!toolsEnabled}
                            value={row.authName || ""} placeholder="header name"
                            onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, authName: e.target.value } : r))} />
                        )}
                        {(row.authType === "bearer" || row.authType === "api_key") && (
                          <input className="mono" type="password" style={{ width: 150, fontSize: 12.5 }} disabled={!toolsEnabled}
                            value={row.authValue || ""} placeholder="secret"
                            onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, authValue: e.target.value } : r))} />
                        )}
                      </>
                    )}
                    <select style={{ width: "auto", fontSize: 12.5, padding: "5px 9px" }} disabled={!toolsEnabled}
                      title="What it does while the call is in flight"
                      value={row.onCall || (row.delivery === "api" ? "silent" : "generate_filler")}
                      onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, onCall: e.target.value } : r))}>
                      <option value="silent">stays quiet while it runs</option>
                      <option value="generate_filler">improvises a filler line</option>
                      <option value="static_filler">says a set line</option>
                    </select>
                    {(row.onCall || (row.delivery === "api" ? "silent" : "generate_filler")) === "static_filler" && (
                      <input style={{ flex: "1 1 180px", fontSize: 12.5 }} disabled={!toolsEnabled}
                        value={row.filler || ""} placeholder='e.g. "Let me pull that up."'
                        onChange={(e) => setToolRows((rs) => rs.map((r, j) => j === i ? { ...r, filler: e.target.value } : r))} />
                    )}
                  </div>
                  {row.delivery === "api" && !String(row.url || "").trim().startsWith("https://") && (
                    <span className="field-hint" style={{ flexBasis: "100%", color: "var(--danger)" }}>
                      Needs an https:// URL — without one this falls back to browser delivery and the PAL can't use the result.
                    </span>
                  )}
                </div>
              ))}
              <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13, marginBottom: 20 }} disabled={!toolsEnabled}
                onClick={() => setToolRows((rs) => [...rs, { name: "", desc: "", fields: "", delivery: "app_message" }])}>+ Add ability</button>

              <Field label="Send tool calls to (webhook URL)" hint="Any HTTPS endpoint — a Zapier 'Catch Hook', Make, n8n, or your own API. Each call posts JSON: { tool, arguments, conversation_id }. Fires live from the demo page.">
                <input className="mono" disabled={!toolsEnabled} value={toolWebhook} onChange={(e) => setToolWebhook(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" />
              </Field>
              <Field label="Spoken confirmation (optional)" hint="Said by the PAL right after it uses an ability.">
                <input disabled={!toolsEnabled} value={toolEcho} onChange={(e) => setToolEcho(e.target.value)} placeholder="Done — I've sent that over to the team." />
              </Field>
              <p className="field-hint" style={{ maxWidth: 620 }}>
                On launch each ability is registered at <span className="mono">/v2/tools</span> and attached to the PAL
                ({toolDefs.length ? toolDefs.map((t) => t.name).join(", ") : "none defined yet"}); re-launching updates them in place
                rather than creating duplicates, and anything left attached from another demo is detached.
                <br /><br />
                <b>→ your API</b> is the one worth using. Tavus calls your endpoint, waits for the JSON, and the PAL answers
                from what came back — "your account has 2 of 100 seats used". <b>→ the browser</b> is the old behaviour:
                the call reaches the demo page and the webhook below, the PAL never learns the result, so it can only
                acknowledge that something happened.
              </p>

              <div className="subhead" style={{ marginTop: 26 }}>Tavus skills</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 12 }}>
                Pre-built abilities Tavus maintains — toggle on and they attach to the PAL at launch, then persist until you detach them.
              </p>

              <div className="skill-head" style={{ maxWidth: 560, marginBottom: 4 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>🔎 Internet Search</span>
                <span style={{ display: "flex", gap: 8, alignItems: "center" }}>
                  <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => detachSkill("internet_search")}>Detach</button>
                  <Toggle on={internetSearchEnabled} onChange={setInternetSearchEnabled} />
                </span>
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 16 }}>
                Live web answers mid-call — no configuration.
              </p>

              <p className="field-hint" style={{ maxWidth: 560 }}>
                🌐 <b>Browser Use moved to the Presentation step</b> — it's an on-stage surface like slides, so it lives with them now
                (browse plan, live config options from Tavus, validate-and-attach).{" "}
                <button className="pill-btn" style={{ padding: "2px 10px", fontSize: 11.5 }} onClick={() => setStep("presentation")}>Take me there</button>
              </p>
            </>
          )}

          {step === "grade" && (
            <>
              <div className="skill-head">
                <h1>Scorecard</h1>
                <Toggle on={gradeEnabled} onChange={setGradeEnabled} />
              </div>
              <p className="lede">
                Grade a finished interview against a rubric you define. This runs <b>after</b> the call, on the transcript Tavus
                already keeps — it never touches the PAL, the conversation, or what the candidate sees. Grade from the Results step.
              </p>

              <Field label="Role" hint="Gives the grader the context a hiring manager would have. Optional.">
                <input value={gradeRole} onChange={(e) => setGradeRole(e.target.value)} placeholder="e.g. Enterprise AE, Mid-Market · Construction SaaS" />
              </Field>

              <div className="subhead" style={{ marginTop: 18 }}>Build the rubric from what you already have</div>
              <Field label="" hint="Paste a job description, a training curriculum, an interview guide — whatever defines what good looks like. Claude keeps only the competencies a spoken conversation can actually evidence.">
                <textarea style={{ minHeight: 110 }} value={gradeSource} onChange={(e) => setGradeSource(e.target.value)}
                  placeholder="Paste the JD or curriculum here…" />
              </Field>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                <button className="pill-btn primary" onClick={draftRubric} disabled={gradeBusy || !gradeSource.trim()}>
                  {gradeBusy ? "Reading…" : parsedRubric.length ? "✨ Redraft the rubric" : "✨ Draft the rubric"}
                </button>
              </div>

              <div className="subhead">The rubric</div>
              <Field label="" hint="One competency per line: what it is | what a strong answer sounds like | weight 1-3. The middle part is what the grader actually matches against, so make it observable — something they'd SAY, not a trait.">
                <textarea style={{ minHeight: 150 }} className="mono" value={gradeRubricText} onChange={(e) => setGradeRubricText(e.target.value)}
                  placeholder={"Discovery | Asks what the buyer's process looks like before pitching | 3\nHandles objection | Acknowledges the concern, then reframes with a concrete example | 2\nProduct fluency | Explains a technical detail so a non-technical buyer follows it | 1"} />
              </Field>

              {parsedRubric.length > 0 ? (
                <>
                  <div className="subhead" style={{ marginTop: 4 }}>Parsed — {parsedRubric.length} competenc{parsedRubric.length === 1 ? "y" : "ies"}</div>
                  <div className="kb-list" style={{ maxWidth: 640, marginBottom: 16 }}>
                    {parsedRubric.map((r, i) => (
                      <div key={i} className="kb-row" style={{ alignItems: "flex-start", gap: 10 }}>
                        <span style={{ color: "var(--muted)", fontSize: 12, width: 18, flexShrink: 0 }}>{i + 1}.</span>
                        <span style={{ flex: 1, fontSize: 13, lineHeight: 1.5 }}>
                          <b>{r.label}</b>
                          {r.good ? <span style={{ color: "var(--muted)" }}> — {r.good}</span>
                            : <span style={{ color: "var(--danger)" }}> — no "strong looks like" yet; the grader is guessing</span>}
                        </span>
                        <span className="gc-weight" style={{ flexShrink: 0 }}>{r.weight}×</span>
                      </div>
                    ))}
                  </div>
                </>
              ) : (
                <p className="field-hint" style={{ color: "var(--muted)", marginBottom: 16 }}>
                  Nothing parsed yet — each line needs at least a competency name.
                </p>
              )}

              <p className="field-hint" style={{ maxWidth: 620 }}>
                Scores are 1-5 per competency and every score comes with the candidate's own words as evidence. A competency the
                conversation never reached is marked <b>no signal</b> rather than scored — it doesn't drag the average down, and the
                overall says how many of the rubric actually got evidenced. The weighted average is computed in the browser, not by
                the model.
              </p>
            </>
          )}

          {step === "calls" && (
            <>
              <div className="skill-head">
                <h1>Results</h1>
                <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={fetchCalls} disabled={callsLoading}>
                  {callsLoading ? "Loading…" : callsList ? "Refresh" : "Load calls"}
                </button>
              </div>
              <p className="lede">
                Every conversation on this account — including ones visitors started from shared links. Open a call for its full transcript, what the PAL saw (perception analysis), and the raw event data. Pulled live from Tavus, so it's always complete.
              </p>
              {callsError && <p className="field-hint" style={{ color: "var(--danger)", maxWidth: 560, marginTop: -6, marginBottom: 14 }}>{callsError}</p>}

              <div className="skill-head">
                <div className="subhead" style={{ margin: 0 }}>Shared-demo dashboard</div>
                <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => fetchDemoStats()} disabled={demoStatsLoading}>
                  {demoStatsLoading ? "Loading…" : demoStats ? "Refresh" : "Load dashboard"}
                </button>
              </div>
              {demoStats === null && !demoDetail && (
                <p className="field-hint" style={{ maxWidth: 560 }}>Stats per shared link: total starts, activity by day, and each visitor conversation (click through to its transcript).</p>
              )}
              {demoDetail ? (
                <div style={{ maxWidth: 640, marginBottom: 24 }}>
                  <div style={{ display: "flex", gap: 10, alignItems: "center", marginBottom: 10 }}>
                    <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => setDemoDetail(null)}>← All demos</button>
                    <span className="mono" style={{ fontSize: 12.5 }}>/d/{demoDetail.slug}</span>
                    <span className="field-hint" style={{ margin: 0 }}>{demoDetail.launches} start{demoDetail.launches === 1 ? "" : "s"} total</span>
                  </div>
                  <div className="stat-bars" title="Starts per day, last 14 days">
                    {demoDetail.days.map((d) => {
                      const max = Math.max(...demoDetail.days.map((x) => x.count), 1);
                      return (
                        <div key={d.date} className="stat-col" title={`${d.date}: ${d.count}`}>
                          <div className="stat-bar" style={{ height: `${Math.max(3, (d.count / max) * 44)}px`, opacity: d.count ? 1 : 0.25 }} />
                          <span className="stat-day">{d.date.slice(8)}</span>
                        </div>
                      );
                    })}
                  </div>
                  <div className="subhead" style={{ marginTop: 14 }}>Visitor conversations ({demoDetail.convos.length})</div>
                  {demoDetail.convos.length === 0 && <p className="field-hint">None yet — share the link!</p>}
                  <div className="kb-list">
                    {demoDetail.convos.map((c) => (
                      <div key={c.id} className="kb-row">
                        <span className="mono" style={{ flex: 1, fontSize: 12 }}>{c.id}</span>
                        {expMap[c.id]?.email && <span title={`Visitor: ${expMap[c.id].email}`} style={{ flexShrink: 0 }}>👤</span>}
                        {expMap[c.id]?.rating > 0 && <span title={`Rated ${expMap[c.id].rating}/5`} style={{ flexShrink: 0, color: "#F3B93F" }}>★{expMap[c.id].rating}</span>}
                        {recMap[c.id]?.uri && <span title={`Recorded: ${recMap[c.id].uri}`} style={{ flexShrink: 0 }}>⏺</span>}
                        <span style={{ color: "var(--muted)", fontSize: 11.5 }}>{(c.at || "").slice(0, 16).replace("T", " ")}</span>
                        <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => openCall(c.id)} disabled={callDetailLoading}>
                          Transcript
                        </button>
                      </div>
                    ))}
                  </div>
                </div>
              ) : demoStats && (
                demoStats.length === 0
                  ? <p className="field-hint" style={{ marginBottom: 20 }}>No shared links yet — create one on the Launch step.</p>
                  : (
                    <div className="kb-list" style={{ marginBottom: 24 }}>
                      {demoStats.map((d) => (
                        <div key={d.slug} className="kb-row">
                          <span style={{ flex: 1, fontSize: 13 }}>{d.name || d.slug}</span>
                          <span className="mono" style={{ fontSize: 11.5, color: "var(--muted)" }}>/d/{d.slug}</span>
                          <span className="kb-status" title="Total starts">{d.launches} ▶</span>
                          <span style={{ color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }} title="Last activity">
                            {d.last ? d.last.slice(0, 16).replace("T", " ") : "—"}
                          </span>
                          <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => fetchDemoStats(d.slug)} disabled={demoStatsLoading}>
                            Stats
                          </button>
                        </div>
                      ))}
                    </div>
                  )
              )}

              {!callDetail && !!callsList?.length && (() => {
                // Recordings as their own category — every call that produced a
                // file in the bucket, no per-call digging.
                const recorded = callsList.filter((c) => recMap[c.conversation_id]?.uri);
                return (
                  <>
                    <div className="subhead">⏺ Recordings ({recorded.length})</div>
                    {recorded.length === 0 ? (
                      <p className="field-hint" style={{ maxWidth: 560, marginBottom: 20 }}>
                        None captured yet. Calls record when S3 recording (Timing step) is on at launch; the file's location lands here a minute or so after each call ends.
                      </p>
                    ) : (
                      <div className="kb-list" style={{ marginBottom: 24 }}>
                        {recorded.map((c) => {
                          const rec = recMap[c.conversation_id];
                          return (
                            <div key={c.conversation_id} className="kb-row">
                              <span style={{ flex: 1, fontSize: 13 }}>
                                {c.conversation_name || <span className="mono" style={{ fontSize: 12 }}>{c.conversation_id}</span>}
                              </span>
                              {rec.duration > 0 && <span style={{ color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }}>{Math.floor(rec.duration / 60)}m {Math.round(rec.duration % 60)}s</span>}
                              <span style={{ color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }}>{(c.created_at || "").slice(0, 16).replace("T", " ")}</span>
                              <a className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, textDecoration: "none" }}
                                href={`/api/recording-url?id=${c.conversation_id}`} target="_blank" rel="noreferrer"
                                title="Downloads the MP4 (15-min signed link — needs the read-only AWS key on the server)">
                                ⭳ Download
                              </a>
                              <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => navigator.clipboard?.writeText(rec.uri).catch(() => {})} title={rec.uri}>
                                Copy path
                              </button>
                              {rec.bucket && (
                                <a className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, textDecoration: "none" }}
                                  href={`https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(rec.bucket)}?prefix=${encodeURIComponent((rec.key || "").replace(/[^/]*$/, ""))}`}
                                  target="_blank" rel="noreferrer">S3 ↗</a>
                              )}
                              <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => openCall(c.conversation_id)} disabled={callDetailLoading}>
                                Transcript
                              </button>
                            </div>
                          );
                        })}
                      </div>
                    )}
                  </>
                );
              })()}

              {!callDetail && !!callsList?.length && (() => {
                // Attendance + feedback from the Experience arc, as its own
                // category — who showed up and what they thought, at a glance.
                const attended = callsList.filter((c) => {
                  const e = expMap[c.conversation_id];
                  return e && (e.email || e.rating || e.comment);
                });
                if (!attended.length) return null;
                return (
                  <>
                    <div className="subhead">👤 Visitors &amp; feedback ({attended.length})</div>
                    <div className="kb-list" style={{ marginBottom: 24 }}>
                      {attended.map((c) => {
                        const e = expMap[c.conversation_id];
                        return (
                          <div key={c.conversation_id} className="kb-row">
                            <span style={{ flex: 1, fontSize: 13 }}>
                              {e.email || <span className="mono" style={{ fontSize: 12 }}>{c.conversation_id}</span>}
                            </span>
                            {e.rating > 0 && <span style={{ color: "#F3B93F", flexShrink: 0 }} title={`Rated ${e.rating}/5`}>{"★".repeat(e.rating)}</span>}
                            {e.comment && (
                              <span style={{ color: "var(--muted)", fontSize: 12, maxWidth: 260, overflow: "hidden", textOverflow: "ellipsis", whiteSpace: "nowrap" }} title={e.comment}>
                                “{e.comment}”
                              </span>
                            )}
                            <span style={{ color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }}>{(c.created_at || "").slice(0, 16).replace("T", " ")}</span>
                            <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => openCall(c.conversation_id)} disabled={callDetailLoading}>
                              Transcript
                            </button>
                          </div>
                        );
                      })}
                    </div>
                  </>
                );
              })()}

              <div className="subhead">All calls on this account{callsList?.length ? ` (${callsList.length})` : ""}</div>

              {callDetail ? (
                <>
                  <div style={{ display: "flex", gap: 8, marginBottom: 14, flexWrap: "wrap" }}>
                    <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => setCallDetail(null)}>← All calls</button>
                    <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => downloadTranscript("txt")}
                      disabled={!Array.isArray(callTranscript())} title="Readable speaker-labeled transcript">Transcript .txt</button>
                    <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={() => downloadTranscript("json")}
                      disabled={!Array.isArray(callTranscript())} title="Structured transcript with roles + timestamps">Transcript .json</button>
                    <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={downloadPerception}
                      disabled={!callPerception().length} title="What the PAL saw & heard (Vision analyses)">Perception .txt</button>
                    <button className="pill-btn" style={{ padding: "6px 14px", fontSize: 13 }} onClick={downloadCall} title="Everything — every event Tavus recorded">Full data .json</button>
                  </div>
                  <p className="field-hint">
                    <span className="mono">{callDetail.conversation_id}</span> · {callDetail.conversation_name || "unnamed"} · {callDetail.status}
                  </p>
                  {(() => {
                    const events = callDetail.events || [];
                    const tEvent = events.find((e) => /transcription/i.test(e.event_type || ""));
                    const transcript = tEvent?.properties?.transcript;
                    const pEvents = events.filter((e) => /perception/i.test(e.event_type || ""));
                    const rec = recMap[callDetail.conversation_id];
                    const ex = expMap[callDetail.conversation_id];
                    const graded = gradeResults[callDetail.conversation_id];
                    return (
                      <>
                        {gradeEnabled && (
                          <>
                            <div className="subhead">Scorecard</div>
                            {parsedRubric.length === 0 ? (
                              <p className="field-hint" style={{ marginBottom: 14 }}>
                                No rubric yet — build one on the <b>Scorecard</b> step, then grade from here.
                              </p>
                            ) : (
                              <div style={{ marginBottom: 16 }}>
                                <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: graded ? 14 : 0 }}>
                                  <button className="pill-btn primary" style={{ padding: "6px 14px", fontSize: 13 }}
                                    onClick={() => gradeCall(callDetail.conversation_id, transcript)}
                                    disabled={!!gradingId || !Array.isArray(transcript)}
                                    title={Array.isArray(transcript) ? `Grade against ${parsedRubric.length} competencies` : "No transcript on this call yet"}>
                                    {gradingId === callDetail.conversation_id ? "Grading…" : graded ? "Grade again" : "◎ Grade this call"}
                                  </button>
                                  <span className="field-hint" style={{ margin: 0 }}>
                                    {Array.isArray(transcript)
                                      ? `${parsedRubric.length} competenc${parsedRubric.length === 1 ? "y" : "ies"} · runs on the transcript below`
                                      : "Waiting on the transcript — Tavus posts it a minute or so after a call ends."}
                                  </span>
                                </div>
                                {graded && <GradeCard grade={graded} rubric={parsedRubric} />}
                              </div>
                            )}
                          </>
                        )}
                        {ex && (ex.email || ex.rating || ex.comment) && (
                          <>
                            <div className="subhead">Visitor</div>
                            <div className="kb-row" style={{ maxWidth: 640, marginBottom: 14, flexWrap: "wrap" }}>
                              {ex.email && <span className="mono" style={{ fontSize: 12.5 }}>👤 {ex.email}</span>}
                              {ex.rating > 0 && <span style={{ color: "#F3B93F" }} title={`Rated ${ex.rating}/5`}>{"★".repeat(ex.rating)}{"☆".repeat(5 - ex.rating)}</span>}
                              {ex.attendAt && <span style={{ color: "var(--muted)", fontSize: 11.5 }}>joined {ex.attendAt.slice(0, 16).replace("T", " ")}</span>}
                              {Array.isArray(ex.answers) && ex.answers.length > 0 && (
                                <span style={{ flexBasis: "100%", fontSize: 12.5, color: "var(--muted)", lineHeight: 1.6 }}>
                                  {ex.answers.map((qa, qi) => <span key={qi} style={{ display: "block" }}>{qa.q} → <b style={{ color: "var(--text)", fontWeight: 600 }}>{qa.a}</b></span>)}
                                </span>
                              )}
                              {ex.comment && <span style={{ flexBasis: "100%", fontSize: 13, color: "var(--muted)", lineHeight: 1.5 }}>“{ex.comment}”</span>}
                            </div>
                          </>
                        )}
                        <div className="subhead">Recording</div>
                        {rec?.uri && !rec.error ? (
                          <div className="kb-row" style={{ maxWidth: 640, marginBottom: 14 }}>
                            <span className="mono" style={{ flex: 1, fontSize: 12, overflowWrap: "anywhere" }}>{rec.uri}</span>
                            {rec.duration > 0 && <span style={{ color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }}>{Math.round(rec.duration / 60)}m {Math.round(rec.duration % 60)}s</span>}
                            <a className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0, textDecoration: "none" }}
                              href={`/api/recording-url?id=${callDetail.conversation_id}`} target="_blank" rel="noreferrer">
                              ⭳ Download
                            </a>
                            <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0 }}
                              onClick={() => navigator.clipboard?.writeText(rec.uri).catch(() => {})}>
                              Copy path
                            </button>
                            {rec.bucket && (
                              <a className="pill-btn" style={{ padding: "4px 12px", fontSize: 12, flexShrink: 0, textDecoration: "none" }}
                                href={`https://s3.console.aws.amazon.com/s3/buckets/${encodeURIComponent(rec.bucket)}?prefix=${encodeURIComponent(rec.key.replace(/[^/]*$/, ""))}`}
                                target="_blank" rel="noreferrer">
                                Open in S3 ↗
                              </a>
                            )}
                          </div>
                        ) : rec?.error ? (
                          <p className="field-hint" style={{ color: "var(--danger)", maxWidth: 560 }}>
                            Recording delivery failed: {rec.error} — usually a trust-policy or region mismatch on the IAM role.
                          </p>
                        ) : (
                          <p className="field-hint">
                            None captured for this call. Recordings appear here when the Timing step's S3 recording is on (the location arrives a minute or so after the call ends; it's a download in S3 — add .mp4 to the filename to play it).
                          </p>
                        )}
                        <div className="subhead">Transcript</div>
                        {Array.isArray(transcript) && transcript.length ? (
                          <div className="transcript">
                            {transcript.filter((m) => m.role !== "system").map((m, i) => (
                              <div key={i} className={`t-row t-${m.role}`}>
                                <span className="t-role">{m.role === "assistant" ? (site.brand || "PAL") : "Visitor"}</span>
                                <span>{typeof m.content === "string" ? m.content : JSON.stringify(m.content)}</span>
                              </div>
                            ))}
                          </div>
                        ) : (
                          <p className="field-hint">No transcript yet — it appears shortly after a call ends.</p>
                        )}
                        <div className="subhead">What the PAL saw &amp; heard (perception)</div>
                        {pEvents.length ? pEvents.map((e, i) => (
                          <div key={i} className="perception-card">
                            {typeof e.properties?.analysis === "string" ? e.properties.analysis : JSON.stringify(e.properties, null, 2)}
                          </div>
                        )) : (
                          <p className="field-hint">No perception analysis — enable Vision on the PAL to get end-of-call visual summaries.</p>
                        )}
                        <div className="subhead">All events ({events.length})</div>
                        <p className="field-hint">Everything Tavus recorded for this call — tool calls, guardrail triggers, shutdown reason — is in the JSON download above.</p>
                      </>
                    );
                  })()}
                </>
              ) : (
                <>
                  {callsList === null && <p className="field-hint">Click "Load calls" to list conversations (needs the API key from Setup).</p>}
                  {callsList?.length === 0 && <p className="field-hint">No conversations yet.</p>}
                  {!!callsList?.length && (() => {
                    // The API key is account-wide (everyone's calls) — scope the
                    // view client-side: text search + only-my-PAL toggle.
                    const palOf = (c) => c.persona_id || c.pal_id || "";
                    const hasPalField = callsList.some((c) => palOf(c));
                    const q = callsFilter.trim().toLowerCase();
                    const matches = callsList.filter((c) => {
                      if (onlyMyPal && palId.trim() && hasPalField && palOf(c) !== palId.trim()) return false;
                      if (!q) return true;
                      return `${c.conversation_name || ""} ${c.conversation_id || ""}`.toLowerCase().includes(q);
                    });
                    const PER_PAGE = 25;
                    const pageCount = Math.max(1, Math.ceil(matches.length / PER_PAGE));
                    const page = Math.min(callsPage, pageCount - 1); // clamp — filters can shrink the list
                    const shown = matches.slice(page * PER_PAGE, (page + 1) * PER_PAGE);
                    return (
                      <>
                        <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap", marginBottom: 10 }}>
                          <input style={{ maxWidth: 260 }} value={callsFilter} onChange={(e) => { setCallsFilter(e.target.value); setCallsPage(0); }}
                            placeholder="Filter by demo name or ID…" />
                          {hasPalField && palId.trim() && (
                            <label style={{ display: "flex", alignItems: "center", gap: 6, fontSize: 12.5, color: "var(--muted)", cursor: "pointer" }}>
                              <input type="checkbox" checked={onlyMyPal} onChange={(e) => { setOnlyMyPal(e.target.checked); setCallsPage(0); }} />
                              only my current PAL ({palId.trim().slice(0, 10)}…)
                            </label>
                          )}
                          {(q || onlyMyPal) && <span className="field-hint" style={{ margin: 0 }}>{matches.length} of {callsList.length}</span>}
                        </div>
                        <div className="kb-list">
                          {shown.map((c) => (
                            <div key={c.conversation_id} className="kb-row">
                              <span style={{ flex: 1, fontSize: 13 }}>
                                {c.conversation_name || <span className="mono" style={{ fontSize: 12 }}>{c.conversation_id}</span>}
                              </span>
                              {expMap[c.conversation_id]?.email && <span title={`Visitor: ${expMap[c.conversation_id].email}`} style={{ flexShrink: 0 }}>👤</span>}
                              {expMap[c.conversation_id]?.rating > 0 && <span title={`Rated ${expMap[c.conversation_id].rating}/5`} style={{ flexShrink: 0, color: "#F3B93F" }}>★{expMap[c.conversation_id].rating}</span>}
                              {recMap[c.conversation_id]?.uri && <span title={`Recorded: ${recMap[c.conversation_id].uri}`} style={{ flexShrink: 0 }}>⏺</span>}
                              <span className={`kb-status ${c.status === "ended" ? "" : "kb-ready"}`}>{c.status}</span>
                              <span style={{ color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }}>{(c.created_at || "").slice(0, 16).replace("T", " ")}</span>
                              <button className="pill-btn" style={{ padding: "4px 12px", fontSize: 12 }} onClick={() => openCall(c.conversation_id)} disabled={callDetailLoading}>
                                {callDetailLoading ? "…" : "View"}
                              </button>
                            </div>
                          ))}
                          {!shown.length && <p className="field-hint">Nothing matches this filter.</p>}
                        </div>
                        {pageCount > 1 && (() => {
                          // Numbered pager: all pages when few; first/last plus a
                          // window around the current page (with gaps) when many.
                          const nums = [];
                          for (let i = 0; i < pageCount; i++) {
                            if (pageCount <= 9 || i === 0 || i === pageCount - 1 || Math.abs(i - page) <= 2) nums.push(i);
                            else if (nums[nums.length - 1] !== "gap") nums.push("gap");
                          }
                          return (
                            <div style={{ display: "flex", gap: 6, alignItems: "center", marginTop: 12, flexWrap: "wrap" }}>
                              <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} disabled={page === 0}
                                onClick={() => setCallsPage(page - 1)}>←</button>
                              {nums.map((n, i) => n === "gap"
                                ? <span key={`g${i}`} style={{ color: "var(--muted)", fontSize: 12 }}>…</span>
                                : (
                                  <button key={n} className={"pill-btn" + (n === page ? " primary" : "")}
                                    style={{ padding: "5px 11px", fontSize: 12 }} onClick={() => setCallsPage(n)}>
                                    {n + 1}
                                  </button>
                                ))}
                              <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} disabled={page >= pageCount - 1}
                                onClick={() => setCallsPage(page + 1)}>→</button>
                              <span className="field-hint" style={{ margin: "0 0 0 6px" }}>{matches.length} calls</span>
                            </div>
                          );
                        })()}
                      </>
                    );
                  })()}
                </>
              )}
            </>
          )}

          {step === "controls" && (
            <>
              <h1>Timing</h1>
              <p className="lede">
                The conversation's rhythm: Sparrow turn-taking (when it speaks, when it yields), how long the call runs, and what happens in the quiet moments.
              </p>

              <div className="subhead">🕊 Turn-taking — Sparrow</div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                Sparrow is the model deciding <b>when it's the AI's turn to talk</b> — pauses, interruptions, "mm-hm"s, the whole scene. Every dial left on
                "Tavus default" is untouched; anything you set persists on the PAL. <b>Sparrow-2</b> — the newest model, noticeably more natural
                back-and-forth — is on by default here and applied to the PAL at every launch (Tavus's own default is still Sparrow-1).
              </p>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(230px, 1fr))", gap: 12, maxWidth: 760, marginBottom: 8 }}>
                <Field label="Turn-taking model">
                  <select value={sparrowModel} onChange={(e) => setSparrowModel(e.target.value)}>
                    <option value="sparrow-2">Sparrow-2 — newest, whole-scene understanding (default)</option>
                    <option value="sparrow-1">Sparrow-1</option>
                    <option value="">Tavus default (currently Sparrow-1)</option>
                  </select>
                </Field>
                <Field label="Patience" hint="How long it waits before taking its turn — high = never talks over a thinker; low = snappy.">
                  <select value={sparrowPatience} onChange={(e) => setSparrowPatience(e.target.value)}>
                    <option value="">Tavus default</option>
                    <option value="low">Low — jumps in fast</option>
                    <option value="medium">Medium</option>
                    <option value="high">High — lets them finish thinking</option>
                  </select>
                </Field>
                <Field label="Interruptibility" hint="How easily the visitor can cut it off mid-sentence.">
                  <select value={sparrowInterrupt} onChange={(e) => setSparrowInterrupt(e.target.value)}>
                    <option value="">Tavus default</option>
                    <option value="verylow">Very low — finishes its thought</option>
                    <option value="low">Low</option>
                    <option value="medium">Medium</option>
                    <option value="high">High — yields instantly</option>
                  </select>
                </Field>
                <Field label="Voice isolation" hint='Filters background noise/voices — "near" focuses on the closest speaker. Great for kiosks and events.'>
                  <select value={sparrowIsolation} onChange={(e) => setSparrowIsolation(e.target.value)}>
                    <option value="">Tavus default</option>
                    <option value="near">Near — closest speaker only</option>
                  </select>
                </Field>
                <Field label="Idle engagement" hint="Whether it proactively breaks a long silence.">
                  <select value={sparrowIdle} onChange={(e) => setSparrowIdle(e.target.value)}>
                    <option value="">Tavus default</option>
                    <option value="patient">Patient — waits it out</option>
                  </select>
                </Field>
              </div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 22 }}>
                Recipes: <b>demo to executives</b> → Sparrow-2, patience high, interruptibility high (they talk, it yields). <b>Kiosk on a loud floor</b> →
                voice isolation near, patience medium. <b>Roleplay a pushy customer</b> → interruptibility very low (they must experience being talked over).
              </p>

              <div className="subhead">Conversation length</div>
              <Field label="Time limit (minutes)" hint="Blank = Tavus default (60). The call shuts down automatically when time is up.">
                <input type="number" min="1" max="60" style={{ maxWidth: 140 }} value={maxMinutes} onChange={(e) => setMaxMinutes(e.target.value)} placeholder="e.g. 10" />
              </Field>
              <Field label="Two-minutes-left announcement" hint="Spoken word-for-word when 2 minutes remain. Leave blank to skip. Needs a time limit of 3+ minutes.">
                <textarea value={timeWarning} onChange={(e) => setTimeWarning(e.target.value)}
                  placeholder="Just a heads up — we have about two minutes left. Is there anything else you'd like to cover?" />
              </Field>

              <div className="subhead">Quiet-visitor nudge</div>
              <Field label="Nudge after (seconds of silence)" hint="Blank = off. If nobody speaks for this long, the PAL says the reminder below — and if the silence continues another 10 seconds, the call closes.">
                <input type="number" min="10" max="600" style={{ maxWidth: 140 }} value={inactivitySeconds} onChange={(e) => setInactivitySeconds(e.target.value)} placeholder="e.g. 45" />
              </Field>
              <Field label="Reminder line" hint="Spoken word-for-word at the nudge.">
                <textarea value={inactivityUtterance} onChange={(e) => setInactivityUtterance(e.target.value)}
                  placeholder="Still there? I'll close our conversation in about ten seconds unless you'd like to keep going." />
              </Field>

              <div className="subhead">Wake phrase</div>
              <Field label="" hint="The AI greets once, then stays quiet until someone says this phrase — great for kiosks where people chat nearby. It's guidance (steers the AI), not a hard mute.">
                <input style={{ maxWidth: 320 }} value={wakePhrase} onChange={(e) => setWakePhrase(e.target.value)} placeholder='e.g. "Hey Ava"' />
              </Field>

              <div className="subhead">Recording → your S3 bucket</div>
              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>⏺ Record every call to S3</span>
                <Toggle on={recordingEnabled} onChange={setRecordingEnabled} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: recordingEnabled ? 14 : 18 }}>
                Tavus uploads the finished recording straight into your bucket — including calls started from shared demo links.
                Files land at <span className="mono">tavus/&lt;conversation_id&gt;/&lt;timestamp&gt;</span>, and each call's recording
                location shows up in <b>Results</b> next to its transcript a minute or so after the call ends.
                One-time AWS setup: create the bucket and an IAM role Tavus can assume (a trust policy — no AWS keys ever go in here, only names).
                The details below are remembered on this browser — fill them in once and every new demo records by default.
              </p>
              {recordingEnabled && (
                <>
                  <Field label="S3 bucket name" hint="Just the bucket name, no s3:// prefix.">
                    <input className="mono" style={{ maxWidth: 360 }} value={recS3Bucket} onChange={(e) => setRecS3Bucket(e.target.value)} placeholder="acme-demo-recordings" />
                  </Field>
                  <Field label="Bucket region">
                    <input className="mono" style={{ maxWidth: 220 }} value={recS3Region} onChange={(e) => setRecS3Region(e.target.value)} placeholder="us-east-1" />
                  </Field>
                  <Field label="IAM role ARN" hint="The role in your AWS account that trusts Tavus. Tavus assumes it to write the file — nothing else.">
                    <input className="mono" value={recS3RoleArn} onChange={(e) => setRecS3RoleArn(e.target.value)} placeholder="arn:aws:iam::123456789012:role/tavus-recording-writer" />
                  </Field>
                  <Field label="External ID (optional)" hint="Only if your role's trust policy requires one.">
                    <input className="mono" style={{ maxWidth: 360 }} value={recS3ExternalId} onChange={(e) => setRecS3ExternalId(e.target.value)} placeholder="leave blank unless your security team set one" />
                  </Field>
                  <Field label="What gets recorded" hint='Everyone = AI human and all humans side by side, constantly (no speaker switching). Full stage = the entire call screen — canvas cards included — via a one-click "share this tab" prompt when you press the ⏺ button on the call (your launches only; visitor calls fall back to Everyone). Speaker focus = talker fills the frame. AI human only = the old behavior.'>
                    <div className="seg">
                      {[["everyone", "Everyone"], ["stage", "Full stage + canvas"], ["speaker", "Speaker focus"], ["pal", "AI human only"]].map(([v, label]) => (
                        <button key={v} className={recLayout === v ? "on" : ""} onClick={() => setRecLayout(v)}>{label}</button>
                      ))}
                    </div>
                  </Field>
                  {!(recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim()) && (
                    <p className="field-hint" style={{ color: "var(--danger)", maxWidth: 560 }}>
                      Recording stays off until bucket, region, and role ARN are all filled in.
                    </p>
                  )}
                </>
              )}
            </>
          )}

          {step === "site" && (
            <>
              <h1>Page &amp; Brand</h1>
              <p className="lede">The launched conversation opens on a clean, branded page — the conversation stage front and center. Canvas cards and presentation slides appear inside the stage automatically.</p>

              <Field label="Match their website" hint="Paste the company's site and Claude restyles this page to their brand — colors, name, headline, logo. Everything stays editable below.">
                <div style={{ display: "flex", gap: 8 }}>
                  <input className="mono" value={brandUrl} onChange={(e) => setBrandUrl(e.target.value)} placeholder="https://acme.com"
                    onKeyDown={(e) => e.key === "Enter" && !theming && themeFromUrl()} />
                  <button className="pill-btn primary" style={{ flexShrink: 0 }} onClick={themeFromUrl} disabled={theming || !brandUrl.trim()}>
                    {theming ? "Theming…" : "Theme it"}
                  </button>
                </div>
                {site.theme && (
                  <span style={{ display: "inline-flex", alignItems: "center", gap: 6, marginTop: 4 }}>
                    {["canvas", "surface", "accent", "text"].map((k) => site.theme[k] && (
                      <span key={k} title={`${k}: ${site.theme[k]}`} style={{ width: 16, height: 16, borderRadius: 5, background: site.theme[k], border: "1px solid var(--border)" }} />
                    ))}
                    <button className="pill-btn" style={{ padding: "3px 10px", fontSize: 11, marginLeft: 4 }} onClick={() => setSiteField("theme", null)}>Reset to Alto</button>
                  </span>
                )}
              </Field>

              <Field label="Brand name">
                <input value={site.brand} onChange={(e) => setSiteField("brand", e.target.value)} placeholder="Acme Health" />
              </Field>
              <Field label="Logo" hint="Upload an image (stored with the config — no hosting needed). Falls back to a monogram when empty.">
                <div style={{ display: "flex", alignItems: "center", gap: 10 }}>
                  <button className="pill-btn" onClick={() => logoFileRef.current?.click()}>Upload logo…</button>
                  {site.logoUrl && (
                    <>
                      <img src={site.logoUrl} alt="logo preview" style={{ height: 30, borderRadius: 7, objectFit: "contain", border: "1px solid var(--border)", background: "#fff", padding: 2 }} />
                      <button className="pill-btn" style={{ padding: "6px 12px", fontSize: 12, color: "var(--danger)" }} onClick={() => setSiteField("logoUrl", "")}>Remove</button>
                    </>
                  )}
                  <input ref={logoFileRef} type="file" accept="image/*" style={{ display: "none" }}
                    onChange={(e) => { const f = e.target.files?.[0]; if (f) onLogoFile(f); e.target.value = ""; }} />
                </div>
              </Field>
              <Field label="Headline">
                <input value={site.headline} onChange={(e) => setSiteField("headline", e.target.value)} placeholder="Meet your AI onboarding specialist" />
              </Field>
              <Field label="Tagline" hint="One supporting sentence under the headline. Leave blank for a stage-only page.">
                <input value={site.tagline} onChange={(e) => setSiteField("tagline", e.target.value)} placeholder="Ask anything about the platform — live, face to face." />
              </Field>
              <Field label="Button label">
                <input value={site.cta} onChange={(e) => setSiteField("cta", e.target.value)} />
              </Field>

              <div className="subhead">Format</div>
              <div className="placement-row" style={{ marginBottom: 18 }}>
                {SITE_FORMATS.map((f) => (
                  <div key={f.v} className={"placement-card" + ((site.format || "desktop") === f.v ? " on" : "")} onClick={() => setSiteField("format", f.v)}>
                    <div className="format-viz">
                      {f.v === "desktop" && <div className="fv-desktop" />}
                      {f.v === "phone" && <div className="fv-phone" />}
                      {f.v === "kiosk" && <div className="fv-kiosk" />}
                      {f.v === "hologram" && <div className="fv-holo" />}
                    </div>
                    <div style={{ fontWeight: 600 }}>{f.label}</div>
                    <div style={{ fontSize: 11.5, marginTop: 4, lineHeight: 1.4 }}>{f.desc}</div>
                  </div>
                ))}
              </div>

              <div className="subhead">📸 Make it their site</div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                The reaction that sells is <b>"wait — that's OUR site."</b> Two ways to get it, best used together:
                the 🌐 URL above pulls their real name, colors, logo, nav and hero image onto the page automatically —
                and a <b>screenshot of their actual site</b> becomes the page itself, with the call sitting on top. Screenshot wins when both are set.
              </p>
              {site.shot ? (
                <div style={{ display: "flex", gap: 10, alignItems: "flex-start", marginBottom: 18, maxWidth: 640 }}>
                  <img src={site.shot} alt="site screenshot" style={{ width: 220, borderRadius: 10, border: "1px solid var(--border)" }} />
                  <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
                    <span className="field-hint">Their site is the backdrop — the call stage renders over it (desktop &amp; phone formats).</span>
                    <button className="pill-btn" style={{ alignSelf: "flex-start" }} onClick={() => setSiteField("shot", "")}>✕ Remove screenshot</button>
                  </div>
                </div>
              ) : (
                <div
                  tabIndex={0}
                  onPaste={(e) => { const f = [...(e.clipboardData?.files || [])].find((x) => x.type.startsWith("image/")); if (f) { e.preventDefault(); onShotFile(f); } }}
                  onClick={(e) => e.currentTarget.focus()}
                  style={{ border: "1.5px dashed var(--border)", borderRadius: 12, padding: "18px 16px", maxWidth: 640, marginBottom: 18, cursor: "text", fontSize: 13, color: "var(--muted)" }}>
                  Screenshot their homepage (⌘⇧4 / Win+Shift+S), then click here and <b>paste</b> (⌘V).
                  Works for apps, portals, and bot-protected sites the crawler can't reach.{" "}
                  <button className="pill-btn" style={{ padding: "2px 12px", fontSize: 12 }}
                    onClick={(e) => { e.stopPropagation(); shotFileRef.current?.click(); }}>
                    …or upload a file
                  </button>
                </div>
              )}
              <input ref={shotFileRef} type="file" accept="image/*" style={{ display: "none" }}
                onChange={(e) => { const f = e.target.files?.[0]; if (f) onShotFile(f); e.target.value = ""; }} />

              <div className="subhead">In-call controls</div>
              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>✋ Interrupt button</span>
                <Toggle on={interruptButton} onChange={setInterruptButton} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 18 }}>
                Adds a button to the call that instantly stops the AI mid-sentence — handy when it's mid-monologue and you want the floor.
              </p>

              <button className="pill-btn" onClick={() => setSiteMode(true)}>Preview the page</button>
            </>
          )}

          {step === "experience" && (
            <>
              <h1>Experience</h1>
              <p className="lede">
                Turn the demo page into a full product journey — guided steps you compose before the call
                (a waiver question, a persona picker, a video…), an email gate, and a feedback screen after.
                Everything rides shared links, and the visitor's answers shape the conversation and land in Results.
              </p>

              <div className="subhead">Guided journey (before the call)</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 12 }}>
                Compose the steps a visitor walks through before the conversation starts. Their choices and answers
                are woven into the call — the AI knows them from its first words — and stored with the call in Results.
              </p>
              {expJourney.length > 0 && (
                <div className="jr-list">
                  {expJourney.map((s, i) => (
                    <div key={i} className="jr-card">
                      <div className="jr-head">
                        <span className="jr-num">{i + 1}</span>
                        <span className="jr-type">
                          {s.type === "info" ? "📄 info screen" : s.type === "video" ? "🎬 video" : s.type === "question" ? "☑️ question" : s.type === "input" ? "✏️ free text" : "🎭 persona picker"}
                        </span>
                        <span className="jr-btns">
                          <button className="kb-move" onClick={() => moveJourneyStep(i, -1)} disabled={i === 0} title="Move up">↑</button>
                          <button className="kb-move" onClick={() => moveJourneyStep(i, 1)} disabled={i === expJourney.length - 1} title="Move down">↓</button>
                          <button className="kb-del" onClick={() => removeJourneyStep(i)} title="Remove step">✕</button>
                        </span>
                      </div>
                      {s.type === "info" && (
                        <>
                          <input value={s.title || ""} onChange={(e) => patchJourneyStep(i, { title: e.target.value })} placeholder="Title — e.g. Welcome to your assessment" />
                          <textarea value={s.body || ""} onChange={(e) => patchJourneyStep(i, { body: e.target.value })} placeholder="A short paragraph the visitor reads before continuing." />
                        </>
                      )}
                      {s.type === "video" && (
                        <>
                          <input value={s.title || ""} onChange={(e) => patchJourneyStep(i, { title: e.target.value })} placeholder="Title — e.g. Watch this 60-second intro" />
                          <input className="mono" value={s.url || ""} onChange={(e) => patchJourneyStep(i, { url: e.target.value })} placeholder="Video URL — YouTube, Loom, or a direct .mp4 link" />
                        </>
                      )}
                      {s.type === "question" && (
                        <>
                          <input value={s.prompt || ""} onChange={(e) => patchJourneyStep(i, { prompt: e.target.value })} placeholder="Question — e.g. Have you filled out the waiver form?" />
                          <textarea value={s.optionsText || ""} onChange={(e) => patchJourneyStep(i, { optionsText: e.target.value })} placeholder={"One answer per line (2–6). Add \" :: instructions\" to rewrite the AI's behavior for that pick:\nEasy :: Be warm and encouraging — softball questions, coach after every answer.\nHard :: Be a demanding interviewer — push back on vague answers, ask for numbers."} />
                          <p className="field-hint" style={{ margin: 0 }}>
                            The visitor's pick is fed to the AI and stored with the call. Anything after <b>::</b> on a line is a conversational-context override — it changes how the AI behaves when that option is picked, not just what it knows. The visitor only ever sees the label.
                          </p>
                        </>
                      )}
                      {s.type === "input" && (
                        <>
                          <input value={s.prompt || ""} onChange={(e) => patchJourneyStep(i, { prompt: e.target.value })} placeholder="Prompt — e.g. What's your first name?" />
                          <input value={s.placeholder || ""} onChange={(e) => patchJourneyStep(i, { placeholder: e.target.value })} placeholder="Placeholder text (optional)" />
                          <p className="field-hint" style={{ margin: 0 }}>Free text — great for names or specifics the AI should personalize around.</p>
                        </>
                      )}
                      {s.type === "personas" && (
                        <>
                          <input value={s.prompt || ""} onChange={(e) => patchJourneyStep(i, { prompt: e.target.value })} placeholder="Prompt — e.g. Who would you like to talk to?" />
                          {(s.options || []).map((o, oi) => (
                            <div key={oi} className="jr-opt">
                              <div style={{ display: "flex", gap: 6 }}>
                                <input value={o.label || ""} onChange={(e) => patchPersonaOption(i, oi, { label: e.target.value })} placeholder={`Option ${oi + 1} — e.g. Better Santa`} />
                                <button className="kb-del" onClick={() => patchJourneyStep(i, { options: s.options.filter((_, y) => y !== oi) })} disabled={(s.options || []).length <= 2} title="Remove option">✕</button>
                              </div>
                              <input value={o.desc || ""} onChange={(e) => patchPersonaOption(i, oi, { desc: e.target.value })} placeholder="One-line description the visitor sees" />
                              <textarea value={o.context || ""} onChange={(e) => patchPersonaOption(i, oi, { context: e.target.value })} placeholder="What changes when they pick this — instructions woven into the conversation." style={{ minHeight: 54 }} />
                              <div style={{ display: "flex", gap: 6 }}>
                                <input value={o.greeting || ""} onChange={(e) => patchPersonaOption(i, oi, { greeting: e.target.value })} placeholder="Custom opening line (optional)" />
                                <input className="mono" style={{ maxWidth: 170 }} value={o.palId || ""} onChange={(e) => patchPersonaOption(i, oi, { palId: e.target.value })} placeholder="PAL ID override (opt.)" title="Advanced: this option talks to a different PAL entirely" />
                              </div>
                            </div>
                          ))}
                          {(s.options || []).length < 4 && (
                            <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => patchJourneyStep(i, { options: [...(s.options || []), { label: "", desc: "", context: "" }] })}>
                              + Option
                            </button>
                          )}
                        </>
                      )}
                    </div>
                  ))}
                </div>
              )}
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 20 }}>
                <button className="pill-btn" onClick={() => addJourneyStep("info")}>+ Info screen</button>
                <button className="pill-btn" onClick={() => addJourneyStep("video")}>+ Video</button>
                <button className="pill-btn" onClick={() => addJourneyStep("question")}>+ Question</button>
                <button className="pill-btn" onClick={() => addJourneyStep("input")}>+ Free text</button>
                <button className="pill-btn" onClick={() => addJourneyStep("personas")}>+ Persona picker</button>
              </div>

              <div className="subhead">Before the call</div>
              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>📧 Email gate</span>
                <Toggle on={expEmailGate} onChange={setExpEmailGate} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 14 }}>
                Visitors enter their email before the conversation unlocks — so you always know who attended.
                It's stored with the call (see Results) and rides along on the attendance alert below.
              </p>
              {expEmailGate && (
                <>
                  <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer", marginBottom: 14 }}>
                    <input type="checkbox" style={{ width: "auto" }} checked={expEmailRequired} onChange={(e) => setExpEmailRequired(e.target.checked)} />
                    Required (unchecked adds a Skip link)
                  </label>
                  <Field label="Gate prompt" hint="The line above the email field. Leave blank for the default.">
                    <input value={expEmailPrompt} onChange={(e) => setExpEmailPrompt(e.target.value)} placeholder="Where can we reach you? The team likes to know who they're talking to." />
                  </Field>
                </>
              )}
              <Field label="Attendance alert webhook" hint="Optional. The moment a visitor starts a call on a shared link, this URL gets a POST with {type:'demo.attend', email, demo, conversation_id} — point it at a Zapier/Make catch hook for a Slack ping or email. Fires for visitor calls only (never your own previews), with or without the gate.">
                <input className="mono" value={expNotifyWebhook} onChange={(e) => setExpNotifyWebhook(e.target.value)} placeholder="https://hooks.zapier.com/hooks/catch/…" />
              </Field>

              <div className="subhead">After the call</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 14 }}>
                With any of these on, ending the call lands on a thank-you screen instead of snapping back to the landing page.
              </p>
              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>⭐ Rating &amp; comment</span>
                <Toggle on={expRating} onChange={setExpRating} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 14 }}>
                1–5 stars plus an optional comment — lands next to the call in Results.
              </p>
              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>📅 Book a meeting</span>
                <Toggle on={expBooking} onChange={setExpBooking} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: expBooking && !schedulingUrl.trim() ? 8 : 14 }}>
                The conversion CTA — opens your scheduling link in a new tab.
              </p>
              {expBooking && (
                <Field label="Scheduling link" hint="Shared with the Magic Canvas scheduling card — set once, used by both.">
                  <input className="mono" value={schedulingUrl} onChange={(e) => setSchedulingUrl(e.target.value)} placeholder="https://calendly.com/you/30min" />
                </Field>
              )}
              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>🔁 Talk again</span>
                <Toggle on={expTalkAgain} onChange={setExpTalkAgain} />
              </div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 14 }}>
                One click starts a fresh conversation from the thank-you screen.
              </p>
              <Field label="Thank-you message" hint="Headline of the post-call screen.">
                <input value={expThanks} onChange={(e) => setExpThanks(e.target.value)} placeholder="Thanks for the conversation!" />
              </Field>

              <div className="skill-head" style={{ marginBottom: 6 }}>
                <span style={{ fontSize: 13, fontWeight: 600 }}>🎯 Coach mode — live scorecard</span>
                <Toggle on={coachEnabled} onChange={setCoachEnabled} />
              </div>
              <p className="field-hint" style={{ maxWidth: 640, marginBottom: 10 }}>
                Turns the call into a roleplay trainer: a dark coach sidebar with behaviors that <b>tick off live</b> as the visitor demonstrates them, a talk/listen meter, the running transcript, and a REC timer. Great when the AI plays a tough customer and the visitor practices on them. The final score lands in Results.
              </p>
              {coachEnabled && (
                <>
                  <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 10, maxWidth: 680 }}>
                    <input style={{ flex: "2 1 240px" }} value={coachVibe} onChange={(e) => setCoachVibe(e.target.value)}
                      placeholder='What should they practice? — e.g. "door-to-door roof sales, homeowner burned by a storm chaser"' />
                    <button className="pill-btn primary" style={{ flexShrink: 0 }} onClick={draftCoach} disabled={coachBusy}>
                      {coachBusy ? "Drafting…" : "✨ Draft the scorecard"}
                    </button>
                  </div>
                  <Field label="Scenario title" hint='Shown on the REC bar — character-forward reads best: "The Storm-Chaser Shadow · Mark Whitaker".'>
                    <input value={coachTitle} onChange={(e) => setCoachTitle(e.target.value)} placeholder="The Storm-Chaser Shadow · Mark Whitaker" />
                  </Field>
                  <Field label="Scene line (shown while connecting)" hint="One tense line over the black screen before the character appears.">
                    <input value={coachScene} onChange={(e) => setCoachScene(e.target.value)} placeholder="Mark Whitaker is about to open the door." />
                  </Field>
                  <Field label="Scorecard behaviors" hint={'One per line. Optional "| word1, word2" after a line = instant tick when the visitor says one; lines without keywords are judged live by Claude every ~25s (conservative — a near-miss stays unticked).'}>
                    <textarea style={{ minHeight: 120 }} value={coachCriteriaText} onChange={(e) => setCoachCriteriaText(e.target.value)}
                      placeholder={"Acknowledged the bad experience before responding\nAsked what happened instead of pitching over it\nOffered something they can independently verify | license, reviews, references\nAsked for a specific inspection time | inspection"} />
                  </Field>
                  <Field label="Talk-meter nudge" hint="Coaching line under the talk/listen bar.">
                    <input value={coachTalkHint} onChange={(e) => setCoachTalkHint(e.target.value)} placeholder="Keep them talking." />
                  </Field>
                  <p className="field-hint" style={{ maxWidth: 640 }}>
                    Coach mode shows on desktop and live-kiosk formats. Tip: make the persona a hard character on the Persona step and keep Magic Canvas minimal — the scorecard <i>is</i> the visual.
                  </p>
                  <div className="skill-head" style={{ marginTop: 14, marginBottom: 4 }}>
                    <span style={{ fontSize: 13, fontWeight: 600 }}>👁 Show the scorecard to the person on the call</span>
                    <Toggle on={coachVisible} onChange={setCoachVisible} />
                  </div>
                  <p className="field-hint" style={{ maxWidth: 640 }}>
                    <b>On</b> for roleplay training — watching the criteria tick as they talk is the whole point.
                    <b> Off</b> for anything you're assessing: an interview candidate reading "mentions total cost of ownership"
                    off a sidebar is being handed the answer key. Scoring runs either way and still lands on the call record;
                    only the panel disappears.
                  </p>
                </>
              )}

              <button className="pill-btn" onClick={() => setSiteMode(true)}>Preview the page</button>
            </>
          )}

          {step === "studio" && (
            <>
              <h1>Studio</h1>
              <p className="lede">
                Record real MP4 feature demos with nobody on the visitor side. Script what the "visitor" says;
                <b> Record take</b> opens the demo page, speaks your lines with TTS and natural turn-taking, and
                captures the <b>full stage</b> — Magic Canvas cards, presentation slides, and the AI human exactly
                as rendered — to your S3 bucket. The take ends itself and shows up in Results with a ⏺ badge.
              </p>

              <div className="subhead">Ready check</div>
              <div className="kb-list" style={{ marginBottom: 18 }}>
                <div className="kb-row">
                  <span style={{ flex: 1, fontSize: 13 }}>Demo ready (key + Face + PAL)</span>
                  <span className={"kb-status " + (canLaunch ? "kb-ready" : "kb-error")}>{canLaunch ? "ready" : "missing — Account step"}</span>
                </div>
                <div className="kb-row">
                  <span style={{ flex: 1, fontSize: 13 }}>S3 recording (captures the take)</span>
                  <span className={"kb-status " + (recordingEnabled && recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim() ? "kb-ready" : "kb-error")}>
                    {recordingEnabled && recS3Bucket.trim() && recS3Region.trim() && recS3RoleArn.trim() ? "configured" : "set up on Timing"}
                  </span>
                </div>
                <div className="kb-row">
                  <span style={{ flex: 1, fontSize: 13 }}>TTS visitor voice</span>
                  <span className={"kb-status " + (ttsAvail?.available ? "kb-ready" : ttsAvail === null ? "" : "kb-error")}>
                    {ttsAvail === null ? "checking…" : ttsAvail?.available ? `Cartesia ready (${ttsAvail.voice})` : "add CARTESIA_API_KEY on Vercel"}
                  </span>
                </div>
              </div>

              <div className="subhead">The visitor's lines</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 10 }}>
                In order. The take waits for the AI human to finish each reply before speaking the next line —
                lines that exercise the feature you're demoing (say "pricing" to fire a scripted card,
                push a guardrail, ask for the deck…). Write them, or let Claude script them from this demo's config.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 12, maxWidth: 640 }}>
                <input style={{ flex: "1 1 280px" }} value={scriptFocus} onChange={(e) => setScriptFocus(e.target.value)}
                  placeholder='Focus (optional) — e.g. "show off the canvas cards and walk the deck"' />
                <button className="pill-btn primary" onClick={generateStudioScript} disabled={scriptBusy}>
                  {scriptBusy ? "Writing…" : "✨ Write the script for me"}
                </button>
              </div>
              <div className="kb-list" style={{ marginBottom: 10 }}>
                {studioLines.map((l, i) => (
                  <div key={i} className="kb-row">
                    <span className="jr-num" style={{ flexShrink: 0 }}>{i + 1}</span>
                    <input style={{ flex: 1 }} value={l.text} placeholder={i === 0 ? `e.g. Hi! Can you walk me through how this works?` : "…then the visitor says"}
                      onChange={(e) => setStudioLines((ls) => ls.map((x, j) => (j === i ? { text: e.target.value } : x)))} />
                    <button className="kb-move" onClick={() => setStudioLines((ls) => { if (!ls[i - 1]) return ls; const n = [...ls]; [n[i - 1], n[i]] = [n[i], n[i - 1]]; return n; })} disabled={i === 0} title="Move up">↑</button>
                    <button className="kb-move" onClick={() => setStudioLines((ls) => { if (!ls[i + 1]) return ls; const n = [...ls]; [n[i + 1], n[i]] = [n[i], n[i + 1]]; return n; })} disabled={i === studioLines.length - 1} title="Move down">↓</button>
                    <button className="kb-del" onClick={() => setStudioLines((ls) => (ls.length > 1 ? ls.filter((_, j) => j !== i) : ls))} disabled={studioLines.length <= 1} title="Remove line">✕</button>
                  </div>
                ))}
              </div>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 18 }}>
                <button className="pill-btn" onClick={() => setStudioLines((ls) => (ls.length >= 12 ? ls : [...ls, { text: "" }]))}>+ Line</button>
              </div>

              <div className="subhead">Scripted cards for this take</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 8 }}>
                Describe the cards you want and Claude designs them from this demo's config — chart, stat, note, image,
                or a clickable multiple-choice question. They land on the Magic Canvas step (editable, with live previews)
                and the forecast below updates instantly.
              </p>
              <div style={{ display: "flex", gap: 8, flexWrap: "wrap", marginBottom: 16, maxWidth: 640 }}>
                <input style={{ flex: "1 1 280px" }} value={cardsPrompt} onChange={(e) => setCardsPrompt(e.target.value)}
                  placeholder='e.g. "a pricing chart when tiers come up, and a which-package question at the end"' />
                <button className="pill-btn primary" onClick={generateScriptedCards} disabled={cardsBusy}>
                  {cardsBusy ? "Designing…" : "✨ Generate cards"}
                </button>
              </div>

              <div className="subhead">What will be on camera</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 8 }}>
                Recomputed live from this demo's config and the script above — fix every ⚠️ before recording, or the take won't show it.
              </p>
              <div className="kb-list" style={{ marginBottom: 16, maxWidth: 660 }}>
                {takeForecast.map((r, i) => (
                  <div key={i} className="kb-row" style={{ alignItems: "flex-start" }}>
                    <span style={{ flexShrink: 0 }}>{r.k === "ok" ? "✅" : r.k === "warn" ? "⚠️" : "🎲"}</span>
                    <span style={{ fontSize: 13, fontWeight: 600, flexShrink: 0, minWidth: 150 }}>{r.label}</span>
                    <span style={{ fontSize: 12.5, color: r.k === "warn" ? "var(--danger)" : "var(--muted)", flex: 1, lineHeight: 1.5 }}>{r.detail}</span>
                  </div>
                ))}
              </div>

              <button className="pill-btn primary" onClick={startStudioTake} disabled={studioActive || !!duetRun}>
                {studioActive ? "Take running…" : "🎬 Record take"}
              </button>
              {studioStatus && <p className="field-hint" style={{ marginTop: 10, maxWidth: 560 }}>{studioStatus}</p>}
              <p className="field-hint" style={{ marginTop: 14, maxWidth: 560 }}>
                Chrome pre-selects this tab in the share dialog — keep the tab visible for the whole take.
                Each take is a normal conversation (normal minutes); re-rolling is one click. Lines save with the
                demo, so a scenario doubles as a repeatable video script. End a take early with the call's leave button.
              </p>

              <div className="subhead" style={{ marginTop: 30 }}>Duet — two AI humans in conversation</div>
              <p className="field-hint" style={{ maxWidth: 600, marginBottom: 12 }}>
                Self-contained: describe the conversation and Claude plans the <b>talk track first</b>, builds both
                AI humans around it, and derives the cards from it — so everything lines up. Pick two faces, record;
                the stage captures locally (a .webm downloads when it ends). Studio reuses the same two PALs every
                time (their prompts are updated per plan), so duets never pile up PALs on your account.
              </p>
              <Field label="Describe the conversation" hint="Include tone and emotion — “they get competitive”, “the host starts skeptical and comes around”, “excitement builds” — the plan writes an emotional arc into both personas, and Tavus performs it in voice and face.">
                <textarea
                  value={duetDesc}
                  onChange={(e) => setDuetDesc(e.target.value)}
                  style={{ minHeight: 74 }}
                  placeholder={"e.g. A Kaiser Permanente intake specialist explains the new medication-reconciliation flow to a host who starts skeptical and gets genuinely excited — cover the meds & allergies checklist, the time-saved numbers, and end by asking which clinic should pilot it."}
                />
              </Field>
              <button className="pill-btn primary" style={{ marginBottom: 16 }} onClick={planDuet} disabled={duetPlanBusy}>
                {duetPlanBusy ? "Planning…" : "✨ Plan the duet"}
              </button>

              {duetPlan && (
                <>
                  <div className="jr-card" style={{ maxWidth: 640, marginBottom: 16 }}>
                    <div className="jr-head">
                      <span className="jr-type">🎭 {duetPlan.title || "duet plan"}</span>
                      <span className="jr-btns">
                        <button className="kb-del" onClick={() => { setDuetPlan(null); setDuetOpener(""); }} title="Discard this plan">✕</button>
                      </span>
                    </div>
                    <p className="field-hint" style={{ margin: "0 0 6px" }}>
                      <b style={{ color: "var(--text)" }}>{duetPlan.featured?.name || "Featured"}</b> opens ·{" "}
                      <b style={{ color: "var(--text)" }}>{duetPlan.host?.name || "Host"}</b> hosts
                    </p>
                    {/* Storyboard: the full talk track with its visuals side by
                        side — and EDITABLE. Beats feed the shared context at
                        record time; cards compile straight from this list. */}
                    {(() => {
                      const beats = duetPlan.outline || [];
                      const raw = Array.isArray(duetPlan.cards) ? duetPlan.cards : [];
                      const setBeat = (i, v) => setDuetPlan((p) => ({ ...p, outline: (p.outline || []).map((b2, j) => (j === i ? v : b2)) }));
                      const delBeat = (i) => setDuetPlan((p) => ({ ...p, outline: (p.outline || []).filter((_, j) => j !== i) }));
                      const addBeat = () => setDuetPlan((p) => ({ ...p, outline: [...(p.outline || []), ""] }));
                      const beatOfKeywords = (c) => {
                        const kws = String(c.keywords ?? "").split(",").map((x) => x.trim().toLowerCase()).filter(Boolean);
                        return beats.findIndex((b2) => kws.some((k) => String(b2).toLowerCase().includes(k)));
                      };
                      // Editing must never move the editor out from under the
                      // cursor: live keyword→beat matching used to re-home a
                      // card mid-keystroke (the input remounted, focus dropped,
                      // and it read as "a new card appeared somewhere else").
                      // First edit pins the card to its current row (uiBeat,
                      // display-only); beat-trigger cards follow their beat.
                      const setCard = (i, patch) => setDuetPlan((p) => ({
                        ...p,
                        cards: (p.cards || []).map((c, j) => {
                          if (j !== i) return c;
                          const next = { ...c, ...patch };
                          if ((next.trigger === "keyword" || !next.trigger) && !parseInt(next.uiBeat, 10)) {
                            const bi = beatOfKeywords(c);
                            next.uiBeat = bi >= 0 ? bi + 1 : -1; // -1 = pinned to the loose row
                          }
                          return next;
                        }),
                      }));
                      const delCard = (i) => setDuetPlan((p) => ({ ...p, cards: (p.cards || []).filter((_, j) => j !== i) }));
                      const addCard = (beatIndex) => setDuetPlan((p) => ({
                        ...p,
                        cards: [...(Array.isArray(p.cards) ? p.cards : []), {
                          style: "note", trigger: "beat", atBeat: beatIndex + 1,
                          title: "", body: "", keywords: "", owner: "featured", hideAfter: 0,
                        }],
                      }));
                      const beatFor = (c) => {
                        if (c.trigger === "start") return 0;
                        if (c.trigger === "beat") return Math.min(beats.length, Math.max(1, parseInt(c.atBeat, 10) || 1)) - 1;
                        if (c.trigger === "time") return -1;
                        const pin = parseInt(c.uiBeat, 10);
                        if (pin > 0) return Math.min(beats.length, pin) - 1;
                        if (pin === -1) return -1;
                        return beatOfKeywords(c);
                      };
                      const byBeat = beats.map(() => []);
                      const loose = [];
                      raw.forEach((c, ci) => { const bi = beatFor(c); (bi >= 0 ? byBeat[bi] : loose).push(ci); });
                      const deckSched = parseInt(duetDeckBeat, 10) || 0;
                      const browserSched = parseInt(duetBrowserBeat, 10) || 0;
                      const deckBeat = duetDeck && docIds.length
                        ? (deckSched > 0 ? Math.min(beats.length, deckSched) - 1 : beats.findIndex((b2) => /slide|deck|present/i.test(b2)))
                        : -1;
                      const browserBeat = duetBrowser
                        ? (browserSched > 0 ? Math.min(beats.length, browserSched) - 1 : beats.findIndex((b2) => /browser|website|web ?page|live (site|page)/i.test(b2)))
                        : -1;
                      const inp = { fontSize: 12.5, padding: "5px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)", width: "100%", boxSizing: "border-box" };
                      const cardEditor = (ci) => {
                        const c = raw[ci];
                        const dropped = !compileScriptedCards([c]).length;
                        return (
                          <div key={ci} style={{ border: "1px solid var(--border)", borderRadius: 10, padding: 8, marginBottom: 8, background: "var(--surface)" }}>
                            <div style={{ display: "flex", gap: 6, marginBottom: 6, alignItems: "center" }}>
                              <select style={{ ...inp, width: 96, flexShrink: 0 }} value={c.style || "note"} onChange={(e) => setCard(ci, { style: e.target.value })}>
                                <option value="note">📄 note</option><option value="stat">🔢 stat</option><option value="chart">📊 chart</option><option value="image">🖼 image</option><option value="question">❓ question</option><option value="link">📅 booking link</option>
                              </select>
                              <input style={inp} placeholder="Card title" value={c.title ?? ""} onChange={(e) => setCard(ci, { title: e.target.value })} />
                              <button className="kb-del" onClick={() => delCard(ci)} title="Remove this card">✕</button>
                            </div>
                            {c.style === "link" && (
                              <input style={{ ...inp, marginBottom: 6 }} placeholder="Booking URL — e.g. https://calendly.com/you/30min" value={c.href ?? ""} onChange={(e) => setCard(ci, { href: e.target.value })} />
                            )}
                            {c.style === "image"
                              ? <input style={{ ...inp, marginBottom: 6 }} placeholder="Image URL" value={c.url ?? ""} onChange={(e) => setCard(ci, { url: e.target.value })} />
                              : <textarea style={{ ...inp, marginBottom: 6, minHeight: 44, resize: "vertical" }} placeholder={c.style === "question" ? "The options — one per line" : c.style === "chart" ? "One “Label: value” per line" : c.style === "stat" ? "Big value\nlabel" : "Card text"} value={c.body ?? ""} onChange={(e) => setCard(ci, { body: e.target.value })} />}
                            <div style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
                              <select style={{ ...inp, width: 96, flexShrink: 0 }} value={c.trigger || "keyword"} onChange={(e) => setCard(ci, { trigger: e.target.value, ...(e.target.value === "beat" && !c.atBeat ? { atBeat: 1 } : {}) })} title="When the card appears — at beat # is exact; on words fires live when spoken">
                                <option value="beat">at beat #</option><option value="keyword">on words</option><option value="time">on timer</option><option value="start">at start</option>
                              </select>
                              {c.trigger === "time"
                                ? <input
                                    style={{ ...inp, width: 110 }}
                                    placeholder="1:30 or 90"
                                    title="Exact time from call start — “m:ss”, or plain seconds"
                                    value={c.atText ?? (Number(c.atMinutes) > 0 ? (() => { const s2 = Math.round(Number(c.atMinutes) * 60); return `${Math.floor(s2 / 60)}:${String(s2 % 60).padStart(2, "0")}`; })() : "")}
                                    onChange={(e) => {
                                      const v = e.target.value;
                                      const m2 = v.trim().match(/^(\d+):([0-5]?\d)$/);
                                      const secs = m2 ? +m2[1] * 60 + +m2[2] : Math.max(0, Math.round(parseFloat(v) || 0));
                                      setCard(ci, { atText: v, atMinutes: secs / 60 });
                                    }}
                                  />
                                : c.trigger === "beat"
                                  ? (
                                    <select style={{ ...inp, flex: 1, minWidth: 120 }} value={Math.min(beats.length, Math.max(1, parseInt(c.atBeat, 10) || 1))} onChange={(e) => setCard(ci, { atBeat: e.target.value })}>
                                      {beats.map((b3, bi) => <option key={bi} value={bi + 1}>beat {bi + 1} — {String(b3).slice(0, 34)}{String(b3).length > 34 ? "…" : ""}</option>)}
                                    </select>
                                  )
                                  : c.trigger === "keyword"
                                    ? <input style={{ ...inp, flex: 1, minWidth: 120 }} placeholder="Trigger words, comma-separated" value={c.keywords ?? ""} onChange={(e) => setCard(ci, { keywords: e.target.value })} />
                                    : <span style={{ flex: 1 }} />}
                              <select style={{ ...inp, width: 130, flexShrink: 0 }} value={c.owner === "host" ? "host" : "featured"} onChange={(e) => setCard(ci, { owner: e.target.value })} title="Whose tile the card appears on">
                                <option value="featured">{(duetPlan.featured?.name || "featured").slice(0, 14)}’s tile</option>
                                <option value="host">{(duetPlan.host?.name || "host").slice(0, 14)}’s tile</option>
                              </select>
                              <label style={{ display: "flex", alignItems: "center", gap: 4, color: "var(--muted)", fontSize: 11.5, flexShrink: 0 }} title="How long the card stays on screen">
                                stays
                                <input style={{ ...inp, width: 56 }} type="number" min="0" placeholder="35" value={c.hideAfter || ""} onChange={(e) => setCard(ci, { hideAfter: e.target.value })} />
                                s
                              </label>
                            </div>
                            {dropped && <div style={{ color: "#b4552d", fontSize: 11.5, marginTop: 5 }}>⚠ Incomplete — needs {c.style === "image" ? "an image URL" : "body text"}{c.trigger === "keyword" ? " and trigger words" : c.trigger === "time" ? " and a time" : ""} or it won’t appear.</div>}
                            {!dropped && c.trigger === "time" && Math.round((parseFloat(c.atMinutes) || 0) * 60) > 300 && <div style={{ color: "#b4552d", fontSize: 11.5, marginTop: 5 }}>⚠ Past the 5-minute hard cap — the take may end before this shows.</div>}
                          </div>
                        );
                      };
                      return (
                        <div style={{ fontSize: 12.5, lineHeight: 1.55 }}>
                          <div style={{ display: "flex", gap: 14, borderBottom: "1px solid var(--border)", padding: "2px 0 6px", fontWeight: 700, color: "var(--text)" }}>
                            <div style={{ flex: 1 }}>Talk track</div>
                            <div style={{ flex: 1.2 }}>On screen</div>
                          </div>
                          {beats.map((b2, i) => (
                            <div key={i} style={{ display: "flex", gap: 14, alignItems: "flex-start", padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
                              <div style={{ flex: 1, display: "flex", gap: 6, alignItems: "flex-start" }}>
                                <b style={{ color: "var(--text)", paddingTop: 6 }}>{i + 1}.</b>
                                <textarea style={{ ...inp, minHeight: 52, resize: "vertical" }} value={b2} onChange={(e) => setBeat(i, e.target.value)} placeholder="What gets covered in this beat…" />
                                <button className="kb-del" onClick={() => delBeat(i)} title="Remove this beat">✕</button>
                              </div>
                              <div style={{ flex: 1.2 }}>
                                {byBeat[i].map(cardEditor)}
                                {deckBeat === i && <div style={{ color: "var(--muted)", marginBottom: 6 }}>📽 <b style={{ color: "var(--text)" }}>Deck panel opens</b> — {deckSched > 0 ? "on cue at this beat" : "≈ when the AI decides (pick a beat above to lock it)"}</div>}
                                {browserBeat === i && <div style={{ color: "var(--muted)", marginBottom: 6 }}>🌐 <b style={{ color: "var(--text)" }}>Live browser opens</b> — {browserSched > 0 ? "on cue at this beat" : "≈ when the AI decides (pick a beat above to lock it)"}</div>}
                                <button className="pill-btn" style={{ padding: "2px 10px", fontSize: 11.5 }} onClick={() => addCard(i)}>+ card at this beat</button>
                              </div>
                            </div>
                          ))}
                          {loose.map((ci) => (
                            <div key={`x${ci}`} style={{ display: "flex", gap: 14, padding: "8px 0", borderBottom: "1px dashed var(--border)" }}>
                              <div style={{ flex: 1, color: "var(--muted)", fontStyle: "italic", paddingTop: 6 }}>
                                {raw[ci]?.trigger === "time" ? "(on a timer)" : "(trigger words not in any beat — fires when spoken, or spreads across the take)"}
                              </div>
                              <div style={{ flex: 1.2 }}>{cardEditor(ci)}</div>
                            </div>
                          ))}
                          <div style={{ paddingTop: 8, display: "flex", gap: 8, flexWrap: "wrap" }}>
                            <button className="pill-btn" style={{ padding: "3px 12px", fontSize: 12 }} onClick={addBeat}>+ Add beat</button>
                            {raw.some((c) => c.trigger === "keyword" || !c.trigger) && (
                              <button
                                className="pill-btn"
                                style={{ padding: "3px 12px", fontSize: 12 }}
                                title="Convert every trigger-word card to a fixed beat — fully deterministic timing"
                                onClick={() => setDuetPlan((p) => {
                                  const kwCards = (p.cards || []).filter((c) => c.trigger === "keyword" || !c.trigger);
                                  let n = 0;
                                  return {
                                    ...p,
                                    cards: (p.cards || []).map((c) => {
                                      if (c.trigger !== "keyword" && c.trigger) return c;
                                      n += 1;
                                      const bi = beatFor(c);
                                      const spread = Math.min(beats.length, Math.max(1, Math.round((n * beats.length) / (kwCards.length + 1))));
                                      return { ...c, trigger: "beat", atBeat: bi >= 0 ? bi + 1 : spread };
                                    }),
                                  };
                                })}
                              >
                                ⏱ Lock every card to its beat
                              </button>
                            )}
                          </div>
                          <p className="field-hint" style={{ margin: "8px 0 0" }}>
                            Edits here are what actually runs — the talk track rides into both rooms at record time and the cards compile from this list.
                            Both personas were <i>written around</i> the original talk track, so for a big change of direction, re-plan instead of rewording.
                          </p>
                        </div>
                      );
                    })()}
                  </div>

                  <Field label={`${duetPlan.featured?.name || "Featured"} — face`}>
                    <div className="face-row">
                      {FACE_PRESETS.map((f) => (
                        <button key={f.id} type="button" className={"face-chip" + (duetFaceA.trim() === f.id ? " on" : "")} onClick={() => setDuetFaceA(f.id)} title={f.id}>
                          <span className="face-chip-name">{f.name}</span>
                          <span className="face-chip-vibe">{f.vibe}</span>
                        </button>
                      ))}
                    </div>
                    <input className="mono" value={duetFaceA} onChange={(e) => setDuetFaceA(e.target.value)} placeholder="r…" />
                  </Field>
                  <Field label={`${duetPlan.host?.name || "Host"} — face`}>
                    <div className="face-row">
                      {FACE_PRESETS.map((f) => (
                        <button key={f.id} type="button" className={"face-chip" + (duetFaceB.trim() === f.id ? " on" : "")} onClick={() => setDuetFaceB(f.id)} title={f.id}>
                          <span className="face-chip-name">{f.name}</span>
                          <span className="face-chip-vibe">{f.vibe}</span>
                        </button>
                      ))}
                    </div>
                    <input className="mono" value={duetFaceB} onChange={(e) => setDuetFaceB(e.target.value)} placeholder="r…" />
                  </Field>
                  <Field label={`Opening line — ${duetPlan.featured?.name || "featured"}`} hint="Spoken the instant the call starts (no LLM wait).">
                    <input value={duetOpener} onChange={(e) => setDuetOpener(e.target.value)} />
                  </Field>
                  <Field label={`Scripted reply — ${duetPlan.host?.name || "host"}`} hint="Also instant: plays the moment the host joins, while the real turns generate — this is what makes the dialogue feel speedy.">
                    <input value={duetOpenerB} onChange={(e) => setDuetOpenerB(e.target.value)} />
                  </Field>
                  <Field label="On-video context — the interaction" hint="Shown on screen at the start: what the viewer is watching. Edit freely.">
                    <textarea style={{ minHeight: 54 }} value={duetNarrIntro} onChange={(e) => setDuetNarrIntro(e.target.value)}
                      placeholder="A simulated conversation between two AI humans on Tavus' full stack — every turn generated live. You could talk to either one yourself." />
                  </Field>
                  <Field label="On-video context — Tavus features shown" hint="Shown after the opening exchange: which capabilities to watch for (canvas elements, emotions escalating…). Edit freely.">
                    <textarea style={{ minHeight: 54 }} value={duetNarrFeatures} onChange={(e) => setDuetNarrFeatures(e.target.value)}
                      placeholder="Watch for Magic Canvas elements triggered live by the dialogue, and the emotion building as the debate heats up." />
                  </Field>
                  <Field label="Exchanges" hint="How many back-and-forths before it wraps and saves (hard cap 5 minutes).">
                    <input type="number" min="2" max="20" style={{ maxWidth: 120 }} value={duetTurns} onChange={(e) => setDuetTurns(e.target.value)} />
                  </Field>
                  <Field label="Video look" hint="“Call recording” reads like a saved Zoom/Meet call: no branded chrome, bottom-left name tags, a native Recording pill, narrator as a captions bar — and the controls fade out whenever your mouse is still, so the capture never shows them.">
                    <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
                      {[["meeting", "🎥 Call recording (Zoom/Meet style)"], ["stage", "🎬 Branded stage"]].map(([v, l]) => (
                        <button key={v} type="button" className={"pill-btn" + (duetLook === v ? " primary" : "")} style={{ padding: "5px 14px", fontSize: 12.5 }} onClick={() => setDuetLook(v)}>{l}</button>
                      ))}
                    </div>
                    <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer", marginTop: 10 }}>
                      <input type="checkbox" style={{ width: "auto" }} checked={duetCaptions} onChange={(e) => setDuetCaptions(e.target.checked)} />
                      💬 Closed captions — live transcript of what's said, revealed at speech pace (scripted openers captioned too)
                    </label>
                  </Field>
                  <Field label="On-screen surfaces" hint="Either one opens in its own window beside the face — never covering anyone. Pick the beat it opens on and the stage sends the featured AI a silent cue at that exact moment; “when the AI decides” leaves it to the model.">
                    {(() => {
                      const beats2 = (duetPlan.outline || []).map((b3) => String(b3).trim()).filter(Boolean);
                      const beatSelect = (value, onChange) => (
                        <select style={{ fontSize: 12.5, padding: "4px 8px", borderRadius: 8, border: "1px solid var(--border)", background: "var(--surface)", color: "var(--text)" }} value={value} onChange={(e) => onChange(e.target.value)}>
                          <option value="0">when the AI decides</option>
                          {beats2.map((b3, bi) => <option key={bi} value={bi + 1}>opens at beat {bi + 1} — {b3.slice(0, 30)}{b3.length > 30 ? "…" : ""}</option>)}
                        </select>
                      );
                      return (
                        <>
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer", marginBottom: 6 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={duetDeck} onChange={(e) => setDuetDeck(e.target.checked)} />
                            📽 Present the deck
                          </label>
                          {duetDeck && (
                            <div style={{ margin: "0 0 12px 26px", display: "flex", flexDirection: "column", gap: 6 }}>
                              <input className="mono" style={{ fontSize: 12.5 }} value={docIdsRaw} onChange={(e) => setDocIdsRaw(e.target.value)} placeholder="Knowledge Base document IDs, comma-separated (shared with the Presentation step)" />
                              {!docIds.length && <span className="field-hint" style={{ color: "#b4552d" }}>⚠ No document IDs yet — the deck can’t open without them.</span>}
                              <div>{beatSelect(duetDeckBeat, setDuetDeckBeat)}</div>
                            </div>
                          )}
                          <label style={{ display: "flex", alignItems: "center", gap: 8, fontSize: 13, color: "var(--muted)", cursor: "pointer", marginBottom: 6 }}>
                            <input type="checkbox" style={{ width: "auto" }} checked={duetBrowser} onChange={(e) => setDuetBrowser(e.target.checked)} />
                            🌐 Browser Use — the featured AI human pulls up a live website
                          </label>
                          {duetBrowser && (
                            <div style={{ margin: "0 0 4px 26px", display: "flex", flexDirection: "column", gap: 6 }}>
                              <input style={{ fontSize: 12.5 }} value={duetBrowserShow} onChange={(e) => setDuetBrowserShow(e.target.value)} placeholder='Which guided flow should it run? — the flow NAME from the Presentation step, e.g. "Pricing tour"' />
                              <div>{beatSelect(duetBrowserBeat, setDuetBrowserBeat)}</div>
                            </div>
                          )}
                        </>
                      );
                    })()}
                  </Field>
                  <div style={{ display: "flex", gap: 10, flexWrap: "wrap" }}>
                    <button className="pill-btn" onClick={() => setDuetRehearse(true)} disabled={!!duetRun} title="Free playback of the storyboard on a mock stage — see every card, tile and panel before recording">
                      ▶ Rehearse the take
                    </button>
                    <button className="pill-btn primary" onClick={startDuet} disabled={!!duetRun || studioActive}>
                      {duetRun ? "Duet running…" : "🎭 Record duet"}
                    </button>
                  </div>
                  <div style={{ marginTop: 18, paddingTop: 14, borderTop: "1px dashed var(--border)", maxWidth: 640 }}>
                    <p className="field-hint" style={{ margin: "0 0 8px" }}>
                      <b style={{ color: "var(--text)" }}>Sales handoff:</b> the video is the teaser — this turns{" "}
                      <b style={{ color: "var(--text)" }}>{duetPlan.featured?.name || "the featured AI human"}</b> into a{" "}
                      <b style={{ color: "var(--text)" }}>permanent</b> PAL a real person can jump in and talk to. Claude adapts
                      the character for a live visitor (same personality and knowledge, no scripted co-host), creates a brand-new
                      PAL that future duet plans never overwrite, and loads it into the builder — Setup gets the IDs, Persona the
                      prompt, Goals the suggested flow. From there: launch it or share the link like any demo.
                    </p>
                    <button className="pill-btn" onClick={promoteDuet} disabled={duetPromoteBusy || !!duetRun}>
                      {duetPromoteBusy ? "Creating the live PAL…" : "🤝 Continue as a live demo"}
                    </button>
                  </div>
                </>
              )}
            </>
          )}

          {step === "launch" && (
            <>
              <div className={"xc" + (crossBreaks ? " xc-bad" : crossCheck.length ? " xc-warn" : " xc-ok")}>
                <div className="xc-head">
                  <span className="xc-dot" />
                  <h2>
                    {crossBreaks
                      ? `${crossBreaks} thing${crossBreaks > 1 ? "s" : ""} will misbehave on this call`
                      : crossCheck.length
                      ? `${crossCheck.length} thing${crossCheck.length > 1 ? "s" : ""} worth a look`
                      : "Everything lines up"}
                  </h2>
                  <span className="xc-sub">
                    {crossCheck.length
                      ? "Facts about this config, not opinions — nothing here changes until you click a fix."
                      : "No contradictions between the persona, the flow, the cards and the skills."}
                  </span>
                </div>
                {crossCheck.map((x, i) => (
                  <div key={i} className={`xc-row xc-${x.level}`}>
                    <span className="xc-tag">{x.level === "break" ? "WILL BREAK" : "LOOK"}</span>
                    <div className="xc-body">
                      <b>{x.title}</b>
                      <span>{x.why}</span>
                    </div>
                    <div className="xc-acts">
                      {x.fix && (
                        <button className="pill-btn primary" style={{ padding: "5px 12px", fontSize: 12.5 }}
                          disabled={generating}
                          onClick={() => x.fix.run()}>{x.fix.label}</button>
                      )}
                      <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12.5 }}
                        onClick={() => setStep(x.step)}>Open {STEPS.find((st) => st.id === x.step)?.label || x.step} →</button>
                    </div>
                  </div>
                ))}
              </div>
              <h1>Launch &amp; Share</h1>
              <p className="lede">
                On launch: {[
                  objectivesEnabled && objectivesPayload.data.length && "creates & attaches objectives",
                  guardrailsEnabled && guardrailsParsed.length && "creates & attaches guardrails",
                  visionEnabled && (visionPayload.visual_awareness_queries || visionPayload.audio_awareness_queries) && "attaches Vision",
                  speechEnabled && pronunciationRules.length && "creates & attaches pronunciation",
                  knowledgeIds.length && `gives the PAL ${knowledgeIds.length} knowledge doc${knowledgeIds.length > 1 ? "s" : ""}`,
                  toolsEnabled && toolDefs.length && `attaches ${toolDefs.length} custom tool${toolDefs.length > 1 ? "s" : ""}`,
                  presentationEnabled && "attaches Presentation",
                  canvasEnabled && "attaches Magic Canvas",
                ].filter(Boolean).join(", ") || "no customizations selected"}, then creates the conversation and opens it on your demo page.
              </p>
              <div style={{ display: "flex", gap: 10 }}>
                <button className="pill-btn primary big" disabled={!canLaunch || busy} onClick={launch}>
                  {busy ? "Working…" : "Launch demo"}
                </button>
                <button className="pill-btn" disabled={!canLaunch || busy || preflighting} onClick={preflight}
                  title="Validates the whole config with Tavus — goals chain, IDs, recording storage — without starting a call. Free.">
                  {preflighting ? "Checking…" : "✓ Preflight check"}
                </button>
                {conversation?.conversation_url && (
                  <button className="pill-btn" onClick={() => setSiteMode(true)}>Reopen page</button>
                )}
              </div>
              {!canLaunch && <p className="field-hint" style={{ marginTop: 10 }}>Complete Setup first — API key, Face ID, and PAL ID are required.</p>}
              <div className="subhead" style={{ marginTop: 26 }}>Shareable demo link</div>
              <p className="field-hint" style={{ maxWidth: 560, marginBottom: 10 }}>
                Mints a permanent link (like {window.location.origin}/d/x7Kp2q) anyone can open — no login, no keys. Each visitor gets their own fresh conversation. <b>Launch once first</b> so objectives, guardrails, vision, and skills are attached to the PAL; the link snapshots the demo as it is now (edit → share again for a new link).
              </p>
              <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
                <button className="pill-btn" onClick={shareDemo} disabled={sharing || !palId.trim() || !faceId.trim()}>
                  {sharing ? "Creating…" : shareUrl ? "Create a new link" : "Create shareable link"}
                </button>
                {shareUrl && (
                  <>
                    <span className="mono" style={{ fontSize: 12.5 }}>{shareUrl}</span>
                    <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => copy(shareUrl, "share")}>
                      {copied === "share" ? "Copied" : "Copy"}
                    </button>
                    <a className="pill-btn" style={{ padding: "5px 12px", fontSize: 12, textDecoration: "none" }} href={shareUrl} target="_blank" rel="noreferrer">Open</a>
                  </>
                )}
              </div>

              {conversation?.conversation_url && (
                <p className="field-hint" style={{ marginTop: 12 }}>
                  Room link:{" "}
                  <span className="mono" style={{ color: "var(--text)" }}>{conversation.conversation_url}</span>{" "}
                  <button className="pill-btn" style={{ padding: "4px 12px", marginLeft: 6, fontSize: 12 }} onClick={() => copy(conversation.conversation_url, "url")}>
                    {copied === "url" ? "Copied" : "Copy"}
                  </button>
                </p>
              )}
              {log.length > 0 && (
                <div className="log">
                  {log.map((l, i) => (
                    <div key={i} className="log-row">
                      <span className="log-t">{l.t}</span>
                      <span className={`log-${l.kind}`}>{l.msg}</span>
                    </div>
                  ))}
                </div>
              )}
            </>
          )}
          {(() => {
            const idx = STEPS.findIndex((s) => s.id === step);
            return (
              <div className="flow-nav">
                {idx > 0 ? (
                  <button className="pill-btn" onClick={() => setStep(STEPS[idx - 1].id)}>← {STEPS[idx - 1].label}</button>
                ) : <span />}
                <span className="flow-pos">{STEPS[idx]?.group} · {idx + 1} of {STEPS.length}</span>
                <span style={{ display: "flex", gap: 8 }}>
                  <button className="pill-btn" onClick={saveScenario}
                    title={`Saves the whole demo${activeScenario ? ` to "${activeScenario}"` : scenarioName.trim() ? ` as "${scenarioName.trim()}"` : " (named after your brand/demo)"} — everything except the API key. Same as Save in the top bar.`}>
                    {savedFlash ? "Saved ✓" : "💾 Save"}
                  </button>
                  {step !== "launch" && (
                    <button className="pill-btn" disabled={!canLaunch} title={canLaunch ? "Jump to Launch & Share" : "Needs your Tavus key + Face + PAL first (Account / Persona)"}
                      onClick={() => setStep("launch")}>🚀 Launch</button>
                  )}
                  {idx < STEPS.length - 1 && (
                    <button className="pill-btn primary" onClick={() => setStep(STEPS[idx + 1].id)}>Next: {STEPS[idx + 1].label} →</button>
                  )}
                </span>
              </div>
            );
          })()}
        </main>

        <aside className="preview">
          <div className="preview-card" style={showApi ? undefined : { flex: "none" }}>
            <div className="preview-head">
              <span className="preview-title">Under the hood</span>
              <span style={{ display: "flex", gap: 6 }}>
                {showApi && (
                  <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }} onClick={() => copy(preview.text, "curl")}>
                    {copied === "curl" ? "Copied" : "Copy curl"}
                  </button>
                )}
                <button className="pill-btn" style={{ padding: "5px 12px", fontSize: 12 }}
                  onClick={() => { const v = !showApi; setShowApi(v); store.set(SHOWAPI_KEY, v); }}>
                  {showApi ? "Hide" : "Show"}
                </button>
              </span>
            </div>
            {showApi && (
              <>
                <span className="preview-title" style={{ color: "var(--muted)" }}>{preview.title}</span>
                <div className="preview-code">{preview.text}</div>
                <p className="preview-note">
                  The exact API request this step sends — copy it to reproduce anything from a terminal or your own code.
                </p>
              </>
            )}
          </div>
        </aside>
      </div>

      {toast && (
        <div className={`toast toast-${toast.kind}`} role="status">
          <span>{toast.msg}</span>
          <button onClick={() => setToast(null)} aria-label="Dismiss">×</button>
        </div>
      )}

      {/* Demo library — searchable, grouped by "Client / name" convention,
          sorted by last save. Replaces the old flat dropdown. */}
      {libOpen && (
        <div className="lib-overlay" onClick={() => setLibOpen(false)}>
          <div className="lib-panel" onClick={(e) => e.stopPropagation()}>
            <div className="lib-head">
              <span style={{ fontWeight: 700, fontSize: 16 }}>Demo library</span>
              <span className="lib-hint">{cloudSync === "on" ? "☁ = synced to your account" : "saved in this browser (cloud sync unavailable)"}</span>
              <button className="pill-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={exportScenario}>Export</button>
              <button className="pill-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => importRef.current?.click()}>Import</button>
              <button className="pill-btn" style={{ padding: "6px 12px", fontSize: 12 }} onClick={() => setLibOpen(false)}>✕</button>
            </div>
            <input className="lib-search" autoFocus placeholder="Search demos…" value={libQuery} onChange={(e) => setLibQuery(e.target.value)} />
            <p className="field-hint" style={{ margin: "6px 2px 0" }}>
              Tip: name demos <b>Client / Use case</b> (e.g. “Santa / Better Santa”) and they group under the client automatically.
            </p>
            <div className="lib-list">
              {(() => {
                const all = Array.from(new Set([...Object.keys(scenarios), ...cloudNames]));
                const q = libQuery.trim().toLowerCase();
                const filtered = q ? all.filter((n) => n.toLowerCase().includes(q)) : all;
                if (!filtered.length) {
                  return <p className="field-hint" style={{ padding: 12 }}>{all.length ? "Nothing matches that search." : "No saved demos yet — build one and hit Save (you'll also be prompted after a launch)."}</p>;
                }
                const groupOf = (n) => { const m = n.match(/^(.+?)\s*\/\s*.+$/); return m ? m[1].trim() : ""; };
                const time = (n) => scenMeta[n]?.updatedAt || "";
                const groups = {};
                filtered.forEach((n) => { (groups[groupOf(n)] ||= []).push(n); });
                const keys = Object.keys(groups).sort((a, b) => (a === "") - (b === "") || a.localeCompare(b));
                return keys.map((g) => (
                  <div key={g || "(ungrouped)"}>
                    {(g || keys.length > 1) && <div className="lib-group">{g || "Ungrouped"}</div>}
                    {groups[g].sort((a, b) => time(b).localeCompare(time(a)) || a.localeCompare(b)).map((n) => {
                      const t = time(n);
                      return (
                        <div className="lib-row" key={n}>
                          <button className="lib-name" onClick={() => { loadScenario(n); setLibOpen(false); }} title={`Load “${n}”`}>
                            {g ? n.replace(/^.+?\s*\/\s*/, "") : n}
                            {activeScenario === n && <span className="lib-active">loaded</span>}
                          </button>
                          {cloudNames.includes(n) && <span title="Synced to your account — survives cleared browser storage">☁</span>}
                          {t && <span className="lib-time" title={t}>{new Date(t).toLocaleDateString(undefined, { month: "short", day: "numeric" })}</span>}
                          <button className="kb-del" title={`Delete “${n}”`}
                            onClick={() => { if (window.confirm(`Delete “${n}”? This removes the saved copy everywhere.`)) deleteScenario(n); }}>
                            ✕
                          </button>
                        </div>
                      );
                    })}
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* Chat with the demo — the always-there edit bar. One instruction,
          coordinated edits across every implicated piece, approve-to-apply. */}
      {wtPlaying && (() => {
        const src = walkthroughs[wtPlaying]?.url || (wtPlaying === wtEditStep ? wtDraft.url : "");
        if (!src) return null;
        const hasNarr = !!String(walkthroughs[wtPlaying]?.narration || "").trim();
        return (
          <div className="wt-overlay" onClick={closeWalkthrough}>
            <div className="wt-modal" onClick={(e) => e.stopPropagation()}>
              <div className="wt-head">
                <b>▶ {STEPS.find((s) => s.id === wtPlaying)?.label || "Walkthrough"}</b>
                {hasNarr && (
                  <button className="pill-btn" style={{ padding: "3px 12px", fontSize: 12 }}
                    onClick={() => setWtNarrOn((on) => { const next = !on; if (next) wtAudioRef.current?.play().catch(() => {}); else wtAudioRef.current?.pause(); return next; })}>
                    {wtNarrOn ? "🔊 Narration" : "🔇 Narration off"}
                  </button>
                )}
                <button className="pill-btn" style={{ padding: "3px 12px", fontSize: 12 }} onClick={closeWalkthrough}>✕</button>
              </div>
              <video
                ref={wtVideoRef}
                src={src}
                controls
                autoPlay
                playsInline
                onPlay={() => { if (wtNarrOn) wtAudioRef.current?.play().catch(() => {}); }}
                onPause={() => wtAudioRef.current?.pause()}
                onSeeked={(e) => { const a = wtAudioRef.current; if (a) { try { a.currentTime = Math.min(e.currentTarget.currentTime, Math.max(0, (a.duration || 0) - 0.05)); } catch { /* not seekable yet */ } } }}
                onEnded={() => wtAudioRef.current?.pause()}
              />
            </div>
          </div>
        );
      })()}
      {!siteMode && !duetRun && !duetRehearse && auth.authed !== false && (
        <div className="editbar">
          {editPending ? (
            <div className="editbar-pending">
              <div style={{ fontSize: 13, lineHeight: 1.5 }}>
                <b>✨ {editPending.note || "Ready to apply."}</b>
                <div style={{ marginTop: 6, display: "flex", gap: 6, flexWrap: "wrap" }}>
                  {editPending.keys.map((k) => <span key={k} className="editbar-chip">{EDIT_LABELS[k]}</span>)}
                </div>
              </div>
              <div style={{ display: "flex", gap: 8, flexShrink: 0 }}>
                <button className="pill-btn primary" style={{ padding: "6px 16px" }} onClick={applyDemoEdit}>Apply</button>
                <button className="pill-btn ghost" style={{ padding: "6px 12px" }} onClick={() => setEditPending(null)}>Discard</button>
              </div>
            </div>
          ) : (
            <>
              <button
                className={"pill-btn" + (dictating === "edit" ? " primary" : "")}
                style={{ flexShrink: 0, padding: "6px 12px" }}
                title={`Dictate the change (${dictEngineName})`}
                disabled={transcribing}
                onClick={() => toggleDictation("edit", (t2) => setEditAsk((v) => (v ? v + " " : "") + t2))}
              >
                {dictating === "edit" ? "⏹" : "🎙"}
              </button>
              <input
                value={editAsk}
                onChange={(e) => setEditAsk(e.target.value)}
                placeholder='✨ Tell the demo what to change — "friendlier", "kill the pricing question", "book the meeting earlier"…'
                onKeyDown={(e) => e.key === "Enter" && runDemoEdit()}
                disabled={editBusy}
              />
              <button className="pill-btn primary" style={{ flexShrink: 0, padding: "7px 18px" }} onClick={runDemoEdit} disabled={editBusy || !editAsk.trim()}>
                {editBusy ? "Thinking…" : "Edit"}
              </button>
            </>
          )}
        </div>
      )}

      {/* Post-launch / post-share save prompt — launched demos are worth keeping. */}
      {savePrompt && !siteMode && (
        <div className="saveprompt">
          <span style={{ fontWeight: 700 }}>💾 Save this demo?</span>
          <span className="saveprompt-sub">
            {activeScenario
              ? <>It has unsaved changes since <b>{activeScenario}</b> was last saved.</>
              : <>Keep it in your library so you can reload, tweak, and share it later.</>}
          </span>
          <input
            value={savePromptName}
            onChange={(e) => setSavePromptName(e.target.value)}
            placeholder="Client / demo name"
            onKeyDown={(e) => e.key === "Enter" && saveScenario(savePromptName || undefined)}
          />
          <div style={{ display: "flex", gap: 8 }}>
            <button className="pill-btn primary" style={{ flex: 1 }} onClick={() => saveScenario(savePromptName || undefined)}>Save</button>
            <button className="pill-btn ghost" onClick={() => setSavePrompt(false)}>Not now</button>
          </div>
        </div>
      )}
    </div>
  );
}
