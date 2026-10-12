# DSA Virtualizer

**See your code think.** A local-first Next.js algorithm workspace that turns JavaScript and Python into an inspectable execution timeline.

## Run locally

Use Node.js 20.9+ (Node 24 recommended).

```sh
npm install
npm run dev
```

Open http://localhost:3000. No environment variables, accounts, API keys, or backend services are required. Pyodide WebAssembly and Python standard-library assets are copied into `public/pyodide`, so Python uses no runtime CDN. `npm install` copies Monaco's runtime into `public/monaco`; the editor does not depend on a CDN. If assets need refreshing, run `npm run postinstall`.

```sh
npm test           # Execution/state tests and every example
npm run typecheck
npm run lint
npm run build
npm start          # Production server after build
```

## Using the workspace

Edit the starter code or choose an example. Click **Start Virtualizing** (Cmd/Ctrl+Enter) to build a real timeline. Execution begins paused at the first recorded operation. Move forward/backward, scrub the timeline, or play at 0.5×–4× speed. Restart returns to the first snapshot without re-executing the code. Editing code clears the previous timeline.

Source highlighting and all runtime state reflect the selected snapshot. Variables live in stack frames **inside the canvas**, with names on the left and animated value boxes on the right. Global, active, suspended, and returning function frames are separate. Arrays, function objects, linked-list nodes, tree nodes, and object properties live on the heap to the right. Reference arrows connect every alias to one shared object; reassignment reroutes the arrow. Purple highlights changed values; amber highlights the actual accessed element or property. Array index pointers are associated with actual indexed reads and writes, rather than guessed from variable names. Console output beneath the page heading is cumulative up to the selected step.

Drag frames and heap objects to arrange them, drag the canvas background to pan, use +/− to zoom, and reset the camera to restore positions. Focused canvas nodes also support arrow keys (Shift for larger moves). The workspace uses nearly the full browser width and gives the canvas a larger default share. Desktop editor width is adjustable with the divider or its arrow-key controls. Mobile uses a stacked layout. Themes persist locally. Animations respect reduced-motion settings.

Outside the editor or a focused canvas node: Space plays/pauses; left/right arrows move between steps. Monaco retains its normal editing shortcuts. Escape closes dialogs.

## Architecture

- `app/`: Next.js App Router page, layout, and responsive theme styles.
- `components/editor/CodeEditor.tsx`: locally hosted Monaco with syntax highlighting, autocomplete, runtime decorations, error markers, and run shortcut.
- `components/visualization/`: canvas, runtime frames, animated boxed values, canonical heap objects, moving index pointers, SVG reference arrows, dragging and camera controls.
- `components/execution/`: timeline/playback controls and snapshot-based console output.
- `components/Workspace.tsx`: orchestration, examples, loading/error states, preferences.
- `lib/execution/interpreter.ts`: Acorn AST validation, bounded interpreter, instrumentation, immutable snapshots.
- `lib/execution/memory.ts`: stable object identities, reachable heap graph, frame bindings, reference-aware changes and index-pointer associations.
- `lib/visualization/memory-layout.ts`: deterministic frame/heap placement and reference routing, including linked chains and tree levels.
- `lib/execution/worker.ts`: JavaScript worker entry point. No source is evaluated as native JavaScript.
- `lib/execution/python-runtime.py`: Python AST validation, indexed-access instrumentation, CPython tracing, frame/heap identities, console output and bounds.
- `public/python-worker.js`: loads locally hosted Pyodide and returns the same execution IR. `scripts/prepare-python.mjs` copies its runtime assets at install/dev/build time.
- `lib/execution/adapters.ts`: asynchronous language adapter boundary, worker lifecycle and timeout, locally hosted Python worker.
- `types/execution.ts` and `types/memory.ts`: execution IR and canonical frame/heap graph.
- `lib/examples/`: 21 runnable programs, including sorting, searching, strings, recursion, lists, trees, stacks and queues.

Source → language adapter → isolated worker runtime → `ExecutionResult` → snapshot visualizers. UI components never parse code to generate execution states. The interpreter emits events after declarations, assignments, updates, function entry/return and output, and after evaluating conditions. Compound lines can generate multiple snapshots. A condition snapshot records the actual boolean result. Statements without a state-changing or control-flow event (e.g. comments) do not create synthetic steps. Execution errors preserve the real partial timeline and do not emit a success event.

## Execution boundary

JavaScript uses a deliberately constrained educational interpreter, not a full ECMAScript runtime. Acorn parses source; an allowlist rejects unsupported AST forms; the interpreter evaluates permitted nodes against private lexical scopes and explicit built-ins. There is no `eval`, `Function`, dynamic import, native function execution from source, DOM, storage, network, timer, or server access. Prototype-sensitive property names are denied. Built-in operations are explicitly implemented/whitelisted. No user code is sent to a server.

Workers isolate both languages from the UI and are terminated after four seconds of execution. Python gets a separate 30-second runtime initialization deadline. Limits include 30,000 source characters, 100,000 operations, 2,500 snapshots, 60 call frames, 8 MB of serialized timeline data, and bounded mutations. These are defense-in-depth limits, not a formally verified multi-tenant sandbox. Very large expressions may still allocate memory before a worker is terminated. Do not repurpose this interpreter for hostile multi-tenant server execution.

### Supported JavaScript subset

