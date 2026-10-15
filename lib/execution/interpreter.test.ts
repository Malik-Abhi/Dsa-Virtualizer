import { test } from "node:test";
import assert from "node:assert/strict";
import { executeJavaScript } from "./interpreter";
import { examples } from "../examples";
const run = (source: string) => {
  const r = executeJavaScript(source);
  assert.equal(r.error, undefined, JSON.stringify(r.error));
  return r;
};
const final = (source: string) => run(source).steps.at(-1)!;
test("assignments preserve immutable snapshots and identify changed variables", () => {
  const r = run("let x = 10; const y = 20; x = x + y;");
  assert.equal(r.steps[0].variables.x, 10);
  assert.equal(r.steps[2].variables.x, 30);
  assert.ok(r.steps[2].changedElements.includes("x"));
});
test("array mutation records element changes without changing earlier states", () => {
  const r = run("const arr = [3, 1]; arr[0] = 2; arr.push(4);");
  assert.deepEqual(r.steps[0].variables.arr, [3, 1]);
  assert.deepEqual(r.steps.at(-1)!.variables.arr, [2, 1, 4]);
  assert.ok(r.steps[1].changedElements.includes("arr.0"));
});
test("for/while loops, branches, break and continue execute real conditions", () => {
  const s = final(
    "let sum = 0; for (let i = 0; i < 5; i++) { if (i === 1) continue; sum += i; } let n = 0; while (true) { n++; if (n === 3) break; }",
  );
  assert.equal(s.variables.sum, 9);
  assert.equal(s.variables.n, 3);
  assert.equal(s.variables.i, undefined);
});
test("functions and recursion produce call frames and return values", () => {
  const r = run(
    "function fact(n) { if (n <= 1) return 1; return n * fact(n - 1); } const result = fact(5); console.log(result);",
  );
  assert.equal(r.steps.at(-1)!.variables.result, 120);
  assert.equal(r.steps.at(-1)!.returnValue, 120);
  assert.ok(r.steps.some((s) => s.callStack.length === 5));
  assert.deepEqual(r.steps.at(-1)!.output, ["120"]);
});
test("console output accumulates at the right line", () => {
  const r = run('let x = 1;\nconsole.log("Value", x);\nx++;\nconsole.log(x);');
  assert.deepEqual(r.steps.find((s) => s.event === "output")!.output, [
    "Value 1",
  ]);
  assert.equal(r.steps.find((s) => s.event === "output")!.line, 2);
  assert.deepEqual(r.steps.at(-1)!.output, ["Value 1", "2"]);
});
test("objects, destructuring, references and arrow functions", () => {
  const s = final(
    "const obj = { count: 1 }; const alias = obj; alias.count++; let a = 3; let b = 2; [a, b] = [b, a]; const twice = x => x * 2; const result = twice(a);",
  );
  assert.deepEqual(s.variables.obj, { count: 2 });
  assert.deepEqual(s.variables.alias, { count: 2 });
  assert.equal(s.variables.result, 4);
  assert.equal(s.variables.b, 3);
});
test("errors distinguish syntax, unsupported syntax and runtime failures", () => {
  assert.equal(executeJavaScript("const x = ;").error?.kind, "syntax");
  assert.equal(
    executeJavaScript("async function f() {}").error?.kind,
    "unsupported",
  );
  const r = executeJavaScript("let x = 1;\nx = missing;");
  assert.equal(r.error?.kind, "runtime");
  assert.equal(r.error?.line, 2);
  assert.equal(r.steps[0].variables.x, 1);
  assert.equal(executeJavaScript("const x = 1; x = 2;").error?.kind, "runtime");
});
test("host capabilities and prototype escapes are inaccessible", () => {
  for (const source of [
    'fetch("https://example.com")',
    "window.location",
    "globalThis",
    'eval("1")',
    "const a = []; a.constructor",
    'const o = {}; o["__proto__"] = {};',
    "const f = () => 1; f.constructor",
  ]) {
    assert.ok(executeJavaScript(source).error, source);
  }
});
test("infinite loops and recursion are bounded", () => {
  assert.equal(executeJavaScript("while (true) {}").error?.kind, "limit");
  assert.equal(
    executeJavaScript("function f() { return f(); } f();").error?.kind,
    "limit",
  );
});
test("snapshots handle cycles", () => {
  const s = final("const obj = {}; obj.self = obj;");
  assert.deepEqual(s.variables.obj, { self: "[Circular reference]" });
});
for (const example of examples)
  test(`example: ${example.name}`, () => {
    const r = run(example.code);
    assert.equal(r.steps.at(-1)!.event, "complete");
    assert.ok(r.steps.at(-1)!.output.length > 0);
  });
