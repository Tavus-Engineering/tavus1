const QUIET_MS = 900;

// The pipe between the form and the call. Lives outside React state so the
// memoized call surface never re-renders on form activity.
export function createChannel(onLog) {
  const ch = {
    daily: null, conversationId: null, connected: false,
    palSpeaking: false, userSpeaking: false, pending: null, timer: null,
    onActivity: null, // called whenever either side starts or stops talking
    send(event_type, properties) {
      if (!ch.connected || !ch.daily) return false;
      try {
        ch.daily.sendAppMessage({ message_type: "conversation", event_type, conversation_id: ch.conversationId, properties }, "*");
        return true;
      } catch { return false; }
    },
    note(text) { onLog("note", text, ch.send("conversation.append_llm_context", { context: "[FORM EVENT] " + text })); },
    // stillTrue: optional check run at send time. A nudge can wait several
    // seconds for a quiet moment, and the form may have moved on by then.
    nudge(text, stillTrue) {
      if (!ch.connected) { onLog("nudge", text, false); return; }
      ch.pending = { text, stillTrue }; // only the latest matters
      ch.schedule();
    },
    schedule() {
      clearTimeout(ch.timer);
      ch.timer = setTimeout(() => {
        if (!ch.pending || !ch.connected || ch.palSpeaking || ch.userSpeaking) return; // stopped_speaking reschedules
        const { text, stillTrue } = ch.pending; ch.pending = null;
        if (stillTrue && !stillTrue()) { onLog("skip", text, true); return; }
        onLog("nudge", text, ch.send("conversation.respond", { text: "[FORM EVENT] " + text }));
      }, QUIET_MS);
    },
    onAppMessage(e) {
      const m = e?.data;
      if (!m?.event_type) return;
      const role = String(m.properties?.role ?? (/\.user\./.test(m.event_type) ? "user" : /\.replica\./.test(m.event_type) ? "pal" : "")).toLowerCase();
      const isPal = role === "pal" || role === "replica";
      const started = /started_speaking$/.test(m.event_type), stopped = /stopped_speaking$/.test(m.event_type);
      if (started) { if (isPal) ch.palSpeaking = true; else if (role === "user") ch.userSpeaking = true; }
      if (stopped) { if (isPal) ch.palSpeaking = false; else if (role === "user") ch.userSpeaking = false; ch.schedule(); }
      if ((started || stopped) && ch.onActivity) ch.onActivity();
    },
    reset() { clearTimeout(ch.timer); Object.assign(ch, { daily: null, conversationId: null, connected: false, palSpeaking: false, userSpeaking: false, pending: null }); },
  };
  return ch;
}
