# Codeflow

Codeflow is a self-contained React component that turns a Python code snippet or module into an interactive system diagram. It loads CPython in the browser through Pyodide, parses the uploaded source file, and renders classes, relationships, and activity flow as a zoomable SVG so that engineers can reason about unfamiliar repositories.

## Features at a Glance

- **Immediate visual feedback** – Bundles a sample authentication workflow so the diagram renders even before you import your own code.
- **Client-side Python parsing** – Lazily downloads Pyodide (~10 MB) on first parse and builds an AST directly in the browser.
- **Structural insights** – Extracts classes, `self` fields, method definitions, and both intra-class and cross-class invocations.
- **Connection controls** – Toggle method labels, group edges by relationship type, and switch a highlight mode that dims unrelated nodes.
- **Context panels** – Selecting a node reveals file metadata, field assignments, and callable methods.
- **Friendly status updates** – Inline messages surface parser load progress, success, and error states (including syntax errors).

## Embedding the Component

The visualization lives entirely in `Main.ts` and exports a default `CodeWorkflowVisualizer` React component. To host it inside an existing React application:

1. Install the peer dependencies the component expects:

   ```bash
   npm install react@^18 lucide-react
   ```

2. Ensure your build target is a browser environment with network access so Pyodide can be fetched from the CDN.
3. Import and render the component wherever you would like the diagram to appear:

   ```tsx
   import CodeWorkflowVisualizer from './Main';

   export default function App() {
     return (
       <div className="h-screen">
         <CodeWorkflowVisualizer />
       </div>
     );
   }
   ```

Pyodide is only instantiated the first time the user parses code. Subsequent parses reuse the in-memory interpreter without additional downloads.

## Working with Python Code

1. Click **Import Code** to open the modal dialog.
2. Either upload a `.py` file or paste Python source into the provided textarea.
3. Choose **Parse Code** to trigger analysis. During this process the status banner will cycle through loader, success, or error messages.
4. Once parsing completes, the diagram refreshes with new nodes and connections derived from the AST. Any syntax errors or parser failures are surfaced in-line so the user can resolve them quickly.

### What Gets Visualized

- Each detected `class` becomes a node labelled with its file of origin.
- Assignments to `self.<field>` are collected and shown as fields in the node sidebar.
- Methods (excluding `__init__`) are listed and can be targeted by connections.
- Method calls such as `self.method()`, `self.<dependency>.method()`, and `ClassName.method()` create edges in the graph, including best-effort resolution of dependency attributes.

### Diagram Controls

- **Method Labels** toggle visibility of call-site labels on edges.
- **Group Connections** aggregates similar relationships to reduce clutter in dense graphs.
- **Highlight Mode** emphasizes the currently selected node and its neighbours while muting others.
- A footer summary displays counts for nodes, raw connections, grouped connections, and whether the parser is ready.

## Internal Layout Engine

The visualizer performs a lightweight auto-layout pass when sample data or parsed nodes are loaded. Nodes are spaced with deterministic offsets so the diagram remains readable without manual positioning. Curved SVG paths with rounded corners connect related nodes and adapt to toggled grouping.

## Roadmap

The current phase focuses on local Python file exploration. The next major milestone is GitHub repository ingestion so that Codeflow can fetch remote projects and visualize them without manual uploads.

