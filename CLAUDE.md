# CLAUDE.md — Tavus Experience Builder

> Scope note: this file documents the **Tavus Experience Builder** demo tool
> (the `builder/` directory). The Python files at the repo root (`server.py`,
> `bridge.py`, `docs_store/`, etc.) are a **separate** project — the Tavus
> Docs Q&A server, documented in `README.md`. This CLAUDE.md is only about
> the React builder.

## What this is

A React app for **building and launching Tavus CVI demos** without touching
code. A solutions engineer points it at a Tavus account, configures a PAL
(persona) — Claude-drafted system prompt, presentation mode, Magic Canvas,
objectives, guardrails — and launches a live conversation onto a clean,
branded demo page. Tavus REST calls (`https://tavusapi.com/v2`) go directly
from the browser; Claude calls go through a serverless backend that holds the
Anthropic key.

## Layout & deployment

`builder/` is a Vercel project (see `builder/README.md` for deploy steps):

- `builder/src/TavusExperienceBuilder.jsx` — the whole UI: one
  default-exported component, all CSS inlined in a `<style>` block.
- `builder/api/generate-persona.js` — Vercel serverless function that calls
  Claude (`claude-opus-4-8`, `@anthropic-ai/sdk`, adaptive thinking, streamed
  as plain text) to draft a persona system prompt. Requires the
  `ANTHROPIC_API_KEY` env var on Vercel — the key never reaches the browser.
- `builder/api/login.js` + `builder/api/_auth.js` — login. When
  `BUILDER_PASSWORD` is set + Redis attached: per-user email/password
  accounts (scrypt in Redis); sign-up needs an invite — either the shared
  `BUILDER_PASSWORD` or a **per-person single-use code** (`TVS-XXXXXXXX`,
  minted by any signed-in user via `api/invites.js`, 30-day unused TTL,
  burned on use; "Team access" panel on the Account step). Sessions are HMAC
  cookies derived from the password — rotating it signs everyone out but
  keeps accounts; they're stateless with no device limit, so the same
  account signs in on any number of laptops (demo library is cloud-synced
  by email; only the Tavus API key is per-browser). `api/account.js`:
  GET → team accounts directory (kvScanKeys over `user:*`), POST → self-
  serve password change (current password is the credential; other devices
  stay signed in). Lost password = teammate mints a fresh personal invite,
  sign up again with the same email + code. "👤 Your account" panel on the
  Account step; multi-laptop + lost-password hints on the lock screen.
  Unset = open (local dev).
- `builder/api/demos.js` + `builder/api/demo-launch.js` + `builder/api/_kv.js`
  — **shareable demo links**. `POST /api/demos` (builder session required)
  stores an immutable snapshot `{name, site, controls, payload}` in Upstash
  Redis (`KV_REST_API_URL`/`UPSTASH_REDIS_REST_URL` env pairs, zero-dep REST
  client) under `demo:{slug}` → `/d/{slug}` (vercel.json rewrite → SPA).
  `GET /api/demos?slug=` is public but strips `payload` + `presentation`
  (the deck-skill config, re-attached per visitor call); visitors launch via
  `POST /api/demo-launch` which creates the Tavus conversation server-side
  with the `TAVUS_API_KEY` env var (rate-limited per slug/hour). The frontend
  `VisitorDemo` component (`?demo=` or `/d/` detection, before the auth gate)
  renders `DemoSite` standalone.
- `builder/api/experience.js` — **experience arc data** (attendance +
  feedback). POST is public-with-credential: a real demo slug (visitor) or a
  builder session (preview); records merge under `exp:{conversation_id}`
  (90-day TTL, hourly rate caps). `kind: "attend"` on a slug call forwards an
  alert to the demo's stored `experience.notifyWebhook` (SSRF-guarded,
  text/plain — Zapier/Make-friendly; fires once per conversation, never for
  builder previews). GET `?ids=` (builder session) returns the per-call map —
  same shape as `/api/recordings`. The demo snapshot stores the full
  `experience` object; the public demo GET strips `notifyWebhook`.
- `builder/api/scenarios.js` — **cloud-synced scenarios**. One Redis hash per
  account (`scenarios:{email}`, field per scenario name; `"team"` for legacy
  shared-code sessions), holding `{name, config, updatedAt, savedBy}` —
  configs never include the Tavus API key. GET → names, GET `?name=` → one,
  POST upsert, DELETE `?name=`. Builder session required; 501 without Redis
  (frontend falls back to localStorage-only silently).
- `kind: "demo"` on `generate-persona` — "Start from an idea" (Setup step):
  Claude returns a full template JSON (site copy, greeting, personaBrief,
  objectives, guardrails, visionVibe, canvasPlaybook) applied across all
  steps; everything stays hand-editable, persona draft is cleared as stale.
- `builder/vercel.json` — bumps the function's `maxDuration` to 60s; rewrite
  for `/d/:slug`.
- `builder/tools/walkthroughs.mjs` — **auto-built video walkthroughs**
  (`npm run walkthroughs`): drives the built app with Playwright
  (playwright-core devDep; browser via `$CHROMIUM_PATH` or
  `/opt/pw-browsers/chromium`), records scripted scenes with a visible
  cursor + caption overlay, transcodes to MP4 (`$FFMPEG_PATH`, Playwright's
  bundled ffmpeg is VP8-only). Output `builder/walkthroughs/` is
  gitignored — regenerate after feature changes; add scenes to the `SCENES`
  list.
- `builder/demos/*.json` — **starter demos** `{name, desc, config}`,
  bundled via `import.meta.glob` (`STARTER_DEMOS`) and listed at the bottom
  of the Demo library step ("＋ Add to my library" → `adoptScenario`, the
  same path Import uses: saved, cloud-synced, loaded). Any
  `https://YOUR-BUILDER-DOMAIN` in a config is rewritten to
  `window.location.origin` on adopt (`withThisOrigin`) so tool URLs hit this
  deployment's own `/api`. `cio-morning-notes.json` pairs with
  `builder/api/cio-desk.js`, a public, read-only endpoint serving the CIO
  Office morning note's figures so the `get_market_brief` registry tool
  (delivery api) has something real to speak.
- Note: the repo **root** `api/`, `vercel.json`, `package.json`, and
  `.vercelignore` mirror `builder/` so the Vercel project can build from the
  repo root with zero config. Keep root `api/` in sync with `builder/api/`.

## Mental model

- **PAL** (`pal_id`, `p…`) — the persona that drives the conversation. **Skills
  attach to the PAL.**
- **Face** (`face_id`, `r…`) — the face shown on the call.
- **Skills are persistent, playbooks are per-conversation.** This distinction
  runs through the whole tool:
  - **Objectives, Guardrails, Presentation, Magic Canvas** are attached to the
    PAL via the API and **persist on the PAL** until explicitly removed — every
    future conversation on that PAL inherits them.
  - The **Canvas playbook**, **card style/rules**, and **placement** are *not*
    attached to the PAL. They are compiled into a `conversational_context`
    string sent with the `POST /conversations` call, so different demos can run
    different behavior against the same PAL without mutating it.

## The wizard (`STEPS`)

