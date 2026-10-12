"use client";
import Editor, { loader, type OnMount } from "@monaco-editor/react";
import type * as Monaco from "monaco-editor";
import { useEffect, useRef } from "react";
import type { ExecutionError, Language } from "@/types/execution";
loader.config({ paths: { vs: "/monaco/vs" } });
export default function CodeEditor({
  source,
  onChange,
  language,
  dark,
  line,
  error,
  onRun,
  busy,
  onReady,
}: {
  source: string;
  onChange: (value: string) => void;
  language: Language;
  dark: boolean;
  line?: number;
  error?: ExecutionError;
  onRun: () => void;
  busy: boolean;
  onReady: (go: (line: number) => void) => void;
}) {
  const editor = useRef<Monaco.editor.IStandaloneCodeEditor | null>(null);
  const api = useRef<typeof Monaco | null>(null);
  const decorations = useRef<Monaco.editor.IEditorDecorationsCollection | null>(
    null,
  );
  const run = useRef(onRun);
  useEffect(() => {
    run.current = onRun;
  }, [onRun]);
  const decorate = () => {
    if (!editor.current || !api.current) return;
    const target = line ?? error?.line;
    decorations.current?.set([
      ...(line
        ? [
            {
              range: new api.current.Range(line, 1, line, 1),
              options: {
                isWholeLine: true,
                className: "code-line-current",
                glyphMarginClassName: "code-glyph-current",
              },
            },
          ]
        : []),
      ...(error
        ? [
            {
              range: new api.current.Range(error.line, 1, error.line, 1),
              options: {
                isWholeLine: true,
                className: "code-line-error",
                glyphMarginClassName: "code-glyph-error",
              },
            },
          ]
        : []),
    ]);
    const model = editor.current.getModel();
    if (model)
      api.current.editor.setModelMarkers(
        model,
        "execution",
        error
          ? [
              {
                startLineNumber: error.line,
                startColumn: 1,
                endLineNumber: error.line,
                endColumn: Math.max(
                  2,
                  model.getLineMaxColumn(
                    Math.min(error.line, model.getLineCount()),
                  ),
                ),
                message: error.message,
                severity: api.current.MarkerSeverity.Error,
              },
            ]
          : [],
      );
    if (target) editor.current.revealLineInCenterIfOutsideViewport(target);
  };
  useEffect(decorate, [line, error]); // Monaco owns imperative decorations.
  const mount: OnMount = (instance, monaco) => {
    editor.current = instance;
    api.current = monaco;
    decorations.current = instance.createDecorationsCollection();
    monaco.editor.defineTheme("virtualizer-light", {
      base: "vs",
      inherit: true,
      rules: [
        { token: "comment", foreground: "92949E", fontStyle: "italic" },
        { token: "keyword", foreground: "8B5BC7" },
        { token: "number", foreground: "B3743D" },
        { token: "string", foreground: "3B8876" },
      ],
      colors: {
        "editor.background": "#FFFFFF",
        "editor.foreground": "#444652",
        "editorLineNumber.foreground": "#C1C2CA",
        "editorLineNumber.activeForeground": "#777381",
        "editor.selectionBackground": "#EDE6FA",
        "editor.lineHighlightBackground": "#F9F8FC",
        "editorCursor.foreground": "#8256CC",
      },
    });
    instance.addCommand(monaco.KeyMod.CtrlCmd | monaco.KeyCode.Enter, () =>
      run.current(),
    );
    onReady((line) => {
      instance.revealLineInCenter(line);
      instance.setPosition({ lineNumber: line, column: 1 });
      instance.focus();
    });
    decorate();
  };
  return (
    <Editor
      height="100%"
      language={language}
      value={source}
      theme={dark ? "vs-dark" : "virtualizer-light"}
      onChange={(value) => onChange(value ?? "")}
      onMount={mount}
      loading={
        <div className="editor-loading">
          <span className="loading-bar" />
          Preparing your editor…
        </div>
      }
      options={{
        readOnly: busy,
        fontSize: 13,
        fontFamily: '"SFMono-Regular", Consolas, "Liberation Mono", monospace',
        lineHeight: 24,
        minimap: { enabled: false },
        scrollBeyondLastLine: false,
        glyphMargin: true,
        folding: false,
        renderLineHighlight: "none",
        padding: { top: 22, bottom: 20 },
        lineNumbersMinChars: 3,
        wordWrap: "on",
        tabSize: 2,
        automaticLayout: true,
        overviewRulerLanes: 0,
        hideCursorInOverviewRuler: true,
        scrollbar: { verticalScrollbarSize: 5, horizontalScrollbarSize: 5 },
        stickyScroll: { enabled: false },
      }}
    />
  );
}
