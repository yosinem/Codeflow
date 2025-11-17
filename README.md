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
| `npm run deploy` | Builds the project and publishes `dist/` to the `gh-pages` branch via [`gh-pages`](https://github.com/tschaub/gh-pages). |

## Deploying

The app ships as a static bundle, so any static host will work. Because the production output assumes it will be served from the
root (`/`) by default, set the `VITE_BASE_PATH` environment variable before building whenever you deploy to a subdirectory.

### GitHub Pages

1. **Enable Pages** on your repository and choose the `gh-pages` branch as the source.
2. Run the deployment script locally (replace `<repo-name>` with your actual repository slug):

   ```bash
   VITE_BASE_PATH="/<repo-name>/" npm run deploy
   ```

   The script builds the project, pushes the new contents to the `gh-pages` branch, and GitHub Pages will publish it automatically
   at `https://<username>.github.io/<repo-name>/`.

If you use GitHub Actions instead, configure a workflow that runs `npm ci`, `VITE_BASE_PATH="/<repo-name>/" npm run build`, and
deploys the resulting `dist/` folder to the `gh-pages` branch.

### Netlify

Netlify detects the included `netlify.toml`, so you can deploy either through the Netlify UI or the CLI:

```bash
netlify deploy --build --prod
```

The config file already runs `npm run build` and publishes `dist/`. Override `VITE_BASE_PATH` in the Netlify dashboard only if you
need a different base path.

## Features

- In-browser Python parsing powered by Pyodide (loads on demand, cached afterwards).
- Automatic graph layout that arranges start/end/class nodes and routes bezier connections around obstacles.
- Optional grouping of repeated edges, label toggles, focus/highlight mode, and live node metrics in the footer.
- Modal importer that accepts `.py` files or pasted code and provides status updates for every parsing phase.

## Notes

The visualizer uses Tailwind-like utility classes baked directly into the JSX markup. No extra Tailwind build step is required because the project relies on Vite + CSS modules for styling, so you can run it immediately after installing dependencies.
