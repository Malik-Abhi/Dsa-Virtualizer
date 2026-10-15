import { parse } from "acorn";
import { MemoryRecorder, type FrameInput, type LoopInput } from "./memory";
import type { MemoryAccess } from "@/types/memory";
import type {
  ExecutionResult,
  ExecutionStep,
  Value,
  CallFrame,
} from "@/types/execution";
// Acorn's heterogeneous ESTree nodes and the interpreter's private runtime values
// are deliberately confined to this module. Only serializable, typed IR leaves it.
type Node = any;
type Runtime = any;
type Binding = { value: Runtime; constant: boolean };
class Scope {
  bindings = new Map<string, Binding>();
  constructor(
    public parent?: Scope,
    public frameId: string = parent?.frameId ?? "global",
  ) {}
  owner(name: string): Scope | undefined {
    return this.bindings.has(name) ? this : this.parent?.owner(name);
  }
  get(name: string): Runtime {
    const owner = this.owner(name);
    if (!owner) throw new Error(`“${name}” is not defined.`);
    return owner.bindings.get(name)!.value;
  }
  define(name: string, value: Runtime, constant = false) {
    if (this.bindings.has(name))
      throw new Error(`“${name}” is already declared.`);
    this.bindings.set(name, { value, constant });
  }
  set(name: string, value: Runtime) {
    const owner = this.owner(name);
    if (!owner) throw new Error(`“${name}” is not defined.`);
    const binding = owner.bindings.get(name)!;
    if (binding.constant)
      throw new Error(`Cannot reassign constant “${name}”.`);
    binding.value = value;
  }
}
const FUNCTION = Symbol("interpreted-function");
const BUILTIN = Symbol("builtin");
const forbidden = new Set([
  "__proto__",
  "prototype",
  "constructor",
  "caller",
  "callee",
  "arguments",
]);
const allowedNodes = new Set([
  "Program",
  "VariableDeclaration",
  "VariableDeclarator",
  "Identifier",
  "Literal",
  "ArrayExpression",
  "ObjectExpression",
  "Property",
  "ExpressionStatement",
  "AssignmentExpression",
  "UpdateExpression",
  "BinaryExpression",
  "LogicalExpression",
  "UnaryExpression",
  "MemberExpression",
  "CallExpression",
  "FunctionDeclaration",
  "FunctionExpression",
  "ArrowFunctionExpression",
  "BlockStatement",
  "ForStatement",
  "ForOfStatement",
  "WhileStatement",
  "DoWhileStatement",
  "IfStatement",
  "ReturnStatement",
  "BreakStatement",
  "ContinueStatement",
  "EmptyStatement",
  "ConditionalExpression",
  "SequenceExpression",
  "ArrayPattern",
  "ObjectPattern",
  "TemplateLiteral",
  "TemplateElement",
]);
class Failure extends Error {
  constructor(
    message: string,
    public kind: "unsupported" | "runtime" | "limit",
    public line: number,
  ) {
    super(message);
  }
}
class Signal {
  constructor(
    public type: "return" | "break" | "continue",
    public value?: Runtime,
  ) {}
}
export function display(value: unknown): string {
  if (typeof value === "string") return value;
  if (value === undefined) return "undefined";
  return JSON.stringify(value);
}
export function executeJavaScript(source: string): ExecutionResult {
  const start = performance.now();
  const steps: ExecutionStep[] = [];
  const output: string[] = [];
  let currentLine = 1,
    operations = 0,
    snapshotBytes = 0,
    lastReturn: Value | undefined;
  const stack: CallFrame[] = [];
  const conditionCollectors: {
    nodes: Set<Node>;
    values: NonNullable<ExecutionStep["conditionOperands"]>;
  }[] = [];
  let accessed = new Set<string>();
  const root = new Scope();
  let active = root;
  let frameSequence = 0,
    scopeSequence = 0;
  const scopeIds = new WeakMap<Scope, string>();
  const scopeId = (scope: Scope) => {
    let id = scopeIds.get(scope);
    if (!id) {
      id = `s${++scopeSequence}`;
      scopeIds.set(scope, id);
    }
    return id;
  };
  const bindingId = (scope: Scope, name: string) =>
    `${scopeId(scope.owner(name) ?? scope)}:${name}`;
  const activations: {
    id: string;
    name: string;
    line: number;
    scope: Scope;
    suspendedScope?: Scope;
  }[] = [];
  let loopSequence = 0;
  const loops: (Omit<LoopInput, "bindings"> & {
    scope: Scope;
    names: Set<string>;
    test?: Node;
  })[] = [];
  function enterLoop(n: Node, scope: Scope) {
    const names = new Set<string>();
    const visit = (node: Node) => {
      if (!node || typeof node !== "object") return;
      if (node.type === "Identifier") names.add(node.name);
      for (const [key, value] of Object.entries(node)) {
        if (["loc", "start", "end"].includes(key)) continue;
        if (Array.isArray(value)) value.forEach(visit);
        else if (value && typeof value === "object") visit(value);
      }
    };
    const iteratorBindings = (node: Node) => {
      if (!node) return;
      if (node.type === "Identifier") names.add(node.name);
      else if (node.type === "VariableDeclaration")
        node.declarations.forEach((declaration: Node) =>
          iteratorBindings(declaration.id),
        );
      else if (
        node.type === "AssignmentExpression" ||
        node.type === "AssignmentPattern"
      )
        iteratorBindings(node.left);
      else if (node.type === "UpdateExpression" || node.type === "RestElement")
        iteratorBindings(node.argument);
      else if (node.type === "SequenceExpression")
        node.expressions.forEach(iteratorBindings);
      else if (node.type === "ArrayPattern")
        node.elements.forEach(iteratorBindings);
      else if (node.type === "ObjectPattern")
        node.properties.forEach((property: Node) =>
          iteratorBindings(
            property.type === "RestElement"
              ? property.argument
              : property.value,
          ),
        );
    };
    if (n.type === "ForOfStatement") iteratorBindings(n.left);
    else if (n.type === "ForStatement") {
      iteratorBindings(n.init);
      iteratorBindings(n.update);
      if (!names.size) iteratorBindings(n.test?.left ?? n.test);
    } else {
      visit(n.test);
      const conditionNames = new Set(names);
      names.clear();
      const writes = (node: Node) => {
        if (
          !node ||
          typeof node !== "object" ||
          [
            "FunctionDeclaration",
            "FunctionExpression",
            "ArrowFunctionExpression",
          ].includes(node.type)
        )
          return;
        if (node.type === "AssignmentExpression") iteratorBindings(node.left);
        if (node.type === "UpdateExpression") iteratorBindings(node.argument);
        for (const [key, value] of Object.entries(node)) {
          if (["loc", "start", "end"].includes(key)) continue;
          if (Array.isArray(value)) value.forEach(writes);
          else if (value && typeof value === "object") writes(value);
        }
      };
      writes(n.body);
      const writtenNames = new Set(names);
      names.clear();
      const controls = [...conditionNames].filter((name) =>
        writtenNames.has(name),
      );
      for (const name of controls.length
        ? controls
        : conditionNames.size
          ? conditionNames
          : writtenNames)
        names.add(name);
    }
    const loop = {
      id: `loop-${++loopSequence}`,
      frameId: scope.frameId,
      parentId: loops.filter((l) => l.frameId === scope.frameId).at(-1)?.id,
      kind: (n.type === "ForStatement"
        ? "for"
        : n.type === "ForOfStatement"
          ? "for…of"
          : n.type === "WhileStatement"
            ? "while"
            : "do…while") as LoopInput["kind"],
      line: n.loc.start.line,
      condition: n.test
        ? source.slice(n.test.start, n.test.end)
        : n.type === "ForOfStatement"
          ? `${source.slice(n.left.start, n.left.end)} of ${source.slice(n.right.start, n.right.end)}`
          : "true",
      iteration: 0,
      conditionResult: (n.test || n.type === "ForOfStatement" ? null : true) as
        boolean | null,
      status: "checking" as LoopInput["status"],
      scope,
      names,
      test: n.test,
    };
    loops.push(loop);
    return loop;
  }
  const memoryAccesses: MemoryAccess[] = [];
  const pointerAssociations = new Map<string, string>();
  let lastRuntimeReturn: Runtime,
    hasReturned = false;
  const memory = new MemoryRecorder((value) =>
    value?.[FUNCTION as keyof object]
      ? {
          name: (value as Runtime).node.id?.name ?? "anonymous",
          parameters: (value as Runtime).node.params.map((p: Node) =>
            source.slice(p.start, p.end),
          ),
          line: (value as Runtime).node.loc.start.line,
        }
      : undefined,
  );
  function frameBindings(scope: Scope, frameId: string) {
    const scopes: Scope[] = [];
    for (
      let current: Scope | undefined = scope;
      current && current.frameId === frameId;
      current = current.parent
    )
      scopes.unshift(current);
    const visible = new Map<
      string,
      { id: string; name: string; value: Runtime }
    >();
    for (const current of scopes)
      for (const [name, binding] of current.bindings) {
        if (
          (current === root &&
            ["undefined", "NaN", "Infinity"].includes(name)) ||
          binding.value?.[BUILTIN]
        )
          continue;
        visible.set(name, {
          id: bindingId(current, name),
          name,
          value: binding.value,
        });
      }
    return [...visible.values()];
  }
  function captureMemory(event: ExecutionStep["event"], value: Runtime) {
    if (event === "return") {
      hasReturned = true;
      lastRuntimeReturn = value;
    }
    const rootScope =
      active.frameId === "global"
        ? active
        : (activations[0]?.suspendedScope ?? root);
    const inputs: FrameInput[] = [
      {
        id: "global",
        name: "Global frame",
        kind: "global",
        status:
          event === "complete"
            ? "complete"
            : activations.length
              ? "suspended"
              : "active",
        callLine: 1,
        bindings: frameBindings(rootScope, "global"),
        returned: event === "complete" && hasReturned,
        returnValue: event === "complete" ? lastRuntimeReturn : undefined,
      },
    ];
    activations.forEach((frame, i) => {
      const isActive = i === activations.length - 1;
      const scope = isActive
        ? active
        : (activations[i + 1].suspendedScope ?? frame.scope);
      inputs.push({
        id: frame.id,
        name: frame.name,
        kind: "function",
        status: isActive
          ? event === "return"
            ? "returning"
            : "active"
          : "suspended",
        callLine: frame.line,
        bindings: frameBindings(scope, frame.id),
        returned: isActive && event === "return",
        returnValue: isActive && event === "return" ? value : undefined,
      });
    });
    try {
      return memory.capture(
        inputs,
        memoryAccesses,
        pointerAssociations,
        loops.map(({ scope, names, test, ...loop }) => {
          void test;
          return {
            ...loop,
            bindings: frameBindings(
              loops.at(-1)?.id === loop.id && active.frameId === loop.frameId
                ? active
                : scope,
              loop.frameId,
            ).filter((binding) => names.has(binding.name)),
          };
        }),
      );
    } catch {
      return fail("Memory graph exceeds 1,000 reachable objects.", "limit");
    }
  }
  const fail = (
    message: string,
    kind: "unsupported" | "runtime" | "limit" = "runtime",
  ): never => {
    throw new Failure(message, kind, currentLine);
  };
  function tick(n?: Node) {
    if (n?.loc) currentLine = n.loc.start.line;
    if (++operations > 100000)
      fail(
        "Execution exceeded 100,000 operations. Shorten the input or check your loop condition.",
        "limit",
      );
  }
  function key(value: Runtime): string {
    if (typeof value !== "string" && typeof value !== "number")
      fail("Property names must be strings or numbers.");
    const k = String(value);
    if (forbidden.has(k))
      fail(`Access to “${k}” is not supported.`, "unsupported");
    return k;
  }
  function snapshot(
    value: Runtime,
    seen = new Set<Runtime>(),
    depth = 0,
  ): Value {
    if (value === undefined) return "undefined";
    if (
      value === null ||
      typeof value === "string" ||
      typeof value === "boolean"
    )
      return value;
    if (typeof value === "number")
      return Number.isFinite(value) ? value : String(value);
    if (value?.[FUNCTION]) return "[Function]";
    if (value?.[BUILTIN]) return "[Built-in]";
    if (seen.has(value)) return "[Circular reference]";
    if (depth > 12) return "[Depth limit]";
    seen.add(value);
    const result: Value = Array.isArray(value)
      ? value.map((v) => snapshot(v, seen, depth + 1))
      : Object.fromEntries(
          Object.entries(value).map(([k, v]) => [
            k,
            snapshot(v, seen, depth + 1),
          ]),
        );
    seen.delete(value);
    return result;
  }
  function capture(
    n: Node,
    event: ExecutionStep["event"],
    description: string,
    returnValue?: Runtime,
    conditionOperands?: ExecutionStep["conditionOperands"],
    assignmentOperands?: ExecutionStep["assignmentOperands"],
  ) {
    if (steps.length >= 2500)
      fail("Timeline reached 2,500 steps. Try a smaller input.", "limit");
    const variables: Record<string, Value> = {};
    const scopes: Scope[] = [];
    for (let s: Scope | undefined = active; s; s = s.parent) scopes.unshift(s);
    for (const s of scopes)
      for (const [name, binding] of s.bindings)
        if (
          !(s === root && ["undefined", "NaN", "Infinity"].includes(name)) &&
          !binding.value?.[FUNCTION] &&
          !binding.value?.[BUILTIN]
        )
          variables[name] = snapshot(binding.value);
    const prior = steps.at(-1)?.variables ?? {};
    const changedElements = Object.keys(variables).filter(
      (k) => JSON.stringify(prior[k]) !== JSON.stringify(variables[k]),
    );
    for (const name of changedElements)
      if (Array.isArray(variables[name]))
        (variables[name] as Value[]).forEach((v, i) => {
          if (
            JSON.stringify((prior[name] as Value[] | undefined)?.[i]) !==
            JSON.stringify(v)
          )
            changedElements.push(`${name}.${i}`);
        });
    const step: ExecutionStep = {
      step: steps.length + 1,
      line: n?.loc?.start.line ?? currentLine,
      event,
      variables,
      memory: captureMemory(event, returnValue),
      changedElements,
      accessedElements: [...accessed],
      dataStructures: Object.entries(variables)
        .filter(([, v]) => v !== null && typeof v === "object")
        .map(([name, v]) => ({
          id: name,
          name,
          kind: Array.isArray(v) ? "array" : "object",
          value: v as Value[] | Record<string, Value>,
        })),
      output: [...output],
      callStack: [...stack],
      description,
      ...(conditionOperands?.length ? { conditionOperands } : {}),
      ...(assignmentOperands?.length ? { assignmentOperands } : {}),
      ...(returnValue !== undefined
        ? { returnValue: snapshot(returnValue) }
        : {}),
    };
    snapshotBytes += JSON.stringify(step).length;
    if (snapshotBytes > 8_000_000)
      fail(
        "Timeline memory limit reached. Use smaller data structures.",
        "limit",
      );
    steps.push(step);
    accessed = new Set();
    memoryAccesses.length = 0;
  }
  function bind(
    pattern: Node,
    value: Runtime,
    scope: Scope,
    constant = false,
    assigning = false,
  ) {
    if (typeof value === "string" && value.length > 100000)
      fail("String size limit (100,000 characters) reached.", "limit");
    if (pattern.type === "Identifier") {
      if (assigning) scope.set(pattern.name, value);
      else scope.define(pattern.name, value, constant);
    } else if (pattern.type === "MemberExpression" && assigning)
      assign(pattern, value, scope);
    else if (pattern.type === "ArrayPattern") {
      if (!Array.isArray(value)) fail("Array destructuring requires an array.");
      pattern.elements.forEach((p: Node, i: number) => {
        if (p) bind(p, value[i], scope, constant, assigning);
      });
    } else if (pattern.type === "ObjectPattern") {
      for (const p of pattern.properties)
        bind(
          p.value,
          value[key(p.key.name ?? p.key.value)],
          scope,
          constant,
          assigning,
        );
    } else fail(`Pattern ${pattern.type} is not supported.`, "unsupported");
  }
  function assign(n: Node, value: Runtime, scope: Scope) {
    if (typeof value === "string" && value.length > 100000)
      fail("String size limit (100,000 characters) reached.", "limit");
    if (n.type === "Identifier") scope.set(n.name, value);
    else if (n.type === "ArrayPattern" || n.type === "ObjectPattern")
      bind(n, value, scope, false, true);
    else if (n.type === "MemberExpression") {
      const target = expr(n.object, scope),
        k = key(n.computed ? expr(n.property, scope) : n.property.name);
      if (
        !target ||
        typeof target !== "object" ||
        target[FUNCTION] ||
        target[BUILTIN]
      )
        fail("This value cannot be mutated.");
      if (Array.isArray(target) && (!/^\d+$/.test(k) || Number(k) > 1000))
        fail("Only array indices 0–1000 can be assigned.");
      if (Object.keys(target).length > 1000)
        fail("Object property limit reached.", "limit");
      target[k] = value;
      recordMemoryAccess(target, k, n, scope);
    } else fail("Assignment target is not supported.", "unsupported");
    return value;
  }
  function binary(op: string, a: Runtime, b: Runtime): Runtime {
    switch (op) {
      case "+":
        return a + b;
      case "-":
        return a - b;
      case "*":
        return a * b;
      case "/":
        return a / b;
      case "%":
        return a % b;
      case "**":
        return a ** b;
      case "<":
        return a < b;
      case ">":
        return a > b;
      case "<=":
        return a <= b;
      case ">=":
        return a >= b;
      case "===":
        return a === b;
      case "!==":
        return a !== b;
      case "==":
        return a == b;
      case "!=":
        return a != b;
      case "&":
        return a & b;
      case "|":
        return a | b;
      case "^":
        return a ^ b;
      case "<<":
        return a << b;
      case ">>":
        return a >> b;
      default:
        return fail(`Operator “${op}” is not supported.`, "unsupported");
    }
  }
  function makeFunction(n: Node, scope: Scope) {
    return { [FUNCTION]: true, node: n, scope };
  }
  function invoke(fn: Runtime, args: Runtime[], n: Node): Runtime {
    if (fn?.[BUILTIN]) return fn.run(args);
    if (!fn?.[FUNCTION]) fail("This value is not a callable function.");
    if (stack.length >= 60)
      fail(
        "Maximum call depth (60) reached. Check the recursion base case.",
        "limit",
      );
    const old = active;
    const id = `call-${++frameSequence}`;
    const scope = new Scope(fn.scope, id);
    activations.push({
      id,
      name: fn.node.id?.name ?? "anonymous",
      line: n.loc.start.line,
      scope,
      suspendedScope: old,
    });
    active = scope;
    stack.push({
      name: fn.node.id?.name ?? "anonymous",
      line: n.loc.start.line,
    });
    fn.node.params.forEach((p: Node, i: number) => bind(p, args[i], scope));
    capture(
      n,
      "call",
      `Call ${stack.at(-1)!.name}(${args.map((a) => display(snapshot(a))).join(", ")})`,
    );
    try {
      if (fn.node.body.type !== "BlockStatement") {
        const value = expr(fn.node.body, scope);
        lastReturn = snapshot(value);
        capture(fn.node.body, "return", `Return ${display(lastReturn)}`, value);
        return value;
      }
      block(fn.node.body.body, scope);
      lastReturn = snapshot(undefined);
      capture(fn.node.body, "return", "Return undefined");
    } catch (signal) {
      if (signal instanceof Signal && signal.type === "return")
        return signal.value;
      throw signal;
    } finally {
      stack.pop();
      activations.pop();
      active = old;
    }
    return undefined;
  }
  const builtin = (run: (args: Runtime[]) => Runtime) => ({
    [BUILTIN]: true,
    run,
  });
  function recordMemoryAccess(
    value: Runtime,
    k: string,
    n: Node,
    scope: Scope,
  ) {
    if (n.object.type === "Identifier" && /^\d+$/.test(k))
      accessed.add(`${n.object.name}.${k}`);
    if (
      typeof value === "object" &&
      value !== null &&
      !value[FUNCTION] &&
      !value[BUILTIN]
    ) {
      const objectId = memory.identity(value);
      memoryAccesses.push({ objectId, property: k, frameId: scope.frameId });
      if (Array.isArray(value) && n.computed && /^\d+$/.test(k)) {
        const pointer =
          n.property.type === "Identifier"
            ? n.property
            : n.property.type === "BinaryExpression" &&
                n.property.left.type === "Identifier"
              ? n.property.left
              : undefined;
        if (pointer && scope.owner(pointer.name))
          pointerAssociations.set(bindingId(scope, pointer.name), objectId);
      }
    }
  }
  function member(n: Node, scope: Scope): Runtime {
    const value = expr(n.object, scope),
      k = key(n.computed ? expr(n.property, scope) : n.property.name);
    if (value == null) fail(`Cannot read “${k}” from ${value}.`);
    recordMemoryAccess(value, k, n, scope);
    if (Array.isArray(value)) {
      if (k === "length") return value.length;
      if (/^\d+$/.test(k)) return value[Number(k)];
      const methods: Record<string, (args: Runtime[]) => Runtime> = {
        push: (a) => {
          if (value.length + a.length > 1000)
            fail("Array size limit reached.", "limit");
          return value.push(...a);
        },
        pop: () => value.pop(),
        shift: () => value.shift(),
        unshift: (a) => {
          if (value.length + a.length > 1000)
            fail("Array size limit reached.", "limit");
          return value.unshift(...a);
        },
        reverse: () => value.reverse(),
        slice: (a) => value.slice(...a),
        join: (a) => value.join(...a),
        indexOf: (a) => value.indexOf(a[0]),
        includes: (a) => value.includes(a[0]),
        splice: (a) => {
          if (value.length + a.length > 1000)
            fail("Array size limit reached.", "limit");
          return value.splice(a[0], a[1], ...a.slice(2));
        },
      };
      if (methods[k]) return builtin(methods[k]);
      fail(
        `Array method “${k}” is not supported. Use a loop instead.`,
        "unsupported",
      );
    }
    if (typeof value === "string") {
      if (k === "length") return value.length;
      if (/^\d+$/.test(k)) return value[Number(k)];
      const methods: Record<string, (a: Runtime[]) => Runtime> = {
        split: (a) => value.split(a[0], a[1]),
        charAt: (a) => value.charAt(a[0]),
        slice: (a) => value.slice(a[0], a[1]),
        toLowerCase: () => value.toLowerCase(),
        toUpperCase: () => value.toUpperCase(),
        includes: (a) => value.includes(a[0]),
        indexOf: (a) => value.indexOf(a[0]),
      };
      if (methods[k]) return builtin(methods[k]);
      fail(`String method “${k}” is not supported.`, "unsupported");
    }
    if (typeof value === "object" && !value[FUNCTION])
      return Object.hasOwn(value, k) ? value[k] : undefined;
    return fail(`Cannot access property “${k}”.`);
  }
  function assignmentValue(n: Node, scope: Scope) {
    const nodes = new Set<Node>();
    const visit = (node: Node) => {
      if (
        node.type === "BinaryExpression" ||
        node.type === "LogicalExpression"
      ) {
        visit(node.left);
        visit(node.right);
      } else if (node.type === "UnaryExpression") visit(node.argument);
      else nodes.add(node);
    };
    visit(n);
    const collector = {
      nodes,
      values: [] as NonNullable<ExecutionStep["assignmentOperands"]>,
    };
    conditionCollectors.push(collector);
    try {
      return { value: expr(n, scope), operands: collector.values };
    } finally {
      conditionCollectors.pop();
    }
  }
  function assignmentResult(node: Node, value: Runtime) {
    return {
      expression: source.slice(node.start, node.end),
      value: String(display(snapshot(value))).slice(0, 500),
    };
  }
  function expr(n: Node, scope: Scope): Runtime {
    const collector = conditionCollectors.at(-1);
    const value = evaluateExpression(n, scope);
    if (collector?.nodes.has(n))
      collector.values.push({
        expression: source.slice(n.start, n.end),
        value: String(display(snapshot(value))).slice(0, 500),
      });
    return value;
  }
  function evaluateExpression(n: Node, scope: Scope): Runtime {
    tick(n);
    switch (n.type) {
      case "Literal":
        if (n.regex || n.bigint)
          return fail(
            "Regular expressions and BigInt are not supported.",
            "unsupported",
          );
        return n.value;
      case "Identifier":
        return scope.get(n.name);
      case "ArrayExpression":
        return n.elements.map((e: Node) => (e ? expr(e, scope) : undefined));
      case "ObjectExpression": {
        const o = Object.create(null);
        for (const p of n.properties)
          o[
            key(p.computed ? expr(p.key, scope) : (p.key.name ?? p.key.value))
          ] = expr(p.value, scope);
        return o;
      }
      case "MemberExpression":
        return member(n, scope);
      case "BinaryExpression": {
        const a = expr(n.left, scope),
          b = expr(n.right, scope);
        const result = binary(n.operator, a, b);
        return result;
      }
      case "LogicalExpression": {
        const a = expr(n.left, scope);
        return n.operator === "&&"
          ? a && expr(n.right, scope)
          : n.operator === "||"
            ? a || expr(n.right, scope)
            : (a ?? expr(n.right, scope));
      }
      case "UnaryExpression": {
        if (
          n.operator === "typeof" &&
          n.argument.type === "Identifier" &&
          !scope.owner(n.argument.name)
        )
          return "undefined";
        const v = expr(n.argument, scope);
        switch (n.operator) {
          case "!":
            return !v;
          case "-":
            return -v;
          case "+":
            return +v;
          case "~":
            return ~v;
          case "typeof":
            return typeof v;
          case "void":
            return undefined;
          default:
            return fail(
              `Unary operator ${n.operator} is not supported.`,
              "unsupported",
            );
        }
      }
      case "AssignmentExpression": {
        const old = n.operator === "=" ? undefined : expr(n.left, scope);
        const right = assignmentValue(n.right, scope);
        const v =
          n.operator === "="
            ? right.value
            : binary(n.operator.slice(0, -1), old, right.value);
        const operands = [
          ...(n.operator === "="
            ? []
            : [
                {
                  ...assignmentResult(n.left, old),
                  expression: `${source.slice(n.left.start, n.left.end)} (before)`,
                },
              ]),
          ...right.operands,
          assignmentResult(n.left, v),
        ];
        assign(n.left, v, scope);
        capture(
          n,
          "assignment",
          `${source.slice(n.left.start, n.left.end)} ← ${display(snapshot(v))}`,
          undefined,
          undefined,
          operands,
        );
        return v;
      }
      case "UpdateExpression": {
        const old = expr(n.argument, scope),
          v = n.operator === "++" ? Number(old) + 1 : Number(old) - 1;
        assign(n.argument, v, scope);
        capture(
          n,
          "assignment",
          `${source.slice(n.argument.start, n.argument.end)} ← ${v}`,
          undefined,
          undefined,
          [assignmentResult(n.argument, v)],
        );
        return n.prefix ? v : old;
      }
      case "CallExpression": {
        const fn = expr(n.callee, scope),
          args = n.arguments.map((a: Node) => expr(a, scope));
        const before = steps.length;
        currentLine = n.loc.start.line;
        const value = invoke(fn, args, n);
        if (steps.length === before)
          capture(
            n,
            "call",
            `${source.slice(n.callee.start, n.callee.end)}(${args.map((a: Runtime) => display(snapshot(a))).join(", ")})`,
          );
        return value;
      }
      case "FunctionExpression":
      case "ArrowFunctionExpression":
        return makeFunction(n, scope);
      case "ConditionalExpression":
        return expr(n.test, scope)
          ? expr(n.consequent, scope)
          : expr(n.alternate, scope);
      case "SequenceExpression": {
        let value;
        for (const e of n.expressions) value = expr(e, scope);
        return value;
      }
      case "TemplateLiteral":
        return n.quasis.reduce(
          (s: string, q: Node, i: number) =>
            s +
            q.value.cooked +
            (n.expressions[i] ? String(expr(n.expressions[i], scope)) : ""),
          "",
        );
      default:
        return fail(`Syntax “${n.type}” is not supported.`, "unsupported");
    }
  }
  function condition(n: Node, scope: Scope) {
    const nodes = new Set<Node>();
    const operands = (node: Node) => {
      if (
        node.type === "BinaryExpression" &&
        ["<", ">", "<=", ">=", "===", "!==", "==", "!="].includes(node.operator)
      ) {
        nodes.add(node.left);
        nodes.add(node.right);
      } else if (node.type === "LogicalExpression") {
        operands(node.left);
        operands(node.right);
      } else if (node.type === "UnaryExpression" && node.operator === "!")
        operands(node.argument);
      else nodes.add(node);
    };
    operands(n);
    const collector = {
      nodes,
      values: [] as NonNullable<ExecutionStep["conditionOperands"]>,
    };
    conditionCollectors.push(collector);
    let v: Runtime;
    try {
      v = expr(n, scope);
    } finally {
      conditionCollectors.pop();
    }
    const loop = loops.findLast(
      (l) => l.test === n && l.frameId === scope.frameId,
    );
    if (loop) {
      loop.conditionResult = Boolean(v);
      loop.status = v ? "checking" : "complete";
    }
    capture(
      n,
      "condition",
      `Check ${source.slice(n.start, n.end)} → ${Boolean(v)}`,
      undefined,
      collector.values,
    );
    return v;
  }
  function block(body: Node[], scope: Scope) {
    for (const n of body)
      if (n.type === "FunctionDeclaration")
        scope.define(n.id.name, makeFunction(n, scope), true);
    for (const n of body) stmt(n, scope);
  }
  function stmt(n: Node, scope: Scope): void {
    tick(n);
    const old = active;
    active = scope;
    try {
      switch (n.type) {
        case "Program":
          block(n.body, scope);
          break;
        case "BlockStatement":
          block(n.body, new Scope(scope));
          break;
        case "VariableDeclaration":
          for (const d of n.declarations) {
            const evaluation = d.init
              ? assignmentValue(d.init, scope)
              : undefined;
            const v = evaluation?.value;
            bind(d.id, v, scope, n.kind === "const");
            capture(
              d,
              "assignment",
              `Declare ${source.slice(d.id.start, d.id.end)} = ${display(snapshot(v))}`,
              undefined,
              undefined,
              [...(evaluation?.operands ?? []), assignmentResult(d.id, v)],
            );
          }
          break;
        case "ExpressionStatement":
          expr(n.expression, scope);
          break;
        case "FunctionDeclaration":
        case "EmptyStatement":
          break;
        case "IfStatement":
          if (condition(n.test, scope)) stmt(n.consequent, scope);
          else if (n.alternate) stmt(n.alternate, scope);
          break;
        case "ForStatement": {
          const local = new Scope(scope);
          active = local;
          const loop = enterLoop(n, local);
          try {
            if (n.init) {
              if (n.init.type === "VariableDeclaration") stmt(n.init, local);
              else expr(n.init, local);
            }
            while (!n.test || condition(n.test, local)) {
              loop.iteration++;
              loop.status = "running";
              capture(
                n,
                "condition",
                `Enter ${loop.kind} loop · iteration ${loop.iteration}`,
              );
              tick(n);
              try {
                stmt(n.body, local);
              } catch (s) {
                if (!(s instanceof Signal)) throw s;
                if (s.type === "break") break;
                if (s.type === "return") throw s;
              }
              if (n.update) expr(n.update, local);
            }
            loop.status = "complete";
            capture(
              n,
              "condition",
              `Loop finished after ${loop.iteration} iterations`,
            );
          } finally {
            loops.pop();
          }
          break;
        }
        case "ForOfStatement": {
          const loop = enterLoop(n, scope);
          try {
            const values = expr(n.right, scope);
            if (!Array.isArray(values) && typeof values !== "string")
              fail("for…of requires an array or string.");
            for (const v of values) {
              loop.iteration++;
              loop.status = "running";
              loop.conditionResult = true;
              tick(n);
              const local = new Scope(scope);
              active = local;
              loop.scope = local;
              if (n.left.type === "VariableDeclaration") {
                bind(
                  n.left.declarations[0].id,
                  v,
                  local,
                  n.left.kind === "const",
                );
                capture(n, "assignment", `Next value: ${display(snapshot(v))}`);
              } else assign(n.left, v, local);
              try {
                stmt(n.body, local);
              } catch (s) {
                if (!(s instanceof Signal)) throw s;
                if (s.type === "break") break;
                if (s.type === "return") throw s;
              }
            }
            loop.status = "complete";
            loop.conditionResult =
              loop.iteration >= values.length ? false : loop.conditionResult;
            capture(
              n,
              "condition",
              `Loop finished after ${loop.iteration} iterations`,
            );
          } finally {
            loops.pop();
          }
          break;
        }
        case "WhileStatement":
        case "DoWhileStatement": {
          const loop = enterLoop(n, scope);
          try {
            let first = true;
            while (
              (n.type === "DoWhileStatement" && first) ||
              condition(n.test, scope)
            ) {
              first = false;
              loop.iteration++;
              loop.status = "running";
              capture(
                n,
                "condition",
                `Enter ${loop.kind} loop · iteration ${loop.iteration}`,
              );
              tick(n);
              try {
                stmt(n.body, scope);
              } catch (s) {
                if (!(s instanceof Signal)) throw s;
                if (s.type === "break") break;
                if (s.type === "return") throw s;
              }
            }
            loop.status = "complete";
            capture(
              n,
              "condition",
              `Loop finished after ${loop.iteration} iterations`,
            );
          } finally {
            loops.pop();
          }
          break;
        }
        case "ReturnStatement": {
          const v = n.argument ? expr(n.argument, scope) : undefined;
          lastReturn = snapshot(v);
          capture(n, "return", `Return ${display(lastReturn)}`, v);
          throw new Signal("return", v);
        }
        case "BreakStatement":
          throw new Signal("break");
        case "ContinueStatement":
          throw new Signal("continue");
        default:
          fail(`Statement “${n.type}” is not supported.`, "unsupported");
      }
    } finally {
      active = old;
    }
  }
  try {
    if (source.length > 30000)
      fail("Source exceeds the 30,000 character limit.", "limit");
    const ast = parse(source, { ecmaVersion: 2022, locations: true });
    function validate(n: Node) {
      if (!n || typeof n !== "object") return;
      if (n.type) {
        currentLine = n.loc?.start.line ?? 1;
        if (
          !allowedNodes.has(n.type) ||
          n.async ||
          n.generator ||
          n.optional ||
          n.method ||
          n.kind === "get" ||
          n.kind === "set" ||
          n.kind === "var" ||
          n.label
        )
          fail(
            `“${n.type === "VariableDeclaration" ? "var (use let or const)" : n.type}” is outside the supported JavaScript subset.`,
            "unsupported",
          );
      }
      for (const [k, v] of Object.entries(n))
        if (k !== "loc") {
          if (Array.isArray(v)) v.forEach(validate);
          else if (v && typeof v === "object") validate(v);
        }
    }
    validate(ast);
    root.define("undefined", undefined, true);
    root.define("NaN", NaN, true);
    root.define("Infinity", Infinity, true);
    const math = Object.create(null);
    for (const name of [
      "floor",
      "ceil",
      "round",
      "abs",
      "min",
      "max",
      "sqrt",
      "pow",
      "trunc",
    ])
      math[name] = builtin((args) => (Math as any)[name](...args));
    root.define("Math", Object.assign(math, { [BUILTIN]: true }), true);
    root.define(
      "console",
      Object.assign(Object.create(null), {
        [BUILTIN]: true,
        log: builtin((args) => {
          output.push(args.map((v) => display(snapshot(v))).join(" "));
          capture(
            { loc: { start: { line: currentLine } } },
            "output",
            `Print: ${output.at(-1)}`,
          );
        }),
      }),
      true,
    );
    root.define(
      "Number",
      builtin((args) => Number(args[0])),
      true,
    );
    root.define(
      "String",
      builtin((args) => String(args[0])),
      true,
    );
    stmt(ast, root);
    active = root;
    capture(
      null,
      "complete",
      "Execution complete. All operations have been recorded.",
      lastReturn,
    );
    return { steps, duration: performance.now() - start };
  } catch (e) {
    const err = e as Error & { loc?: { line: number } };
    const kind =
      e instanceof Failure
        ? e.kind
        : e instanceof SyntaxError
          ? "syntax"
          : "runtime";
    return {
      steps,
      duration: performance.now() - start,
      error: {
        kind,
        message: err.message ?? "Execution failed.",
        line: e instanceof Failure ? e.line : (err.loc?.line ?? currentLine),
        details: `${err.name ?? "Error"}: ${err.message}`,
      },
    };
  }
}
