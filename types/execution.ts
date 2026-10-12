import type { MemorySnapshot } from "./memory";
export type Language = "javascript" | "python";
export type Value =
  string | number | boolean | null | Value[] | { [key: string]: Value };
export type DataStructure = {
  id: string;
  name: string;
  kind: "array" | "object";
  value: Value[] | Record<string, Value>;
};
export type CallFrame = { name: string; line: number };
export type ExecutionStep = {
  step: number;
  line: number;
  event: "assignment" | "condition" | "call" | "return" | "output" | "complete";
  memory: MemorySnapshot;
  variables: Record<string, Value>;
  dataStructures: DataStructure[];
  output: string[];
  changedElements: string[];
  accessedElements: string[];
  callStack: CallFrame[];
  description: string;
  conditionOperands?: { expression: string; value: string }[];
  assignmentOperands?: { expression: string; value: string }[];
  returnValue?: Value;
};
export type ExecutionError = {
  kind: "syntax" | "unsupported" | "runtime" | "limit";
  message: string;
  line: number;
  details: string;
};
export type ExecutionResult = {
  steps: ExecutionStep[];
  duration: number;
  error?: ExecutionError;
};
export interface ExecutionAdapter {
  language: Language;
  execute(source: string): Promise<ExecutionResult>;
}
