# TODO backlog for future features

1. **GitHub commit ingestion & context panel** — Status: TODO  
   Extend the importer so users can paste a commit/PR URL from a public repository, pull the diff via the GitHub REST API, and show commit metadata (author, timestamp, files) alongside the current “paste Python” workflow instead of replacing it. Since only public repos are supported for now, skip any OAuth/token handling and rely on unauthenticated requests (mindful of rate limits).  
   :::task-stub{title="Add GitHub commit import alongside existing parser modal"}
   * Enhance `CodeWorkflowVisualizer`’s modal (where `showImportModal`, `pythonCode`, and `parseStatus` are handled) to include a new tab for “GitHub commit/PR” input; validate that URLs reference public repos before fetching.
   * Create a lightweight serverless proxy (Netlify function or Vite dev proxy) that calls GitHub’s `/repos/{owner}/{repo}/commits/{sha}` and `/pulls/{number}/files` endpoints without authentication to avoid CORS issues while keeping implementation simple.
   * Normalize the fetched file patches into a structure compatible with the existing `WorkflowNode` + `WorkflowConnection` builder so both pasted code and fetched commits flow through the same layout pipeline.
   * Add a right-hand metadata drawer showing commit message, author avatar, file list, and status of the ingestion request, including clear messaging when rate limits prevent fetching.
   :::

2. **Diff-focused visualization & color semantics** — Status: TODO  
   Introduce an unobtrusive way to visualize added/modified/removed classes and relationships by combining color accents, layered views, and toggles that keep the canvas legible during reviews.  
   :::task-stub{title="Layer diff-aware rendering on the workflow canvas"}
   * Update the node/connection renderers (where `highlightMode`, `showLabels`, and `groupConnections` already gate styles) to read diff metadata (added/removed/modified) and apply consistent colors—e.g., green glow for additions, red strikethrough for removals, amber outline for edits—plus an optional “diff legend” overlay.
   * Provide a per-file toggle that collapses unchanged nodes to reduce clutter; leverage the existing `autoLayout` output and introduce grouping/stacking so only diff-heavy areas expand by default.
   * Support side-by-side or overlay modes: an “overlay” keeps a single canvas but ghosts the previous version behind the new one, while “split” renders two synchronized canvases with mirrored zoom/pan.
   * Persist user preferences (color theme, overlay vs split) in local storage so reviewers can tailor the visualization for longer sessions.
   :::

3. **AI-powered micro-summaries & hover interactions** — Status: TODO  
   Give reviewers concise AI explanations scoped to functions/classes/connections, surfaced either as tooltips on hover or as a collapsible sidebar list that can highlight the relevant nodes when selected.  
   :::task-stub{title="Generate and surface AI summaries for code regions"}
   * After a commit loads, walk the parsed AST/diff to build summary prompts (class/function/connection level) and send them to an LLM endpoint (e.g., OpenAI function call) in batches; cache results per commit SHA.
   * Store summaries alongside node metadata so hovering on a node/edge triggers a tooltip that shows the <100-character explanation; respect existing `selectedNode` state to avoid conflicts.
   * Implement a sidebar panel listing all summaries grouped by category (“Classes”, “Connections”, “Hotspots”); clicking an entry should set `selectedNode` and temporarily pulse the node/edge on the canvas.
   * Add a quick “Explain more” action that expands the summary inline or opens a modal without overloading the default view.
   :::

4. **Richer node iconography & domain-specific glyphs** — Status: TODO  
   Make diagrams faster to scan by decorating nodes with icons that communicate their role (API handler, database model, service, test, etc.) and optionally overlaying small sparkline badges for metrics (e.g., churn, complexity).  
   :::task-stub{title="Introduce icon packs and visual cues for node types"}
   * Extend `WorkflowNode` with a `kind` enum and optional `metrics` map populated during parsing/import (e.g., detect files under `/db/` as data nodes, classes inheriting from Django models, etc.).
   * Update the SVG node renderer to prepend Lucide (already imported) or custom icons based on `kind`, keeping size constraints so nodes remain compact; ensure icons respond to highlight/diff colors.
   * Allow users to override auto-detected kinds via a small inspector form so the visualization stays accurate for unconventional codebases.
   * Explore lightweight glyph overlays (database cylinders, API globe, queue stack) and optional mini-badges (e.g., cyclomatic complexity) that can be toggled from the control bar to prevent clutter.
   :::
