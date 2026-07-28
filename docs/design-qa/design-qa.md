## Design QA

**Comparison target**

- Source visual truth: `docs/design-qa/assets/reference/design-reference.png`
- Rendered implementation: `docs/design-qa/assets/implementation/visual-upgrade-24h-exact.png`
- Side-by-side evidence: `docs/design-qa/assets/comparison/visual-upgrade-side-by-side.png`
- Responsive evidence: `docs/design-qa/assets/implementation/visual-upgrade-1440x900.png`
- Short-window status evidence: `docs/design-qa/assets/implementation/visual-upgrade-1h-1440x900.png`
- 6h status-label evidence: `docs/design-qa/assets/implementation/visual-upgrade-6h-label.png`
- State: dark command center, 24h range for the full-view comparison; 1h range for the focused status-zone comparison.
- Viewport: 1697 × 892 CSS px for the matched full view; 1440 × 900 CSS px for responsive verification.
- Density normalization: source and matched implementation are both 1697 × 892 px at devicePixelRatio 1; no scaling was used.

**Full-view comparison evidence**

- The chart remains the dominant surface and preserves the reference composition: slim header, metric rail, large separation chart, two compact right-side modules, feedback timeline, correction strip, and selected-minute rail.
- The aurora asset, cyan/green/amber/violet semantic palette, line hierarchy, and glass treatment remain aligned with the source while chromatic depth and panel separation are stronger.
- No persistent control is clipped at 1440 × 900, and the bottom records entry remains operable without vertical scrolling.

**Focused region comparison evidence**

- Status zones were checked separately at 1h, 6h, 24h, and 7d. At 1h, corrected and waiting regions retain readable in-chart labels, while the realtime region is anchored by the blue band and NOW line.
- At 6h, the waiting label is anchored to the actual midpoint of the amber interval and positioned below NOW, so it neither drifts into the realtime band nor overlaps the NOW label.
- At 24h and 7d, narrow waiting/realtime intervals keep their actual temporal width while a compact detached waiting label remains visible above the interval without clipping.
- The right-side recognition and feedback modules were inspected against the source for border weight, type contrast, alignment, and visual priority; no P0/P1/P2 drift remains.

**Required fidelity surfaces**

- Fonts and typography: Chinese uses the existing HarmonyOS/Source Han fallback stack; operational numbers use JetBrains Mono. Weight, contrast, wrapping, and small-label legibility are acceptable at both tested viewports.
- Spacing and layout rhythm: primary grid proportions, module gaps, chart margins, and bottom-rail density remain consistent and free of overlap.
- Colors and visual tokens: state colors remain semantic and consistent. Added glows and gradients increase depth without obscuring the plotted data.
- Image quality and asset fidelity: the existing high-resolution aurora field remains sharp and correctly cropped; Phosphor icons remain vector-based and consistent.
- Copy and content: business labels remain concise and use “辨识分数/置信度”; no prediction, device-control, or model-training language was introduced.

**Comparison history**

- Iteration 1 — P2: added “反馈校正截止” and “实时窗口” boundary labels collided with NOW and the waiting-zone label in long ranges. Fix: removed both helper labels and their endpoint symbols, retained color-coded boundary lines, moved NOW to a compact two-line label, and made the waiting-zone title conditional on available width.
- Post-fix evidence: `visual-upgrade-24h-exact.png` shows no right-edge label collision; `visual-upgrade-1h-1440x900.png` shows the three states remain distinguishable in a short range.
- Iteration 2 — P2: the first detached 6h waiting label was placed using a fixed right offset and drifted toward the realtime/NOW area. Fix: replaced it with a data-coordinate scatter annotation anchored to the true waiting-interval midpoint, then placed it below NOW. Post-fix evidence: `visual-upgrade-6h-label.png`.

**Findings**

- No actionable P0, P1, or P2 findings remain.

**Follow-up polish**

- P3: a real backend could expose explicit status-window metadata so region boundaries no longer need to be derived from the latest arrived batch and the configured five-minute realtime interval.

**Implementation checklist**

- Keep the range-specific status-label strategy: in-area at 1h, data-anchored at 6h, detached compact label at 24h/7d.
- Preserve reduced-effects fallbacks for the scan, status pulse, and feedback bloom.
- Re-run visual QA when real backend timing produces substantially longer waiting intervals.

final result: passed
