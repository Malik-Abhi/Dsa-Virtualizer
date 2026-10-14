import type {
  HeapObject,
  MemorySnapshot,
  MemoryValue,
  RuntimeLoop,
} from "@/types/memory";
export const FRAME_WIDTH = 260,
  FRAME_ROW = 34,
  HEAP_ROW = 32,
  ARRAY_CELL = 44;
export const isInlineForLoop = (loop: RuntimeLoop) =>
  loop.kind === "for" || loop.kind === "for…of";
export type Point = { x: number; y: number };
export type MemoryNode = Point & {
  id: string;
  kind: "frame" | "heap" | "loop";
  width: number;
  height: number;
};
export type ReferenceEdge = {
  id: string;
  source: string;
  target: string;
  from: Point;
  to: Point;
  label: string;
  changed: boolean;
};
export type MemoryLayout = {
  nodes: MemoryNode[];
  edges: ReferenceEdge[];
  width: number;
  height: number;
};
export const frameNodeId = (id: string) => `frame:${id}`;
export const loopNodeId = (id: string) => `loop:${id}`;
export const heapNodeId = (id: string) => `heap:${id}`;
export function arrayPointerHeight(objectId: string, memory?: MemorySnapshot) {
  return memory?.pointers.some((p) => p.objectId === objectId && p.index < 24)
    ? 28
    : 0;
}
export function objectDimensions(object: HeapObject, memory?: MemorySnapshot) {
  if (object.kind === "array")
    return {
      width: Math.max(90, Math.min(object.items.length, 24) * ARRAY_CELL + 2),
      height: 78 + arrayPointerHeight(object.id, memory),
    };
  if (object.kind === "function") return { width: 256, height: 100 };
  return {
    width: 244,
    height: 46 + Math.max(1, object.properties.length) * HEAP_ROW,
  };
}
export function objectRole(object: HeapObject): string {
  if (object.kind === "array") return "Array";
  if (object.kind === "function") return "Function";
  const names = new Set(object.properties.map((p) => p.name));
  return names.has("next") && names.has("value")
    ? "List node"
    : names.has("left") && names.has("right")
      ? "Tree node"
      : "Object";
}
/** Deterministic geometry shared by node rendering and SVG reference routing. */
export function layoutMemory(memory: MemorySnapshot): MemoryLayout {
  const nodes: MemoryNode[] = [];
  let frameY = 26;
  for (const frame of memory.frames) {
    const height =
      64 +
      (frame.variables.length +
        (frame.kind === "function" || frame.returned ? 1 : 0)) *
        FRAME_ROW;
    nodes.push({
      id: frameNodeId(frame.id),
      kind: "frame",
      x: 24,
      y: frameY,
      width: FRAME_WIDTH,
      height,
    });
    frameY += height + 16;
    for (const loop of memory.loops ?? []) {
      if (loop.frameId !== frame.id || isInlineForLoop(loop)) continue;
      const loopHeight = 108 + loop.variables.length * FRAME_ROW;
      nodes.push({
        id: loopNodeId(loop.id),
        kind: "loop",
        x: 24,
        y: frameY,
        width: FRAME_WIDTH,
        height: loopHeight,
      });
      frameY += loopHeight + 16;
    }
  }
  const placed = new Set<string>(),
    byId = new Map(memory.heap.map((o) => [o.id, o]));
  const linked = (object: HeapObject, name: string) =>
    object.kind === "object"
      ? object.properties.find((p) => p.name === name)?.value
      : undefined;
  const reference = (value?: MemoryValue) =>
    value?.kind === "reference" ? byId.get(value.objectId) : undefined;
  let heapY = 26;
  // Follow actual heap references, including nested arrays, rather than allocation order.
  const childSlots = (object: HeapObject): (HeapObject | undefined)[] => {
    if (object.kind === "array")
      return object.items
        .slice(0, 24)
        .map(reference)
        .filter((child) => !!child);
    if (object.kind !== "object") return [];
    if (objectRole(object) === "Tree node") {
      const slots = [
        reference(linked(object, "left")),
        reference(linked(object, "right")),
      ];
      return slots.some(Boolean) ? slots : [];
    }
    return object.properties
      .map((property) => reference(property.value))
      .filter((child) => !!child);
  };
  const children = new Set(
    memory.heap.flatMap((object) =>
      childSlots(object).flatMap((child) => (child ? [child.id] : [])),
    ),
  );
  const roots = [...memory.heap].sort(
    (a, b) => Number(children.has(a.id)) - Number(children.has(b.id)),
  );
  for (const root of roots) {
    if (placed.has(root.id)) continue;
    const role = objectRole(root);
    if (role === "List node") {
      let object: HeapObject | undefined = root,
        x = 360,
        rowHeight = 0;
      while (
        object &&
        !placed.has(object.id) &&
        objectRole(object) === "List node"
      ) {
        const size = objectDimensions(object, memory);
        placed.add(object.id);
        nodes.push({
          id: heapNodeId(object.id),
          kind: "heap",
          x,
          y: heapY,
          ...size,
        });
        rowHeight = Math.max(rowHeight, size.height);
        x += size.width + 48;
        object = reference(linked(object, "next"));
      }
      heapY += rowHeight + 20;
    } else {
      type Branch = {
        object: HeapObject;
        width: number;
        size: ReturnType<typeof objectDimensions>;
        children: { branch?: Branch; width: number }[];
      };
      const levelHeights: number[] = [];
      // Build one spanning tree per root. Shared objects and cycles keep a single
      // card; all of their additional references are still drawn below.
      const measure = (object: HeapObject, depth: number): Branch => {
        placed.add(object.id);
        const size = objectDimensions(object, memory);
        levelHeights[depth] = Math.max(levelHeights[depth] ?? 0, size.height);
        const branches = childSlots(object)
          .map((child) => {
            if (!child || placed.has(child.id))
              return {
                width: objectRole(object) === "Tree node" ? 48 : 0,
              };
            const branch = measure(child, depth + 1);
            return { branch, width: branch.width };
          })
          .filter((child) => child.width > 0);
        const childrenWidth =
          branches.reduce((sum, child) => sum + child.width, 0) +
          Math.max(0, branches.length - 1) * 32;
        return {
          object,
          size,
          children: branches,
          width: Math.max(size.width, childrenWidth),
        };
      };
      const branch = measure(root, 0);
      const levelY: number[] = [heapY];
      for (let depth = 1; depth < levelHeights.length; depth++)
        levelY[depth] = levelY[depth - 1] + levelHeights[depth - 1] + 44;
      const place = (branch: Branch, left: number, depth: number) => {
        nodes.push({
          id: heapNodeId(branch.object.id),
          kind: "heap",
          x: left + (branch.width - branch.size.width) / 2,
          y: levelY[depth],
          ...branch.size,
        });
        const childrenWidth =
          branch.children.reduce((sum, child) => sum + child.width, 0) +
          Math.max(0, branch.children.length - 1) * 32;
        let childLeft = left + (branch.width - childrenWidth) / 2;
        for (const child of branch.children) {
          if (child.branch) place(child.branch, childLeft, depth + 1);
          childLeft += child.width + 32;
        }
      };
      place(branch, 360, 0);
      heapY = levelY.at(-1)! + levelHeights.at(-1)! + 24;
    }
  }
  const byNode = new Map(nodes.map((n) => [n.id, n]));
  const edges: ReferenceEdge[] = [];
  function edge(
    id: string,
    source: string,
    value: MemoryValue,
    from: Point,
    label: string,
    changed: boolean,
  ) {
    if (value.kind !== "reference") return;
    const target = heapNodeId(value.objectId),
      node = byNode.get(target);
    if (!node) return;
    edges.push({
      id,
      source,
      target,
      from,
      to: {
        x: 0,
        y:
          byId.get(value.objectId)?.kind === "array"
            ? 60 + arrayPointerHeight(value.objectId, memory)
            : 17,
      },
      label,
      changed,
    });
  }
  for (const frame of memory.frames) {
    frame.variables.forEach((variable, i) =>
      edge(
        variable.id,
        frameNodeId(frame.id),
        variable.value,
        { x: FRAME_WIDTH - 12, y: 74 + i * FRAME_ROW },
        variable.name,
        variable.changed,
      ),
    );
    if (frame.returned)
      edge(
        `${frame.id}:return`,
        frameNodeId(frame.id),
        frame.returnValue,
        { x: FRAME_WIDTH - 12, y: 74 + frame.variables.length * FRAME_ROW },
        "Return value",
        true,
      );
  }
  for (const loop of (memory.loops ?? []).filter(
    (loop) => !isInlineForLoop(loop),
  ))
    loop.variables.forEach((variable, i) =>
      edge(
        `${loop.id}:${variable.id}`,
        loopNodeId(loop.id),
        variable.value,
        { x: FRAME_WIDTH - 12, y: 118 + i * FRAME_ROW },
        variable.name,
        variable.changed,
      ),
    );
  for (const object of memory.heap) {
    if (object.kind === "object")
      object.properties.forEach((property, i) =>
        edge(
          `${object.id}:${property.name}`,
          heapNodeId(object.id),
          property.value,
          { x: 230, y: 55 + i * HEAP_ROW },
          property.name,
          object.changedKeys.includes(property.name),
        ),
      );
    if (object.kind === "array")
      object.items.slice(0, 24).forEach((value, i) =>
        edge(
          `${object.id}:${i}`,
          heapNodeId(object.id),
          value,
          {
            x: 1 + ARRAY_CELL * (i + 1) - 7,
            y: 60 + arrayPointerHeight(object.id, memory),
          },
          `[${i}]`,
          object.changedKeys.includes(String(i)),
        ),
      );
  }
  return {
    nodes,
    edges,
    width: Math.max(640, ...nodes.map((n) => n.x + n.width)) + 24,
    height: Math.max(180, ...nodes.map((n) => n.y + n.height)) + 24,
  };
}
export function edgePath(
  edge: ReferenceEdge,
  positions: Map<string, Point>,
  nodes: MemoryNode[],
) {
  const source = positions.get(edge.source),
    target = positions.get(edge.target);
  if (!source || !target) return "";
  const a = { x: source.x + edge.from.x, y: source.y + edge.from.y },
    b = { x: target.x + edge.to.x, y: target.y + edge.to.y };
  if (edge.source === edge.target) {
    const width = nodes.find((n) => n.id === edge.source)?.width ?? 244;
    return `M ${a.x} ${a.y} C ${source.x + width + 60} ${a.y}, ${source.x + width + 60} ${source.y - 32}, ${source.x + width / 2} ${source.y - 32} S ${source.x - 35} ${source.y - 32}, ${b.x - 7} ${b.y}`;
  }
  if (b.x <= a.x + 30) {
    const bend = Math.max(a.x, b.x) + 72;
    return `M ${a.x} ${a.y} C ${bend} ${a.y}, ${bend} ${b.y - 58}, ${b.x - 7} ${b.y}`;
  }
  const curve = Math.max(48, (b.x - a.x) * 0.45);
  return `M ${a.x} ${a.y} C ${a.x + curve} ${a.y}, ${b.x - curve} ${b.y}, ${b.x - 7} ${b.y}`;
}
