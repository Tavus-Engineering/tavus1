# RingCentral Air × Tavus — AI Negotiator (Auto)

Demo for the RingCentral GSP Summit (Oct 12–15). Source: the Sep 28 sync with
Tom Tofigh + Hassan, where Tom described RingCentral's LiveKit-based "AI
negotiator" on Air (pulls 2–3 cars from the catalog, reads emotions, works to a
7–8% discount, "I'll hold this if you promise to come in and sign") and Hassan
said he wants it on dealer websites and in dealerships. Cox Automotive resells
RingCentral, which makes it the natural first pilot to pitch.

The pitch is that RingCentral already has the negotiation logic. Tavus gives it
a face, reads the shopper's emotions on camera, and performs feelings back in
voice and expression.

## Live page

**https://tavus1.vercel.app/d/rc-negotiator** goes live once this branch is merged and
deployed. It's built in (`api/_builtin-demos.js`), so it needs no builder login and no
Redis, and each visitor call uses the Vercel `TAVUS_API_KEY`. To change the page, edit the
scenario, re-import it, capture the Share payload, and replace the snapshot.

## Load it

1. Builder → Demo library → **Import** → `ringcentral-ai-negotiator.scenario.json`.
2. Setup: paste the API key. The scenario already points at PAL `paf624e2960c`
   (Phoenix 4.5 stock face "Dominic", `rcf10ec292c1`). The prompt, objectives, guardrails,
   emotion control, perception and Magic Canvas are already attached in the account.
3. Launch. To hand it to Tom as a link, use **Share** and send `/d/<slug>`.

## Drive it (≈3 min, hits every emotion)

| You (the buyer) say | Jordan should feel | On screen |
|---|---|---|
| "Hi, I need an SUV. Two kids, a dog, and a long commute." | Bright, then curious | — |
| "Budget's tight, around $450 a month. I'm a little stressed about it, honestly." | Empathetic, slows down | 🎭 emotion chip |
| (Jordan pitches RAV4 / Tucson.) "Ooh, the RAV4 in blue." | Excited | RAV4 card |
| "I'll give you thirty-one for it." | Playful mock-pain ("Oof…") | — |
| "Come on, what can you really do?" | Conspiratorial, going to bat | Deal sheet updates |
| "Bayside Toyota quoted me thirty-three-five." | Takes it seriously, compares value | Added value card |
| "Thirty-two flat, final offer." | Sincere and firm at the floor (~$34,400) | — |
| "Fine. Deal." | Real delight | ✅ Deal held 48h |
| "Saturday at 10." | Warm recap | Calendar card |

Make the frustration visible on camera (sigh, frown). The perception layer is
what turns "it read my mood" into the moment people remember.

## Decisions you may want to change

- **Dealer and inventory are fictional** (Northgate Auto Group, three 2026
  hybrids at plausible demo prices). If Tom shares Cox or real dealer
  inventory, replace the Inventory block in the prompt and the three stat cards.
- **The floor is 8% off listed**, matching Tom's 7–8% from the call.
  Jordan reaches it in shrinking steps (3 → 2 → 1.5 → 1%) and trades value
  (oil changes, mats, warranty) before cutting price again.
- **Branding is "RingCentral Air × Tavus" with an approximate RC orange**
  (#FF7A00). No logo is included, so upload RC's official one on the Demo Page step.
- **The email gate is off**: it's a live exec demo, so there's no friction.
