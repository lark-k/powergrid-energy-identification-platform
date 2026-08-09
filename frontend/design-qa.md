# Design QA — 数据采集与模型训练驾驶舱

- Source visual truth (collection): `C:/Users/lark-k/AppData/Local/Temp/codex-clipboard-8690a291-3956-4f19-82c2-51e1ca259f39.png`
- Source visual truth (training): `C:/Users/lark-k/AppData/Local/Temp/codex-clipboard-5bf71099-4d56-4347-9dcf-9095a5bdd159.png`
- Implementation URL: `http://localhost:5173/`
- Implementation screenshot: unavailable; the in-app browser URL policy blocked local-page capture
- Intended viewport: 1920 × 1080 CSS px, desktop dark theme
- Source pixels: 2048 × 1123 for both supplied references
- Implementation pixels / density normalization: unavailable because browser capture was blocked
- States: collection live cockpit; training demo replay after a real training-run 404

## Findings

- [P2] Browser-rendered visual comparison is unavailable.
  - Location: both process cockpits.
  - Evidence: the Docker frontend responds with HTTP 200 and the rebuilt bundle includes both cockpit modules, but the required implementation screenshot could not be captured in the selected in-app browser because local navigation was rejected by its URL policy.
  - Impact: typography, spacing, colors, image/background integration, copy, icons, overflow, and the animated Epoch replay cannot be certified from browser-rendered evidence in this run.
  - Fix: open the running container at `http://localhost:5173/`, inspect both process dialogs at 1920 × 1080, and capture matching implementation states for a final comparison pass.

## Comparison history

- Current pass: source references opened and measured; implementation capture blocked before visual comparison.
- No P0/P1/P2 visual fixes were made from a rendered comparison because no valid implementation screenshot was available.

## Full-view comparison evidence

- Source references were inspected at their native 2048 × 1123 dimensions.
- Implementation evidence is limited to a healthy Docker container, HTTP 200, a successful production bundle, and automated component/data tests; these do not substitute for a screenshot comparison.

## Focused-region comparison evidence

- Not performed. Dense chart legends, KPI typography, process-card spacing, demo notice, and release panels require a browser-rendered image before focused comparison is valid.

## Functional evidence

- Production build: passed.
- Vitest: 7 files and 31 tests passed.
- Docker services: frontend, backend, model service, and PostgreSQL healthy.
- Primary browser interactions tested: blocked before page navigation.
- Browser console errors checked: no; page navigation was blocked.

final result: blocked
