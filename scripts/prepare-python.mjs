import { cpSync, mkdirSync } from "node:fs";
mkdirSync("public/pyodide", { recursive: true });
for (const file of [
  "pyodide.js",
  "pyodide.mjs",
  "pyodide.asm.mjs",
  "pyodide.asm.wasm",
  "python_stdlib.zip",
  "pyodide-lock.json",
]) {
  cpSync(`node_modules/pyodide/${file}`, `public/pyodide/${file}`);
}
cpSync("lib/execution/python-runtime.py", "public/python-runtime.py");
