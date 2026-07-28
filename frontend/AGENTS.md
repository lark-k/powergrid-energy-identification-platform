# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Project-specific design decisions

- The selected source of truth is `../docs/design-qa/assets/reference/design-reference.png`: a 1920x1080 dark Aurora Signal Lab command-center screen with the main chart as the dominant surface.
- Do not add play, pause, single-step, speed, or other media-player controls. Demo data runs automatically from the mock adapter.
- Keep the data layer replaceable through service adapters so mock data can later switch to REST/WebSocket/SSE without changing UI components.
- Maintain a balanced exhibition density: vivid aurora atmosphere and event-bound motion, but no card mosaic, explanatory paragraphs, decorative HUD rings, or large topology competing with the chart.
- Visual upgrades should increase chromatic depth, glass hierarchy, energy-flow highlights, and event-bound bloom while keeping the chart dominant and the layout orderly.
- Storage and charger display independent recognition scores only; never label them as separated power.
- Corrected PV is visible only for historical periods with arrived feedback; future or not-yet-arrived substation data must stay absent and read `等待回传`.
- Keep the four-stage business pipeline visible above the KPI strip: data collection, offline model training, online inference, and result visualization. Training must show its last completed model/version rather than implying continuous online training.
- Keep the homepage pipeline compact. Clicking data collection or model training opens a dedicated process-visualization cockpit; detailed process content belongs in that second layer so the main chart remains visually dominant.
- The two process cockpits must consume a dedicated process-data adapter. Mock telemetry is only the current adapter implementation; preserve the REST/SSE switch so connecting a real backend does not require UI rewrites, and never synthesize missing training metrics inside a component.
