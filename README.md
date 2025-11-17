# Codeflow

A Vite + React + TypeScript playground that renders the **Code Workflow Visualizer** component. The UI lets you paste or upload Python code, parses it in-browser via [Pyodide](https://pyodide.org/en/stable/) to extract classes/methods, and draws an interactive class workflow diagram with grouping, highlighting, and zoom helpers.

## Getting started

```bash
npm install
npm run dev
```

Then visit the URL that Vite prints (usually `http://localhost:5173`).

### Other scripts

| Command | Description |
| --- | --- |
| `npm run build` | Type-checks the project and outputs a production build in `dist/`. |
| `npm run preview` | Serves the production build locally so you can verify it. |
| `npm run lint` | Runs ESLint with the config that ships with Vite. |

## Features

- In-browser Python parsing powered by Pyodide (loads on demand, cached afterwards).
- Automatic graph layout that arranges start/end/class nodes and routes bezier connections around obstacles.
- Optional grouping of repeated edges, label toggles, focus/highlight mode, and live node metrics in the footer.
- Modal importer that accepts `.py` files or pasted code and provides status updates for every parsing phase.

## Notes

The visualizer uses Tailwind-like utility classes baked directly into the JSX markup. No extra Tailwind build step is required because the project relies on Vite + CSS modules for styling, so you can run it immediately after installing dependencies.
