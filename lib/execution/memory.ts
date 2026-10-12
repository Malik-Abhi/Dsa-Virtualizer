import type {
  HeapObject,
  MemorySnapshot,
  MemoryValue,
  RuntimeFrame,
  MemoryAccess,
  RuntimeLoop,
} from "@/types/memory";
export type FrameInput = Omit<RuntimeFrame, "variables" | "returnValue"> & {
  bindings: { id: string; name: string; value: unknown }[];
  returnValue: unknown;
};
export type LoopInput = Omit<RuntimeLoop, "variables"> & {
  bindings: FrameInput["bindings"];
};
type FunctionInfo = { name: string; parameters: string[]; line: number };
/** Identity belongs to the runtime, not a variable name or a serialized value. */
export class MemoryRecorder {
  private identities = new WeakMap<object, string>();
  private sequence = 0;
  private previous?: MemorySnapshot;
  constructor(
    private functionInfo: (value: object) => FunctionInfo | undefined,
  ) {}
  identity(value: object): string {
    let id = this.identities.get(value);
    if (!id) {
      id = `h${++this.sequence}`;
      this.identities.set(value, id);
    }
    return id;
  }
  capture(
    inputs: FrameInput[],
    accesses: MemoryAccess[],
    associations: Map<string, string>,
    loopInputs: LoopInput[] = [],
  ): MemorySnapshot {
    const pending: object[] = [];
    const queued = new Set<string>();
    const encode = (value: unknown): MemoryValue => {
      if (typeof value === "object" && value !== null) {
        const objectId = this.identity(value);
        if (!queued.has(objectId)) {
          queued.add(objectId);
          pending.push(value);
        }
        return { kind: "reference", objectId };
      }
      if (value === undefined)
        return { kind: "primitive", type: "undefined", value: null };
      if (value === null)
        return { kind: "primitive", type: "null", value: null };
      if (typeof value === "number")
        return {
          kind: "primitive",
          type: "number",
          value: Number.isFinite(value) ? value : String(value),
        };
      if (typeof value === "boolean")
        return { kind: "primitive", type: "boolean", value };
      return { kind: "primitive", type: "string", value: String(value) };
    };
    const previousVariables = new Map(
      this.previous?.frames.flatMap((f) =>
        f.variables.map((v) => [v.id, v.value] as const),
      ),
    );
    const frames = inputs.map(({ bindings, returnValue, ...frame }) => ({
      ...frame,
      returnValue: encode(returnValue),
      variables: bindings.map(({ value, ...binding }) => {
        const encoded = encode(value);
        return {
          ...binding,
          value: encoded,
          changed:
            JSON.stringify(previousVariables.get(binding.id)) !==
            JSON.stringify(encoded),
        };
      }),
    }));
    const loops = loopInputs.map(({ bindings, ...loop }) => ({
      ...loop,
      variables: bindings.map(({ value, ...binding }) => {
        const encoded = encode(value);
        return {
          ...binding,
          value: encoded,
          changed:
            JSON.stringify(previousVariables.get(binding.id)) !==
            JSON.stringify(encoded),
        };
      }),
    }));
    const heap: HeapObject[] = [];
    const priorHeap = new Map(this.previous?.heap.map((o) => [o.id, o]));
    const entries = (object: HeapObject): [string, MemoryValue][] =>
      object.kind === "array"
        ? object.items.map((v, i) => [String(i), v])
        : object.kind === "object"
          ? object.properties.map((p) => [p.name, p.value])
          : [];
    for (let i = 0; i < pending.length; i++) {
      if (i >= 1000)
        throw new Error("Memory graph exceeds 1,000 reachable objects.");
      const value = pending[i],
        id = this.identity(value),
        fn = this.functionInfo(value);
      const object: HeapObject = fn
        ? { id, kind: "function", ...fn, changedKeys: [] }
        : Array.isArray(value)
          ? {
              id,
              kind: "array",
              items: Array.from(value, encode),
              changedKeys: [],
            }
          : {
              id,
              kind: "object",
              properties: Object.entries(value).map(([name, v]) => ({
                name,
                value: encode(v),
              })),
              changedKeys: [],
            };
      const prior = priorHeap.get(id);
      const priorValues = new Map(prior ? entries(prior) : []);
      const currentValues = new Map(entries(object));
      object.changedKeys = [
        ...new Set([...priorValues.keys(), ...currentValues.keys()]),
      ].filter(
        (k) =>
          JSON.stringify(priorValues.get(k)) !==
          JSON.stringify(currentValues.get(k)),
      );
      heap.push(object);
    }
    const byId = new Map(heap.map((o) => [o.id, o]));
    const pointers = frames.flatMap((frame) =>
      frame.variables.flatMap((variable) => {
        const objectId = associations.get(variable.id),
          object = objectId ? byId.get(objectId) : undefined;
        return object?.kind === "array" &&
          variable.value.kind === "primitive" &&
          variable.value.type === "number" &&
          typeof variable.value.value === "number" &&
          Number.isInteger(variable.value.value) &&
          variable.value.value >= 0 &&
          variable.value.value < object.items.length
          ? [
              {
                id: variable.id,
                name: variable.name,
                frameId: frame.id,
                objectId: object.id,
                index: variable.value.value,
              },
            ]
          : [];
      }),
    );
    const snapshot: MemorySnapshot = {
      frames,
      loops,
      heap,
      accesses: [...accesses],
      pointers,
    };
    this.previous = snapshot;
    return snapshot;
  }
}
