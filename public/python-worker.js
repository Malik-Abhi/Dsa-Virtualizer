import { loadPyodide } from "/pyodide/pyodide.mjs";

/* Python stays in a dedicated worker; all runtime assets are hosted locally. */
self.onmessage = async ({ data }) => {
  try {
    const runtime = await loadPyodide({ indexURL: "/pyodide/" });
    const response = await fetch("/python-runtime.py");
    if (!response.ok) throw new Error("Python instrumentation is missing.");
    runtime.runPython(await response.text());
    self.postMessage({ status: "ready" });
    runtime.globals.set("_visualizer_source", data.source);
    const result = JSON.parse(
      runtime.runPython("execute_python(_visualizer_source)"),
    );
    self.postMessage({ status: "result", result });
  } catch (error) {
    self.postMessage({
      status: "result",
      result: {
        steps: [],
        duration: 0,
        error: {
          kind: "runtime",
          line: 1,
          message: "The Python runtime could not start. Reload and try again.",
          details: String(error),
        },
      },
    });
  }
};
