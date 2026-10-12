"use client";
import { useState } from "react";
import { Check, ChevronDown, Terminal } from "lucide-react";
import type {
  ExecutionResult,
  ExecutionStep,
  Language,
} from "@/types/execution";
export default function ConsoleOutput({
  step,
  result,
  language = "javascript",
}: {
  step?: ExecutionStep;
  result?: ExecutionResult;
  language?: Language;
}) {
  const [expanded, setExpanded] = useState(true);
  return (
    <section
      className={`console-panel ${expanded ? "" : "console-collapsed"}`}
      aria-label="Console output"
    >
      <button
        className="console-heading"
        onClick={() => setExpanded((v) => !v)}
        aria-expanded={expanded}
      >
        <Terminal size={14} />
        <span>Console</span>
        <span className="console-count">{step?.output.length ?? 0}</span>
        <small>
          {step?.event === "complete" ? (
            <>
              <Check size={12} /> Complete
            </>
          ) : (
            "Output at this step"
          )}
        </small>
        <ChevronDown size={13} />
      </button>
      {expanded && (
        <div className="console-body">
          {step?.output.length ? (
            step.output.map((line, i) => (
              <div className="console-line" key={i}>
                <span>›</span>
                <code>{line}</code>
              </div>
            ))
          ) : (
            <span className="console-empty">
              Your {language === "python" ? "print" : "console.log"} output
              appears here. Variables and frames live in the canvas.
            </span>
          )}
          {step?.event === "complete" && (
            <div className="console-complete">
              <Check size={12} />
              <span>Execution complete</span>
              <small>
                {result?.steps.length} steps · {result?.duration.toFixed(1)} ms
              </small>
            </div>
          )}
        </div>
      )}
    </section>
  );
}
