# Demo handoff: where everything lives

This repo runs **tavus1.vercel.app**: the Tavus Experience Builder (home page) plus four customer demos under `/apex`. This note covers the demos. `APEX.md` has the deeper technical detail; `CLAUDE.md` covers the Experience Builder.

## The demos

| Demo | Who's on the call | Live links |
|---|---|---|
| Apex Wealth | AI portfolio manager runs a discovery call | Console: `/apex` |
| Optimize (client) | Victor walks a prospect through the client brochure | Console, or share link `/meet/optimize` |
| **Optimize Corp Dev** | Victor recruits a financial advisor: deck, FAQ, Dealer Analysis Report questions, books meeting 2 | Console, or share link `/meet/corpdev` |
| **Invitation Homes** | AI roleplay partner (upset resident / safety escalation / leasing prospect) + on-screen scorecard | Console, or share link `/meet/invitationhomes` |

- `/apex`: console (needs the Experience Builder login). Pick a demo, launch, watch the live "what the AI did" feed.
- `/apex/crm`: mock CRM the avatars write to. `/apex/training`: Invitation Homes scorecards.
- `/meet/<demo>`: public, no login, rate-limited (4 calls/hour per network, 40/day total).
- `/apex/score-preview`: the scorecard design with sample data, no call needed.

## Two places to edit, and which one you want

**1. What the avatar says and does lives in Tavus, not this repo.** The script, deck notes, FAQ, voice and turn-taking settings are on each avatar ("PAL") in PAL Maker. Changes there are live on the next call, no deploy.

| Avatar | PAL Maker |
|---|---|
| Optimize Corp Dev Victor | https://maker.tavus.io/dev/pals/update?pal_id=pe1cff40644a |
| Optimize (client) Victor | https://maker.tavus.io/dev/pals/update?pal_id=pb40abfd8546 |
| Apex Portfolio Manager | https://maker.tavus.io/dev/pals/update?pal_id=p6e28aea25fd |
| Invitation Homes simulator | https://maker.tavus.io/dev/pals/update?pal_id=p5250d043111 |

`apex-prompts/*.md` are **backup copies** of those prompts. Editing them changes nothing on a call; if you change a prompt in PAL Maker, paste the new version into the matching file so the backup stays current.

**2. Everything else is code in this repo:** the call pages, CRM, booking, post-call processing, scorecards, and the Invitation Homes scenarios.

## Common edits

| I want to… | Where |
|---|---|
| Change Victor's Corp Dev script or DAR questions | PAL Maker (Corp Dev) → System prompt |
| Change what he says on a slide / which pages he shows | PAL Maker → Skills → Presentation prompt |
| Fix a mispronounced word | PAL Maker → Voice → pronunciation dictionary (Corp Dev uses `pd_de46b02fbc5743df`) |
| Change the booked meeting's title, length, description or default day | `api/_apex_lib.js` → `FIRMS` |
| Change which DAR fields get captured after the call | `api/_apex_lib.js` → `ADVISOR_FIELDS` |
| Edit or add an Invitation Homes scenario (character, opening line, criteria) | `api/_apex_lib.js` → `IH_SCENARIOS`. One PAL plays every scenario; adding one is just a new entry. |
| Change the scorecard / call page look | `builder/src/apex/ApexApp.jsx` + `builder/src/apex/apex.css` |
| Change the share-link landing copy | `api/apex.js` → `publicInfo`, and `PublicMeet` in `ApexApp.jsx` |

## How data flows on a Corp Dev call

1. Launch creates a CRM deal and a Tavus conversation (`launch()` in `api/apex.js`).
2. During the call Victor uses only two tools: `book_dar_review` (books the calendar invite) and `request_advisor_handoff` (flags sensitive topics for Chris). Both POST to `/api/apex?op=tool`.
3. Victor hangs up himself with Tavus's built-in `end_call`.
4. After the call Tavus sends the transcript to `/api/apex?op=webhook`; Claude extracts the DAR answers, objections and a summary into the deal (`captureAdvisorCall`). Takes about a minute.

Invitation Homes: the "End scenario & score me" button sends the transcript to `/api/apex?op=score`, which grades it with Claude and shows the scorecard beside the video. If someone just hangs up, the call is graded from the post-call transcript instead.

## Working safely

- **Pushing to `claude/serene-pasteur-DOOq1` deploys to production immediately.** Work on your own branch; Vercel gives every branch a preview URL to test on first.
- `api/` at the repo root and `builder/api/` are **copies of each other**. After editing `api/apex.js` or `api/_apex_lib.js`, run `cp api/apex.js api/_apex_lib.js builder/api/` before committing.
- Check the frontend builds: `cd builder && npm ci && npx vite build`.
- Some Tavus tools (e.g. `log_objection`, `request_advisor_handoff`) are shared by several avatars; changing one in Tavus changes it everywhere.
- "Reset demo data" on the console wipes the mock CRM and feed (only `apex:*` keys), not the Google connection.

## Accounts and settings (names only, values are in Vercel)

- Vercel env vars: `TAVUS_API_KEY`, Redis (`KV_REST_API_URL` / `UPSTASH_REDIS_REST_*`), `ANTHROPIC_API_KEY` (scorecards + post-call capture), `GOOGLE_CLIENT_ID`, `GOOGLE_CLIENT_SECRET`.
- Google Calendar is connected to **tim@tavus.io** (Google Cloud project "Google Cal", OAuth client "Web client 1", redirect URI `https://tavus1.vercel.app/google/callback`). Invites go out from Tim's calendar. Testing with tim@tavus.io as the advisor email won't send an invite (Google doesn't invite the calendar owner); use another address.
- Tavus account: the one whose API key is in Vercel; PAL Maker needs a login to it.
