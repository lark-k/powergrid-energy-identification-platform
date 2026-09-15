# Prototype Instructions

Run the local server yourself and open the preview in the browser available to this environment. Do not give the user server-start instructions when you can run it.

Before making substantial visual changes, use the Product Design plugin's `get-context` skill when the visual source is unclear or no longer matches the current goal. When the user gives durable prototype-specific design feedback, preferences, or decisions, record them in `AGENTS.md`.

When implementing from a selected generated mock, treat that image as the source of truth for layout, component anatomy, density, spacing, color, typography, visible content, and hierarchy.

Build app UI in `src/`. Keep `.openai/hosting.json`, `worker/index.js`, `scripts/prepare-sites-build.mjs`, and `tests/sites-worker.test.mjs` intact so the same local prototype can be handed to Sites. Before a Sites handoff, run `npm run build` and `npm run test:sites`; the build must leave `dist/client/index.html`, `dist/server/index.js`, and `dist/.openai/hosting.json`.

## Project-specific design decisions

- The latest approved whole-page reference is `../docs/design-qa/glass-upgrade/harmonized-reference.png`. It supersedes the earlier bright glass material: use deep navy smoked glass, subdued thin edges, small upper reflections, 13–14px card radii and restrained curve bloom. Apply the same material to the toolbar, four mini charts, minute ledger and all four chart detail windows. Keep the entire left energy-flow region unchanged, including content, layout, assets, animation and styles. Preserve the previous detail window structure and all data/interaction behavior.
- The 2026-09-15 approved glass upgrade references are `../docs/design-qa/glass-upgrade/{cards,detail,ledger}-reference.png`. Use consistent smoky graphite-blue glass, fine perimeter highlights, stable dark data areas, and cyan/green/violet/amber measurement accents across these three surfaces. The expanded chart uses a compact top metric strip and vertical process steps. Curves have a substantial sharp stroke, restrained glow, subtle zero-baseline fill, and a latest-point marker. Preserve real data, precision, missing-value semantics, hover/zoom locks, and minute-detail locks; mock values are never data sources.
- For frontend-only Docker upgrades, rebuild/recreate only the frontend service with dependencies excluded. Keep the MQTT backend, PostgreSQL, and model service running; verify container identity/start time and persisted minute continuity before and after the frontend replacement.

- The selected source of truth is `../docs/design-qa/assets/reference/design-reference.png`: a 1920x1080 dark Aurora Signal Lab command-center screen with the main chart as the dominant surface.
- Do not add play, pause, single-step, speed, or other media-player controls. Demo data runs automatically from the mock adapter.
- Keep the data layer replaceable through service adapters so mock data can later switch to REST/WebSocket/SSE without changing UI components.
- Maintain a balanced exhibition density: vivid aurora atmosphere and event-bound motion, but no card mosaic, explanatory paragraphs, decorative HUD rings, or large topology competing with the chart.
- Visual upgrades should increase chromatic depth, glass hierarchy, energy-flow highlights, and event-bound bloom while keeping the chart dominant and the layout orderly.
- Energy station and charger display independent recognition scores only; never label them as separated power.
- Corrected PV is visible only for historical periods with arrived feedback; future or not-yet-arrived substation data must stay absent and read `等待回传`.
- Keep the four-stage business pipeline visible above the KPI strip: data collection, offline model training, online inference, and result visualization. Training must show its last completed model/version rather than implying continuous online training.
- Keep the homepage pipeline compact. Clicking data collection or model training opens a dedicated process-visualization cockpit; detailed process content belongs in that second layer so the main chart remains visually dominant.
- The two process cockpits must consume a dedicated process-data adapter. Mock telemetry is only the current adapter implementation; preserve the REST/SSE switch so connecting a real backend does not require UI rewrites, and never synthesize missing training metrics inside a component.
- Real-time mode must use a continuously advancing time window and label it as a real-time window; it must never retain the fixed end time or historical label from replay mode.
- Historical window selection must support both the range rail and a minute-precise calendar/time picker. Calendar days without persisted station data must be visibly disabled and unavailable for selection.
- Every fresh page load and application startup must begin in real-time mode. Date/time labels in the window selector must include the year for cross-year replay.
- Manual date or time selection while in real-time mode detaches the selector from the moving live clock and keeps the chosen window fixed until the user starts simulated replay or explicitly returns to live mode.
- The expected transient `connecting` state while switching from replay back to real time must remain visible only in the compact connection status; it must not trigger the red business-chain failure alert unless an actual request error exists.
- In both live mode and simulated replay, hovering a detail-chart point must freeze only that chart's rendered data/time-axis snapshot while ingestion and the rest of the page continue updating. The exact `event_time`, curve point, crosshair, and pointer-relative tooltip must stay aligned; after pointer leave, apply the newest queued chart option and resume following the mode's latest data.
- User-visible power values must retain at least three decimal places; do not round normal kW values to whole numbers. Values below 0.01 kW may retain a fourth decimal place.
- Never present PV activity probability as power-estimate accuracy. Show its explicit label, and surface model-window interpolation counts as an input-data quality warning.
- A manually locked minute detail must survive automatic realtime window movement; clear it only when the station changes or the user explicitly unlocks it.
