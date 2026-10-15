"use client";
import { AnimatePresence, motion } from "motion/react";
import type { MemoryValue } from "@/types/memory";
export function formatMemoryValue(value: MemoryValue): string {
  if (value.kind === "reference") return `reference · #${value.objectId}`;
  if (value.type === "undefined") return "undefined";
  if (value.type === "null") return "null";
  if (value.type === "none") return "None";
  if (value.type === "python-boolean") return value.value ? "True" : "False";
  return value.type === "string"
    ? JSON.stringify(value.value)
    : String(value.value);
}
export default function MemoryValueBox({
  value,
  changed = false,
  pending = false,
  small = false,
}: {
  value: MemoryValue;
  changed?: boolean;
  pending?: boolean;
  small?: boolean;
}) {
  const reference = value.kind === "reference";
  const text = pending
    ? "—"
    : reference
      ? "reference"
      : formatMemoryValue(value);
  return (
    <div
      className={`memory-value-box ${!pending && value.kind === "primitive" && value.type === "number" ? "is-number" : ""} ${reference && !pending ? "is-reference" : ""} ${changed ? "is-changed" : ""} ${small ? "small" : ""}`}
      title={
        pending ? "This frame has not returned yet." : formatMemoryValue(value)
      }
    >
      <AnimatePresence initial={false} mode="popLayout">
        <motion.span
          className="memory-value-text"
          key={pending ? "pending" : JSON.stringify(value)}
          initial={{ opacity: 0, y: 11 }}
          animate={{ opacity: 1, y: 0 }}
          exit={{ opacity: 0, y: -11 }}
          transition={{ duration: 0.2 }}
        >
          {text}
          {reference && !pending && <small>#{value.objectId}</small>}
        </motion.span>
      </AnimatePresence>
      {reference && !pending && (
        <span
          className="reference-port"
          aria-label={`Points to ${value.objectId}`}
        />
      )}
    </div>
  );
}
