# 台区光储充辨识与光伏功率分离平台

面向台区能源监测、企业展厅与运维指挥场景的可视化平台原型。平台通过分钟级功率数据展示光伏、储能和充电桩的存在性辨识结果，并对光伏功率进行初始分离、分站反馈校正和全过程追溯。

当前仓库包含可运行的 React 前端、后台接口约定、需求手册和设计验收资料；真实业务后端与模型服务尚未包含在仓库中。

## 核心能力

- 展示台区总有功、初始光伏、校正后光伏、分站参考和剩余负荷等分钟级曲线。
- 分别给出光伏、储能、充电桩的存在性标签和辨识分数。
- 以 `event_time` 和 `arrival_time` 双时间轴处理延迟反馈与历史校正。
- 展示分站缺失、乱序、质量告警、长延迟和批量回传等数据事件。
- 支持分钟结果、反馈批次、参与节点与校正记录的查询和追溯。
- 提供数据采集与模型训练过程驾驶舱。
- 支持 CSV 导出、数据导入入口、阈值设置、全屏和多时间范围切换。
- 通过数据适配器隔离 Mock 数据与 REST、WebSocket、SSE 接口。

> 当前版本只对光伏功率进行数值分离。储能与充电桩仅展示辨识结果，不包含功率分离、设备控制或调度闭环。

## 当前实现状态

| 模块 | 状态 | 说明 |
| --- | --- | --- |
| 主看板 | 可运行 | 使用确定性 Mock 数据，可重复演示 |
| 数据采集驾驶舱 | 可运行 | 支持 Mock，也预留 HTTP + SSE 接口 |
| 模型训练驾驶舱 | 可运行 | 支持 Mock，也可读取真实训练运行数据 |
| 主看板真实数据 | 待接入 | 需要实现 `RestStationAdapter` 并替换当前 Mock 适配器 |
| 后台与模型服务 | 未包含 | 接口与业务规则见 `docs/` |

## 技术栈

- React 19 + TypeScript
- Vite 6
- ECharts 6
- TanStack Query、TanStack Table
- Zustand
- Sass
- Vitest + Testing Library
- Playwright
- MSW

## 快速开始

### 环境要求

- Node.js 18、20 或 22 及以上兼容版本
- npm

### 安装与启动

```bash
cd frontend
npm ci
npm run dev
```

开发服务器默认地址：

```text
http://localhost:5173
```

页面默认运行在 Mock 模式，不依赖后台服务。

## 常用命令

以下命令均在 `frontend/` 目录执行：

```bash
npm run dev          # 启动开发服务器
npm run build        # 生产构建
npm run preview      # 本地预览生产构建
npm test             # 运行 Vitest 测试
npm run test:watch   # 以监听模式运行 Vitest
npm run test:e2e     # 运行 Playwright 端到端测试
npm run test:sites   # 校验 Sites Worker 构建产物
```

生产构建输出位于 `frontend/dist/`：

```text
dist/
├─ client/            # 前端静态资源
├─ server/index.js    # SPA 回退 Worker
└─ .openai/
   └─ hosting.json    # Sites 部署配置
```

## 数据源配置

过程驾驶舱可通过环境变量切换至真实 HTTP/SSE 接口。在 `frontend/` 下创建 `.env.local`：

```dotenv
VITE_DATA_SOURCE=api
VITE_API_BASE_URL=http://localhost:8080
```

| 变量 | 默认值 | 作用 |
| --- | --- | --- |
| `VITE_DATA_SOURCE` | `mock` | 设为 `api` 时启用真实过程数据适配器 |
| `VITE_API_BASE_URL` | 空字符串 | 后台 API 根地址；为空时使用同源地址 |

需要注意：

- 该开关目前作用于数据采集和模型训练过程驾驶舱。
- 主看板仍使用 `MockStationAdapter`。接入真实数据时，需要在 `frontend/src/services/adapter.ts` 中实现并启用 `RestStationAdapter`。
- 实时接口事件应先转换为统一领域类型，再按到达时间过滤、按事件时间归属历史周期。

## 项目结构

```text
.
├─ docs/
│  ├─ 台区光储充辨识与光伏功率分离系统需求手册_V0.3.docx
│  ├─ 台区光储充辨识平台后台接口文档_V1.1.md
│  └─ design-qa/              # 设计参考、截图与验收记录
├─ frontend/
│  ├─ public/                 # 静态资源
│  ├─ scripts/                # 构建辅助脚本
│  ├─ src/
│  │  ├─ components/          # 图表、指标、表格与弹层
│  │  ├─ config/              # 站点、阈值、节点与主题配置
│  │  ├─ features/            # 业务功能模块
│  │  ├─ mocks/               # Mock 数据生成器与 handlers
│  │  ├─ services/            # 数据适配器
│  │  ├─ stores/              # 页面状态
│  │  ├─ theme/               # 全局样式与响应式布局
│  │  ├─ types/               # 领域类型
│  │  └─ tests/               # 单元与业务规则测试
│  ├─ tests/e2e/              # Playwright 测试
│  ├─ worker/                 # SPA 部署 Worker
│  └─ README.md               # 前端详细说明
└─ README.md
```

## 接口接入

后台应优先实现以下最小联调接口：

```text
GET /api/v1/stations/{stationId}/snapshot
GET /api/v1/stations/{stationId}/process/collection
GET /api/v1/stations/{stationId}/training-runs/latest
SSE /api/v1/stations/{stationId}/process/collection/stream
WS  /api/v1/stream?stationId=...
```

历史查询、反馈批次、校正记录、导入导出、错误响应及完整字段定义，请参阅[后台接口文档](docs/台区光储充辨识平台后台接口文档_V1.1.md)。

## 相关文档

- [前端详细说明](frontend/README.md)
- [后台接口文档 V1.1](docs/台区光储充辨识平台后台接口文档_V1.1.md)
- [设计验收记录](docs/design-qa/design-qa.md)
- [前端设计 QA 说明](frontend/design-qa.md)
- [视觉设计基准](docs/design-qa/assets/reference/design-reference.png)

需求手册位于 `docs/台区光储充辨识与光伏功率分离系统需求手册_V0.3.docx`。

