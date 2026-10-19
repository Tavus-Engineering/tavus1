# MoneyMaya demo (`/maya`)

A debt relief application with "Maya" (PAL `peb9b600328c`) live beside it.
Concept demo for the MoneyMaya / National Debt Relief funnel. Nothing typed is
submitted or stored. Lives alongside the Experience Builder; touches none of it.

- `/maya`: public page, no sign-in. Visitor presses **Start with Maya** and talks
  to her while filling in the form (debt range → name → address → date of birth →
  illustrative quote).
- Frontend: `builder/maya/index.html` → `src/maya/` (`MayaApp.jsx`, `channel.js`,
  `maya.css`). The call renders with the builder's vendored CVI UI.
- Backend: `api/maya.js` (`?op=start` / `?op=end`), mirrored in `builder/api/`.

## How Maya "sees" the form

No screen share (Raven's screen view lags a few seconds). The page sends each
change into the call over Daily app-messages:

- `conversation.append_llm_context`: field done, back/restart. Silent; Maya just knows.
- `conversation.respond`: new step, an error that is still showing after 1.5s,
  30s idle on a step, quote ready. Maya speaks. Held until neither side is talking
  (`conversation.started_speaking` / `stopped_speaking`), latest one wins.

Every message is prefixed `[FORM EVENT]`. The PAL's system prompt ("How You See
the Form") tells Maya to treat these as ground truth and never read them aloud.
The street address and full birth date are never sent, only "entered" and the age.
The "What Maya knows (live)" panel shows every message as it goes out.

## Limits and env vars

`TAVUS_API_KEY` + Redis (both already used by the builder). Caps: 6 calls per
network per hour, `MAYA_DAILY_CAP` (default 40) per day, 15 minutes per call.
Optional: `MAYA_PAL_ID`, `MAYA_FACE_ID`.

Quote figures are illustrative (≈75% of enrolled debt over 24–48 months) and
labelled as such on the page. Swap in real program math before showing it as
anything more than a concept.

Tests: `node builder/tools/maya.test.mjs` (also part of `npm run smoke`).
