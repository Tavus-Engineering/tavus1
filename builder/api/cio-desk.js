/* Demo data desk for the "CIO Office Morning Notes" demo — the endpoint a
   PAL's registry tool calls (delivery.api + on_resolve:"generate_response"),
   so the AI human looks a figure up mid-call and SPEAKS what comes back.

   Public on purpose: Tavus calls it server-to-server with no builder
   session, and everything here is the published morning note — no secrets,
   no writes. Every number is lifted verbatim from the note; nothing is
   live market data, and the payload says so.

   POST {topic} (or GET ?topic=) → {as_of, topic, headline, points[],
   related[]}. Unknown/blank topic → the overview + the topics it knows. */

const AS_OF = "CIO Office Morning Notes, 14 September 2026";

const DESK = {
  overview: {
    headline: "Rising oil and a sticky inflation print pushed yields to multi-decade highs; risk assets retreated except energy.",
    points: [
      "Brent rose high single digits for a second straight week and settled above $100 a barrel.",
      "US August CPI: headline +3.4% and core +2.4% year on year — in line, but monthly progress toward the Fed's target has stalled.",
      "Markets now price an 88% chance of a Fed hike in September and two hikes by year-end.",
      "It's a central-bank week: Fed Wednesday, BOE Thursday, BOJ Friday.",
    ],
    related: ["oil", "inflation", "fed", "bonds", "equities", "this_morning", "week_ahead", "geopolitics"],
  },
  oil: {
    headline: "Brent settled above $100 a barrel after two back-to-back weeks of high single-digit gains.",
    points: [
      "Driver: heightened Middle East tensions on multiple fronts.",
      "This morning Brent rose again after the shutdown of Saudi Arabia's East-West pipeline and the postponement of a planned Iran–Gulf States meeting.",
      "Energy was the only asset class that didn't retreat last week.",
      "The worry chain: oil lifts inflation, inflation lifts yields, yields cap equities.",
    ],
    related: ["geopolitics", "inflation"],
  },
  inflation: {
    headline: "US August CPI came in at +3.4% headline and +2.4% core year on year — in line with projections.",
    points: [
      "The monthly figures showed progress toward the Fed's inflation target has stalled.",
      "Paired with rising energy prices, that suggests more price pressure is in the pipeline.",
      "China's inflation also rose.",
    ],
    related: ["oil", "fed"],
  },
  fed: {
    headline: "Expectations for a Fed hike in September shot up to 88%, with two hikes priced by year-end.",
    points: [
      "The Fed decides Wednesday.",
      "The ECB raised rates again, as expected; hawkish tone and higher inflation forecasts point to one more hike in December.",
      "The BOJ (Friday) is also expected to hike; the BOE (Thursday) is expected to hold.",
      "Gold slipped this morning on growing bets of Fed tightening.",
    ],
    related: ["week_ahead", "bonds"],
  },
  bonds: {
    headline: "Global bonds and US Treasuries were severely hit; global yields reached new multi-decade highs.",
    points: [
      "The Treasury curve shifted sharply higher over the week.",
      "Treasuries held last week's losses this morning.",
      "Investor concern: higher yields capping equities.",
    ],
    related: ["fed", "equities"],
  },
  equities: {
    headline: "Stocks retreated across the risk spectrum, all closing in negative territory.",
    points: [
      "The S&P 500 outperformed the Dow, smaller companies and developed markets outside the US.",
      "Emerging-market equities fared better, though still negative.",
      "This morning Asian stocks and US index futures retreated — MSCI Asia Pacific, Nasdaq 100 and S&P 500 futures all lower.",
      "Also weighing: major AI companies calling for a slowdown in the technology's development.",
    ],
    related: ["this_morning", "bonds"],
  },
  this_morning: {
    headline: "Asian stocks and US equity futures retreated on a wave of negative Middle East news.",
    points: [
      "Brent rose after Saudi Arabia's East-West pipeline shutdown and a postponed Iran–Gulf States meeting.",
      "Treasuries held last week's losses.",
      "Gold slipped on Fed-tightening bets; bitcoin ticked higher.",
      "Major AI companies calling for a development slowdown weighed on tech.",
    ],
    related: ["oil", "equities"],
  },
  week_ahead: {
    headline: "A central-bank packed week: Fed Wednesday and BOJ Friday both expected to hike; BOE Thursday should hold.",
    points: [
      "Tuesday: euro area ZEW survey; China retail sales, fixed-asset investment and industrial production; Treasury Secretary Bessent testifies in the House.",
      "Wednesday: US retail sales, then the Fed decision.",
      "Thursday: Bank of England.",
      "Friday: Bank of Japan.",
    ],
    related: ["fed"],
  },
  geopolitics: {
    headline: "The Middle East conflict escalated on multiple fronts.",
    points: [
      "US–Iran tit-for-tat restarted.",
      "Energy infrastructure in Saudi Arabia was attacked.",
      "Houthi rebels gained control of the Bab al-Mandeb Strait on the Red Sea.",
      "Iran said an agreement with Oman on Hormuz navigation would not mean reopening the Strait unless multiple conditions were accepted.",
    ],
    related: ["oil"],
  },
  fx_gold: {
    headline: "Gold retreated and the US dollar ended the week little changed.",
    points: [
      "Gold slipped again this morning on growing bets of Fed tightening.",
      "Bitcoin ticked higher this morning.",
    ],
    related: ["fed"],
  },
};

// Loose matching: the model passes whatever the visitor said ("crude",
// "the Fed", "what's on this week"), not our keys.
const ALIASES = [
  ["oil", /oil|brent|crude|energy|barrel|opec|pipeline/],
  ["geopolitics", /geopolit|middle east|iran|saudi|houthi|hormuz|red sea|mandeb|oman|conflict|war/],
  ["inflation", /inflation|cpi|prices|core/],
  ["fed", /fed|rate|hike|central bank|ecb|boj|boe|tighten/],
  ["bonds", /bond|yield|treasur|curve|fixed income/],
  ["this_morning", /morning|today|futures|asia/],
  ["equities", /equit|stock|s&p|dow|nasdaq|share|emerging|market/],
  ["week_ahead", /week|calendar|upcoming|event|data|retail sales|zew|bessent/],
  ["fx_gold", /gold|dollar|usd|fx|currenc|bitcoin|crypto/],
];

function resolve(raw) {
  const t = String(raw || "").toLowerCase().trim();
  if (!t) return "overview";
  if (DESK[t]) return t;
  for (const [key, re] of ALIASES) if (re.test(t)) return key;
  return "overview";
}

export default async function handler(req, res) {
  if (!["GET", "POST"].includes(req.method)) { res.status(405).json({ error: "GET or POST" }); return; }
  let body = req.body;
  if (typeof body === "string") { try { body = JSON.parse(body); } catch { body = {}; } }
  const raw = String(body?.topic ?? req.query?.topic ?? "").slice(0, 200);
  const key = resolve(raw);
  const entry = DESK[key];
  res.setHeader("Cache-Control", "no-store");
  res.status(200).json({
    as_of: AS_OF,
    source_note: "Figures are from the CIO Office morning note, not live market data.",
    topic: key,
    asked: raw || null,
    headline: entry.headline,
    points: entry.points,
    related: entry.related,
  });
}
