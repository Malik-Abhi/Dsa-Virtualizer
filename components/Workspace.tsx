"use client";
import Link from "next/link";
import { useCallback, useEffect, useRef, useState } from "react";
import { AnimatePresence, motion, MotionConfig } from "motion/react";
import {
  Braces,
  Workflow,
  ChevronDown,
  ArrowUpRight,
  BookOpen,
  Sun,
  Moon,
  Settings2,
  Code2,
  Play,
  RotateCcw,
  Trash2,
  ArrowRight,
  X,
  Check,
  CircleAlert,
  Command,
  Search,
  Sparkles,
  Terminal,
  ShieldCheck,
  Save,
  Bookmark,
  ArrowDown,
} from "lucide-react";
import CodeEditor from "./editor/CodeEditor";
import Canvas from "./visualization/Canvas";
import Controls from "./execution/Controls";
import ConsoleOutput from "./execution/ConsoleOutput";
import { examples, pythonExample, type Example } from "@/lib/examples";
import { javascriptAdapter, pythonAdapter } from "@/lib/execution/adapters";
import type { ExecutionResult, Language } from "@/types/execution";
import {
  SAVED_CODE_KEY,
  parseSavedCode,
  type SavedCode,
} from "@/lib/saved-code";
export default function Workspace() {
  const [source, setSource] = useState(examples[0].code);
  const currentSource = useRef(examples[0].code);
  const [language, setLanguage] = useState<Language>("javascript");
  const [example, setExample] = useState(examples[0]);
  const [result, setResult] = useState<ExecutionResult>();
  const [index, setIndex] = useState(0);
  const [runVersion, setRunVersion] = useState(0);
  const [playing, setPlaying] = useState(false);
  const [loading, setLoading] = useState(false);
  const [speed, setSpeed] = useState(1);
  const [dark, setDark] = useState(false);
  const [modal, setModal] = useState<
    "examples" | "guide" | "settings" | "save" | "saved" | null
  >(null);
  const [search, setSearch] = useState("");
  const [tab, setTab] = useState<"workspace" | "examples" | "saved">(
    "workspace",
  );
  const [savedCodes, setSavedCodes] = useState<SavedCode[]>([]);
  const [activeSavedId, setActiveSavedId] = useState<string | null>(null);
  const [saveName, setSaveName] = useState("");
  const [storageReady, setStorageReady] = useState(false);
  const [storageError, setStorageError] = useState("");
  const [saveNotice, setSaveNotice] = useState("");
  const [deletedCode, setDeletedCode] = useState<SavedCode | null>(null);
  const activeSaved = savedCodes.find((item) => item.id === activeSavedId);
  const hasUnsavedChanges =
    !!activeSaved &&
    (source !== activeSaved.source || language !== activeSaved.language);
  useEffect(() => {
    try {
      const items = parseSavedCode(localStorage.getItem(SAVED_CODE_KEY));
      // Browser storage is restored only after hydration.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSavedCodes(items);
      setStorageReady(true);
    } catch {
      setStorageError(
        "Your saved code could not be read. Check browser storage and reload to try again.",
      );
    }
  }, []);
  const persistSaved = (items: SavedCode[]) => {
    if (!storageReady) return false;
    try {
      localStorage.setItem(SAVED_CODE_KEY, JSON.stringify(items));
      setSavedCodes(items);
      setStorageError("");
      return true;
    } catch {
      setStorageError(
        "Could not save locally. Browser storage may be full or unavailable. Your editor code is still here.",
      );
      return false;
    }
  };
  const openSave = () => {
    setSaveName(
      activeSaved?.name ??
        (language === "javascript" ? example.name : "Python algorithm"),
    );
    setSaveNotice("");
    setModal("save");
  };
  const saveCode = (asCopy = false) => {
    const name = saveName.trim();
    if (!name || !source.trim()) return;
    const item: SavedCode = {
      id: !asCopy && activeSaved ? activeSaved.id : crypto.randomUUID(),
      name,
      source: currentSource.current,
      language,
      updatedAt: new Date().toISOString(),
    };
    if (
      !persistSaved([
        item,
        ...savedCodes.filter((entry) => entry.id !== item.id),
      ])
    )
      return;
    setActiveSavedId(item.id);
    setSaveNotice(`Saved “${name}” locally.`);
    setModal(null);
    setTab("workspace");
  };
  const openSavedCode = (item: SavedCode) => {
    currentSource.current = item.source;
    setSource(item.source);
    setLanguage(item.language);
    setActiveSavedId(item.id);
    invalidate();
    setModal(null);
    setTab("workspace");
    setSaveNotice(`Opened “${item.name}”.`);
  };
  const [editorWidth, setEditorWidth] = useState(34);
  const [compact, setCompact] = useState(false);
  const goToLine = useRef<((line: number) => void) | null>(null);
  const dialog = useRef<HTMLElement | null>(null);
  const runId = useRef(0);
  const resizeStart = useRef<{
    x: number;
    width: number;
    total: number;
  } | null>(null);
  const split = useRef<HTMLDivElement>(null);
  const step = result?.steps[index];
  const count = result?.steps.length ?? 0;
  const complete = step?.event === "complete";
  useEffect(() => {
    const theme = localStorage.getItem("dsa-theme");
    // Restore browser storage after hydration so server and client markup agree.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (theme === "dark") setDark(true);
  }, []);
  useEffect(() => {
    document.documentElement.dataset.theme = dark ? "dark" : "light";
  }, [dark]);
  const toggleTheme = () => {
    setDark((d) => {
      localStorage.setItem("dsa-theme", d ? "light" : "dark");
      return !d;
    });
  };
  const invalidate = useCallback(() => {
    runId.current++;
    setResult(undefined);
    setIndex(0);
    setPlaying(false);
    setLoading(false);
  }, []);
  const edit = (value: string) => {
    if (value === currentSource.current) return;
    setSaveNotice("");
    currentSource.current = value;
    setSource(value);
    invalidate();
  };
  const changeLanguage = (value: Language) => {
    setActiveSavedId(null);
    setSaveNotice("");
    setLanguage(value);
    currentSource.current = value === "python" ? pythonExample : example.code;
    setSource(currentSource.current);
    invalidate();
  };
  const selectExample = (item: Example) => {
    setActiveSavedId(null);
    setSaveNotice("");
    setExample(item);
    currentSource.current = item.code;
    setSource(item.code);
    setLanguage("javascript");
    invalidate();
    setModal(null);
    setTab("workspace");
  };
  const run = useCallback(async () => {
    if (loading) return;
    const id = ++runId.current;
    setRunVersion((v) => v + 1);
    setPlaying(false);
    setResult(undefined);
    setIndex(0);
    setLoading(true);
    const adapter =
      language === "javascript" ? javascriptAdapter : pythonAdapter;
    const [data] = await Promise.all([
      adapter.execute(currentSource.current),
      new Promise((resolve) => setTimeout(resolve, 700)),
    ]);
    if (id !== runId.current) return;
    setResult(data);
    setLoading(false);
  }, [language, loading]);
  const seek = useCallback(
    (next: number) => {
      setPlaying(false);
      setIndex(Math.max(0, Math.min(count - 1, next)));
    },
    [count],
  );
  const play = useCallback(() => {
    if (!count) return;
    if (index >= count - 1) setIndex(0);
    setPlaying((p) => !p);
  }, [count, index]);
  useEffect(() => {
    if (!playing) return;
    const timer = setInterval(() => {
      setIndex((i) => {
        if (i >= count - 1) {
          setPlaying(false);
          return i;
        }
        return i + 1;
      });
    }, 800 / speed);
    return () => clearInterval(timer);
  }, [playing, count, speed]);
  useEffect(() => {
    const key = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (
        target.closest(".monaco-editor, .memory-node") ||
        ["INPUT", "TEXTAREA", "SELECT"].includes(target.tagName) ||
        modal
      )
        return;
      if (e.code === "Space") {
        e.preventDefault();
        play();
      }
      if (e.key === "ArrowRight") {
        e.preventDefault();
        seek(index + 1);
      }
      if (e.key === "ArrowLeft") {
        e.preventDefault();
        seek(index - 1);
      }
      if ((e.metaKey || e.ctrlKey) && e.key === "Enter") {
        e.preventDefault();
        void run();
      }
    };
    window.addEventListener("keydown", key);
    return () => window.removeEventListener("keydown", key);
  }, [play, seek, index, run, modal]);
  useEffect(() => {
    if (!modal) return;
    const prior = document.activeElement as HTMLElement | null;
    dialog.current?.querySelector<HTMLElement>("button")?.focus();
    const key = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        setModal(null);
        setTab("workspace");
      }
      if (e.key === "Tab") {
        const nodes = dialog.current?.querySelectorAll<HTMLElement>(
          'button:not(:disabled), input, select, [tabindex=\"0\"]',
        );
        if (!nodes?.length) return;
        const first = nodes[0],
          last = nodes[nodes.length - 1];
        if (e.shiftKey && document.activeElement === first) {
          e.preventDefault();
          last.focus();
        } else if (!e.shiftKey && document.activeElement === last) {
          e.preventDefault();
          first.focus();
        }
      }
    };
    window.addEventListener("keydown", key);
    return () => {
      window.removeEventListener("keydown", key);
      prior?.focus();
    };
  }, [modal]);
  return (
    <MotionConfig reducedMotion="user">
      <div className={`app ${compact ? "compact" : ""}`}>
        <header className="topbar">
          <Link className="brand" href="/" aria-label="DSA Virtualizer home">
            <span className="brand-mark">
              <Workflow size={21} />
            </span>
            <span>
              DSA <strong>Virtualizer</strong>
            </span>
            <span className="beta-tag">BETA</span>
          </Link>
          <nav aria-label="Main navigation">
            <button
              className={tab === "workspace" ? "nav-active" : ""}
              onClick={() => {
                setTab("workspace");
                setModal(null);
              }}
            >
              <Code2 size={14} /> Workspace
            </button>
            <button
              className={tab === "examples" ? "nav-active" : ""}
              onClick={() => {
                setTab("examples");
                setModal("examples");
              }}
            >
              <BookOpen size={14} /> Examples
            </button>
            <button
              className={tab === "saved" ? "nav-active" : ""}
              onClick={() => {
                setTab("saved");
                setSearch("");
                setModal("saved");
              }}
            >
              <Bookmark size={14} /> Saved
              {savedCodes.length > 0 && (
                <span className="saved-count">{savedCodes.length}</span>
              )}
            </button>
          </nav>
          <div className="top-actions">
            <button className="guide-button" onClick={() => setModal("guide")}>
              Quick guide <ArrowUpRight size={13} />
            </button>
            <span className="top-divider" />
            <button
              className="icon-button"
              aria-label={
                dark ? "Switch to light theme" : "Switch to dark theme"
              }
              onClick={toggleTheme}
            >
              {dark ? <Sun size={17} /> : <Moon size={17} />}
            </button>
            <button
              className="icon-button"
              aria-label="Workspace settings"
              onClick={() => setModal("settings")}
            >
              <Settings2 size={17} />
            </button>
          </div>
        </header>
        <main className="main">
          <section className="workspace-heading">
            <div>
              <div className="eyebrow">
                <span /> THE ALGORITHM WORKSPACE
              </div>
              <h1>A little code. A lot of clarity.</h1>
              <p>Write it. Run it. Understand every step.</p>
            </div>
            <button
              className="example-button"
              onClick={() => setModal("examples")}
            >
              <BookOpen size={15} />
              <span>Explore examples</span>
              <ArrowRight size={15} />
            </button>
          </section>
          <ConsoleOutput step={step} result={result} language={language} />
          <div className="workspace-shell">
            <div
              className="workspace-body"
              ref={split}
              style={
                { "--editor-width": `${editorWidth}%` } as React.CSSProperties
              }
            >
              <section
                className={`editor-panel ${loading ? "editor-busy" : ""}`}
              >
                <div className="panel-heading">
                  <span>
                    <Code2 size={15} /> CODE EDITOR
                  </span>
                  <div className="language-select">
                    <span
                      className={
                        language === "javascript" ? "js-badge" : "py-badge"
                      }
                    >
                      {language === "javascript" ? "JS" : "PY"}
                    </span>
                    <select
                      aria-label="Code language"
                      value={language}
                      disabled={loading}
                      onChange={(e) =>
                        changeLanguage(e.target.value as Language)
                      }
                    >
                      <option value="javascript">JavaScript</option>
                      <option value="python">Python</option>
                    </select>
                    <ChevronDown size={12} />
                  </div>
                </div>
                <div className="file-bar">
                  <span className="file-tab">
                    <span
                      className={
                        language === "javascript" ? "file-js" : "file-py"
                      }
                    >
                      {language === "javascript" ? "JS" : "PY"}
                    </span>
                    <span className="file-name" title={activeSaved?.name}>
                      {activeSaved?.name ??
                        (language === "javascript"
                          ? "algorithm.js"
                          : "algorithm.py")}
                    </span>
                    {(!activeSaved || hasUnsavedChanges) && (
                      <span className="file-dot" title="Unsaved changes" />
                    )}
                  </span>
                  <div>
                    <button
                      aria-label="Save code"
                      title="Save code locally"
                      disabled={loading || !source.trim()}
                      onClick={openSave}
                    >
                      <Save size={14} />
                    </button>
                    <button
                      aria-label="Reset code to example"
                      title="Reset code"
                      disabled={loading}
                      onClick={() =>
                        edit(
                          language === "javascript"
                            ? example.code
                            : pythonExample,
                        )
                      }
                    >
                      <RotateCcw size={13} />
                    </button>
                    <button
                      aria-label="Clear code"
                      title="Clear code"
                      disabled={loading}
                      onClick={() => edit("")}
                    >
                      <Trash2 size={13} />
                    </button>
                  </div>
                </div>
                <div className="editor-area">
                  <CodeEditor
                    source={source}
                    onChange={edit}
                    language={language}
                    dark={dark}
                    line={step?.line}
                    error={result?.error}
                    onRun={() => void run()}
                    busy={loading}
                    onReady={(go) => {
                      goToLine.current = go;
                    }}
                  />
                </div>
                <div className="editor-footer">
                  <div>
                    <ShieldCheck size={12} />
                    <span>
                      {language === "javascript"
                        ? "Isolated JavaScript runtime"
                        : "Isolated Python runtime"}
                    </span>
                    <span>UTF-8</span>
                  </div>
                  <button
                    className="run-button"
                    disabled={loading || !source.trim()}
                    onClick={() => void run()}
                  >
                    {loading ? (
                      <span className="run-loading" />
                    ) : (
                      <Play size={14} fill="currentColor" />
                    )}
                    {loading ? "Building timeline…" : "Start Virtualizing"}
                    <kbd>⌘ ↵</kbd>
                  </button>
                  <p role="status">
                    {saveNotice ||
                      (hasUnsavedChanges
                        ? "Unsaved changes · save to update your snippet"
                        : "Your code. One operation at a time.")}
                  </p>
                </div>
              </section>
              <div
                className="resize-handle"
                role="separator"
                aria-label="Resize editor"
                aria-orientation="vertical"
                tabIndex={0}
                onKeyDown={(e) => {
                  if (e.key === "ArrowLeft")
                    setEditorWidth((w) => Math.max(28, w - 2));
                  if (e.key === "ArrowRight")
                    setEditorWidth((w) => Math.min(55, w + 2));
                }}
                onPointerDown={(e) => {
                  resizeStart.current = {
                    x: e.clientX,
                    width: editorWidth,
                    total: split.current?.clientWidth ?? 1000,
                  };
                  e.currentTarget.setPointerCapture(e.pointerId);
                }}
                onPointerMove={(e) => {
                  const start = resizeStart.current;
                  if (start)
                    setEditorWidth(
                      Math.max(
                        28,
                        Math.min(
                          55,
                          start.width +
                            ((e.clientX - start.x) / start.total) * 100,
                        ),
                      ),
                    );
                }}
                onPointerUp={() => {
                  resizeStart.current = null;
                }}
                onPointerCancel={() => {
                  resizeStart.current = null;
                }}
              />
              <section className="visualization-panel">
                <div className="panel-heading">
                  <span>
                    <Workflow size={15} /> VISUALIZATION
                  </span>
                  <span
                    className={`execution-badge ${complete ? "complete" : ""}`}
                  >
                    <span />
                    {loading
                      ? "Processing"
                      : result?.error
                        ? "Needs attention"
                        : complete
                          ? "Completed"
                          : playing
                            ? "Playing"
                            : step
                              ? "Paused"
                              : "Ready to run"}
                  </span>
                </div>
                <Canvas
                  key={runVersion}
                  step={step}
                  loading={loading}
                  hasTimeline={count > 0}
                  error={result?.error}
                />
                <div
                  className={`step-explanation ${result?.error ? "explanation-error" : ""}`}
                  aria-live="polite"
                >
                  <div className="explanation-icon">
                    {result?.error ? (
                      <CircleAlert size={17} />
                    ) : complete ? (
                      <Check size={17} />
                    ) : (
                      <Sparkles size={17} />
                    )}
                  </div>
                  <div>
                    {result?.error ? (
                      <>
                        <strong>
                          {result.error.kind === "unsupported"
                            ? "Execution not supported"
                            : `Check line ${result.error.line}`}
                        </strong>
                        <p>{result.error.message}</p>
                        <button
                          className="error-line-button"
                          onClick={() => goToLine.current?.(result.error!.line)}
                        >
                          Go to line {result.error.line}{" "}
                          <ArrowUpRight size={11} />
                        </button>
                        <details>
                          <summary>Technical details</summary>
                          <code>{result.error.details}</code>
                        </details>
                      </>
                    ) : (
                      <>
                        <span>
                          {step
                            ? complete
                              ? "EXECUTION COMPLETE"
                              : `STEP ${step.step} · LINE ${step.line}`
                            : "A FRONT-ROW SEAT TO YOUR LOGIC"}
                        </span>
                        <p>
                          {step?.description ??
                            "Run your code to see what happens, and why."}
                        </p>
                        {!!(step?.conditionOperands ?? step?.assignmentOperands)
                          ?.length && (
                          <div
                            className="condition-operands"
                            aria-label={
                              step?.conditionOperands
                                ? "Evaluated condition values"
                                : "Evaluated assignment values"
                            }
                          >
                            {(step.conditionOperands ??
                              step.assignmentOperands)!.map(
                              (operand, operandIndex) => (
                                <div
                                  className="condition-operand"
                                  key={`${operand.expression}:${operandIndex}`}
                                >
                                  <code title={operand.expression}>
                                    {operand.expression}
                                  </code>
                                  <ArrowDown size={12} aria-hidden="true" />
                                  <code
                                    className="condition-operand-value"
                                    title={operand.value}
                                  >
                                    {operand.value}
                                  </code>
                                </div>
                              ),
                            )}
                          </div>
                        )}
                        {complete && (
                          <small>
                            {count} recorded steps ·{" "}
                            {result?.duration.toFixed(1)} ms
                          </small>
                        )}
                      </>
                    )}
                  </div>
                  {step && !result?.error && !complete && (
                    <span className="event-tag">{step.event}</span>
                  )}
                </div>
              </section>
            </div>
            <Controls
              index={index}
              count={count}
              playing={playing}
              speed={speed}
              onIndex={seek}
              onPlay={play}
              onSpeed={setSpeed}
              disabled={loading}
            />
          </div>
          <div className="workspace-bottom">
            <span>
              <span className="status-dot active" /> All execution stays on your
              device
            </span>
            <span>
              Built for the curious. <span className="bottom-spark">✦</span> See
              your code think.
            </span>
            <button onClick={() => setModal("guide")}>
              <Command size={12} /> Keyboard shortcuts
            </button>
          </div>
        </main>
        <AnimatePresence>
          {modal && (
            <motion.div
              className="modal-backdrop"
              initial={{ opacity: 0 }}
              animate={{ opacity: 1 }}
              exit={{ opacity: 0 }}
              onClick={() => {
                setModal(null);
                setTab("workspace");
              }}
            >
              <motion.section
                ref={dialog}
                className={`modal ${modal === "examples" ? "examples-modal" : ""}`}
                role="dialog"
                aria-modal="true"
                aria-label={
                  modal === "save"
                    ? "Save code locally"
                    : modal === "saved"
                      ? "Saved code"
                      : modal === "examples"
                        ? "Example library"
                        : modal === "guide"
                          ? "Quick guide"
                          : "Workspace settings"
                }
                initial={{ opacity: 0, y: 15, scale: 0.98 }}
                animate={{ opacity: 1, y: 0, scale: 1 }}
                exit={{ opacity: 0, y: 15 }}
                onClick={(e) => e.stopPropagation()}
              >
                <button
                  className="modal-close icon-button"
                  aria-label="Close dialog"
                  onClick={() => {
                    setModal(null);
                    setTab("workspace");
                  }}
                >
                  <X size={19} />
                </button>
                {modal === "save" ? (
                  <>
                    <span className="eyebrow">KEEP YOUR THINKING</span>
                    <h2>
                      {activeSaved ? "Update saved code" : "Save your code"}
                    </h2>
                    <p>
                      Name this{" "}
                      {language === "python" ? "Python" : "JavaScript"} snippet.
                      It stays in this browser on this device.
                    </p>
                    <form
                      className="save-code-form"
                      onSubmit={(e) => {
                        e.preventDefault();
                        saveCode();
                      }}
                    >
                      <label htmlFor="saved-code-name">Snippet name</label>
                      <input
                        id="saved-code-name"
                        value={saveName}
                        maxLength={80}
                        required
                        onChange={(e) => setSaveName(e.target.value)}
                        placeholder="e.g. Even-index prefix sum"
                      />
                      {storageError && (
                        <p className="saved-error" role="alert">
                          {storageError}
                        </p>
                      )}
                      <div className="save-code-actions">
                        <button
                          type="submit"
                          className="secondary-button save-primary"
                          disabled={
                            !storageReady || !saveName.trim() || !source.trim()
                          }
                        >
                          <Save size={15} />
                          {activeSaved ? "Update code" : "Save code"}
                        </button>
                        {activeSaved && (
                          <button
                            type="button"
                            className="secondary-button"
                            disabled={!storageReady || !saveName.trim()}
                            onClick={() => saveCode(true)}
                          >
                            Save a copy
                          </button>
                        )}
                      </div>
                    </form>
                  </>
                ) : modal === "saved" ? (
                  <>
                    <span className="eyebrow">YOUR LOCAL LIBRARY</span>
                    <h2>Saved code</h2>
                    <p>
                      Reopen your named snippets. Stored in this browser on this
                      device.
                    </p>
                    <label className="example-search">
                      <Search size={16} />
                      <input
                        aria-label="Search saved code"
                        placeholder="Find a saved snippet…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                    </label>
                    {storageError && (
                      <p className="saved-error" role="alert">
                        {storageError}
                      </p>
                    )}
                    <div className="saved-code-list">
                      {savedCodes
                        .filter((item) =>
                          `${item.name} ${item.language}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        )
                        .map((item) => (
                          <div className="saved-code-row" key={item.id}>
                            <button
                              className="saved-code-open"
                              onClick={() => openSavedCode(item)}
                              aria-label={`Open ${item.name}`}
                            >
                              <Code2 size={18} />
                              <span>
                                <strong>{item.name}</strong>
                                <small>
                                  {item.language === "python"
                                    ? "Python"
                                    : "JavaScript"}{" "}
                                  ·{" "}
                                  {new Date(
                                    item.updatedAt,
                                  ).toLocaleDateString()}
                                </small>
                              </span>
                              <ArrowUpRight size={15} />
                            </button>
                            <button
                              className="icon-button"
                              aria-label={`Delete ${item.name}`}
                              title="Delete saved snippet"
                              onClick={() => {
                                if (
                                  persistSaved(
                                    savedCodes.filter(
                                      (entry) => entry.id !== item.id,
                                    ),
                                  )
                                ) {
                                  setDeletedCode(item);
                                  if (activeSavedId === item.id)
                                    setActiveSavedId(null);
                                }
                              }}
                            >
                              <Trash2 size={14} />
                            </button>
                          </div>
                        ))}
                      {!savedCodes.length && (
                        <div className="saved-empty">
                          <Bookmark size={26} />
                          <strong>Your next idea belongs here.</strong>
                          <p>
                            Use the save icon above the editor to name and keep
                            your code.
                          </p>
                          <button
                            className="secondary-button"
                            disabled={!source.trim()}
                            onClick={openSave}
                          >
                            <Save size={14} />
                            Save current code
                          </button>
                        </div>
                      )}
                      {!!savedCodes.length &&
                        !savedCodes.some((item) =>
                          `${item.name} ${item.language}`
                            .toLowerCase()
                            .includes(search.toLowerCase()),
                        ) && (
                          <p className="saved-empty">
                            No snippets match your search.
                          </p>
                        )}
                    </div>
                    {deletedCode && (
                      <div className="saved-undo" role="status">
                        <span>Deleted “{deletedCode.name}”.</span>
                        <button
                          onClick={() => {
                            if (
                              persistSaved([
                                deletedCode,
                                ...savedCodes.filter(
                                  (item) => item.id !== deletedCode.id,
                                ),
                              ])
                            )
                              setDeletedCode(null);
                          }}
                        >
                          Undo
                        </button>
                      </div>
                    )}
                    <div className="modal-note">
                      Saving an open snippet updates it. Choose “Save a copy” to
                      keep another version.
                    </div>
                  </>
                ) : modal === "examples" ? (
                  <>
                    <span className="eyebrow">LEARN BY DOING</span>
                    <h2>Small programs. Big insights.</h2>
                    <p>Pick an algorithm and follow its thinking.</p>
                    <label className="example-search">
                      <Search size={16} />
                      <input
                        aria-label="Search examples"
                        placeholder="Search algorithms…"
                        value={search}
                        onChange={(e) => setSearch(e.target.value)}
                      />
                      <kbd>esc</kbd>
                    </label>
                    <div className="example-list">
                      {[...new Set(examples.map((e) => e.category))].map(
                        (category) => {
                          const items = examples.filter(
                            (e) =>
                              e.category === category &&
                              `${e.name} ${e.category}`
                                .toLowerCase()
                                .includes(search.toLowerCase()),
                          );
                          return items.length ? (
                            <div key={category}>
                              <h3>{category}</h3>
                              {items.map((item) => (
                                <button
                                  key={item.id}
                                  onClick={() => selectExample(item)}
                                >
                                  <span className="example-symbol">
                                    <Braces size={17} />
                                  </span>
                                  <span>
                                    <strong>{item.name}</strong>
                                    <small>{item.description}</small>
                                  </span>
                                  <ArrowUpRight size={15} />
                                </button>
                              ))}
                            </div>
                          ) : null;
                        },
                      )}
                      {!examples.some((e) =>
                        `${e.name} ${e.category}`
                          .toLowerCase()
                          .includes(search.toLowerCase()),
                      ) && <p>No examples found. Try “sort” or “array”.</p>}
                    </div>
                    <div className="modal-note">
                      Lists and trees use connected heap nodes. JavaScript
                      examples execute in the supported subset.
                    </div>
                  </>
                ) : modal === "guide" ? (
                  <>
                    <span className="eyebrow">YOUR FIRST RUN</span>
                    <h2>Follow the logic.</h2>
                    <p>See exactly what changes at every step.</p>
                    <div className="guide-steps">
                      <div>
                        <span>01</span>
                        <section>
                          <h3>Make it yours</h3>
                          <p>
                            Edit the JavaScript or Python starter, or choose an
                            example.
                          </p>
                        </section>
                      </div>
                      <div>
                        <span>02</span>
                        <section>
                          <h3>Build the timeline</h3>
                          <p>
                            Click Start Virtualizing. The isolated interpreter
                            records real execution states.
                          </p>
                        </section>
                      </div>
                      <div>
                        <span>03</span>
                        <section>
                          <h3>Explore every operation</h3>
                          <p>
                            Step through the code, inspect variables and console
                            output, or press play. Drag structures and zoom to
                            explore.
                          </p>
                        </section>
                      </div>
                    </div>
                    <div className="shortcut-list">
                      <span>
                        <kbd>⌘ / Ctrl</kbd> + <kbd>Enter</kbd> Run code
                      </span>
                      <span>
                        <kbd>Space</kbd> Play / pause
                      </span>
                      <span>
                        <kbd>←</kbd> <kbd>→</kbd> Step backward / forward
                      </span>
                    </div>
                    <div className="modal-note">
                      <strong>Supported JavaScript</strong>
                      <br />
                      let / const, arrays, objects, loops, conditions,
                      functions, recursion, destructuring, common array and
                      string methods, Math and console.log. Imports, classes,
                      async code, DOM/network APIs and arbitrary native
                      functions are unavailable in JavaScript. Python supports
                      core built-ins, loops, functions, lists, and dictionaries;
                      basic classes and instance methods are supported; imports,
                      inheritance, and decorators are unavailable.
                    </div>
                  </>
                ) : (
                  <>
                    <span className="eyebrow">
                      MAKE SPACE FOR YOUR THINKING
                    </span>
                    <h2>Workspace settings</h2>
                    <p>A few preferences for your next insight.</p>
                    <div className="setting-row">
                      <span>
                        <strong>Appearance</strong>
                        <small>Saved across visits</small>
                      </span>
                      <button
                        className="secondary-button"
                        onClick={toggleTheme}
                      >
                        {dark ? <Sun size={15} /> : <Moon size={15} />}{" "}
                        {dark ? "Dark" : "Light"}
                      </button>
                    </div>
                    <div className="setting-row">
                      <span>
                        <strong>Compact spacing</strong>
                        <small>A little more room for your code</small>
                      </span>
                      <button
                        role="switch"
                        aria-checked={compact}
                        aria-label="Compact spacing"
                        className={`toggle ${compact ? "on" : ""}`}
                        onClick={() => setCompact((c) => !c)}
                      >
                        <span />
                      </button>
                    </div>
                    <div className="setting-row">
                      <span>
                        <strong>Default playback speed</strong>
                        <small>Applied to this workspace</small>
                      </span>
                      <select
                        aria-label="Default playback speed"
                        value={speed}
                        onChange={(e) => setSpeed(Number(e.target.value))}
                      >
                        {[0.5, 1, 2, 4].map((v) => (
                          <option key={v} value={v}>
                            {v}×
                          </option>
                        ))}
                      </select>
                    </div>
                    <div className="modal-note">
                      <Terminal size={15} /> JavaScript & Python · 2,500 steps ·
                      4 second time limit
                      <br />
                      Motion follows your device’s reduced-motion preference.
                    </div>
                  </>
                )}
              </motion.section>
            </motion.div>
          )}
        </AnimatePresence>
      </div>
    </MotionConfig>
  );
}
