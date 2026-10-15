"use client";
import { AnimatePresence, motion } from "motion/react";
import {
  Minus,
  Plus,
  Scan,
  Move,
  MousePointer2,
  CircleAlert,
  ArrowRight,
  Layers3,
} from "lucide-react";
import { useEffect, useMemo, useRef, useState } from "react";
import type { ExecutionStep, ExecutionError } from "@/types/execution";
import { layoutMemory, type Point } from "@/lib/visualization/memory-layout";
import RuntimeFrame from "./RuntimeFrame";
import HeapObject from "./HeapObject";
import ReferenceArrows from "./ReferenceArrows";
export default function Canvas({
  step,
  loading,
  hasTimeline,
  error,
}: {
  step?: ExecutionStep;
  loading: boolean;
  hasTimeline: boolean;
  error?: ExecutionError;
}) {
  const container = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ width: 800, height: 540 });
  const [camera, setCamera] = useState<{ zoom: number; pan: Point } | null>(
    null,
  );
  const [offsets, setOffsets] = useState<Record<string, Point>>({});
  const [selected, setSelected] = useState<string>();
  const [dragging, setDragging] = useState<string>();
  const gesture = useRef<{
    kind: "pan" | "node";
    id?: string;
    x: number;
    y: number;
    origin: Point;
    zoom: number;
  } | null>(null);
  useEffect(() => {
    const element = container.current;
    if (!element) return;
    const observer = new ResizeObserver(([entry]) =>
      setSize({
        width: entry.contentRect.width,
        height: entry.contentRect.height,
      }),
    );
    observer.observe(element);
    return () => observer.disconnect();
  }, []);
  const memory = step?.memory;
  const layout = useMemo(
    () =>
      memory
        ? layoutMemory(memory)
        : { nodes: [], edges: [], width: 760, height: 340 },
    [memory],
  );
  const fittedZoom = Math.min(
    1,
    Math.max(
      0.15,
      Math.min(
        (size.width - 28) / layout.width,
        (size.height - 92) / layout.height,
      ),
    ),
  );
  const view = camera ?? {
    zoom: fittedZoom,
    pan: {
      x: (size.width - layout.width * fittedZoom) / 2,
      y: 46 + (size.height - 92 - layout.height * fittedZoom) / 2,
    },
  };
  const positions = new Map(
    layout.nodes.map((node) => [
      node.id,
      {
        x: node.x + (offsets[node.id]?.x ?? 0),
        y: node.y + (offsets[node.id]?.y ?? 0),
      },
    ]),
  );
  const frames = new Map(
    memory?.frames.map((frame) => [`frame:${frame.id}`, frame]),
  );
  const heap = new Map(
    memory?.heap.map((object) => [`heap:${object.id}`, object]),
  );
  function zoomBy(delta: number) {
    const zoom = Math.max(0.15, Math.min(2, view.zoom + delta)),
      ratio = zoom / view.zoom;
    setCamera({
      zoom,
      pan: {
        x: size.width / 2 - (size.width / 2 - view.pan.x) * ratio,
        y: size.height / 2 - (size.height / 2 - view.pan.y) * ratio,
      },
    });
  }
  function beginNode(e: React.PointerEvent, id: string) {
    if (e.button !== 0) return;
    e.stopPropagation();
    e.currentTarget.setPointerCapture(e.pointerId);
    gesture.current = {
      kind: "node",
      id,
      x: e.clientX,
      y: e.clientY,
      origin: offsets[id] ?? { x: 0, y: 0 },
      zoom: view.zoom,
    };
    setCamera(view);
    setDragging(id);
    setSelected(id);
  }
  function move(e: React.PointerEvent) {
    const g = gesture.current;
    if (!g) return;
    const delta = { x: e.clientX - g.x, y: e.clientY - g.y };
    if (g.kind === "pan")
      setCamera({
        zoom: g.zoom,
        pan: { x: g.origin.x + delta.x, y: g.origin.y + delta.y },
      });
    else if (g.id)
      setOffsets((old) => ({
        ...old,
        [g.id!]: {
          x: g.origin.x + delta.x / g.zoom,
          y: g.origin.y + delta.y / g.zoom,
        },
      }));
  }
  function stop() {
    gesture.current = null;
    setDragging(undefined);
  }
  function reset() {
    setCamera(null);
    setOffsets({});
    setSelected(undefined);
  }
  return (
    <div
      ref={container}
      className={`canvas memory-canvas ${loading ? "canvas-processing" : ""}`}
      onPointerDown={(e) => {
        if (e.target !== e.currentTarget || e.button !== 0) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        gesture.current = {
          kind: "pan",
          x: e.clientX,
          y: e.clientY,
          origin: view.pan,
          zoom: view.zoom,
        };
        setSelected(undefined);
      }}
      onPointerMove={move}
      onPointerUp={stop}
      onPointerCancel={stop}
    >
      <div className="canvas-topline">
        <span>
          <span className={`status-dot ${step ? "active" : ""}`} />
          {loading
            ? "Preparing memory graph"
            : step
              ? "Runtime memory"
              : "Your runtime, in plain sight"}
        </span>
        <span className="canvas-mode">
          <MousePointer2 size={12} />
          {memory
            ? `${memory.frames.length} frames${memory.loops?.length ? ` · ${memory.loops.length} loops` : ""} · ${memory.heap.length} objects`
            : "Interactive memory canvas"}
        </span>
      </div>
      {!hasTimeline && !loading && !error && (
        <div className="memory-welcome">
          <div className="preview-tag">
            <Layers3 size={12} /> STACK → REFERENCES → HEAP
          </div>
          <h2>
            See your code think<span>.</span>
          </h2>
          <p>
            Variables belong to frames. Objects live on the heap.
            <br />
            Follow the arrows to see how your code connects.
          </p>
          <div
            className="memory-preview"
            aria-label="Illustration of a frame referencing a shared array"
          >
            <div className="preview-frame">
              <strong>Runtime frame</strong>
              <div>
                <span>name</span>
                <i>
                  reference <b>●</b>
                </i>
              </div>
              <div>
                <span>index</span>
                <i>0</i>
              </div>
            </div>
            <ArrowRight className="preview-reference" size={38} />
            <div className="preview-heap">
              <span>Shared array</span>
              <div>
                {[2, 8, 3].map((v, i) => (
                  <section key={i}>
                    <small>{i}</small>
                    <strong>{v}</strong>
                  </section>
                ))}
              </div>
            </div>
          </div>
          <span className="welcome-caption">
            Run your code to build its real memory model.
          </span>
        </div>
      )}
      {error && !hasTimeline && !loading && (
        <div className="memory-welcome canvas-error">
          <CircleAlert size={28} />
          <h2>
            {error.kind === "unsupported"
              ? "This code needs a different runtime"
              : "Let’s check your code"}
          </h2>
          <p>
            Look at the details below, update your source, then run it again.
          </p>
        </div>
      )}
      {memory && (
        <div
          className="memory-world"
          style={{
            width: layout.width,
            height: layout.height,
            transform: `translate(${view.pan.x}px,${view.pan.y}px) scale(${view.zoom})`,
          }}
        >
          <span className="memory-region-label" style={{ left: 24 }}>
            {memory?.loops?.length ? "FRAMES & LOOPS" : "STACK FRAMES"}
          </span>
          <span className="memory-region-label" style={{ left: 360 }}>
            HEAP · SHARED OBJECTS
          </span>
          <ReferenceArrows
            layout={layout}
            positions={positions}
            selected={selected}
            dragging={!!dragging}
          />
          <AnimatePresence initial={false}>
            {layout.nodes.map((node) => {
              const position = positions.get(node.id)!,
                frame = frames.get(node.id),
                object = heap.get(node.id);
              return (
                <motion.div
                  key={node.id}
                  className={`memory-node ${selected === node.id ? "node-selected" : ""} ${dragging === node.id ? "node-dragging" : ""}`}
                  style={{
                    width: node.width,
                    height: node.height,
                    zIndex: dragging === node.id ? 8 : 2,
                  }}
                  initial={{
                    opacity: 0,
                    scale: 0.96,
                    x: position.x,
                    y: position.y,
                  }}
                  animate={{
                    opacity: 1,
                    scale: 1,
                    x: position.x,
                    y: position.y,
                  }}
                  exit={{ opacity: 0, scale: 0.96 }}
                  transition={{ duration: dragging === node.id ? 0 : 0.18 }}
                  onPointerDown={(e) => beginNode(e, node.id)}
                  onPointerMove={(e) => {
                    e.stopPropagation();
                    move(e);
                  }}
                  onPointerUp={(e) => {
                    e.stopPropagation();
                    stop();
                  }}
                  onPointerCancel={stop}
                  role="group"
                  aria-label={`Move ${frame?.name ?? object?.kind} ${frame?.id ?? object?.id}`}
                  tabIndex={0}
                  onKeyDown={(e) => {
                    if (
                      [
                        "ArrowLeft",
                        "ArrowRight",
                        "ArrowUp",
                        "ArrowDown",
                      ].includes(e.key)
                    ) {
                      e.preventDefault();
                      e.stopPropagation();
                      setCamera(view);
                      const amount = e.shiftKey ? 50 : 20;
                      setOffsets((old) => ({
                        ...old,
                        [node.id]: {
                          x:
                            (old[node.id]?.x ?? 0) +
                            (e.key === "ArrowLeft"
                              ? -amount
                              : e.key === "ArrowRight"
                                ? amount
                                : 0),
                          y:
                            (old[node.id]?.y ?? 0) +
                            (e.key === "ArrowUp"
                              ? -amount
                              : e.key === "ArrowDown"
                                ? amount
                                : 0),
                        },
                      }));
                    }
                    if (e.key === "Escape") setSelected(undefined);
                    if (e.key === "Enter") {
                      e.preventDefault();
                      setSelected((s) => (s === node.id ? undefined : node.id));
                    }
                  }}
                >
                  {frame ? (
                    <RuntimeFrame frame={frame} loops={memory?.loops} />
                  ) : object && memory ? (
                    <HeapObject object={object} memory={memory} />
                  ) : null}
                </motion.div>
              );
            })}
          </AnimatePresence>
        </div>
      )}
      <AnimatePresence>
        {loading && (
          <motion.div
            className="processing-overlay"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
          >
            <div className="processing-cubes">
              <i />
              <i />
              <i />
            </div>
            <h3>Building your memory timeline</h3>
            <p>
              Recording frames <span>→</span> Resolving references{" "}
              <span>→</span> Preparing canvas
            </p>
            <div className="processing-track">
              <span />
            </div>
          </motion.div>
        )}
      </AnimatePresence>
      <div className="canvas-bottom">
        <span className="canvas-tip">
          <Move size={12} /> Drag frames & objects · Pan background
        </span>
        <div className="camera-controls">
          <button aria-label="Zoom out" onClick={() => zoomBy(-0.1)}>
            <Minus size={14} />
          </button>
          <span>{Math.round(view.zoom * 100)}%</span>
          <button aria-label="Zoom in" onClick={() => zoomBy(0.1)}>
            <Plus size={14} />
          </button>
          <i />
          <button
            aria-label="Reset camera"
            title="Fit memory graph and reset positions"
            onClick={reset}
          >
            <Scan size={15} />
          </button>
        </div>
      </div>
    </div>
  );
}
