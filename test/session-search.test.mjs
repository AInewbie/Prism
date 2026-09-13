import test from "node:test";
import assert from "node:assert/strict";
import { filterSessions } from "../public/session-search.js";

test("session search combines words, accents and mode without changing saved order", () => {
  const sessions = [
    { id: "a", title: "Café launch plan", mode: "demo" },
    { id: "b", title: "Launch a café: costs", mode: "live" },
    { id: "c", title: "Research brief", mode: "demo" },
  ];
  assert.deepEqual(filterSessions(sessions, { query: "  CAFE   launch " }).map(x => x.id), ["a", "b"]);
  assert.deepEqual(filterSessions(sessions, { query: "café", mode: "live" }).map(x => x.id), ["b"]);
  assert.deepEqual(filterSessions(sessions, { query: "missing" }), []);
  assert.deepEqual(filterSessions(sessions), sessions);
  assert.deepEqual(sessions.map(x => x.id), ["a", "b", "c"]);
});

test("the offline demo can reuse matching with its existing prompt records", () => {
  const sessions = [{ prompt: "Idea one" }, { prompt: "Travel plan" }];
  assert.deepEqual(filterSessions(sessions, { query: "travel", mode: "demo" }), [sessions[1]]);
  assert.deepEqual(filterSessions(sessions, { mode: "live" }), []);
  assert.deepEqual(filterSessions(sessions, { query: "<img>" }), []);
});