test("sorting examples return actual sorted arrays", () => {
  for (const id of ["bubble", "selection", "insertion"]) {
    const r = run(examples.find((e) => e.id === id)!.code);
    const a = r.steps.at(-1)!.variables.arr as number[];
    assert.deepEqual(
      a,
      [...a].sort((x, y) => x - y),
    );
  }
});
test("binary search, frequency and tree traversal produce expected results", () => {
  const binary = final(examples.find((e) => e.id === "binary")!.code);
  assert.equal(binary.variables.found, 4);
  const freq = final(examples.find((e) => e.id === "frequency")!.code);
  assert.deepEqual(freq.variables.counts, { b: 1, a: 3, n: 2 });
  assert.deepEqual(
    final(examples.find((e) => e.id === "dfs")!.code).variables.visited,
    [4, 2, 6],
  );
});

test("memory aliases share one heap object, while equal arrays stay distinct", () => {
  const s = final("const A = [2, 8]; const B = A; const C = [2, 8]; B[0] = 9;");
  const vars = s.memory.frames[0].variables;
  const a = vars.find((v) => v.name === "A")!.value;
  assert.deepEqual(a, vars.find((v) => v.name === "B")!.value);
  assert.notDeepEqual(a, vars.find((v) => v.name === "C")!.value);
  assert.equal(s.memory.heap.filter((o) => o.kind === "array").length, 2);
  assert.equal(a.kind, "reference");
  const heap = s.memory.heap.find(
    (o) => o.id === (a.kind === "reference" ? a.objectId : ""),
  )!;
  assert.equal(heap.kind, "array");
  if (heap.kind === "array")
    assert.equal(heap.items[0].kind === "primitive" && heap.items[0].value, 9);
});
test("memory preserves callers, local shadowing, function objects and actual return references", () => {
  const r = run(
    "const A = [1]; let n = 99; function outer(n) { const saved = 7; return inner(A); } function inner(B) { B[0] = 3; return B; } const result = outer(2);",
  );
  const nested = r.steps.find(
    (s) => s.memory.frames.length === 3 && s.event === "return",
  )!;
  const [global, outer, inner] = nested.memory.frames;
  assert.equal(
    global.variables.find((v) => v.name === "n")!.value.kind === "primitive" &&
      (global.variables.find((v) => v.name === "n")!.value as { value: number })
        .value,
    99,
  );
  assert.equal(outer.name, "outer");
  assert.equal(outer.status, "suspended");
  assert.ok(outer.variables.some((v) => v.name === "saved"));
  assert.equal(inner.status, "returning");
  const a = global.variables.find((v) => v.name === "A")!.value;
  assert.deepEqual(a, inner.variables.find((v) => v.name === "B")!.value);
  assert.deepEqual(a, inner.returnValue);
  assert.ok(
    nested.memory.heap.some((o) => o.kind === "function" && o.name === "inner"),
  );
  assert.equal(r.steps.at(-1)!.memory.frames.length, 1);
});
test("cyclic and nested memory objects use real reference edges without duplicating nodes", () => {
  const r = run(
    "const node = { value: 1, next: null }; node.next = node; const A = [node, node];",
  );
  const memory = r.steps.at(-1)!.memory;
  assert.equal(memory.heap.filter((o) => o.kind === "object").length, 1);
  const node = memory.heap.find((o) => o.kind === "object")!;
  if (node.kind === "object")
    assert.deepEqual(node.properties.find((p) => p.name === "next")!.value, {
      kind: "reference",
      objectId: node.id,
    });
  assert.equal(JSON.stringify(memory).includes("[Circular reference]"), false);
});
test("heap identities and snapshots stay stable across mutations and reference reassignment", () => {
  const r = run("let A = [1, 2]; const B = A; A[0] = 4; A = [9];");
  const first = r.steps[0].memory.frames[0].variables[0].value;
  const last = r.steps.at(-1)!.memory.frames[0].variables;
  assert.deepEqual(first, last.find((v) => v.name === "B")!.value);
  assert.notDeepEqual(first, last.find((v) => v.name === "A")!.value);
  const heap = r.steps[0].memory.heap.find((o) => o.kind === "array")!;
  if (heap.kind === "array")
    assert.equal(heap.items[0].kind === "primitive" && heap.items[0].value, 1);
});
test("index pointers follow actual array access and moving index variables", () => {
  const r = run(
    "const A = [2, 8, 3]; const B = [4]; let i = 0; let value = A[i]; i = 1; value = A[i];",
  );
  const moved = r.steps.find((s) => s.description === "i ← 1")!;
  const pointer = moved.memory.pointers.find((p) => p.name === "i")!;
  assert.equal(pointer.index, 1);
  const a = moved.memory.frames[0].variables.find((v) => v.name === "A")!.value;
  assert.equal(a.kind === "reference" && a.objectId, pointer.objectId);
  assert.equal(moved.memory.pointers.length, 1);
});
test("recursive invocations get distinct frame identities and independent parameter values", () => {
  const r = run(
    "function f(n) { if (n === 0) return 0; return f(n - 1); } f(2);",
  );
  const step = r.steps.find((s) => s.callStack.length === 3)!;
  assert.equal(new Set(step.memory.frames.map((f) => f.id)).size, 4);
  assert.deepEqual(
    step.memory.frames
      .slice(1)
      .map((f) => f.variables.find((v) => v.name === "n")!.value),
    [2, 1, 0].map((value) => ({ kind: "primitive", type: "number", value })),
  );
});

