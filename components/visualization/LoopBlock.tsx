"use client";
import { Repeat2, GripVertical } from "lucide-react";
import type { RuntimeLoop } from "@/types/memory";
import MemoryValueBox from "./MemoryValueBox";
export default function LoopBlock({ loop }: { loop: RuntimeLoop }) {
  return (
    <section
      className={`runtime-frame loop-block loop-${loop.status}`}
      aria-label={`${loop.kind} loop at line ${loop.line}`}
    >
      <header className="memory-node-header">
        <span className="memory-node-icon">
          <Repeat2 size={15} />
        </span>
        <strong>
          {loop.kind} loop · line {loop.line}
        </strong>
        <GripVertical size={13} />
      </header>
      <div className="frame-meta">
        <span>
          ITERATION {loop.iteration}
          {loop.parentId ? " · NESTED" : ""}
        </span>
        <span
          className={`frame-state ${loop.status === "complete" ? "complete" : "active"}`}
        >
          {loop.status}
        </span>
      </div>
      <div className="loop-condition">
        <code title={loop.condition}>{loop.condition}</code>
        <span>
          {loop.conditionResult === null
            ? "—"
            : loop.conditionResult
              ? "true"
              : "false"}
        </span>
      </div>
      <div className="frame-bindings">
        {loop.variables.map((variable) => (
          <div
            key={variable.id}
            className={`memory-variable ${variable.changed ? "binding-changed" : ""}`}
          >
            <span className="memory-variable-name" title={variable.name}>
              {variable.name}
            </span>
            <MemoryValueBox value={variable.value} changed={variable.changed} />
          </div>
        ))}
      </div>
    </section>
  );
}
