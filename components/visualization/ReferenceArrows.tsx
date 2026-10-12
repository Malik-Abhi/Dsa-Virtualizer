"use client";
import { motion } from "motion/react";
import { useId } from "react";
import {
  edgePath,
  type MemoryLayout,
  type Point,
} from "@/lib/visualization/memory-layout";
export default function ReferenceArrows({
  layout,
  positions,
  selected,
  dragging,
}: {
  layout: MemoryLayout;
  positions: Map<string, Point>;
  selected?: string;
  dragging?: boolean;
}) {
  const marker = useId().replaceAll(":", "");
  const width = Math.max(
      layout.width,
      ...[...positions.values()].map((p) => p.x + 1500),
    ),
    height = Math.max(
      layout.height,
      ...[...positions.values()].map((p) => p.y + 1200),
    );
  return (
    <svg
      className="memory-reference-arrows"
      width={width}
      height={height}
      aria-label="Object reference connections"
    >
      <defs>
        <marker
          id={marker}
          viewBox="0 0 8 8"
          refX="7"
          refY="4"
          markerWidth="7"
          markerHeight="7"
          orient="auto"
        >
          <path d="M 0 0 L 8 4 L 0 8 z" fill="var(--accent)" />
        </marker>
      </defs>
      {layout.edges.map((edge) => {
        const related =
          !selected || edge.source === selected || edge.target === selected;
        return (
          <motion.path
            key={edge.id}
            className={`reference-edge ${edge.changed ? "reference-changed" : ""}`}
            initial={false}
            animate={{
              d: edgePath(edge, positions, layout.nodes),
              opacity: related ? 0.65 : 0.1,
            }}
            transition={{ duration: dragging ? 0 : 0.18 }}
            fill="none"
            stroke="var(--accent)"
            strokeWidth={edge.changed ? 1.8 : 1.4}
            vectorEffect="non-scaling-stroke"
            markerEnd={`url(#${marker})`}
            data-reference={edge.label}
          >
            <title>
              {edge.label} points to {edge.target.replace("heap:", "")}
            </title>
          </motion.path>
        );
      })}
    </svg>
  );
}
