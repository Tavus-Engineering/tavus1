/* Built-in demo links: snapshots that ship with the code instead of living in
   Redis, so /d/{slug} works on every deploy (previews included) with no
   builder session and no storage. Same shape as a POST /api/demos snapshot —
   generate one by importing the scenario in the builder and capturing the
   Share payload. Visitor calls still use the server's TAVUS_API_KEY.

   rc-negotiator: RingCentral Air × Tavus AI car-sales negotiator
   (builder/demos/ringcentral-ai-negotiator/). */

export const BUILTIN_DEMOS = {
  "rc-negotiator": {
    "v": 1,
    "createdAt": "2026-10-10T00:00:00.000Z",
    "createdBy": "tim@tavus.io",
    "name": "RingCentral Air × Tavus · AI Negotiator",
    "site": {
      "brand": "RingCentral Air × Tavus",
      "logoUrl": "",
      "headline": "Meet Jordan, your dealership's AI negotiator",
      "tagline": "RingCentral Air answers. Tavus gives it a face, reads the room, and closes the deal.",
      "cta": "Find my car",
      "format": "desktop",
      "theme": {
        "accent": "#FF7A00",
        "text": "#0B1F33",
        "canvas": "#F6F8FB",
        "surface": "#FFFFFF"
      },
      "shot": "",
      "nav": null,
      "heroImage": ""
    },
    "controls": {
      "scriptedCards": [
        {
          "style": "stat",
          "trigger": "keyword",
          "title": "2026 RAV4 Hybrid XLE",
          "body": "$37,400 listed\nAWD · 39 mpg · Blueprint blue",
          "url": "",
          "href": "",
          "keywords": "RAV4",
          "atBeat": 0,
          "atSeconds": 0,
          "hideAfter": 40,
          "linkLabel": "",
          "speaker": "ai",
          "owner": "featured"
        },
        {
          "style": "stat",
          "trigger": "keyword",
          "title": "2026 CR-V Hybrid Sport-L",
          "body": "$39,900 listed\nAWD · 40 mpg · Meteorite gray",
          "url": "",
          "href": "",
          "keywords": "CR-V, CRV",
          "atBeat": 0,
          "atSeconds": 0,
          "hideAfter": 40,
          "linkLabel": "",
          "speaker": "ai",
          "owner": "featured"
        },
        {
          "style": "stat",
          "trigger": "keyword",
          "title": "2026 Tucson Hybrid SEL",
          "body": "$34,600 listed\nAWD · 38 mpg · Amazon gray",
          "url": "",
          "href": "",
          "keywords": "Tucson",
          "atBeat": 0,
          "atSeconds": 0,
          "hideAfter": 40,
          "linkLabel": "",
          "speaker": "ai",
          "owner": "featured"
        },
        {
          "style": "note",
          "trigger": "keyword",
          "title": "Added value",
          "body": "First two oil changes · All-weather mats · 7-yr powertrain warranty",
          "url": "",
          "href": "",
          "keywords": "oil changes, floor mats, powertrain",
          "atBeat": 0,
          "atSeconds": 0,
          "hideAfter": 30,
          "linkLabel": "",
          "speaker": "ai",
          "owner": "featured"
        },
        {
          "style": "note",
          "trigger": "keyword",
          "title": "✅ Deal held for 48 hours",
          "body": "Your price is saved. Come in, sign, and drive home.",
          "url": "",
          "href": "",
          "keywords": "lock it in, 48 hours",
          "atBeat": 0,
          "atSeconds": 0,
          "hideAfter": 60,
          "linkLabel": "",
          "speaker": "ai",
          "owner": "featured"
        }
      ],
      "maxSeconds": 480,
      "timeWarning": "",
      "inactivitySeconds": 0,
      "inactivityUtterance": "",
      "interruptButton": false,
      "guardrailEcho": "",
      "toolWebhook": "",
      "toolEcho": "",
      "recording": false,
      "recordingLayout": "everyone",
      "annot": {
        "emotion": true,
        "vision": false,
        "memory": false,
        "memoryOn": false
      }
    },
    "payload": {
      "face_id": "rcf10ec292c1",
      "pal_id": "paf624e2960c",
      "conversation_name": "RingCentral Air × Tavus · AI Negotiator",
      "custom_greeting": "Hey, thanks for calling Northgate Auto! I'm Jordan. What are you hoping to drive home in?",
      "conversational_context": "Your first spoken line is already scripted and plays automatically at the start of the call: \"Hey, thanks for calling Northgate Auto! I'm Jordan. What are you hoping to drive home in?\" — never introduce yourself a second time. If that line already asked a question, treat it as asked: don't repeat it, work with whatever they answer.\n\nMagic Canvas cards:\n- Format: cards render markdown; every list = one \"- item\" per line (never a run-on paragraph); title 2-5 words; ≤6 bullets; ≤8 words per bullet — say detail aloud instead.\n- One idea per card; new topic = new card.\n- Prefer the structured card for the job (Question for choices, Input for details, Calendar for dates) over a Text card.\n\nCanvas playbook:\nKeep a running deal sheet. Every time the price moves, show one short text card with the car, its listed price, the current offer, and what was added (for example: \"RAV4 Hybrid XLE · Listed $37,400 · Now $35,900 · + first 2 oil changes\"). When they pick appointment times, offer a calendar card. Don't show a card on every turn.\n\nWhen you show Magic Canvas cards, always set layout.preferred_slot to \"safe-area-right\" so cards appear on the right side of the video.",
      "properties": {
        "languages": [
          "en"
        ],
        "max_call_duration": 480
      }
    },
    "experience": {
      "journey": [],
      "emailGate": false,
      "emailRequired": true,
      "emailPrompt": "",
      "notifyWebhook": "",
      "rating": false,
      "booking": false,
      "schedulingUrl": "",
      "talkAgain": false,
      "thanks": ""
    }
  }
};

/* Built-in first, then Redis. Built-ins never need storage to load. */
export async function loadDemo(slug, kvAvailable, kvGet) {
  if (Object.prototype.hasOwnProperty.call(BUILTIN_DEMOS, slug)) return BUILTIN_DEMOS[slug];
  if (!kvAvailable()) return null;
  return kvGet(`demo:${slug}`);
}
