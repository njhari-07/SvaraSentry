import { test } from "node:test";
import assert from "node:assert/strict";
import { ScoreLifecycle } from "../lib/score-lifecycle.ts";

const result = (stream, index, score = 0.9) => ({ stream_id: stream, chunk_index: index, smoothed_risk: score });
const summary = (stream) => ({ stream_id: stream, average_risk: 0.4, completed: true });

test("Stop holds late window updates; final summary is accepted exactly once", () => {
  const state = new ScoreLifecycle();
  state.begin("first");
  assert.equal(state.result(result("first", 1)), true);
  state.stop();
  assert.equal(state.result(result("first", 2)), false);
  assert.equal(state.latest.chunk_index, 2); // retains metadata without moving the gauge
  assert.equal(state.history.length, 2); // final timeline includes drained windows
  assert.equal(state.finish(summary("first")), true);
  assert.equal(state.finish(summary("first")), false); // second socket acknowledgment
  assert.equal(state.result(result("first", 3)), false);
  assert.equal(state.latest.chunk_index, 2);
});

test("history is bounded, timestamps survive, and new streams clear old history", () => {
  const state = new ScoreLifecycle();
  state.begin("history");
  for (let index = 1; index <= 130; index++) state.result({ ...result("history", index), timestamp: index + 2, spectrogram_png_b64: "large-image" });
  assert.equal(state.history.length, 120);
  assert.equal(state.history[0].timestamp, 13);
  assert.equal(state.history.at(-1).timestamp, 132);
  assert.equal(state.history[0].spectrogram_png_b64, undefined);
  state.begin("new");
  assert.equal(state.history.length, 0);
});

test("Reconnect cannot reopen a sealed stream; stale and duplicate windows are ignored", () => {
  const state = new ScoreLifecycle();
  state.begin("first");
  state.result(result("first", 2));
  assert.equal(state.result(result("first", 1)), false);
  assert.equal(state.result(result("first", 2)), false);
  state.finish(summary("first"));
  assert.equal(state.begin("first"), false);
  assert.equal(state.sealed, true);
  assert.equal(state.begin("second"), true);
  assert.equal(state.result(result("first", 3)), false);
  assert.equal(state.finish(summary("first")), false);
  assert.equal(state.result(result("second", 1)), true);
});