test("indexed writes associate a pointer with the actual shared heap object", () => {
  const r = executeJavaScript(
    "const A = [1, 2]; let cursor = 0; A[cursor] = 9; cursor++; A[cursor] = 8;",
  );
  assert.equal(r.error, undefined);
  const write =
    r.steps.find((s) => s.description.includes("A[cursor] = 8")) ??
    r.steps.findLast((s) => s.memory.accesses.some((a) => a.property === "1"))!;
  const pointer = write.memory.pointers.find((p) => p.name === "cursor")!;
  assert.equal(pointer.index, 1);
  assert.ok(
    write.memory.accesses.some(
      (a) => a.objectId === pointer.objectId && a.property === "1",
    ),
  );
});

test("every JavaScript loop kind has immutable counters and current variables", () => {
  const result = executeJavaScript(
    "let sum = 0; for (let i = 0; i < 2; i++) { sum += i; } let j = 0; while (j < 2) { j++; } do { j--; } while (j > 0); for (const value of [3,4]) { sum += value; }",
  );
  assert.equal(result.error, undefined);
  for (const kind of ["for", "while", "do…while", "for…of"]) {
    const snapshots = result.steps
      .flatMap((step) => step.memory.loops ?? [])
      .filter((loop) => loop.kind === kind);
    assert.ok(
      snapshots.some(
        (loop) => loop.iteration === 1 && loop.status === "running",
      ),
    );
    const completed = snapshots.find((loop) => loop.status === "complete")!;
    assert.equal(completed.iteration, 2);
    assert.ok(completed.variables.length > 0);
    assert.ok(snapshots.every((loop) => loop.id === snapshots[0].id));
  }
  assert.deepEqual(result.steps.at(-1)!.memory.loops, []);
});

test("nested for loops keep independent identities and only their own iterators", () => {
  const result = executeJavaScript(
    "const A = [1,2]; for (let i=0; i<2; i++) { for (let j=0; j<2; j++) { A[j] += i; } }",
  );
  assert.equal(result.error, undefined);
  const nested = result.steps.filter((step) => step.memory.loops?.length === 2);
  assert.ok(nested.length);
  for (const step of nested) {
    const [outer, inner] = step.memory.loops!;
    assert.equal(inner.parentId, outer.id);
    assert.equal(inner.frameId, outer.frameId);
    assert.deepEqual(
      outer.variables.map((v) => v.name),
      ["i"],
    );
    assert.deepEqual(
      inner.variables.map((v) => v.name),
      ["j"],
    );
    assert.ok(step.memory.frames[0].variables.some((v) => v.name === "A"));
  }
  const innerIds = new Set(nested.map((step) => step.memory.loops![1].id));
  assert.equal(innerIds.size, 2);
});

