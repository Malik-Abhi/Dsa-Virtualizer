import { test } from "node:test";
import assert from "node:assert/strict";
import { parseSavedCode } from "../saved-code";

test("saved snippets round-trip exact source, names and both languages", () => {
  const entries = [
    {
      id: "js",
      name: "Array <traversal>",
      source: 'const A = [1, 2];\nconsole.log("✦", A);',
      language: "javascript",
      updatedAt: "2026-10-07T00:00:00.000Z",
    },
    {
      id: "py",
      name: "Prefix sum",
      source: "def sum(A):\n    return A[0]\n",
      language: "python",
      updatedAt: "2026-10-07T00:00:00.000Z",
    },
  ];
  assert.deepEqual(parseSavedCode(JSON.stringify(entries)), entries);
  assert.deepEqual(parseSavedCode(null), []);
});

test("invalid library data is rejected rather than silently discarded", () => {
  const valid = {
    id: "one",
    name: "Example",
    source: "print(1)",
    language: "python",
    updatedAt: "2026-10-07T00:00:00.000Z",
  };
  for (const raw of [
    "broken",
    "{}",
    JSON.stringify([null]),
    JSON.stringify([valid, valid]),
    ...[
      { name: " " },
      { source: 123 },
      { language: "ruby" },
      { updatedAt: "bad date" },
      { id: "" },
    ].map((change) => JSON.stringify([{ ...valid, ...change }])),
  ]) {
    assert.throws(() => parseSavedCode(raw));
  }
});
