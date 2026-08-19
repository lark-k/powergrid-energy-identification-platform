# Scheme 2 Design QA

- source visual truth: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/reference/scheme-2-flow-alignment-target-v2.png`
- latest user evidence: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/reference/scheme-2-minute-detail-selection-request.png` and `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/reference/scheme-2-curve-window-selection-request.png`
- header/detail request evidence: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/reference/scheme-2-header-chart-detail-request.png`
- implementation screenshot: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-home-v10-header-chart-realtime.png`
- curve-detail screenshot: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-signal-detail-total-v10-realtime-clean.png`
- locked curve-window evidence: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-zoom-window-locked-v11.png`
- locked minute-detail evidence: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-minute-detail-locked-v11.png`
- latest side-by-side comparison: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-detail-clean-comparison-v10.png`
- flow-alignment side-by-side comparison: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-glass-comparison-v8.png`
- compact history-control evidence: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-history-compact-v7.png`
- supporting training-page evidence: `D:/code/school/powergrid-energy-identification-platform/docs/design-qa/assets/implementation/scheme-2-training.png`
- viewport: 1920 × 1080 CSS px; device pixel ratio 1
- source pixels: 960 × 578; implementation pixels: 1920 × 1080; both images were width-normalized into a single 1920 px comparison canvas
- state: API mode, A01 海滨路台区, historical data replaying minute by minute

## Full-view comparison evidence

The latest combined comparison verifies the requested geometry against target image 2 and the user's annotated correction evidence. The two source cards share one left edge, identical width and identical height, including during the GSAP entrance animation. The causal-window content is fully contained by the mint frame. The resource-recognition and photovoltaic-separation content occupies the upper and lower violet cavities respectively. All three information surfaces use translucent frosted-glass fills without adding a second visible outline. The validation target follows the pink shield and the application target sits on the amber database beacon.

The regenerated background has no amber stream to the right of the database beacon. The ECharts overlay was independently shortened to x=84.8%, so both the raster river and moving particles terminate at the same node.

The header comparison confirms that its full-width three-column geometry remains unchanged. Only the redundant “台区能源辨识全流程” line was removed; the retained product name is rendered at 18 px. All four right-side signal cards open the same independent large analysis dialog. The dialog receives the current `chartData` on every replay tick, so its curve, latest value, KPI statistics and recent-record list advance together with the homepage. The three moving dashed reference lines were removed from the detail-series configuration, leaving only the stable grid and the actual signal curve.

## Focused comparison evidence

- source stack: `.river-sources` is anchored at left 1.5%, top 30%, height 38%; both cards measured x=51.12 px and width=255 px in the final 1920 px browser pass. The entrance animation now runs on the shared parent, preventing transient per-card horizontal drift.
- causal frame: `.causal-window` is anchored at left 25.9%, top 27%, width 9.2%, height 41.8%, inside the generated mint aperture.
- model cavities: `.model-stack` is anchored at left 45.1%, top 25.5%, width 14.3%, height 44.2%; each button occupies the corresponding generated violet cavity.
- frosted surfaces: causal background is `rgba(3, 22, 31, .76)` with 10 px blur; model backgrounds are `rgba(18, 13, 46, .78)` with 10 px blur. The generated mint/violet outlines remain the only visible outer frames.
- history adjustment: the former full-width history panel was removed. A compact trigger now sits immediately left of “业务链路在线” and opens a 620 × 236 px adjustment popover with the original range, presets, replay and live controls.
- validation and terminal: click targets are anchored over the pink shield and amber database beacon; amber particle lines end at the beacon rather than crossing it.
- two captures 900 ms apart differ, confirming that the visible particle motion remains active after the path correction.

## Required fidelity surfaces

- Fonts and typography: Microsoft YaHei UI/YaHei fallbacks, enlarged 12—30 px main-flow hierarchy, stable truncation for long model versions, no unreadably small primary labels.
- Spacing and layout rhythm: percentage anchors now follow the background asset's own apertures instead of approximating them with a grid; source cards, causal frame, two model slots, shield and beacon share a single coordinate system.
- Colors and visual tokens: cyan, mint, violet, pink and amber remain mapped directly to the target; dark navy glass surfaces preserve the target contrast.
- Image quality and asset fidelity: the new 1824 × 862 background is a project-bound raster asset with one mint frame, two violet cavities, one pink gate and one amber terminal. It contains no text or placeholder UI.
- Copy and content: business labels and dynamic values are HTML backed by the real REST API; the raster asset contains no fake business data.
- Accessibility/interactions: semantic buttons, keyboard-dismissable lifecycle pages, labelled range controls and reduced-motion handling remain intact.
- curve drill-down: four keyboard-accessible signal cards open a modal with the actual backend series, data zoom, crosshair, current KPIs, process explanation and recent records. Empty corrected/feedback series explicitly disclose that no real values are present.

