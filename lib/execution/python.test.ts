import { before, test } from "node:test";
import assert from "node:assert/strict";
import { readFile } from "node:fs/promises";
import { loadPyodide, type PyodideInterface } from "pyodide";
import type { ExecutionResult } from "../../types/execution";
import { pythonExample } from "../examples";
let runtime: PyodideInterface;
before(async () => {
  runtime = await loadPyodide({ indexURL: "node_modules/pyodide/" });
  runtime.runPython(await readFile("lib/execution/python-runtime.py", "utf8"));
});
function execute(source: string): ExecutionResult {
  runtime.globals.set("_test_source", source);
  return JSON.parse(runtime.runPython("execute_python(_test_source)"));
}
function run(source: string) {
  const result = execute(source);
  assert.equal(result.error, undefined, JSON.stringify(result.error));
  return result;
}
test("Python executes the pictured prefix-sum algorithm with real output and return values", () => {
  const result = run(pythonExample);
  assert.deepEqual(result.steps.at(-1)!.output, ["Sum: 20", "B: [1, 4, 20]"]);
  const returned = result.steps.find((s) => s.event === "return")!;
  const frame = returned.memory.frames.at(-1)!;
  assert.equal(frame.returnValue.kind, "primitive");
  assert.deepEqual(frame.returnValue, {
    kind: "primitive",
    type: "number",
    value: 20,
  });
  assert.ok(
    frame.variables.some(
      (v) => v.name === "prefix" && v.value.kind === "reference",
    ),
  );
  assert.ok(
    result.steps.some((s) =>
      s.memory.pointers.some((p) => p.name === "i" && p.index === 4),
    ),
  );
});
test("Python snapshots keep aliases shared, mutations immutable, and None distinct", () => {
  const result = run(
    'A = [1, 2]\nB = A\nA[0] = 9\nnode = {"value": 1, "next": None}\nnode["next"] = node',
  );
  const last = result.steps.at(-1)!;
  const variables = last.memory.frames[0].variables;
  assert.deepEqual(
    variables.find((v) => v.name === "A")!.value,
    variables.find((v) => v.name === "B")!.value,
  );
  assert.equal(last.memory.heap.filter((o) => o.kind === "array").length, 1);
  assert.equal(
    result.steps[0].memory.heap.find((o) => o.kind === "array")!.items[0].kind,
    "primitive",
  );
  assert.deepEqual(
    result.steps[0].memory.heap.find((o) => o.kind === "array")!.items[0],
    { kind: "primitive", type: "number", value: 1 },
  );
  const node = last.memory.heap.find((o) => o.kind === "object")!;
  assert.deepEqual(node.properties.find((p) => p.name === "next")!.value, {
    kind: "reference",
    objectId: node.id,
  });
});
test("Python recursion preserves suspended callers and independent parameters", () => {
  const result = run(
    "def factorial(n):\n    if n <= 1:\n        return 1\n    return n * factorial(n - 1)\nprint(factorial(5))",
  );
  assert.deepEqual(result.steps.at(-1)!.output, ["120"]);
  const deepest = result.steps.find((s) => s.memory.frames.length === 6)!;
  assert.equal(new Set(deepest.memory.frames.map((f) => f.id)).size, 6);
  assert.equal(deepest.memory.frames[1].status, "suspended");
});
test("Python supports tuple unpacking, comprehensions, dictionaries, and loop controls", () => {
  const result = run(
    'A = [3, 1, 2]\nA[0], A[1] = A[1], A[0]\nsquares = [i * i for i in range(4)]\ncounts = {}\nfor char in "banana":\n    counts[char] = counts.get(char, 0) + 1\nprint(A, squares, counts)',
  );
  assert.deepEqual(result.steps.at(-1)!.output, [
    "[1, 3, 2] [0, 1, 4, 9] {'b': 1, 'a': 3, 'n': 2}",
  ]);
});
test("Python reports syntax and runtime lines and retains its partial timeline", () => {
  assert.equal(execute("def broken(:").error?.kind, "syntax");
  const result = execute("value = 2\nprint(value)\nresult = 1 / 0");
  assert.equal(result.error?.kind, "runtime");
  assert.equal(result.error?.line, 3);
  assert.deepEqual(result.steps.at(-1)!.output, ["2"]);
  assert.equal(
    result.steps.some((s) => s.event === "complete"),
    false,
  );
});
test("Python denies imports, host access, runtime introspection, and dynamic execution", () => {
  for (const source of [
    "import js",
    "import os",
    'open("/etc/passwd")',
    'eval("1")',
    'exec("print(1)")',
    "globals()",
    'getattr([], "__class__")',
    "[].__class__",
    "def f():\n    pass\nf.__globals__",
    "__builtins__",
    "class A(list):\n    pass",
  ]) {
    assert.ok(execute(source).error, source);
  }
});
test("Python loops, recursion, collection sizes, and output have execution limits", () => {
  assert.equal(execute("while True:\n    pass").error?.kind, "limit");
  assert.equal(execute("def f():\n    return f()\nf()").error?.kind, "limit");
  assert.equal(execute("A = [0] * 1001").error?.kind, "limit");
  assert.equal(execute('print("x" * 100001)').error?.kind, "limit");
});

