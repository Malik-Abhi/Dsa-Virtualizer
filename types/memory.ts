/** Serializable memory graph. References always identify one shared heap object. */
export type MemoryValue =
  | {
      kind: "primitive";
      type:
        | "number"
        | "string"
        | "boolean"
        | "null"
        | "undefined"
        | "none"
        | "python-boolean";
      value: string | number | boolean | null;
    }
  | { kind: "reference"; objectId: string };
export type MemoryVariable = {
  id: string;
  name: string;
  value: MemoryValue;
  changed: boolean;
};
export type RuntimeFrame = {
  id: string;
  name: string;
  kind: "global" | "function";
  status: "active" | "suspended" | "returning" | "complete";
  callLine: number;
  variables: MemoryVariable[];
  returnValue: MemoryValue;
  returned: boolean;
};
export type HeapObject = {
  id: string;
  changedKeys: string[];
} & (
  | { kind: "array"; items: MemoryValue[] }
  | { kind: "object"; properties: { name: string; value: MemoryValue }[] }
  | { kind: "function"; name: string; parameters: string[]; line: number }
);
export type MemoryAccess = {
  objectId: string;
  property: string;
  frameId: string;
};
export type ArrayPointer = {
  id: string;
  name: string;
  frameId: string;
  objectId: string;
  index: number;
};
export type RuntimeLoop = {
  id: string;
  frameId: string;
  parentId?: string;
  kind: "for" | "for…of" | "while" | "do…while";
  line: number;
  condition: string;
  iteration: number;
  conditionResult: boolean | null;
  status: "checking" | "running" | "complete";
  variables: MemoryVariable[];
};
export type MemorySnapshot = {
  loops?: RuntimeLoop[];
  frames: RuntimeFrame[];
  heap: HeapObject[];
  accesses: MemoryAccess[];
  pointers: ArrayPointer[];
};
