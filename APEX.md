# Apex Wealth demo (`/apex`)

A Tavus avatar ("Apex Portfolio Manager", PAL `p6e28aea25fd`, face Victor `re3fd4adeafd`)
joins a live Zoom call, runs a Discovery & Financial Goal Mapping call, handles
objections, books meeting 2 with a Google Calendar invite, and updates a CRM sandbox,
all through its own tool calls. Lives alongside the Experience Builder; touches none of it.

- `/apex`: Live Call Console (paste Zoom link → Send Apex in; live feed of AI actions)
- `/apex/crm`: deal pipeline, deal record (custom Client Objections field), tasks
- Backend: `api/apex.js` (single function, `?op=` routing) + `api/_apex_lib.js`.
  Mirrored in `builder/api/` like the rest of `api/`.
- Data: Redis, `apex:*` keys only. Reset on the console wipes only those.
- Access: same builder sign-in. Tavus tool calls (`?op=tool`) only write for
  conversations this console started.

Tools on the PAL (registry, API delivery → `/api/apex?op=tool`, HMAC):
`log_objection`, `record_discovery_answers`, `book_next_meeting`,
`complete_discovery_call`, `request_advisor_handoff`.

Env vars (Vercel): `TAVUS_API_KEY` + Redis (already used by the builder).
For calendar invites: `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET` (OAuth "Web" client,
redirect URI `https://tavus1.vercel.app/api/apex?op=google_callback`, Calendar API on),
then click Connect on the console. Optional: `APEX_TOOL_SECRET` to enforce tool-call
signatures, `APEX_PAL_ID` / `APEX_FACE_ID` overrides.

## Optimize mode (brochure walkthrough + initial meeting)

Pick "Optimize" on the console. Second PAL "Optimize Senior Portfolio Manager"
(`pb40abfd8546`, face Victor, LLM tavus-gpt-5.6-terra) with:
- Presentation skill, `walk_the_deck`, on Knowledge doc `d7-14f2e55ca5a9`
  (`builder/public/apex-assets/optimize-brochure.pdf`, page 11 flattened to strip a
  hidden advisor-compensation text layer). Page-by-page notes: `apex-prompts/optimize_presentation_prompt.md`.
- System prompt: `apex-prompts/optimize_system_prompt.md` (full initial-meeting script).
- Tools: `record_client_profile` (per discovery section → deal "Client profile"),
  `book_plan_review` (Comprehensive Financial Plan review, 60 min), plus the shared
  `log_objection`, `complete_discovery_call`, `request_advisor_handoff`.
- Guardrail `g204367c8b27a`: no guarantees, no invented fee %, no advisor comp talk.

## Standalone + share link

- Console "Where" defaults to **Standalone**: a Tavus-hosted room rendered at `/apex/room`
  with the builder's vendored CVI UI (brochure pages become the main view while presenting).
- **Share link**: `https://tavus1.vercel.app/meet/optimize` (also `/meet/apex`). Public, no sign-in:
  visitor enters name + email and talks to the avatar; CRM + booking work the same; never
  occupies the console's live-call slot. Caps: 4 calls per network per hour, 40 per day
  (`APEX_PUBLIC_DAILY_CAP`). Rate-limit keys survive "Reset demo data".

## Optimize Corp Dev mode (advisor recruiting)

Console option "Optimize Corp Dev" and share link `/meet/corpdev`. PAL `pe1cff40644a`
("Optimize Corp Dev - Victor", face Victor, tavus-gpt-5.6-terra). Deck:
`builder/public/apex-assets/optimize-advisor-platform.pdf` (script pages only). FAQ knowledge:
`builder/public/apex-assets/optimize-corpdev-faq.txt` (internal notes removed; figures aligned to
the intro script). Tools: `record_advisor_profile` (Dealer Analysis Report inputs),
`book_dar_review` (meeting 2 of 4), plus shared objection/handoff/complete tools.
Guardrail `g31c7be8c1804`. Scripts: `apex-prompts/corpdev_*.md`.