test("Python preserves print separators and partial lines and displays None and booleans", () => {
  const result = run(
    'value = None\nflag = True\nprint("a", end="")\nprint("b", 2, sep="-")',
  );
  assert.deepEqual(result.steps.at(-1)!.output, ["ab-2"]);
  const vars = result.steps.at(-1)!.memory.frames[0].variables;
  assert.deepEqual(vars.find((v) => v.name === "value")!.value, {
    kind: "primitive",
    type: "none",
    value: null,
  });
  assert.deepEqual(vars.find((v) => v.name === "flag")!.value, {
    kind: "primitive",
    type: "python-boolean",
    value: true,
  });
});

test("Python index variables can point into multiple genuinely accessed lists", () => {
  const result = run("A = [2, 8]\nB = [1, 4]\ni = 0\nx = A[i] + B[i]\ni = 1");
  const pointers = result.steps.at(-1)!.memory.pointers;
  assert.equal(pointers.length, 2);
  assert.equal(new Set(pointers.map((p) => p.id)).size, 2);
  assert.ok(pointers.every((p) => p.name === "i" && p.index === 1));
});

test("Python for and while loop blocks track actual iterations and variables", () => {
  const result = run(
    "A = [1,2]\ntotal = 0\nfor i in range(2):\n    total += A[i]\nwhile total < 5:\n    total += 1\nprint(total)",
  );
  for (const kind of ["for", "while"]) {
    const loops = result.steps
      .flatMap((step) => step.memory.loops ?? [])
      .filter((loop) => loop.kind === kind);
    assert.ok(
      loops.some((loop) => loop.iteration === 1 && loop.status === "running"),
    );
    assert.equal(
      loops.find((loop) => loop.status === "complete")!.iteration,
      2,
    );
  }
  const body = result.steps.find(
    (step) =>
      step.memory.loops?.some(
        (loop) => loop.kind === "for" && loop.iteration === 2,
      ) &&
      step.memory.frames[0].variables.some(
        (v) =>
          v.name === "total" &&
          v.value.kind === "primitive" &&
          v.value.value === 3,
      ),
  )!;
  for (const step of result.steps)
    for (const loop of step.memory.loops ?? []) {
      if (loop.kind === "for" && loop.iteration > 0)
        assert.deepEqual(
          loop.variables.map((v) => v.name),
          ["i"],
        );
    }
  assert.ok(body);
  assert.deepEqual(result.steps.at(-1)!.memory.loops, []);
  assert.deepEqual(result.steps.at(-1)!.output, ["5"]);
});

test("Python nested loops preserve parents and exits on break, continue, and return", () => {
  const result = run(
    "def f():\n    for i in range(3):\n        if i == 0:\n            continue\n        j = 0\n        while j < 3:\n            j += 1\n            if j == 1:\n                break\n        return i\nanswer = f()\nwhile False:\n    pass\nprint(answer)",
  );
  const nested = result.steps.find((step) => step.memory.loops?.length === 2)!;
  assert.ok(nested);
  const [outer, inner] = nested.memory.loops!;
  assert.equal(inner.parentId, outer.id);
  assert.equal(outer.iteration, 2);
  assert.equal(outer.frameId, nested.memory.frames.at(-1)!.id);
  const zero = result.steps
    .flatMap((step) => step.memory.loops ?? [])
    .find(
      (loop) =>
        loop.kind === "while" &&
        loop.iteration === 0 &&
        loop.status === "complete",
    );
  assert.ok(zero);
  assert.deepEqual(result.steps.at(-1)!.memory.loops, []);
  assert.deepEqual(result.steps.at(-1)!.output, ["1"]);
});

test("Python Solution classes execute annotated methods with loops and return values", () => {
  const result = run(
    "class Solution:\n    def sumEven(self, A: List[int]) -> int:\n        total = 0\n        for i in range(len(A)):\n            if i % 2 == 0:\n                total += A[i]\n        return total\nsolution = Solution()\nanswer = solution.sumEven([2,8,3,9,15])\nprint(answer)",
  );
  assert.deepEqual(result.steps.at(-1)!.output, ["20"]);
  assert.ok(
    result.steps.some((step) =>
      step.memory.frames.some((frame) => frame.name === "sumEven"),
    ),
  );
  assert.ok(result.steps.some((step) => step.memory.loops?.length));
});

