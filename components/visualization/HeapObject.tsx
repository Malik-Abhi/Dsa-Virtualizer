"use client";
import { motion, AnimatePresence } from "motion/react";
import { ArrowDown, Braces, Code2, GripVertical } from "lucide-react";
import type {
  HeapObject as ObjectSnapshot,
  MemorySnapshot,
} from "@/types/memory";
import {
  ARRAY_CELL,
  arrayPointerHeight,
  objectRole,
} from "@/lib/visualization/memory-layout";
import MemoryValueBox, { formatMemoryValue } from "./MemoryValueBox";
function ArrayMemory({
  object,
  memory,
}: {
  object: Extract<ObjectSnapshot, { kind: "array" }>;
  memory: MemorySnapshot;
}) {
  const occurrences = new Map<string, number>();
  const items = object.items.slice(0, 24).map((value, index) => {
    const base = JSON.stringify(value),
      count = occurrences.get(base) ?? 0;
    occurrences.set(base, count + 1);
    return { value, index, key: `${base}:${count}` };
  });
  const pointers = memory.pointers.filter(
    (p) => p.objectId === object.id && p.index < 24,
  );
  return (
    <>
      {pointers.length > 0 && (
        <div className="memory-pointer-lane">
          {pointers.map((pointer) => (
            <motion.div
              key={pointer.id}
              className="memory-index-pointer"
              initial={false}
              animate={{
                x:
                  pointer.index * ARRAY_CELL +
                  ARRAY_CELL / 2 +
                  (pointers
                    .filter((p) => p.index === pointer.index)
                    .findIndex((p) => p.id === pointer.id) -
                    (pointers.filter((p) => p.index === pointer.index).length -
                      1) /
                      2) *
                    18,
                y: 0,
              }}
              transition={{ type: "spring", stiffness: 320, damping: 30 }}
              title={`${pointer.name} in ${memory.frames.find((f) => f.id === pointer.frameId)?.name}`}
            >
              <span>{pointer.name}</span>
              <ArrowDown size={14} />
            </motion.div>
          ))}
        </div>
      )}
      <div className="memory-array-table">
        {items.length === 0 ? (
          <div className="memory-empty-array">
            Empty array <code>[]</code>
          </div>
        ) : (
          items.map(({ value, index, key }) => {
            const accessed = memory.accesses.some(
              (a) => a.objectId === object.id && a.property === String(index),
            );
            return (
              <div
                className={`memory-array-column ${accessed ? "array-accessed" : ""} ${object.changedKeys.includes(String(index)) ? "array-mutated" : ""}`}
                key={index}
              >
                <div className="memory-array-index">{index}</div>
                <div
                  className="memory-array-value"
                  title={formatMemoryValue(value)}
                >
                  {value.kind === "reference" ? (
                    <MemoryValueBox value={value} small />
                  ) : (
                    <AnimatePresence initial={false} mode="popLayout">
                      <motion.span
                        layoutId={`${object.id}:item:${key}`}
                        key={key}
                        initial={{ opacity: 0, y: 8 }}
                        animate={{ opacity: 1, y: 0 }}
                        exit={{ opacity: 0, y: -8 }}
                        transition={{
                          type: "spring",
                          stiffness: 350,
                          damping: 30,
                        }}
                      >
                        {formatMemoryValue(value)}
                      </motion.span>
                    </AnimatePresence>
                  )}
                </div>
              </div>
            );
          })
        )}
      </div>
    </>
  );
}
export default function HeapObject({
  object,
  memory,
}: {
  object: ObjectSnapshot;
  memory: MemorySnapshot;
}) {
  const label = object.kind === "function" ? object.name : objectRole(object);
  return (
    <section
      className={`heap-object heap-${object.kind} ${object.kind === "array" && arrayPointerHeight(object.id, memory) ? "has-pointers" : ""}`}
      aria-label={`${label} ${object.id}`}
    >
      {object.kind === "array" ? (
        <div
          className="array-caption"
          title={`${object.items.length} elements${object.items.length > 24 ? " · first 24 shown" : ""}`}
        >
          <span>
            Array <span className="heap-identity">#{object.id}</span>
          </span>
          {object.items.length > 24 && <span>24/{object.items.length}</span>}
          <GripVertical size={11} />
        </div>
      ) : (
        <header className="memory-node-header">
          <span className="memory-node-icon">
            {object.kind === "function" ? (
              <Code2 size={15} />
            ) : (
              <Braces size={15} />
            )}
          </span>
          <strong title={label}>{label}</strong>
          <span className="heap-identity">#{object.id}</span>
          <GripVertical size={13} />
        </header>
      )}
      {object.kind === "array" ? (
        <ArrayMemory object={object} memory={memory} />
      ) : object.kind === "function" ? (
        <div className="function-memory">
          <code>
            {object.name}({object.parameters.join(", ")})
          </code>
          <span>Defined on line {object.line}</span>
          <span className="function-badge">function object</span>
        </div>
      ) : (
        <div className="heap-properties">
          {object.properties.length === 0 ? (
            <div className="memory-empty-object">
              No properties <code>{"{}"}</code>
            </div>
          ) : (
            object.properties.map((property) => (
              <div
                className={`heap-property ${memory.accesses.some((a) => a.objectId === object.id && a.property === property.name) ? "property-accessed" : ""}`}
                key={property.name}
              >
                <span title={property.name}>{property.name}</span>
                <MemoryValueBox
                  value={property.value}
                  changed={object.changedKeys.includes(property.name)}
                  small
                />
              </div>
            ))
          )}
        </div>
      )}
    </section>
  );
}
