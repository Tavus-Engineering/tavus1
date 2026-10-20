/* MoneyMaya demo (/maya): the form → call pipe and the start/end endpoint.
   No network: Daily is a fake call object, Tavus + Upstash are a fake fetch.
   Run from builder/: node tools/maya.test.mjs */
import assert from "node:assert";
import { createChannel } from "../src/maya/channel.js";

const wait = (ms) => new Promise((r) => setTimeout(r, ms));

// ---- channel ---------------------------------------------------------------
{
  const logs = [];
  const sent = [];
  const ch = createChannel((kind, text, ok) => logs.push({ kind, text, ok }));

  ch.note("before join");
  ch.nudge("before join");
  assert.deepEqual(logs.map((l) => l.ok), [false, false], "nothing is sent before Maya joins");
  assert.equal(sent.length, 0);

  ch.daily = { sendAppMessage: (m, to) => sent.push({ m, to }) };
  ch.conversationId = "c123";
  ch.connected = true;

  ch.note("filled ZIP");
  assert.equal(sent.length, 1);
  assert.deepEqual(sent[0].m, {
    message_type: "conversation", event_type: "conversation.append_llm_context", conversation_id: "c123",
    properties: { context: "[FORM EVENT] filled ZIP" },
  });
  assert.equal(sent[0].to, "*");

  // A nudge waits while Maya is talking, and only the latest one survives.
  ch.onAppMessage({ data: { event_type: "conversation.started_speaking", properties: { role: "pal" } } });
  ch.nudge("old step");
  ch.nudge("now on step 3");
  await wait(1100);
  assert.equal(sent.length, 1, "held while Maya speaks");
  ch.onAppMessage({ data: { event_type: "conversation.stopped_speaking", properties: { role: "pal" } } });
  await wait(1100);
  assert.equal(sent.length, 2);
  assert.equal(sent[1].m.event_type, "conversation.respond");
  assert.equal(sent[1].m.properties.text, "[FORM EVENT] now on step 3");

  // Same for the visitor talking, including the legacy replica/user event names.
  ch.onAppMessage({ data: { event_type: "conversation.user.started_speaking", properties: {} } });
  ch.nudge("error showing");
  await wait(1100);
  assert.equal(sent.length, 2, "held while the visitor speaks");
  ch.onAppMessage({ data: { event_type: "conversation.user.stopped_speaking", properties: {} } });
  await wait(1100);
  assert.equal(sent.length, 3);

  // A nudge that went stale while waiting is dropped, not sent.
  let zipStillBad = true;
  ch.onAppMessage({ data: { event_type: "conversation.started_speaking", properties: { role: "pal" } } });
  ch.nudge("ZIP is short", () => zipStillBad);
  zipStillBad = false; // fixed while Maya was still talking
  ch.onAppMessage({ data: { event_type: "conversation.stopped_speaking", properties: { role: "pal" } } });
  await wait(1100);
  assert.equal(sent.length, 3, "stale nudge dropped");
  assert.equal(logs.at(-1).kind, "skip");

  // Speech on either side counts as activity (resets the idle check-in).
  let activity = 0;
  ch.onActivity = () => activity++;
  ch.onAppMessage({ data: { event_type: "conversation.started_speaking", properties: { role: "user" } } });
  ch.onAppMessage({ data: { event_type: "conversation.stopped_speaking", properties: { role: "user" } } });
  ch.onAppMessage({ data: { event_type: "conversation.utterance", properties: { role: "user", speech: "hi" } } });
  assert.equal(activity, 2, "start/stop speaking are activity, utterances aren't double-counted");

  ch.reset();
  ch.note("after leave");
  assert.equal(sent.length, 3, "nothing is sent after the call ends");
  console.log("maya channel: ok");
}

// ---- api/maya.js -------------------------------------------------------------
{
  process.env.TAVUS_API_KEY = "test-key";
  process.env.KV_REST_API_URL = "https://kv.test";
  process.env.KV_REST_API_TOKEN = "t";
  const kv = new Map();
  const tavusCalls = [];
  globalThis.fetch = async (url, init = {}) => {
    const body = init.body ? JSON.parse(init.body) : null;
    if (String(url).startsWith("https://kv.test")) {
      const [cmd, key, val] = body;
      let result = null;
      if (cmd === "INCR") { kv.set(key, (kv.get(key) || 0) + 1); result = kv.get(key); }
      else if (cmd === "SET") { kv.set(key, val); result = "OK"; }
      else if (cmd === "GET") result = kv.get(key) ?? null;
      return new Response(JSON.stringify({ result }));
    }
    tavusCalls.push({ url: String(url), body, headers: init.headers });
    if (String(url).endsWith("/conversations")) {
      return new Response(JSON.stringify({ conversation_id: "cabc123", conversation_url: "https://tavus.daily.co/cabc123" }));
    }
    return new Response("{}");
  };
  const { default: handler } = await import("../api/maya.js");
  const call = async (op, body = {}, ip = "1.1.1.1") => {
    let status = 0, json = null;
    const res = { status(s) { status = s; return this; }, json(j) { json = j; return this; } };
    await handler({ method: "POST", query: { op }, body, headers: { "x-forwarded-for": ip } }, res);
    return { status, json };
  };

  const r = await call("start");
  assert.equal(r.status, 200);
  assert.deepEqual(r.json, { conversationId: "cabc123", conversationUrl: "https://tavus.daily.co/cabc123" });
  const create = tavusCalls[0];
  assert.equal(create.headers["x-api-key"], "test-key");
  assert.equal(create.body.pal_id, "peb9b600328c");
  assert.equal(create.body.properties.max_call_duration, 900);
  assert.match(create.body.conversational_context, /\[FORM EVENT\]/);

  for (let i = 0; i < 5; i++) assert.equal((await call("start")).status, 200);
  assert.equal((await call("start")).status, 429, "7th call from one network in an hour is refused");
  assert.equal((await call("start", {}, "2.2.2.2")).status, 200, "another network is fine");

  const before = tavusCalls.length;
  await call("end", { conversationId: "notours99" });
  assert.equal(tavusCalls.length, before, "won't end a conversation it didn't start");
  await call("end", { conversationId: "cabc123" });
  assert.equal(tavusCalls.at(-1).url, "https://tavusapi.com/v2/conversations/cabc123/end");

  delete process.env.TAVUS_API_KEY;
  assert.equal((await call("start")).status, 500, "clear error without TAVUS_API_KEY");
  console.log("maya api: ok");
}
