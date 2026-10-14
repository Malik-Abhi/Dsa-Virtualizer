"use client";
import { Layers, Globe2, GripVertical } from "lucide-react";
import type { RuntimeFrame as Frame, RuntimeLoop } from "@/types/memory";
import { isInlineForLoop } from "@/lib/visualization/memory-layout";
import MemoryValueBox from "./MemoryValueBox";
export default function RuntimeFrame({
  frame,
  loops = [],
}: {
  frame: Frame;
  loops?: RuntimeLoop[];
}) {
  const inlineLoops = loops.filter(
    (loop) => loop.frameId === frame.id && isInlineForLoop(loop),
  );
  return (
    <section
      className={`runtime-frame frame-${frame.status}`}
      aria-label={`${frame.name} runtime frame`}
    >
      <header className="memory-node-header">
        <span className="memory-node-icon">
          {frame.kind === "global" ? (
            <Globe2 size={15} />
          ) : (
            <Layers size={15} />
          )}
        </span>
        <strong title={frame.name}>{frame.name}</strong>
        <GripVertical size={13} />
      </header>
      <div className="frame-meta">
        <span>
          {frame.kind === "global"
            ? "GLOBAL SCOPE"
            : `CALL FRAME · LINE ${frame.callLine}`}
        </span>
        <span className={`frame-state ${frame.status}`}>{frame.status}</span>
      </div>
      <div className="frame-bindings">
        {frame.variables.map((variable) => (
          <div
            key={variable.id}
            className={`memory-variable ${variable.changed ? "binding-changed" : ""}`}
            data-binding={variable.name}
          >
            <span className="memory-variable-name" title={variable.name}>
              {variable.name}
            </span>
            <MemoryValueBox value={variable.value} changed={variable.changed} />
          </div>
        ))}
        {(frame.kind === "function" || frame.returned) && (
          <div
            className={`memory-variable return-variable ${frame.returned ? "binding-changed" : ""}`}
          >
            <span className="memory-variable-name">
              {frame.kind === "global" ? "Last return" : "Return value"}
            </span>
            <MemoryValueBox
              value={frame.returnValue}
              pending={!frame.returned}
              changed={frame.returned}
            />
          </div>
        )}
      </div>
      {inlineLoops.map((loop) => (
        <div
          className="frame-loop-label"
          key={loop.id}
          title={`${loop.condition} · iteration ${loop.iteration} · ${loop.status}`}
        >
          {loop.kind} loop · line {loop.line}
        </div>
      ))}
    </section>
  );
}
