# 台区光储充辨识与光伏功率分离系统

面向企业展厅与运维指挥场景的单页可视化前端。当前版本使用确定性 Mock 数据，视觉基准位于 `../docs/design-qa/assets/reference/design-reference.png`，主题为“NEON GRID · 光能解构舱”。

## 运行

```bash
npm install
npm run dev
```

浏览器打开 `http://localhost:5173`。其他命令：

```bash
npm run build      # 生产构建
npm run preview    # 预览生产构建
npm test           # Vitest 关键业务测试
npm run test:e2e   # Playwright 交互测试
```

## 已实现

- 24 小时、1 分钟级主站综合功率与实时初始光伏分离结果。
- 光伏、储能、充电桩三个互不排斥的存在性标签及辨识分数；首期仅分离光伏数值。
- 6 个光伏分站的 15 分钟数据，以及 32、47、68 分钟等不规则批次回传特征。
- `event_time` 与 `arrival_time` 双时间轴；反馈只在实际到达后显示，并按历史同期校正。
- 主曲线包含总有功、初始光伏、校正后光伏、分站参考、剩余负荷、状态背景、NOW、缩放和 Tooltip。
- 历史回补保持原分钟曲线形状，支持校正前后差值波形与反馈批次覆盖区间。
- 节点缺失、乱序、质量告警、长延迟、多时段批量回传等演示事件。
- 点击分钟结果查看模型窗口、批次、参与节点、校正量和置信度。
- 分钟、反馈、节点、校正四类虚拟滚动表格，支持筛选、排序和导出。
- 数据导入入口、CSV 导出、阈值/动效设置、全屏和“看图说明”。
- 点击“数据采集”或“模型训练”进入独立过程驾驶舱：采集页展示接入源、处理链路、质量闸门、原始信号和事件流；训练页展示真实训练运行步骤、epoch 指标与版本发布检查。
- 1h / 6h / 24h / 7d 时间范围；7d 入口保留聚合策略配置，当前演示数据为 24 小时。
- 1440×900、1920×1080、2560×1440 响应式布局；支持键盘焦点和减少动态效果。

## Mock 数据

`src/mocks/generator.ts` 通过固定公式生成可重复数据：普通负荷含早晚峰，光伏为日间钟形曲线并叠加云影扰动，储能含低谷充电/高峰放电特征，充电桩含持续阶跃负荷。数据日期自动锚定浏览器本地日期，页面时钟每秒与本地系统时间同步，分钟数据在自然分钟切换时更新；页面没有播放器。

关键规则由 `src/tests/generator.test.ts` 验证：未来反馈不可见、反馈按历史 `event_time` 匹配、到达分钟不会被错误校正、缺失节点和批量历史覆盖可追溯。

## 项目结构

```text
src/
├─ components/        # ECharts 包装、指标、表格和弹层
├─ config/            # 台区、阈值、节点、时间范围与颜色配置
├─ features/          # 指挥舱、辨识、分离、反馈、校正、追溯
├─ mocks/             # 演示数据生成器与 MSW handlers
├─ services/          # UI 无关的统一数据适配器
├─ stores/            # Zustand 演示时钟和交互状态
├─ theme/             # 设计令牌与响应式样式
├─ types/             # 领域类型
└─ tests/             # Vitest 业务规则测试
```

## 切换真实接口

UI 仅依赖 `StationDataAdapter`。后续在 `src/services/adapter.ts` 实现 `RestStationAdapter`，并在组合根替换 `stationAdapter` 即可；组件无需重写。已预留：

- `GET /api/v1/stations/{stationId}/snapshot`
- `GET /api/v1/stations/{stationId}/minute-series`
- `GET /api/v1/stations/{stationId}/recognition/latest`
- `GET /api/v1/stations/{stationId}/feedback-batches`
- `GET /api/v1/stations/{stationId}/corrections`
- `GET /api/v1/stations/{stationId}/results`
- `POST /api/v1/imports`
- `POST /api/v1/exports`
- `WS /api/v1/stream?stationId=...`

过程驾驶舱独立依赖 `ProcessDataAdapter`（`src/services/processAdapter.ts`），已同时实现 Mock 与真实 HTTP/SSE 入口：

- `GET /api/v1/stations/{stationId}/process/collection`
- `GET /api/v1/stations/{stationId}/training-runs/latest`
- `SSE /api/v1/stations/{stationId}/process/collection/stream`，事件名为 `telemetry`

环境变量 `VITE_DATA_SOURCE=api` 可切换到真实过程接口，`VITE_API_BASE_URL` 用于配置 API 根地址。训练收敛图只绘制接口返回的 `epochs`；接口未返回时展示等待态，不在 UI 内重建或伪造曲线。

WebSocket/SSE 接入时，应继续由 adapter 把事件转换成领域类型，并坚持以 `arrival_time <= 当前时刻` 过滤可见数据，再按 `event_time` 归属历史周期。

## 需要真实后端支持

- 实际站点、模型服务、实时 WebSocket/SSE 推送与鉴权。
- 服务端文件解析、长期存储、审计日志和大规模历史分页。
- 7 天以上历史数据的服务端抽稀与缩放后明细加载。
- 真实模型推理、模型健康度和质量规则计算。

本项目不包含光伏预测、储能/充电桩功率分离、模型训练、设备控制或调度闭环。