test("zero iterations, break, continue and returns remove loop blocks correctly", () => {
  const result = executeJavaScript(
    "function f() { for(let i=0;i<3;i++){ if(i===0) continue; return i; } } while(false) {} let j=0; do { j++; break; } while(true); const answer=f();",
  );
  assert.equal(result.error, undefined);
  const zero = result.steps
    .flatMap((step) => step.memory.loops ?? [])
    .find((loop) => loop.kind === "while" && loop.status === "complete")!;
  assert.equal(zero.iteration, 0);
  const returned = result.steps.find((step) => step.event === "return")!;
  assert.equal(returned.memory.loops![0].iteration, 2);
  assert.equal(
    returned.memory.loops![0].frameId,
    returned.memory.frames.at(-1)!.id,
  );
  assert.deepEqual(result.steps.at(-1)!.memory.loops, []);
});

test("for loops only expose declared or updated iterators, including destructuring", () => {
  const result = executeJavaScript(
    "const A=[1,2]; let total=0; let i=0; for(;i<A.length;i++){total+=A[i];} for(const [index,value] of [[0,3],[1,4]]){total+=value;}",
  );
  assert.equal(result.error, undefined);
  for (const step of result.steps)
    for (const loop of step.memory.loops ?? []) {
      assert.deepEqual(
        loop.variables.map((v) => v.name),
        loop.kind === "for" ? ["i"] : ["index", "value"],
      );
    }
});

test("condition annotations retain evaluated operands without repeating side effects", () => {
  const result = executeJavaScript(
    "const A=[5]; let i=0; let max_sum=0; if(A[i]>max_sum){max_sum=9;} let calls=0; function next(){calls++; return calls;} if(next()>0){} if(false && next()>0){} console.log(calls);",
  );
  assert.equal(result.error, undefined);
  const condition = result.steps.find((step) =>
    step.conditionOperands?.some((operand) => operand.expression === "A[i]"),
  )!;
  assert.equal(condition.description, "Check A[i]>max_sum → true");
  assert.deepEqual(condition.conditionOperands, [
    { expression: "A[i]", value: "5" },
    { expression: "max_sum", value: "0" },
  ]);
  assert.deepEqual(result.steps.at(-1)!.output, ["1"]);
  const skipped = result.steps.find((step) =>
    step.description.includes("false &&"),
  )!;
  assert.ok(
    !skipped.conditionOperands?.some(
      (operand) => operand.expression === "next()",
    ),
  );
});

test("assignment annotations show inputs and result without reevaluating calls", () => {
  const result = executeJavaScript(
    "let even_left=5; let odd_right=0; let new_even=even_left+odd_right; let calls=0; function next(){calls++; return calls;} new_even=next()+odd_right; console.log(calls);",
  );
  assert.equal(result.error, undefined);
  const sum = result.steps.find(
    (step) =>
      step.assignmentOperands?.some(
        (operand) =>
          operand.expression === "even_left" && operand.value === "5",
      ) &&
      step.assignmentOperands.some(
        (operand) => operand.expression === "odd_right",
      ),
  )!;
  assert.deepEqual(sum.assignmentOperands, [
    { expression: "even_left", value: "5" },
    { expression: "odd_right", value: "0" },
    { expression: "new_even", value: "5" },
  ]);
  const called = result.steps.find((step) =>
    step.assignmentOperands?.some((operand) => operand.expression === "next()"),
  )!;
  assert.deepEqual(called.assignmentOperands, [
    { expression: "next()", value: "1" },
    { expression: "odd_right", value: "0" },
    { expression: "new_even", value: "1" },
  ]);
  assert.deepEqual(result.steps.at(-1)!.output, ["1"]);
});

test("while and do-while labels track control variables without copying accumulators", () => {
  const result = executeJavaScript(
    "const A=[1,2]; let i=0; let total=0; while(i<A.length){total+=A[i];i++;} do {total+=i;i--;} while(i>0);",
  );
  assert.equal(result.error, undefined);
  const loops = result.steps.flatMap((step) => step.memory.loops ?? []);
  assert.ok(loops.some((loop) => loop.kind === "while"));
  assert.ok(loops.some((loop) => loop.kind === "do…while"));
  for (const loop of loops)
    assert.deepEqual(
      loop.variables.map((variable) => variable.name),
      ["i"],
    );
});
