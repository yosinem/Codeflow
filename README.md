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

## Deploying with Netlify

This project is tailored for Netlify's static hosting pipeline. The bundled `netlify.toml` already sets `npm run build` as the build command and publishes the `dist/` directory, so you can go from repo to live site in a few clicks.

### One-time setup

1. Sign in to [Netlify](https://www.netlify.com/), choose **Add new site → Import an existing project**, and connect your Git provider.
2. Select this repository, confirm the default build command (`npm run build`) and publish directory (`dist`), and pick the branch you want to deploy (usually `main`).
3. Finish the wizard—Netlify will kick off the first production build immediately.

### Deploying changes

- **Automatic deploys:** every push to the tracked branch triggers Netlify to run `npm run build` and publish the new static assets.
- **Manual deploys:** install the Netlify CLI and run `netlify deploy --build --prod` from the repo if you ever need to publish outside of the Git-based workflow. The CLI command reads the same settings defined in `netlify.toml`.

Netlify also generates preview URLs for each pull request so you can verify changes before merging.

## Features

- In-browser Python parsing powered by Pyodide (loads on demand, cached afterwards).
- Automatic graph layout that arranges start/end/class nodes and routes bezier connections around obstacles.
- Optional grouping of repeated edges, label toggles, focus/highlight mode, and live node metrics in the footer.
- Modal importer that accepts `.py` files or pasted code and provides status updates for every parsing phase.

## Notes

The visualizer uses Tailwind-like utility classes baked directly into the JSX markup. No extra Tailwind build step is required because the project relies on Vite + CSS modules for styling, so you can run it immediately after installing dependencies.