test("Python constructors and instance fields preserve identity, aliases and mutations", () => {
  const result = run(
    "class Node:\n    def __init__(self, value):\n        self.value = value\n        self.left = None\n        self.right = None\n    def update(self, value):\n        self.value = value\nroot = Node(1)\nalias = root\nroot.left = Node(2)\nroot.update(3)\nprint(alias.value, root.left.value)",
  );
  assert.deepEqual(result.steps.at(-1)!.output, ["3 2"]);
  const memory = result.steps.at(-1)!.memory;
  const variables = memory.frames[0].variables;
  assert.deepEqual(
    variables.find((v) => v.name === "root")!.value,
    variables.find((v) => v.name === "alias")!.value,
  );
  assert.ok(
    memory.heap.some(
      (object) =>
        object.kind === "object" &&
        object.properties.some(
          (p) =>
            p.name === "value" &&
            p.value.kind === "primitive" &&
            p.value.value === 3,
        ),
    ),
  );
});

test("Python classes keep runtime internals and unsafe attribute access unavailable", () => {
  for (const source of [
    "class A:\n    def __getattribute__(self, name):\n        return 1",
    "class A:\n    pass\na = A()\nprint(a.__class__)",
    "def f():\n    pass\nclass A:\n    func_globals = 1\nprint(f.func_globals)",
    "class A:\n    pass\nA.__bases__",
    "class A:\n    pass\nA.mro()",
  ])
    assert.ok(execute(source).error, source);
});

test("Python tuple iterators exclude arrays and accumulators from loop blocks", () => {
  const result = run(
    "A = [2,4]\ntotal = 0\nfor i, value in enumerate(A):\n    total += value\nprint(total)",
  );
  const running = result.steps.filter((step) =>
    step.memory.loops?.some((loop) => loop.status === "running"),
  );
  assert.ok(running.length);
  for (const step of running)
    assert.deepEqual(
      step.memory.loops![0].variables.map((v) => v.name),
      ["i", "value"],
    );
  assert.deepEqual(result.steps.at(-1)!.output, ["6"]);
});

test("Python condition annotations show operand values at evaluation time", () => {
  const result = run(
    "A = [5]\ni = 0\nmax_sum = 0\nif A[i] > max_sum:\n    max_sum = 9\nprint(max_sum)",
  );
  const condition = result.steps.find((step) =>
    step.conditionOperands?.some((operand) => operand.expression === "A[i]"),
  )!;
  assert.deepEqual(condition.conditionOperands, [
    { expression: "A[i]", value: "5" },
    { expression: "max_sum", value: "0" },
  ]);
  assert.deepEqual(result.steps.at(-1)!.output, ["9"]);
});

test("Python annotation instrumentation preserves short-circuiting and nested conditions", () => {
  const result = run(
    "calls = [0]\ndef next_value():\n    calls[0] += 1\n    if calls[0] > 0:\n        return calls[0]\nif next_value() > 0:\n    pass\nif False and next_value() > 0:\n    pass\nif 3 < 2 < next_value():\n    pass\nprint(calls[0])",
  );
  assert.deepEqual(result.steps.at(-1)!.output, ["1"]);
  const outer = result.steps.find((step) =>
    step.conditionOperands?.some(
      (operand) => operand.expression === "next_value()",
    ),
  )!;
  assert.deepEqual(outer.conditionOperands, [
    { expression: "next_value()", value: "1" },
    { expression: "0", value: "0" },
  ]);
  const chained = result.steps.find((step) =>
    step.description.startsWith("if 3 < 2"),
  )!;
  assert.deepEqual(chained.conditionOperands, [
    { expression: "3", value: "3" },
    { expression: "2", value: "2" },
  ]);
});

test("Python assignment values show source operands and assigned result", () => {
  const result = run(
    "even_left = 5\nodd_right = 0\nnew_even = even_left + odd_right\neven_left = 9\nprint(new_even)",
  );
  const sum = result.steps.find(
    (step) =>
      step.assignmentOperands?.some(
        (operand) => operand.expression === "even_left",
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
  assert.deepEqual(result.steps.at(-1)!.output, ["5"]);
});

test("Python assignment calls and augmented assignments retain actual evaluations", () => {
  const result = run(
    "calls = [0]\ndef next_value():\n    calls[0] += 1\n    return calls[0]\nanswer = next_value() + 4\nanswer += 2\nprint(calls[0], answer)",
  );
  const assigned = result.steps.find((step) =>
    step.assignmentOperands?.some(
      (operand) => operand.expression === "next_value()",
    ),
  )!;
  assert.deepEqual(assigned.assignmentOperands, [
    { expression: "next_value()", value: "1" },
    { expression: "4", value: "4" },
    { expression: "answer", value: "5" },
  ]);
  const augmented = result.steps.find(
    (step) => step.description === "answer += 2",
  )!;
  assert.deepEqual(augmented.assignmentOperands, [
    { expression: "2", value: "2" },
    { expression: "answer", value: "7" },
  ]);
  assert.deepEqual(result.steps.at(-1)!.output, ["1 7"]);
});
