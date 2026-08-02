# 平台契约

本目录是前端、Java 业务后台和 Python 模型服务之间的稳定契约源。

- `platform-api.openapi.yaml`：Java 对前端的业务 API。
- `model-service.openapi.yaml`：Java 调用 Python 的内部推理 API。
- `events.schema.json`：outbox、SSE 与 WebSocket 共用的事件信封。

统一业务资源标识为 `main_switch`、`pv`、`energy_station`、`charger`。当前仅 `pv` 返回数值分离功率；`energy_station` 和 `charger` 只返回辨识概率与状态。功率单位为 kW，比例为 0～1，无结果使用 `null`，不得用 0 代替缺失结果。

所有接口均为只读分析或数据管理接口，不包含设备控制、调度指令或自动闭环。
