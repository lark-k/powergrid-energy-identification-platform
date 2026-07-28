# Design QA — Collection and training process cockpits

- Design-system source: `../docs/design-qa/assets/reference/design-reference.png`
- Collection implementation: `../docs/design-qa/assets/implementation/collection-process-cockpit-1440x900.png`
- Training implementation: `../docs/design-qa/assets/implementation/training-process-cockpit-1440x900.png`
- Viewport/state: 1440 × 900 CSS px, desktop dark theme, startup transition complete

## Findings

- No actionable P0/P1/P2 findings remain.
- The homepage retains its compact four-stage ribbon and dominant power-separation chart. Detailed collection and training telemetry moves to a near-full-screen second layer.
- Collection uses cyan signal language, a live four-step data highway, source matrix, real signal plot, quality gate, and event stream.
- Training uses a violet model language, a five-step offline pipeline, epoch convergence chart, release score, checks, version, and completion metadata.
- Both cockpits identify the active process-data source. The current build reads `MOCK API`; the same UI accepts REST/SSE telemetry through `ProcessDataAdapter`.

## Resolved issues

- P1: The first implementation mounted the fixed dialog inside the homepage pipeline stacking context, allowing later KPI/chart layers to paint over the dialog.
- Resolution: The cockpit now renders through a document-level portal and uses an opaque command-surface base. The final screenshots show no homepage content bleeding into either process page.

## Interaction and runtime evidence

- Data collection opens from the first homepage card.
- Model training opens from the second homepage card and can also be reached from the in-cockpit switch.
- Close button and backdrop/Escape handling are present; close-button flow was verified in the browser.
- Browser console errors/warnings: none.
- Production build: passed.
- Vitest: 11 passed.
- Playwright E2E: 2 passed.
- Sites packaging tests: 4 passed.

## Backend readiness

- `CollectionProcessTelemetry` and `TrainingProcessRun` are UI-facing contracts.
- REST endpoints are reserved for collection telemetry and latest training run.
- SSE collection telemetry uses the `telemetry` event.
- Training charts only render `epochs` supplied by the process adapter. When absent, the UI shows an explicit waiting state.

final result: passed