- `let`/`const`, primitives, arithmetic/comparison/logical operators, template strings.
- Arrays, object literals, property/index assignments, array/object destructuring.
- `for`, `for…of`, `while`, `do…while`, `if`/`else`, `break`, `continue`.
- Functions, arrow functions, parameters, recursion, returns, lexical lookup.
- Array `push`, `pop`, `shift`, `unshift`, `reverse`, `slice`, `splice`, `join`, `indexOf`, `includes`.
- String indexing, `length`, `split`, `charAt`, `slice`, case conversion, `includes`, `indexOf`.
- `Math.floor/ceil/round/abs/min/max/sqrt/pow/trunc`, `Number`, `String`, `console.log`.

### Supported Python subset

Select **Python** in the language menu and run the included even-index prefix-sum example. Functions, recursion, returns, assignments, arithmetic, comparisons, booleans, `None`, lists/tuples/sets/dictionaries, indexing/slices, unpacking, comprehensions, `for`/`while`, conditions, break/continue and f-strings execute as real Python. Core built-ins include `len`, `range`, `enumerate`, `zip`, `sum`, `min`/`max`, `sorted`, numeric/string conversions and `print`. Common list, dictionary, set and string methods are permitted. Use dictionaries for linked-list/tree properties. Imports, classes, arbitrary attributes and external packages are unavailable.

Python tracing records executed line changes, calls, returns, evaluated conditions and output. Indexed reads and simple indexed writes associate pointers with the referenced heap object. Comprehensions count toward operation limits but do not render separate internal frames. `None` and Python booleans display in their native spelling. Large integers are shown as strings to preserve their digits. Runtime errors retain the completed partial timeline; initialization or hard timeout errors cannot recover a worker's unreturned snapshots.

### Known limitations

- Python executes through locally hosted [Pyodide](https://pyodide.org/en/stable/usage/index.html), which runs CPython as WebAssembly in a dedicated worker. Its AST allowlist and restricted built-ins reject imports, classes, async, exceptions/try-catch, file/network access, dynamic evaluation and runtime introspection. Python source stays in the browser. These restrictions are an educational boundary, not a formally verified sandbox.
- JavaScript has no `var`, imports, classes, `new`, async/await, promises, exceptions/try-catch, generators, regex, BigInt, spread/rest, default parameters, optional chaining, getters/setters, native callbacks such as `map`/`sort`, or arbitrary built-ins.
- Not every JavaScript edge case is modeled: per-iteration closure binding, temporal-dead-zone behavior, sparse-array semantics and named function-expression self-binding are outside the MVP. Avoid depending on those behaviors.
- The canvas memory graph preserves shared and cyclic references and distinguishes `undefined`, `null`, and strings. Legacy flattened diagnostic fields remain in the execution IR for compatibility; the canvas consumes only the canonical memory graph.
- Heap snapshots include objects reachable from visible frame bindings and return values. Unreachable objects disappear; closure environments are not separately rendered.
- Array cards display the first 24 elements and report the full length. Pointers and reference arrows for later slots are not rendered. Many frames or objects may need zooming/panning; there is no minimap.
- Array value animation uses value plus duplicate occurrence identity within a stable heap object. Intermediate assignments during a manual swap may create/remove an element animation identity.
- Editing is not persisted across reloads; only the theme is saved.

## Add a visualizer

Extend the `HeapObject` discriminated union in `types/memory.ts`, encode the runtime object in `MemoryRecorder`, add geometry and reference ports in `memory-layout.ts`, then render its pure snapshot in `HeapObject.tsx`. Keep syntax/execution logic out of canvas components. Use runtime object IDs for nodes and binding/property IDs for edges. Test shared aliases, reference reassignment, cycles, and backwards stepping.

## Add a language

Implement `ExecutionAdapter.execute(source)` returning `ExecutionResult`. Use a bounded, isolated runtime (for example a dedicated Pyodide worker or a secured backend worker) and map its instrumentation into the same `ExecutionStep` IR. Include source locations, snapshot values, cumulative output, separate runtime frames, and a shared heap/reference graph. Enforce time/memory limits and reject unavailable functionality clearly. Follow the existing Python adapter and worker as the second-language example.

## Validation

The execution suite tests immutable state, element mutation, branches/loops, break/continue, recursion/call frames, return values, object references, destructuring, console locations, syntax/runtime/unsupported errors, capability denial, cycles, execution limits, and every bundled example. The current suite has 53 passing tests, including the actual Pyodide runtime, the pictured Python prefix-sum algorithm, aliases, recursion, errors, output, capability denial and execution limits. Browser verification covers editable Monaco source, real worker execution, aliases sharing one heap node, reference reassignment, suspended recursive frames, linked-list/tree connections, animated scalar updates and index pointers, keyboard and pointer node movement, pan/zoom/reset, console output, themes, and mobile stacking without horizontal page overflow.

### Dependency audit note

At verification, the runtime audit reports no moderate, high, or critical findings. Monaco 0.57.0 ships DOMPurify 3.4.15, which has two low-severity audit entries (reported against DOMPurify and its parent package). Its prebuilt editor assets embed that version; overriding the package alone would not patch those assets. A future Monaco release with refreshed prebuilt assets should replace it. The development-only Next ESLint glob chain also reports a high-severity braces advisory; braces currently has no published patched release. The interpreter never exposes these libraries to user programs. Do not use an audit-forced Next downgrade as a fix.
