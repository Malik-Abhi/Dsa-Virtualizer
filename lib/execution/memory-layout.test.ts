import { test } from "node:test";
import assert from "node:assert/strict";
import { executeJavaScript } from "./interpreter";
import { layoutMemory, edgePath } from "../visualization/memory-layout";
const layout = (source: string) => {
  const result = executeJavaScript(source);
  assert.equal(result.error, undefined);
  return layoutMemory(result.steps.at(-1)!.memory);
};
test("alias references route to the same heap node and every endpoint exists", () => {
  const graph = layout("const A = [1]; const B = A;");
  assert.equal(graph.nodes.filter((n) => n.kind === "heap").length, 1);
  assert.equal(graph.edges.length, 2);
  assert.equal(graph.edges[0].target, graph.edges[1].target);
  for (const edge of graph.edges)
    assert.ok(graph.nodes.some((n) => n.id === edge.target));
});
test("reference paths reroute after moving source or target and retain stable edge identities", () => {
  const graph = layout("const A = [1];");
  const positions = new Map(graph.nodes.map((n) => [n.id, { x: n.x, y: n.y }]));
  const before = edgePath(graph.edges[0], positions, graph.nodes);
  const target = positions.get(graph.edges[0].target)!;
  positions.set(graph.edges[0].target, { x: target.x + 80, y: target.y + 35 });
  assert.notEqual(edgePath(graph.edges[0], positions, graph.nodes), before);
});
test("linked nodes occupy a chain and circular edges terminate on the original node", () => {
  const graph = layout(
    "const head = {value:1,next:{value:2,next:null}}; head.next.next = head;",
  );
  const nodes = graph.nodes.filter((n) => n.kind === "heap");
  assert.equal(nodes.length, 2);
  assert.equal(nodes[0].y, nodes[1].y);
  assert.ok(nodes[1].x > nodes[0].x);
  assert.equal(
    graph.edges.filter((e) => e.source.startsWith("heap:")).length,
    2,
  );
});
test("tree parents sit above children and shared subtrees have only one visual node", () => {
  const graph = layout(
    "const child = {value:2,left:null,right:null}; const tree = {value:4,left:child,right:child};",
  );
  const heapEdges = graph.edges.filter((e) => e.source.startsWith("heap:"));
  assert.equal(graph.nodes.filter((n) => n.kind === "heap").length, 2);
  assert.equal(heapEdges.length, 2);
  assert.equal(heapEdges[0].target, heapEdges[1].target);
  const parent = graph.nodes.find((n) => n.id === heapEdges[0].source)!;
  const child = graph.nodes.find((n) => n.id === heapEdges[0].target)!;
  assert.ok(parent.y < child.y);
});

test("array pointer lanes reserve space only when used and references follow the value row", () => {
  const result = executeJavaScript(
    "const A = [[1, 4], [0, 2]]; const i = 0; const selected = A[i];",
  );
  assert.equal(result.error, undefined);
  const memory = result.steps.at(-1)!.memory;
  assert.ok(memory.pointers.length > 0);
  const withPointers = layoutMemory(memory);
  const withoutPointers = layoutMemory({ ...memory, pointers: [] });
  const pointedId = `heap:${memory.pointers[0].objectId}`;
  const pointed = withPointers.nodes.find((n) => n.id === pointedId)!;
  const plain = withoutPointers.nodes.find((n) => n.id === pointedId)!;
  assert.ok(pointed.height > plain.height);
  const incoming = withPointers.edges.find((e) => e.target === pointedId)!;
  const plainIncoming = withoutPointers.edges.find(
    (e) => e.id === incoming.id,
  )!;
  assert.equal(
    incoming.to.y - plainIncoming.to.y,
    pointed.height - plain.height,
  );
  const nested = withPointers.edges.find((e) => e.source === pointedId)!;
  assert.equal(nested.from.y, incoming.to.y);
  for (const edge of withPointers.edges) {
    const source = withPointers.nodes.find((n) => n.id === edge.source)!;
    const target = withPointers.nodes.find((n) => n.id === edge.target)!;
    assert.ok(edge.from.y > 0 && edge.from.y < source.height);
    assert.ok(edge.to.y > 0 && edge.to.y < target.height);
  }
});

function assertNoOverlaps(graph: ReturnType<typeof layoutMemory>) {
  const heap = graph.nodes.filter((node) => node.kind === "heap");
  for (let i = 0; i < heap.length; i++)
    for (let j = i + 1; j < heap.length; j++) {
      const a = heap[i],
        b = heap[j];
      assert.ok(
        a.x + a.width <= b.x ||
          b.x + b.width <= a.x ||
          a.y + a.height <= b.y ||
          b.y + b.height <= a.y,
        `${a.id} overlaps ${b.id}`,
      );
    }
}

