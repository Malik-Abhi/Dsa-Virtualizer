import type { ExecutionAdapter, ExecutionResult } from "@/types/execution";
export const javascriptAdapter: ExecutionAdapter = {
  language: "javascript",
  execute(source) {
    return new Promise<ExecutionResult>((resolve) => {
      const worker = new Worker(new URL("./worker.ts", import.meta.url));
      const timeout = setTimeout(() => {
        worker.terminate();
        resolve({
          steps: [],
          duration: 4000,
          error: {
            kind: "limit",
            line: 1,
            message:
              "Execution took too long. Reduce the input or check for an infinite loop.",
            details: "Worker terminated after 4 seconds.",
          },
        });
      }, 4000);
      worker.onmessage = (event) => {
        clearTimeout(timeout);
        worker.terminate();
        resolve(event.data);
      };
      worker.onerror = () => {
        clearTimeout(timeout);
        worker.terminate();
        resolve({
          steps: [],
          duration: 0,
          error: {
            kind: "runtime",
            line: 1,
            message:
              "The execution worker could not start. Reload and try again.",
            details: "Worker initialization failed.",
          },
        });
      };
      worker.postMessage({ source });
    });
  },
};
export const pythonAdapter: ExecutionAdapter = {
  language: "python",
  execute(source) {
    return new Promise<ExecutionResult>((resolve) => {
      const worker = new Worker("/python-worker.js", { type: "module" });
      let started = false;
      let settled = false;
      const finish = (result: ExecutionResult) => {
        if (settled) return;
        settled = true;
        clearTimeout(timeout);
        worker.terminate();
        resolve(result);
      };
      const expired = () =>
        finish({
          steps: [],
          duration: started ? 4000 : 30000,
          error: {
            kind: started ? "limit" : "runtime",
            line: 1,
            message: started
              ? "Python execution took too long. Reduce the input or check for an infinite loop."
              : "The Python runtime could not load. Reload and try again.",
            details: started
              ? "Worker terminated after 4 seconds of execution."
              : "Runtime initialization timed out after 30 seconds.",
          },
        });
      // Loading WebAssembly has its own deadline; execution still gets four seconds.
      let timeout = setTimeout(expired, 30000);
      worker.onmessage = (
        event: MessageEvent<{
          status: "ready" | "result";
          result?: ExecutionResult;
        }>,
      ) => {
        if (event.data.status === "ready") {
          started = true;
          clearTimeout(timeout);
          timeout = setTimeout(expired, 4000);
        } else if (event.data.result) finish(event.data.result);
      };
      worker.onerror = () =>
        finish({
          steps: [],
          duration: 0,
          error: {
            kind: "runtime",
            line: 1,
            message: "The Python worker could not start. Reload and try again.",
            details: "Worker initialization failed.",
          },
        });
      worker.postMessage({ source });
    });
  },
};
