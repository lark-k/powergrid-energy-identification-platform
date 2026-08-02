# 台区能源辨识与光伏功率分离前端

React 19 + TypeScript + Vite 单页前端，保留原有指挥大屏设计。页面展示总开有功、光伏分离、反馈校正，以及光伏、能源站、充电桩三个独立辨识结果。只有光伏显示数值分离功率。

## 数据模式

- `VITE_DATA_SOURCE=api`：`RestStationAdapter` 只访问 Java `/api/v1`；没有 Mock 回退。
- `VITE_DATA_SOURCE=mock`：显式演示模式，使用确定性生成器；演示数据不代表真实模型输出。
- `VITE_API_BASE_URL`：Java API 根地址；容器部署留空并由同源 Nginx 代理。

认证令牌从 `powergrid_access_token` 本地存储键或受控的 `VITE_ACCESS_TOKEN` 冒烟配置读取。REST/SSE 使用 Bearer 头；WebSocket 使用不进入 URL 的受控子协议。401、403、404、422、500、503 转换为带 `request_id` 的统一页面状态。

## 运行与测试

```powershell
npm.cmd ci
npm.cmd run dev
npm.cmd test
npm.cmd run build
npm.cmd run test:e2e
npm.cmd run test:sites
```

环境变量示例见 `.env.example`。默认 Vite 端口为 5173。

## 已实现

- 多台区列表与选择；1h / 6h / 24h / 7d 服务端范围加载；实时/历史时刻切换使用后台真实数据边界。
- 总开分钟曲线直接来自 `main_switch_minute`，即使光伏分离仍在预热也保持可见；光伏曲线只叠加真实 `pv_separation_result`。
- 能源站和充电桩只显示概率/状态，不推断或显示分离功率。
- 结果详情显示真实模型版本、输入窗口和数据质量。
- WebSocket 与 SSE 自动重连；WebSocket 重连后按当前历史锚点和范围重新拉取完整 snapshot，不会强制跳回当前 24 小时。
- 后台离线、模型降级、总开数据延迟、120/240 分钟窗口预热、无真实训练记录空态。
- API 训练曲线只使用后台 `training_epoch`；没有记录时为空。
- CSV/JSON 安全导入入口与服务端 CSV 导出。
- 响应式布局、键盘焦点、降低动效和关键页面 Playwright E2E。

## 主要目录

```text
src/
├─ components/       # 图表、指标、抽屉和覆盖层
├─ features/         # 指挥舱、辨识、分离、反馈、校正和过程驾驶舱
├─ mocks/            # 仅 mock 模式使用的演示生成器
├─ services/         # REST、认证、WebSocket、SSE 与错误适配
├─ stores/           # 多台区、连接、范围和交互状态
├─ types/            # 稳定前端领域类型
└─ tests/            # Vitest
tests/e2e/            # Playwright
```

前端不加载 `.pt`、不解析模型 CSV、不调用 Python、不生成训练指标或缺失模型输出，也不提供设备控制。