test("nested arrays automatically form a parent above ordered siblings", () => {
  const graph = layout("const B = [[1,4], [0,2], [2,3]];");
  const parent = graph.nodes.find(
    (n) =>
      n.id === graph.edges.find((e) => e.source.startsWith("frame:"))!.target,
  )!;
  const children = graph.edges
    .filter((e) => e.source === parent.id)
    .map((e) => graph.nodes.find((n) => n.id === e.target)!);
  assert.equal(children.length, 3);
  assert.ok(children.every((n) => n.y > parent.y));
  assert.equal(new Set(children.map((n) => n.y)).size, 1);
  assert.ok(children[0].x < children[1].x && children[1].x < children[2].x);
  const center = parent.x + parent.width / 2;
  assert.ok(
    center > children[0].x && center < children[2].x + children[2].width,
  );
  assertNoOverlaps(graph);
});

test("uneven nested arrays reserve space for complete subtrees and wide siblings", () => {
  const graph = layout(
    "const small = [1]; const rows = [[small, [2,3]], [4,5,6,7,8,9,10,11], [[12], [13]]]; const extra = [99];",
  );
  assertNoOverlaps(graph);
  for (const edge of graph.edges.filter((e) => e.source.startsWith("heap:"))) {
    const parent = graph.nodes.find((n) => n.id === edge.source)!;
    const child = graph.nodes.find((n) => n.id === edge.target)!;
    assert.ok(child.y > parent.y);
  }
});

test("binary trees preserve left and right branches even when one child is missing", () => {
  const graph = layout(
    "const tree = {value:1,left:null,right:{value:2,left:{value:3,left:null,right:null},right:null}};",
  );
  const edges = graph.edges.filter((e) => e.source.startsWith("heap:"));
  for (const edge of edges) {
    const parent = graph.nodes.find((n) => n.id === edge.source)!;
    const child = graph.nodes.find((n) => n.id === edge.target)!;
    assert.ok(child.y > parent.y);
    if (edge.label === "left")
      assert.ok(child.x + child.width / 2 < parent.x + parent.width / 2);
    if (edge.label === "right")
      assert.ok(child.x + child.width / 2 > parent.x + parent.width / 2);
  }
  assertNoOverlaps(graph);
});

test("shared and cyclic arrays remain single cards with every reference intact", () => {
  const graph = layout(
    "const child = [1,2]; const root = [child, child]; child.push(root); const alias = root;",
  );
  assert.equal(graph.nodes.filter((n) => n.kind === "heap").length, 2);
  assert.equal(
    graph.edges.filter((e) => e.source.startsWith("heap:")).length,
    3,
  );
  assertNoOverlaps(graph);
});

test("for loops share their frame instead of creating extra cards or arrows", () => {
  const result = executeJavaScript(
    "const A=[[1,2]]; const row=A[0]; for(const item of A){ item[0]++; }",
  );
  assert.equal(result.error, undefined);
  const memory = result.steps.find((step) =>
    step.memory.loops?.some(
      (loop) => loop.iteration === 1 && loop.status === "running",
    ),
  )!.memory;
  const graph = layoutMemory(memory);
  const plain = layoutMemory({ ...memory, loops: [] });
  assert.equal(graph.nodes.filter((node) => node.kind === "loop").length, 0);
  const frame = graph.nodes.find((node) => node.kind === "frame")!;
  const plainFrame = plain.nodes.find((node) => node.id === frame.id)!;
  assert.equal(frame.height, plainFrame.height);
  assert.deepEqual(graph.edges, plain.edges);
  assert.equal(graph.nodes.filter((node) => node.kind === "heap").length, 2);
});

test("nested for labels belong only to their call frame and while cards remain available", () => {
  const result = executeJavaScript(
    "function f(){for(let i=0;i<1;i++){for(let j=0;j<1;j++){let k=0;while(k<1){k++;}}}} f();",
  );
  assert.equal(result.error, undefined);
  const memory = result.steps.find(
    (step) => step.memory.loops?.length === 3,
  )!.memory;
  const graph = layoutMemory(memory);
  const plain = layoutMemory({ ...memory, loops: [] });
  const caller = graph.nodes.find(
    (node) => node.id === `frame:${memory.frames.at(-1)!.id}`,
  )!;
  const plainCaller = plain.nodes.find((node) => node.id === caller.id)!;
  assert.equal(caller.height, plainCaller.height);
  assert.equal(
    graph.nodes.find((node) => node.id === "frame:global")!.height,
    plain.nodes.find((node) => node.id === "frame:global")!.height,
  );
  assert.equal(graph.nodes.filter((node) => node.kind === "loop").length, 1);
});