## Comparison history

### Pass 1 — blocked

- P1: Main flow was a few thin lines on an empty background.
- Fix: generated the electric-grid river asset and added 27 animated particle paths.

### Pass 2 — blocked

- P1: The first generated composition still placed cards by approximate grid columns.
- P2: Card edges did not follow the mint and violet background apertures.
- Fix: replaced grid placement with percentage anchors tied to the background.

### Pass 3 — blocked

- P1: User evidence showed the causal card exceeded the mint frame, the lower source card sat too low, the two model cards did not occupy the centers of their energy lanes, and amber energy continued after the database node.
- Fix: regenerated the background with explicit empty card cavities, moved the validation gate and terminal rightward, reduced and re-anchored all five card areas, and truncated both raster and ECharts amber paths at the database node.

### Pass 4 — passed

- Post-fix evidence: `scheme-2-alignment-comparison-v5.png`.
- No actionable P0/P1/P2 alignment mismatch remains for the requested five-card flow.
- Browser console: no errors or warnings in the final browser pass.
- Primary interactions tested: open data collection, switch to model training, close overlay, view real REST records; historical replay and minute-ledger controls remain present.

### Pass 5 — blocked

- P2: User evidence showed the upper source card could appear horizontally offset during its staggered GSAP entrance.
- P2: Removing all fills from the causal/model surfaces made their text merge into the energy background.
- P2: The full-width historical-range panel consumed excessive vertical space.
- Fix: animated the common source container instead of individual cards; forced both source cards to the same stretch geometry; added borderless frosted fills to the background apertures; enlarged the main flow to 620—740 px and moved the historical controls into the header.

### Pass 6 — passed

- Post-fix evidence: `scheme-2-glass-comparison-v8.png` and `scheme-2-history-compact-v7.png`.
- Source-card x and width are identical during animation and after rest.
- Browser-computed glass fills and blur are present for the causal and both model surfaces.
- No actionable P0/P1/P2 mismatch remains for the five requested corrections.

### Pass 7 — blocked

- P2: The second brand line duplicated the page identity and made the header visually heavier than requested.
- P2: The four compact signal charts did not provide enough space for leadership review of the full time series.
- Fix: removed only “台区能源辨识全流程”, retained the existing header width/grid, enlarged “新型能源智能辨识与分离平台” to 18 px, and added an independent large analysis dialog to all four chart cards.

### Pass 8 — blocked

- P2: The first detail-dialog implementation captured the signal data at click time, so an open dialog did not receive later historical-replay ticks.
- P2: Average, maximum and minimum `markLine` guides produced three animated dashed lines that competed visually with the signal.
- Fix: store only the selected signal title and derive the dialog specification from current `chartData` on every render; add a visible replay/live status; use the same 380 ms update cadence as the homepage chart; remove the three animated dashed guides.

### Pass 9 — passed

- Runtime evidence: while the total-power dialog stayed open, its actual point count advanced from 21 to 23 and the latest value changed from 3 kW to 17 kW. The initial-PV dialog advanced from 334 to 336 points in the same open state.
- The combined visual evidence `scheme-2-detail-clean-comparison-v10.png` shows that the requested dashed guides are absent while the actual curve and stable axis grid remain.
- Browser-computed header evidence: width 1920 px, product name 18 px, redundant title absent, four clickable chart cards present.
- Production build passed; 7 test files / 31 tests passed; final browser console contained zero errors or warnings.
- No actionable P0/P1/P2 issue remains for the header, curve drill-down, synchronized replay or dashed-guide removal requests.

### Pass 10 — blocked

- P1: Every replay snapshot replaced the selected minute record, so the detail panel could jump away from the row explicitly chosen by the user.
- P1: The detail chart was rebuilt with `notMerge: true` on every new data point, resetting a manually adjusted `dataZoom` range to 0—100%.
- Fix: added a user-owned pinned minute selection that refreshes only the same `event_time`, and clears only when the station or requested history range changes. Added ECharts data-zoom state capture and absolute `startValue` / `endValue` restoration after each series update.

### Pass 11 — passed

- Minute-detail runtime evidence: after choosing 2025-12-12 03:35:00, the replay advanced for 3.2 seconds while the detail title and active row remained on 03:35; the “已锁定” state stayed visible.
- Curve runtime evidence: after manually zooming the total-power detail curve, the real point count advanced from 3 to 6 while “滑动窗口已锁定” remained visible and the selected time interval stayed narrowed.
- Both behaviors keep receiving actual backend updates without allowing automatic refresh to override the user's current inspection state.
- Production build and all 31 automated tests pass; browser console contains no errors or warnings.
- No actionable P0/P1/P2 issue remains for the two persistence requirements.

## Follow-up polish

- P3: Complete model-version strings are intentionally truncated in compact river cards; the full strings remain visible on the model-management page and in tooltips.

final result: passed
