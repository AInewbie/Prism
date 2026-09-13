// Shared, dependency-free matching for the server UI and standalone HTML demo.
// Keep this a pure function so future tags or folders can extend the same filter.
const normalize = (value) => String(value ?? "").normalize("NFKD")
  .replace(/\p{M}/gu, "").toLocaleLowerCase();

export function filterSessions(sessions, { query = "", mode = "all" } = {}) {
  const words = normalize(query).trim().split(/\s+/).filter(Boolean);
  return sessions.filter((session) =>
    (mode === "all" || (session.mode || "demo") === mode) &&
    words.every((word) => normalize(session.title ?? session.prompt).includes(word)),
  );
}