Left-rail steps, grouped into four phases rendered as rail headers
(`Start` → `The AI human` → `The experience` → `Run it`; `group` field on
each STEPS entry). Step labels use **Tavus-native terms** (Objectives &
Guardrails, Perception, Knowledge Base, Presentation — per explicit user
direction; don't "simplify" them back to generic words). The persona
generator (`GENERATOR_SYSTEM`) emits the official Tavus Prompting Guide
structure: `## Identity & Role`, `## Personality & Conversational Style`
(base energy 1–10, SIGNATURE/NEVER-USE phrases), `## Core Behaviors`,
`## Response Style Rules`, `## Perception`, `## Guardrails & Constraints`,
`## Conversation Flow` — and receives perception/knowledge/tools context
alongside objectives/guardrails/presentation/canvas. Every step ends with a `flow-nav` footer (Back /
"Next: X →" / a 🚀 Launch shortcut gated on `canLaunch`). The default step
is `start` — the **replace-a-flow arc**: 1· what conversation is this
replacing (`demoReplacing`), 2· "walk me through how a good one goes"
(`ideaText`, the only required answer — objectives/audience/tone/outcome
all derive from it), 3· "when should a real person take over?"
(`demoHandoff` → guardrails + graceful escalation; DEMO_SYSTEM drafts 3-5
more rails which the draft report renders as a **prune list** — ✕ removes
the line from guardrailsText), 4· feature checklist. After the draft +
auto persona: **🎬 Rehearse the conversation** (`kind: "rehearse"` —
Claude plays BOTH sides faithfully, flaws included, starting from the
scripted greeting; renders as chat bubbles) with a coach-notes box
(typed or 🎙) that routes through `revisePersona` with the transcript as
evidence — flow notes → objectives, rule notes → guardrails, tone → the
prompt; then rehearse again. Rehearsal state is ephemeral (not saved).
Plus optional website + the **feature checklist**
(`DEMO_FEATURES`: canvas/emailGate default ON; vision/coach/presentation/
browseruse default OFF; each pick maps 1:1 to a builder toggle and a
template section — `FEATURES SELECTED:` line in the kind:"demo" request,
DEMO_SYSTEM gates canvasPlaybook/visionVibe/coach on it). "✨ Build my
demo" runs `themeFromUrl()` then `draftDemo(brand, themeJ)`; a
**draft report** card lists what got built (✅) and what needs one manual
step (🔶 deck ID / guided flow). **Net-new means net-new**: after the
template fetch succeeds, `draftDemo` runs `applyConfig({faceId, palId,
studioPalA, studioPalB, site: freshSite, demoIntent/Audience/Outcome/
Features})` — a full reset of every other demo-content field (recording/
webhook ride through via store fallbacks; palId is KEPT — the launch
hygiene sweep makes PAL reuse safe, and wiping it dead-ended launch; the
just-fetched theme rides in via `freshSite`), clears `activeScenario`,
and anchors the draft only to fresh signals, never the previous demo's
`site.brand`. Feature toggles are set from the PICKS, never from whether
the template filled a field. Template objectives starting with "if " are
indented on apply (branch lines require indentation in `parseObjectives`
— which also dedupes lines and always emits a catch-all, adding a
synthetic `…_wrap` objective when the last step has branches).
**Anti-repetition invariants** (learned from live calls): the inactivity
nudge is one-shot (its own speech must not re-arm it; only real user
speech cancels the grace timer); guardrail/tool echoes are debounced;
scripted-card fired-set and the time warning live in refs (effect re-runs
must not replay); CallExtras answers `objective.pending` with
`objective.confirm` (manual confirmation mode stalls forever otherwise);
launch section failures are fail-SAFE (objectives/guardrails onFail
clears the PAL's stale set rather than launching on the old demo's
brain); skill detaches key on the operator's toggle alone and are skipped
entirely when the PAL couldn't be read. **Launch runs a PAL-hygiene
sweep** first: auto-attaches a never-attached persona draft, GETs the PAL,
and clears whatever the PAL carries that this demo has OFF (objectives,
guardrails→[], perception→off, pronunciation id, llm tools→[],
emotion-control back on, DELETE for disabled skills) — a PAL keeps
everything ever attached, so disabled≠detached was the big bleed channel.
**Greeting cohesion**: the scripted greeting is passed to persona
generate/revise context (revise may return `greeting`), pushed into
`conversational_context` at launch ("your first line already played —
don't re-introduce"), and journey per-option greeting overrides append the
same note (duplicated in `api/demo-launch.js` — keep in sync). The right-hand curl panel is titled "Under the hood"
and is collapsible (persisted via `SHOWAPI_KEY`).

Categorization rules learned the hard way: the ✋ interrupt-button toggle
lives in **Page & Brand** (it's call UI, not timing); the guardrail
voice-line lives in **Goals & Rules** next to the guardrails textarea;
Timing keeps duration/warning/nudge/wake-phrase plus the Sparrow
turn-taking dials. Magic Canvas has a
"Suggest a canvas plan" button (`kind: "canvas"` → JSON
{style, playbook, rules, disable}, biased against card overuse).

Step slices of the one big component's state (labels renamed for
non-technical users; ids unchanged):

1. **Setup** — `apiKey`, `faceId`, `palId`, `languages`, `conversationName`,
   `callbackUrl` (webhook), `greeting`. `canLaunch` requires key + face + PAL.
1.5. **Persona** — ONE freeform vibe box (`personaBrief.vibe`) + an optional
   "Fine-tune" drawer (product, audience, goal, tone, emotions; the old
   mustCover/avoid inputs are GONE from the UI — Objectives & Guardrails are
   the single home for flow/rules and the generator reads them from context;
   the state fields remain for old scenarios) → `generatePersona()` POSTs
   brief + current builder context (objectives, guardrails, canvas playbook,
   presentation) to `/api/generate-persona` and streams the draft into an
   editable `personaDraft` textarea → `attachPersona()` PATCHes the PAL with
   `[{op:"add", path:"/system_prompt", value}]`. Draft → review → attach; the
   attach never happens without the human seeing the text.
   **Revise with feedback** (`revisePersona()`, `kind: "revise"`): a one-line
   feedback field under the draft sends draft + current objectives/guardrails
   text + presentation setup (`presentationContext()`: trigger, presenter
   style, talk track — generate sends the same object) + feedback; Claude
   returns JSON `{prompt, objectives|null, guardrails|null, note}` — an
   *edit*, not a regenerate. Objectives are
   revised together with the prompt because they drive flow mechanically
   (a prompt-only edit leaves the PAL looping on stale objectives — learned
   from user pain). Frontend applies all three; goals re-attach on next
   launch, prompt needs manual re-attach; failure restores the prior draft.
   **Test drive** (`startTestDrive()` etc.): text-only chat against the PAL —
   `POST /conversations {persona_id, chat: true}`, then per turn
   `POST /conversations/{id}/respond {text, timeout_s}` (if not immediately
   `status:"ready"`, poll `GET …/respond`), `POST …/end` to finish. Runs the
   PAL's ATTACHED config (attach first!); no video pipeline; billed like
   conversation time. Endpoint shape confirmed from the `tavus-cli` package
   (not in public API reference — may change).
   The prompt persists on the PAL like objectives do.
   Setup also offers **Create PAL** (`createPal()`): `POST /pals` with
   `pal_name`, `default_face_id` (uses the Face ID field), and `system_prompt`
   (the persona draft when present, else a generic default) → fills `palId`.
2. **Objectives & Guardrails** (`guide`) — plain-English textareas, one item
   per line, parsed on launch (slug names are generated internally and never
   shown in the UI — summaries use `shortLabel(objective_prompt)`; branch
   nodes show as `↳`):
   - `parseObjectives` — top-level lines → objectives **chaining** in order
     via `next_required_objective`. **If/then branching**: an indented
     `if <condition> -> <detour objective>` line under a step compiles to
     `next_conditional_objectives` (mutually exclusive with next_required);
     detours rejoin the main flow at the next top-level step and a catch-all
     ("In any other case") is added automatically so uncovered answers never
     stall. `| var1, var2` suffix → `output_variables`.
     `confirmationMode` (`auto`/`manual`) applies to all.
   - `parseGuardrails` — each line → a guardrail; `[visual]` anywhere in the
     line marks `modality: "visual"` (else `verbal`).
   - `slugName()` turns prose into API-safe `obj_N_…` / `gr_N_…` names.
2.5. **Vision** (`vision`) — the perception layer. Plain-English "what should
   it notice" (`visionVibe`) → `generateVision()` calls `/api/generate-persona`
   with `kind: "vision"`; Claude returns `VISUAL:`/`AUDIO:` sections parsed by
   `parseVisionDraft` into editable per-line textareas. On launch →
   `PATCH /pals/{id}` `/layers/perception` with `{perception_model: "raven-1",
   visual_awareness_queries, audio_awareness_queries}`. Persists on the PAL.
   **On-stage annotations** ("X-ray mode", same step + a memory toggle on the
   KB step): `annotEmotion`/`annotVision`/`annotMemory` → chips over the live
   call showing the AI sensing. Emotion + vision ride INLINE PERCEPTION
   TOOLS (`note_emotion` audio tool / `note_scene` visual tool +
   `audio_tool_prompt`/`visual_tool_prompt` merged into `visionPayload`) —
   Raven fires them as fire-and-forget `conversation.perception_tool_call`
   app-messages; a sensed emotion arms a one-shot "↳ Reacting" chip on the
   PAL's next started_speaking. `annotMemory` = a context line making the
   PAL say recalls out loud + chips for recall phrases, `rag`-observability
   events (📚 with document names), and a memory-active badge at call start
   (`controls.annot.memoryOn`). Wiring: `controls.annot` in controlsConfig
   (rides share links) → CallExtras `onAnnot` (deduped per kind-window) →
   `annotChips` state in DemoSite (OUTSIDE the memo firewall) → `.annot-rail`
   chips (one-shot entrance animation only — A/V invariant). Launch attaches
   perception whenever vision is on OR annotations are on (queries stripped
   when vision itself is off), and the hygiene sweep spares the layer then.
   **Scenario-specific queries** (from the "vision is fine at basic, useless
   at specific" brainstorm) rest on three things the one-shot vibe box
   lacked: ⬆ **scene frames** (`visionShots`, session-only, never
   saved; no taste-based cap — `imageBlocks()` refuses a set over ~3.6MB
   and names the reason, since the only real limit is the request body) ride as base64 `images` so the queries name what is REALLY in
   shot — the same vision-grounding the talk track got, via the shared
   `readShrunkImages` downscaler and the server's `sanitizeImages`;
   **objectives + guardrails** ride `context` so queries serve the flow's
   actual moments; and 🪡 **inject into prompt**
   (`injectVisionIntoPrompt`, mirrors the deck's) weaves each check into
   the persona's Perception section with the response it should trigger —
   raven answers the queries whether or not anything reads them, so
   without the inject perception observes into the void, which is
   indistinguishable from not observing.
3. **Presentation** — attach PDF/image decks from the Knowledge Base.
   `docIdsRaw` (comma/newline list → `docIds`), `slidesTrigger`
   (`walk_the_deck` | `on_demand`), optional `presentPrompt`, per-slide
   `talkTrack`. **Inject into prompt** (`injectPresentationIntoPrompt()`,
   mirrors the canvas inject): weaves the deck — trigger mode, presenter
   style, talk track — into the persona + objectives via the revise
   machinery, so the flow actually reaches and finishes the deck.
   **Vision-grounded talk track** (portal AI spec): ⬆ Slide images (PNG/JPG
   exports, ≤20, canvas-downscaled ≤240KB each, session-only `slideShots` —
   never saved) ride `kind:"talktrack"` as base64 `images` → one vision
   block per slide; TALKTRACK_SYSTEM writes presenter-instructions (never
   verbatim script / stage directions), grounds every note in the visible
   slide, 2-4 conversational moments per deck, `FLAGS:` lines surface as
   Review log lines. Text-only stays the fallback (log says it's
   unverified). **The Brief** (same spec): `buildBrief()` compiles a
   `<brief>` block from existing intake state (use case, audience,
   presenter=ai_avatar, goal, tone, must cover/avoid, product, brand) and
   rides `context.brief` on talktrack/canvas/vision/browserflow/revise/edit
   calls; the server prepends it to the USER message (never for
   kind:"demo"/"score"). FLOW/DEMO objectives prompts carry the spec's
   structural rules (mode detection first, escalations→guardrails never
   steps, branches exit, loop counters, explicit "| var" captures,
   converged close); REVISE/EDIT carry its merge-with-implications rules.
   **Deck coherence rules** (from the "presentation isn't working" audit):
   toggle-on-with-no-docs at launch SKIPS the attach and CLEARS any stale
   deck the PAL carries (loud log both times; the rail ● needs docs, not
   just the toggle); a failed attach is fail-SAFE (DELETE, never launch on
   an older deck); when the deck is configured, `conversationPayload` adds
   a one-line context part telling the model a deck exists (walk vs
   on-request wording) — without it on_demand mode never fired; share
   links snapshot `presentation: {config}` and `demo-launch` re-PUTs it
   per visitor call (after journey PAL overrides), so a later builder
   launch on the same PAL can't kill a live link's slides.
4. **Magic Canvas** — interactive cards beside the video. **Magic moments
   board** (primary UI, per explicit user direction — vibe-writing canvas
   plans was "too much"): the objectives flow renders as a numbered
   vertical diagram and the operator pins cards to steps ("＋ magic moment
   here"); a moment is a scripted card (style note/image/question/stat)
   with `objIndex` for board grouping and trigger keywords pre-derived
   from its step's words — deterministic firing via the existing
   scripted-card engine, no model judgment. Model-driven config
   (style/rules/playbook/suggest) remains below as "Model-driven cards
   (advanced)". Seven components
   (`CANVAS_COMPONENTS`); all on by default. Per-card enable + free-text rule,
   `canvasStyle` (eager/balanced/minimal/on_request), `canvasPlaybook`,
   `placement` (auto/right/left), and `schedulingUrl` (Calendly, activates the
   Scheduling card). **Approved links** (`linkCatalog`, rides scenarios +
   share links): link cards invent URLs without ground truth, so the catalog
   lists the only URLs the PAL may share (compiled into
   `conversational_context`); `GET /api/site-links?url&q` (builder session,
   SSRF-guarded, browser UA) crawls one real page (or sitemap.xml) server-side
   and returns its same-site links so the catalog is built from the live site,
   never from memory; `?meta=1&url=` returns a page's og:title/og:image (the
   📷 button per row). Rows with an `image` compile into `productCards` —
   deterministic scripted image cards (keyword trigger from `keywords` or
   derived from the label, click-through `href`, 45s auto-hide) merged into
   `controlsConfig.scriptedCards`, so saying the item's words shows its photo
   beside the video with no model involved; the context tells the PAL the
   photos appear automatically.
4.5. **Pronunciation** (`speech`) — `parsePronunciation`: one rule per line,
   `word = how to say it` (also `:` / `->`), `[ipa]` → `type: "ipa"`, `[case]`
   → `case_sensitive`, duplicates dropped. On launch →
   `POST /pronunciation-dictionaries` then `PATCH /pals/{id}`
   `/layers/tts/pronunciation_dictionary_id`. Persists on the PAL.
4.55. **Tavus skills** — `internet_search` (no config; bottom of `tools`
   step) and `browser_use` (**Presentation step** — account-enabled skill).
   Browser Use runs PRE-AUTHORED NAMED GUIDED FLOWS (`config.guided_flows`,
   ≤20; each `{name, description, start_url, steps[≤50]}`; steps are
   🌐 `{task, prompt, url?}` / 💬 `{prompt}` speak-only / 🖼 `{slide, prompt?}`
   pages of `config.slide_document_id`) — it NEVER free-browses. Builder has
   a first-class flow editor + ✨ "Script a flow" (`kind: "browserflow"`,
   Tavus best practices: speak-only intro, small single-action tasks,
   1-2 sentence narration per step — narration covers browser think time),
   🧪 Validate-&-attach (PUT now, server-side verdict), a
   when-to-run-which-flow steering box (🪡 inject teaches the persona its
   flows BY NAME), and a raw-JSON drawer over the same `browserUseConfig`.
   Launch + validate refuse empty `guided_flows` / slide steps without a
   deck. **Browser Use and Presentation are MUTUALLY EXCLUSIVE on a PAL** —
   Tavus 400s the pair outright ("move presentation slides into Browser Use
   instead"). Launch attaches Browser Use first, so the DECK is what fails
   and the fail-safe then DELETEs it, leaving a PAL that looks like slides
   were never configured while the Slides step insists they are. Launch now
   skips the deck attach with a loud log when a browser config is present,
   and the cross-check flags the pair. Slides alongside Browser Use only
   exist as 🖼 steps inside a guided flow (`config.slide_document_id` +
   `{slide, prompt?}` steps) — which fire in FLOW ORDER, so an "open the
   diagram whenever X comes up" behaviour is not achievable with Browser
   Use attached; that needs Presentation and no Browser Use. On launch `PUT /pals/{id}/skills/{skill_id}` `{config}`; per-skill
   Detach buttons (`DELETE …/skills/{id}`). **Flow coherence rules** (from
   the "browser mode isn't working" audit — mirrors the deck's): both
   validate and launch PUT the same `sanitizeBrowserCfg` shape (blank
   flows/steps dropped, empty step `url` keys stripped, 20/50 caps);
   toggle-on-with-no-complete-flows SKIPS the attach and CLEARS stale flows
   off the PAL; a failed attach fail-SAFEs (DELETE — the log also points at
   the account-grant cause on 403/404); when flows exist,
   `conversationPayload` names them in context ("start one by its exact
   name… run it straight through step by step without waiting between
   steps" — the model otherwise narrates instead of opening the browser,
   or stalls mid-flow waiting for the visitor); share links snapshot
   `browserUse: {config}` and `demo-launch` re-PUTs it per visitor call. Browser view arrives as the
   replica's screenVideo track — same path as slides, already rendered by
   the custom UI (and the duet joiner's side panel; the duet beat cue says
   "start your guided browser flow \"X\"").
4.6. **Integrations** (`tools`) — the **tools REGISTRY**, not the deprecated
   inline `layers.llm.tools`. That path only ever supported app-message
   delivery, so the result never re-entered the conversation and the PAL
   could acknowledge a tool call but never answer from it. Ability rows
   ({name, desc, fields, delivery, method, url, authType/Name/Value, onCall,
   filler, onResolve}) → `toolDefs` (registry shape: name, description,
   parameters, origin:"llm", on_call, on_resolve, delivery). Launch:
   `GET /tools?type=user&name_or_uuid=` → `PATCH /tools/{id}` when the name
   exists else `POST /tools` (names are unique per ACCOUNT, so a relaunch
   409s on create), then `POST /pals/{id}/tools {tool_ids}` and DELETE any
   attached tool not in this demo's set (full replace, like guardrails).
   **Defaults are the feature**: `delivery:"api"` implies
   `on_call:"silent"` + `on_resolve:"generate_response"`, so the PAL calls
   the endpoint quietly and SPEAKS the JSON that comes back; `body_template`
   is generated from the declared fields (every `{placeholder}` must be a
   declared property — hand-written JSON is where that breaks). The hygiene
   sweep now clears `layers.llm.tools` ALWAYS, not only when tools are off:
   a PAL built by an older version would otherwise offer every function
   twice. `toolWebhook`/`toolEcho` still travel in `controlsConfig` and
   still serve app_message delivery — `CallExtras` forwards
   `conversation.tool_call` app-messages to the webhook as `text/plain`
   JSON (no CORS preflight — works with Zapier/Make catch hooks).
   NOTE: the Tavus **MCP server** (`https://mcp.tavus.io/mcp`) is for CODING
   AGENTS, not for this browser app — it is an OAuth'd wrapper over the same
   REST API the builder already calls. Don't route the builder through it.
4.65. **Calls & Data** (`calls`) — pull-based, straight from Tavus:
   `GET /conversations` list + `GET /conversations/{id}?verbose=true` for
   transcript (`transcription`-type event), perception analyses, and raw JSON
   download. Covers visitor calls from shared links too (same Tavus account).
4.7. **Timing & Controls** (`controls`) — `maxMinutes` →
   `properties.max_call_duration`; `wakePhrase` → a conversational_context
   instruction. **Sparrow turn-taking** (top of the step): 5 dials
   (`sparrowModel` — **defaults to "sparrow-2"** per explicit user direction,
   Tavus's own default is still sparrow-1, so every launch PATCHes it;
   ""/sparrow-1 selectable — `sparrowPatience` low/medium/high,
   `sparrowInterrupt` verylow/low/medium/high, `sparrowIsolation` "near",
   `sparrowIdle` "patient") → `conversationalFlowPayload` (only set fields) →
   launch `PATCH /pals/{id}` `[{op:"add", path:"/layers/conversational_flow",
   value}]`. Blank = Tavus default; deliberately NOT cleared by the hygiene
   sweep (low-stakes layer, avoids churn). Persists on the PAL.
   The rest run client-side in `CallExtras` (rendered inside
   `CVIProvider`, custom call UI only) via Daily app-messages:
   `timeWarning` (echoed at T−2min), `inactivitySeconds`/`inactivityUtterance`
   (silence → echo → 10s grace → leave), `interruptButton`
   (`conversation.interrupt`), `guardrailEcho` (echo on any `*guardrail*`
   app-message event).
   **Recording → S3** also lives here: **on by default**, and the S3 fields
   persist in localStorage (`REC_KEY = "tavus_builder_recording_v1"`) —
   entered once per browser; `applyConfig` falls back to those saved values
   when a scenario predates the feature. Fields: `recordingEnabled` + `recS3Bucket`/
   `recS3Region`/`recS3RoleArn` (+ optional `recS3ExternalId`) →
   `properties.enable_recording: true` and `properties.recording_storage`
   (`{provider:"s3", bucket_name, bucket_region, assume_role_arn,
   external_id?}`) on the conversation payload — non-secret identifiers only;
   AWS access comes from a one-time IAM role trust to Tavus, never keys.
   **Gotcha: Tavus does NOT start the recording on its own** — `CallExtras`
   calls `daily.startRecording()` on `joined-meeting` when
   `controls.recording` is set (the flag travels in `controlsConfig`, so
   visitor calls from shared links record too; the storage config rides the
   stored payload through `demo-launch`). Recordings land at
   `tavus/<conversation_id>/<epoch_ms>` in the bucket (MP4, no extension).
   **Recording visibility**: when recording is on, `conversationPayload`
   points `callback_url` at `/api/recording-hook` (public POST; a
   user-entered webhook still gets every event — it rides along as `?fwd=`,
   SSRF-guarded). The hook stores `application.recording_ready` /
   `recording_copy_failed` under `rec:{conversation_id}` in Redis (90-day
   TTL, hourly abuse cap, always answers 200). `GET /api/recordings?ids=`
   (builder session required) returns the map; the Calls & Data step shows a
   ⏺ badge per recorded call and a Recording panel (s3:// URI, copy, S3
   console link) above the transcript.
5. **Demo Page** (`site`) — `brand`, `logoUrl` (set via **file upload** →
   canvas-downscaled ≤512px data URL, stored in config, no hosting),
   `headline`, `tagline`, `cta`, and `format`: `desktop` | `phone` (a
   scrollable in-app screen — status bar, app header, hero + CTA, skeleton
   cards standing in for the host app — inside a phone frame; in-call the
   conversation takes the screen over full-bleed) | `kiosk` (framed
   freestanding totem preview with a touch-to-start attract screen; the
   **Go live** button flips to `demo-kiosk-live` — chrome-less full-viewport
   + fullscreen for real kiosk/tablet hardware, Esc drops back to the framed
   preview) | `hologram` (a Proto-style holobox: white enclosure with brand
   top bar + speaker grilles, glowing blue 9:16 screen the call renders
   into — bright and physical, per explicit user direction; NOT dark
   sci-fi).
   **The design goal is "that's OUR site"** (per explicit user direction —
   the ✨ design studio / `designed` format / `kind:"design"` were DELETED
   as bells-and-whistles; `applyConfig` coerces legacy `designed`→`desktop`
   and drops `site.design`). Two fidelity mechanisms, screenshot wins:
   - **📸 Screenshot facade** (`site.shot`, JPEG data URL auto-compressed
     to ≤300KB, upload or clipboard-paste on the site step): on `desktop`
     it's a "their site comes alive" treatment (`.demo-shot`/`.shot-*`) —
     the screenshot's top ~118px stays crisp as their real header
     (`.shot-topbar`), the rest becomes a blurred/dimmed full-bleed
     backdrop (`.shot-backdrop`, animated dim), and the call rises on a
     clean centered stage with white headline/tagline over it (replaced
     the flat card-over-busy-page overlay, which read as an iframe on
     clutter); on `phone` it's the app screen with a sticky CTA sheet. Kiosk/holo ignore it. Rides
     scenarios + share links; the CLOUD DRAFT strips `shot` when the
     payload exceeds ~380KB (the draft slot caps at 400KB) — local
     autosave and scenario saves keep it.
   - **Auto-facade from the URL**: `brand-theme` also returns `navLabels`
     (the site's real top-nav labels, rendered via `.dz-navlinks` — the
     one surviving dz class) and `heroImage` (og:image → the desktop
     stage's pre-call poster background, sanitized http(s) only), stored
     as `site.nav` / `site.heroImage`.
   `DemoSite` switches on `site.format` via `demo-{format}` CSS classes.
   Canvas split-layout only engages on `desktop` and live kiosk — phone,
   framed kiosk, and hologram keep the card overlay behavior.
5.5. **Experience** (`experience`) — the arc around the call, all riding
   shared links (config travels in the demo snapshot). **Guided journey**
   (`expJourney`, editor shape → `compiledJourney` ships): up to 8
   builder-composed pre-call steps — `info`, `video` (YouTube/Loom/Vimeo/mp4
   via `videoEmbed()`), `question` (choice), `input` (free text), `personas`
   (cards with per-option context/greeting/PAL-ID override). The visitor
   walks them as guided screens (progress dots) ending in the email gate;
   answers are woven into the conversation via `applyJourneyPrefs()` —
   duplicated in `api/demo-launch.js` (server resolves INDEXES against the
   stored journey; keep both copies in sync) — and stored as `{q,a}` pairs
   on the exp record (Results shows them). **Pre-call**: email
   gate (`expEmailGate`/`expEmailRequired`/`expEmailPrompt`) — **default ON**
   (email is table stakes; only explicit false turns it off, and old
   scenarios inherit ON); visitors
   enter an email before the CTA fires; `expNotifyWebhook` gets a
   `demo.attend` POST (incl. answers) the moment a visitor starts (works
   gate-on or -off).
   **Post-call** (any toggle on → ending the call lands on a thank-you
   screen instead of leaving): `expRating` (1–5 stars + comment),
   `expBooking` (opens `schedulingUrl` — shared with the Canvas scheduling
   card), `expTalkAgain`, `expThanks` (headline). All off = classic
   landing→call flow. In `DemoSite`: gate/post screens render inside the
   stage for every format (`exp-screen`); `handleLeave` routes to the post
   screen via `onCallEnd` (clears the conversation without closing the
   page). Attend/feedback POST to `/api/experience`; the Results step shows
   a "Visitors & feedback" list, 👤/★ row badges, and a Visitor panel on
   call detail (`expMap`, fetched alongside recordings).
   **Memories** (Tavus `memory_stores`, configured on the Knowledge Base
   step — Knowledge is what it knows, Memory is what it remembers about
   the person): `memoryEnabled`/`memoryMode`("visitor"|"demo")/`memoryKey`.
   Builder launches send a demo-level store on the payload (visitor mode
   uses a separate `…_operator` store so tests don't pollute visitors);
   share links carry `experience.memory` in the snapshot (STRIPPED from
   the public GET like notifyWebhook) and `demo-launch` derives the key
   server-side — visitor mode keys to the gate email scoped per demo
   (`{key}_{email-slug}`; no email → memory_stores deleted), demo mode is
   one shared store. Keys are slugged [a-z0-9_]; changing the key starts
   a blank memory. The anatomy hub shows 💭 Memory separate from
   📚 Knowledge.
   **Coach mode** (same step; Rilla-style roleplay trainer): `coachEnabled` +
   `coachVisible` + `coachTitle/Scene/TalkHint/CriteriaText`
   ("label | keywords" per line, ≤8) → `controlsConfig.coach`;
   **`coachVisible` (default true) decides whether the person ON THE CALL
   sees the panel.** True is roleplay training, where watching the criteria
   tick is the product. FALSE is any assessment: the criteria are the answer
   key, and an interview candidate reading "mentions total cost of
   ownership" off a sidebar is being marked against a rubric they can see.
   Hidden keeps every hook running (keyword ticks, the ~25s judge, the final
   post to the exp record) and returns null instead of the panel — and
   `coachShown` gates `.coach-split` too, so the stage doesn't reserve a
   sidebar nobody can see. The cross-check flags visible-coach +
   a grading rubric as a WILL BREAK with a one-click hide. `CoachPanel` in DemoSite (desktop + live kiosk;
   `.coach-split` right sidebar, canvas/card panel auto-moves left) renders a
   live scorecard — keyword lines tick instantly off the visitor's speech
   (utterance feed via `onCoachSpeech` on CallExtras), keyword-less lines are
   judged every ~25s by `kind: "score"` on generate-persona (Haiku,
   conservative; the ONE unauthed kind — a real demo slug is the credential,
   rate-capped per slug like /api/experience) — plus a talk/listen meter,
   live transcript, REC countdown, and a `coach-scene` overlay (scene line)
   until the first utterance. ✨ "Draft the scorecard" = `kind: "coach"`
   (title/scene/talkHint/criteria from persona + objectives). The final
   score posts to the exp record as a "Scorecard" answer on panel unmount.
5.8. **Studio** (`studio`) — records scripted takes as MP4 feature demos.
   `studioLines` (saved with scenarios) script the visitor — hand-written or
   Claude-drafted (`kind: "script"` on generate-persona: lines engineered
   from the demo's config to fire scripted-card trigger words in order,
   request/react to the deck per its trigger mode, invite canvas cards,
   advance the objectives, optionally test one guardrail); `startStudioTake()`
   captures the tab via getDisplayMedia **inside the click** (gesture rule),
   renders lines via `POST /api/tts` (**Cartesia** Sonic behind
   `CARTESIA_API_KEY` — per explicit user direction, same voice stack as
   Tavus; `CARTESIA_VOICE_ID`/`CARTESIA_MODEL`/`CARTESIA_VERSION` env
   overrides, voice falls back to the account's first voice; GET probes
   availability for the step's ready-check), then `launch()`es
   with `controls.studio: true` + `recordingLayout: "stage"`. The take
   engine in `CallExtras` (reads module-level `STUDIO_RUNTIME`) joins with
   the TTS MediaStream as mic (`setInputDevicesAsync`), camera off,
   publishes the captured tab as the stage screenshare, starts the S3
   recording, and turn-takes off utterance app-messages (1.7s quiet → next
   line; 12–16s fallback timers so a take always completes). Tab capture is
   the point: Daily's composed recordings can't see DOM overlays, so this
   is the only capture that includes Magic Canvas cards. Takes surface in
   Results as ordinary ⏺ recordings. **Live-call path untested in CI** —
   verify on deployed hardware before demoing.
   **Duet mode** (same step) is SELF-CONTAINED (v2, per explicit user
   direction — borrowing the demo PAL made cards misalign with the actual
   conversation): describe the conversation → `kind: "duet"` on
   generate-persona plans the TALK TRACK FIRST, then both personas (each
   embeds the outline verbatim), then derives the scripted cards from the
   finished outline (trigger words must appear in its beats) — alignment by
   construction. Studio maintains exactly TWO reusable PALs (`studioPalA/B`,
   `ensureStudioPal` PATCHes /system_prompt per plan, creates only when
   missing/stale) so duets never pile up PALs. **Latency**: BOTH sides get
   scripted openers (`duetOpener` = featured's custom_greeting,
   `duetOpenerB` = host's custom_greeting written by the plan as a reply to
   the featured opener) — the opening exchange plays instantly while real
   LLM turns generate, and `DuetStage` (`scriptedOpen`) skips relaying A's
   first turn since B's greeting already answers it. BOTH rooms join at
   t=0 (both faces visible together — no black tile); side B joins with
   `&hold=1` (`DuetJoiner` hold mode: audio muted + any spontaneous greeting
   interrupted). When A's opener lands, the parent posts `release` and B
   speaks the scripted reply via `conversation.echo` (18s fallback release);
   per-side ready flags + queued respond messages keep ordering
   deterministic. Cards render ON THE ASKER'S TILE (`duet-tile-card`,
   from = triggering side); a live question card's option auto-selects when
   the OTHER speaker's turn contains the option text (`forcePicked` on
   `ScriptedCard`). A `duet-narrator` strip under the tiles explains what's
   on screen: plan `summary` at start, a Magic Canvas caption when a card
   fires, then outline beats as the talk track advances. `kind: "duet"`
   also returns `summary` and writes an emotional arc into both prompts
   (per explicit user direction — tone/expressions escalate across beats). Tiles carry `duet-name` chips
   (who is who); cards render in a dedicated `duet-cardbar` band BELOW the
   tiles (never over a face).
   **On-screen surfaces** (`duetDeck`/`duetBrowser` + `duetDeckBeat`/
   `duetBrowserBeat`/`duetBrowserShow`, saved with scenarios): the FEATURED
   side can present the deck (`docIdsRaw` editable in-place on the Studio
   step — same state as the Presentation step; `slides_trigger:
   "on_demand"`) and/or run Browser Use (with a "what to pull up" target) —
   startDuet PUTs the skill on the featured studio PAL when on and DELETEs
   it when off (the reusable PAL must not carry a stale deck into the next
   duet); planDuet appends a beat hint to the brief so the outline actually
   reaches the deck (toggle BEFORE planning). Each surface can be scheduled
   to a talk-track beat: at that beat `DuetStage` rides a
   `(Stage direction: …)` parenthetical into the next host→featured relay
   (one-shot `deckCuedRef`/`browserCuedRef`; the featured context explains
   the convention — act silently, never read aloud), so the surface opens
   on cue instead of when the model feels like it.
   **Rehearsal** (`DuetRehearsal`, "▶ Rehearse the take"): free playback of
   the storyboard on a mock stage — placeholder tiles, every card on its
   owner tile at its scheduled time, panel-open simulation, narrator line,
   transport bar (play/pause/speed/scrub) and a clickable event ruler.
   ~11s/turn simulated pacing; order/tile/beat positions exact, "≈" marks
   model-timed events. No conversations are created.
   **Deterministic placement**: `compileScriptedCards` defaults `owner` to
   `"featured"` — a card's tile NEVER depends on which speaker triggered it.
   **Video look** (`duetLook`, default `"meeting"`): the duet's purpose is
   replacing a hand-recorded avatar call, so the default look reads like a
   saved Zoom/Meet recording — Meet-dark canvas, bottom-left name tags,
   native "Recording" pill, narrator as a captions bar, and operator
   controls (End & save, turn counter, live quotes) in a `.meet-controls`
   cluster that fades out after 2.5s of mouse idle so the tab capture never
   shows them. `"stage"` keeps the branded chrome. The rehearsal previews
   whichever look is selected. **Latency**: the joiner's end-of-turn quiet
   window is adaptive — 900ms when the transcript ends on sentence-final
   punctuation, 1400ms for mid-sentence stops/blank buffers (scripted speech;
   short windows there caused talk-over) — and `ensureStudioPal` sets
   `layers.perception.perception_model: "off"` (duet rooms have no camera or
   mic; raven is dead weight). `speculative_inference` already defaults true.
   Two conversations are created; each joins in a same-origin iframe
   (`?duet=join&url=…&side=a|b` → `DuetJoiner`; dodges Daily's
   one-call-object-per-page limit). The joiner renders the replica's
   screen track (presentation slides / Browser Use) in a dedicated panel
   that slides open BESIDE the face — canvas-placement style, never covering
   it — and posts `{type:"screen"}` up so `DuetStage` widens that tile
   (`duet-screen-a/b` grid classes) and captions it in the narrator. The parent `DuetStage` is a pure TEXT
   switchboard: a replica's finished turn (buffered `conversation.utterance`
   speech, flushed on `stopped_speaking`; role from properties OR embedded
   in the event type, user role skipped, streaming-utterance events
   excluded) is sent to the other room as `conversation.respond`. No
   microphones in either room → no feedback loops. Recording is LOCAL:
   getDisplayMedia tab capture (with tab audio) → MediaRecorder → .webm
   auto-download — S3/Daily recording never sees both rooms. Config fields
   `duetPalB/FaceB/Opener/Topic/Turns` persist with scenarios; hard caps:
   2×turns relays + 5-minute timer + `max_call_duration: 360` on both rooms.
   **Scripted cards in duets**: `DuetStage` receives `compiledScriptedCards`
   and runs its trigger engine (`matchCards`) on the joiner's LIVE speech
   feed (`{type:"speech"}` posted per utterance event — cards fire the
   moment the word is said, not an end-of-turn quiet-window later) with the
   finished-turn text as backstop (scripted speech has no live feed; the
   authored `openerA`/`openerB` texts are substituted at turn time so their
   keywords still fire). The joiner dedupes cumulative utterance re-emits
   (Tavus can resend a turn's text containing everything so far — replace,
   never stack, or relayed turns read "A. B. A. B. C."). Magic Canvas still
   never renders in duets. The plan preview is an **editable storyboard**:
   talk-track beats side by side with the visuals that fire on each (cards
   matched to beats by trigger keyword, deck/browser open markers, unmatched
   cards footed). Both columns edit `duetPlan` in place — beats
   (add/edit/delete; blank beats filtered at record time) and full card
   editors (style/title/body/trigger/owner-tile/stays-seconds, per-beat
   "+ card" pins to that beat, incomplete cards get a ⚠ won't-appear flag).
   **Card timing**: trigger `"beat"` + `atBeat` (1-indexed) fires when the
   talk track reaches that beat (~2 turns/beat, the narrator's clock) —
   deterministic, the default for hand-added cards and ~half of planned
   ones (DUET_SYSTEM); `"keyword"` fires live off the speech feed; the
   due-turn fallback spreads KEYWORD cards only (beat/time/start cards
   keep their own clock).
   Edits ARE what runs (sharedCtx + compileScriptedCards read duetPlan
   live); the personas embed the ORIGINAL outline, so direction changes
   warrant a re-plan — the hint under the storyboard says so.
   **Sales handoff** (`promoteDuet`, `kind: "promote"` on generate-persona):
   "Continue as a live demo" — Claude adapts the featured duet persona for a
   real human visitor (same character, co-host/talk-track mechanics removed,
   visitor-facing Conversation Flow; returns JSON
   `{name, prompt, greeting, objectives|null}`), creates a brand-new
   PERMANENT PAL (never touched by `ensureStudioPal` — that only PATCHes the
   two studio PAL ids), and loads it into the builder: Setup gets
   palId/faceId/name, Persona the (already attached) prompt as reviewable
   draft, greeting + suggested objectives applied, deck/browser toggles
   carried into presentationEnabled/browserUseEnabled. Then launch/share as
   any demo.
   **Scripted-card extras**: style `question` = clickable multiple choice
   (title is the question, body lines are the options); the pick goes to the
   LLM as `conversation.respond` (answer fn threaded through
   `onScriptedCard({card, seq, answer})`) and appends to the exp record's
   answers via kind:"attend" (server APPENDS answers now, cap 24). Claude
   can draft the whole card set: `kind: "cards"` on generate-persona
   (JSON array), wired to "✨ Generate cards" on the Studio step (lands in
   `scCards`, editable on the Magic Canvas step).
5.9. **Cross-check** (top of the Launch step + a red count badge on the
   rail from every step) — `crossCheck`, a useMemo of ~15 DETERMINISTIC
   findings: facts about the config, never a model's opinion, so it cannot
   invent a problem. Catches the drift a scattered launch log never
   surfaced in time — an unattached persona draft (the PAL runs the older
   prompt), perception queries with no Perception section in the prompt, a
   deck with no presenting section, two scripted cards sharing a trigger
   word (first-match-wins, so the later never fires), per-visitor memory
   with the email gate off (no key, no memory), anything offering booking
   with no `schedulingUrl`, a rubric with the scorecard switched off.
   Findings are `{level: "break"|"look", title, why, step, fix?}`; each
   carries its OWN fix that routes through the existing reviewed path
   (`attachPersona`, the 🪡 injects, a single toggle) plus a jump to the
   step. **There is deliberately no "fix all"** — a button that
   reconciled persona, objectives, cards and rubric together would be a
   regenerate in disguise and would change a demo in the one way the
   operator can't catch before going live. It detects; it never
   reconciles. NOTE: the memo must stay declared BELOW
   `compiledScriptedCards`/`parsedRubric`/`parsedCoachCriteria` and
   reference later-declared functions only inside arrows — naming a
   later `const` in the memo body is a TDZ error that renders a blank app.
6. **Launch** — runs the whole attach-then-create sequence, logs each step.
   Also **Preflight check** (`preflight()`): `POST /objectives/validate`
   (shape/chain check, nothing saved) + `POST /conversations` with
   `test_mode: true` (Tavus validates the full payload incl. recording
   storage; conversation is created pre-ended — no PAL joins, no cost).

## Feature walkthroughs (`/api/walkthroughs`)

App-level (not per-demo) video library: one Redis hash `walkthroughs`
mapping `stepId → {url, narration}`. Managed on the Account step (pick a
step, ⬆ upload via `blobUploadSmart` — the shared Blob uploader extracted
from the KB path — or paste an https URL, write narration, save). Steps
with a video get a ▶ in the rail; the player is a modal `<video>` with the
narration rendered LIVE by `/api/tts` (Cartesia) and synced to
play/pause/seek — recordings are swapped without ever editing audio in.
Built for live-call footage (Studio takes / S3 recordings).

## Chat with the demo (`kind: "edit"`)

A fixed bottom-center **edit bar** (`.editbar`, hidden on demo/duet overlays
and the login screen): one plain-English instruction → `kind: "edit"` on
generate-persona receives the full current state (prompt, objectives,
guardrails, greeting, page copy, canvas playbook) and returns
`{note, changes:{piece: null|newText}}` — an EDIT, never a regenerate
(operator text is sacred; flow changes must land in objectives, rules in
guardrails + prompt). Nothing applies until the operator clicks **Apply** on
the pending card (note + changed-piece chips). Prompt edits clear
`personaAttached` (manual re-attach); objectives/guardrails re-attach on the
next launch. This is the primary post-generate editing path — steps stay for
surgical edits.

## Launch sequence (`launch()`)

In order, skipping any disabled section:

1. Objectives → `POST /objectives`, then `PATCH /pals/{id}` with
   `[{op:"add", path:"/objectives_id", value}]` (replaces any existing set).
2. Guardrails → `POST /guardrails` per rule, then `PATCH /pals/{id}`
   `/guardrail_ids` with **exactly the new IDs (full replace)** — merging
   accumulated duplicates across relaunches until PALs hit Tavus's
   50-guardrail cap and launches 400'd. The builder owns the PAL's set.
3. Presentation → `PUT /pals/{id}/skills/presentation`.
4. Magic Canvas → `PUT /pals/{id}/skills/magic_canvas`.
5. `POST /conversations` → stores `conversation`, flips `siteMode` on to open
   the demo page.

All requests go through `tavusFetch(method, path, body)` with the `x-api-key`
header. The right-hand **preview panel** shows the exact `curl` for the current
step (`curlFor`) — if a browser call is blocked by CORS, the log tells the user
to copy that curl and run it from a terminal/backend.

## Payload construction (the `useMemo` blocks)

- `presentationPayload` → `{ config: { document_ids, slides_trigger, prompt? } }`
- `canvasPayload` → `{ config: { components: overlay } }` where `overlay` only
  lists **disabled** components (`{enabled:false}`) plus the scheduling embed.
  **Gotcha (noted in the preview panel): a PATCH containing `components`
  replaces the whole overlay map — always send the complete set of overrides.**
  This tool uses `PUT` (full overwrite) for skill attaches.
- `conversationPayload` → `face_id` + `pal_id`, optional name/callback/greeting,
  `properties.languages` — an ORDERED list of the 42 Tavus language codes,
  first entry = the language the call opens in; sending it REPLACES the PAL's
  set rather than merging (the deprecated single-name `properties.language` is
  gone, and `applyConfig` migrates old scenarios by name) — and (when canvas
  is on) the assembled
  `conversational_context` combining style text, per-card rules, playbook, and a
  `layout.preferred_slot` instruction for `safe-area-{left|right}`.

## Demo page (`DemoSite`)

Full-screen branded shell rendered when `siteMode` is true.

- **The custom CVI call UI is the ONLY call path** (per explicit product
  decision — never show the Daily prebuilt/hosted iframe). Components are
  vendored under `src/components/cvi/` and loaded via
  `import.meta.glob("./components/cvi/components/*/index.{tsx,ts,jsx,js}")`.
  - `cvi === undefined` → loading
  - `cvi` object → render custom `<CVIProvider><Conversation/><MagicCanvas/></CVIProvider>`
  - `cvi === null` → chunk load failure → a "Reload" prompt. There is **no
    iframe fallback** and no `?ui=` escape hatch.
- (The old `useTabRecorder` tab-capture button was removed once server-side
  S3 recording shipped — don't reintroduce a second recording path.)
- **Magic Canvas split layout**: when a side card is active,
  `onLayoutEffectChange` flips `canvasPanel` and the stage splits — the video
  pane resizes into the remaining width (`.cvi-video-pane` + `left`/`right`
  insets) and the card lands in a dedicated `.canvas-panel` region with its own
  background. Cards get their own screen beside the video, never overlaying it.
  (Replaced the old `translateX` video-shift, which still let cards cut into
  the video.) Panel width is `--canvas-panel-w` on `.cvi-wrap`; the vendored
  side slots are re-fit to it via `[data-canvas-slot]` overrides (the module
  CSS sizes them off `100vw`, wrong inside a contained stage). Phone format
  keeps the overlay behavior — too narrow to split.

### A/V smoothness invariants (from the "audio lags lipsync then speeds
up to catch up" audit — that symptom is WebRTC NetEQ draining a playout
buffer the page starved)

- **No perpetual paint animations while a call is live.** The vendored
  call container's infinite `background-position` gradient animation and
  the hologram's pulsing `box-shadow` (`hologlow`) were the culprits —
  both now static. One-shot animations (`shotdim`/`shotrise`, connect
  spinners) are fine; anything `infinite` that invalidates paint
  (background-position, box-shadow, filter) is not.
- **The remote-audio sink never unmounts mid-call.** `MainVideo` renders
  its one `DailyAudioTrack` on every branch (connecting states included),
  keyed to the last known replica id — a detached/re-attached audio
  element restarts playout with accumulated delay, then audibly
  accelerates.
- **No mic input processors.** `use-cvi-call` joins without Krisp
  noise-cancellation — the WASM processing competes with remote playout
  on marginal demo laptops.
- **Keep the memo firewall intact.** `handleLeave` (a prop of the
  memoized `Conversation`) stays `useCallback`-wrapped; per-utterance
  state (coach feed, captions) must not re-render the call surface.
  `useClosedCaption(enabled)` is gated — captions default off, so its
  per-word setState was the highest-frequency React work on a plain call.
- Live diagnosis: `chrome://webrtc-internals` → receive-audio
  jitter-buffer target rising then dropping during the drift.
- **Every direct child of `.cvi-wrap` MUST size itself** (`width:auto;
  height:auto` on absolutely-positioned pills, or an explicit width):
  `.cvi-wrap > * { width:100%; height:100% }` inflates anything that
  doesn't — a pill with `border-radius:999px` then renders as a
  stage-sized translucent disc over the face (the interrupt button did
  exactly this once `palSpeaking` started popping it in mid-call).
  CallExtras returns a fragment, so ALL its overlays (interrupt-btn,
  rec-live, stage-rec-btn, annot-rail) are direct children of the wrap.

### Fixed — custom CVI call UI used to hang on "Connecting"

Root cause (confirmed & fixed): the vendored `Conversation` component joined
in a **mount-only** `useEffect`, but `DailyProvider` creates the Daily call
object asynchronously and child effects run before parent effects — so
`useDaily()` was still `null`, `daily?.join()` silently no-oped, and nothing
retried. The fix (in `components/cvi/components/conversation/index.jsx`)
gates the join effect on `useDaily()` so it fires once the call object
exists. **Don't regress this when re-running `npx @tavus/cvi-ui add` — the
CLI's `--overwrite` will clobber the patched file.**

(Historical note: a hosted-iframe fallback existed until the user asked for
the prebuilt UI to be impossible; it was removed once this fix made the
custom path reliable.)

## Design system — Alto

Styling approximates **Alto (the Tavus Design System)**: warm light canvas,
white cards, hairline borders, large radii, black pill buttons, peach accent.
**All tokens live in the `:root` block** at the top of the `<style>` (`--canvas`,
`--surface`, `--border`, `--text`, `--muted`, `--accent`, radii, fonts). These
are approximations — **paste real Alto values into `:root` to match exactly**;
that is the single intended place to retheme.

## Persistence — scenarios & API key (localStorage)

`store` is a try/catch wrapper over `localStorage` that **silently no-ops where
storage is blocked** (e.g. the claude.ai preview iframe) — saves succeed in a
real local Vite app.

- **Scenarios** (`SCENARIOS_KEY = "tavus_builder_scenarios_v1"`) — named
  snapshots of the full builder config (everything except the API key),
  including `personaBrief` and `personaDraft`. The top-bar UI is a
  **Demo library** panel (`libOpen`), not a dropdown: search, per-row
  load/delete, ☁ badges, last-saved dates (`SCENMETA_KEY` locally +
  `scenmeta:{email}` hash via GET `/api/scenarios` → `{names, meta}`), and
  automatic grouping by the `Client / Use case` naming convention. A
  **save prompt** (`savePrompt`, bottom-right card) fires after a
  successful launch (on return from the demo page) and after creating a
  share link, whenever `isConfigDirty()` — keep `collectConfig` cheap, it
  runs in the dirty check.
  `collectConfig()` / `applyConfig()` are the serialize/restore pair; keep them
  in sync when adding a new field. Save/Load/Delete plus **Export/Import** to a
  JSON file (the file path works even when localStorage is blocked).
  **Cloud sync** (`/api/scenarios`): localStorage is only the instant/offline
  cache — every save/import also POSTs to the account's Redis hash, the
  dropdown shows the union of local + cloud names (☁ = synced), and load
  prefers the cloud copy when the two differ (it's the one that survives
  cleared browser storage and follows the account across devices).
  `cloudSync` state: `"unknown" → "on"/"off"`; `"off"` (no Redis, bare vite)
  degrades to the old localStorage-only behavior with honest log lines.
- **API key** (`APIKEY_KEY = "tavus_builder_api_key_v1"`) — remembered only when
  the "Remember key" box is checked; **never included in scenario exports**.
- **Autosave draft** (`DRAFT_KEY = "tavus_builder_draft_v1"`) — a rolling,
  debounced (900ms) snapshot of `collectConfig()` written on every change and
  restored on mount (with `activeScenario`), so Back/refresh/crash never lose
  work. Launch also auto-saves to the library (`saveScenario()`) when dirty
  BEFORE opening the demo page, and `siteMode` pushes a history entry so the
  browser Back button closes the demo overlay instead of leaving the SPA.

## Keeping it simple — the anti-overengineering process

This tool nearly died of feature accretion once (each feature fine alone;
their interactions broke the paste-a-link golden path). Three standing
rules, in force for EVERY change:

1. **The golden path is executable.** `cd builder && npm run smoke` runs
   the objectives-compiler invariant tests, `tools/api-kinds.test.mjs`
   (invokes the generate-persona handler once per `kind` with no
   ANTHROPIC_API_KEY, so each branch builds its whole prompt and stops at
   the key check — **add a case when you add a kind**), and a real-browser
   drive of the New Demo flow (mocked backend) asserting intake → build →
   apply → settings, PAL-id survival, greeting cohesion, and feature
   toggles. Run it before pushing anything that touches draftDemo, launch,
   parseObjectives, conversationPayload, the start step, or a
   generate-persona branch — and extend it when adding an intake field or
   feature pick. RED = don't ship.
   (`const c = context || {}` is declared PER BRANCH in generate-persona:
   a branch that uses `c` without declaring it throws only at request
   time, shipping clean through build and lint and surfacing as Vercel's
   FUNCTION_INVOCATION_FAILED. That is the bug api-kinds.test.mjs exists
   to catch.)
2. **Complexity budget on the PAL's standing instructions.** The default
   PAL model is tavus-gemma-4 (small): `conversational_context` stays
   ≤ ~450 words fully loaded, no rule stated twice across prompt and
   context, no negated instructions ("never say you can't…"), and every
   context part is gated on its feature toggle. A new instruction must
   displace or merge with an old one, not stack.
3. **Features default OFF and never touch the minimal path.** The minimal
   demo (idea → build → launch) must work with every optional feature
   unchecked; a feature's code must be inert (no context parts, no
   payload fields, no PAL attachments) when its toggle is off. Launch
   detaches what's off; failures fail-safe (clear stale PAL state),
   never fail-stale.

Periodic deep audit (monthly, or after any multi-feature sprint): three
parallel subagents — repetition mechanics (everything that can make the
PAL say the same thing twice), context bloat vs the word budget, and a
regression diff-review of recent commits — then fix what's confirmed.
The prompts for these live in the session history pattern: symptom-first,
line-refs required, ranked by likelihood.

## Conventions when editing

- It's one component; add UI as a new `step` in `STEPS` and a `{step === "…"}`
  block. New config fields must be threaded through `collectConfig`,
  `applyConfig`, and (if they shape a request) the relevant payload `useMemo`.
- Prefer `PUT` for skill attaches (full overwrite). If you switch to `PATCH`,
  remember the components-map replacement gotcha above.
- Retheme via `:root` tokens, not scattered literals.
- Never reintroduce a hosted-iframe/Daily-prebuilt call path — the custom CVI UI is the only sanctioned call surface.
