# 故障排查

| 现象 | 检查 | 处理 |
|---|---|---|
| 前端显示后台离线 | Java readiness、反向代理 `/api`、CORS、OIDC token | 修复后台/代理；API 模式不会回退 Mock |
| 显示窗口预热 | 总开连续点数、目标分钟是否真实、缺口是否超过 3 分钟 | 补齐真实历史；不要用 0 伪装数据 |
| 模型 readiness 失败 | checkpoint SHA、manifest、归一化和阈值摘要 | 重新发布完整模型制品，禁止单独换 checkpoint |
| 推理 degraded | Java `modelService` 健康、Python 日志、超时/熔断计数 | 原始分钟已保留；恢复后可从数据库回放 |
| 反馈未出现 | `arrival_time` 是否到达、台区和批次、覆盖业务时间 | 到达后按历史 `event_time` 校正，不修改为 arrival_time |
| 没有训练曲线 | `training_run` / `training_epoch` 是否有真实记录 | 正常空态；禁止在 UI 或后台生成曲线 |
| WebSocket 403 | 用户台区授权、OIDC token、代理是否保留子协议头 | 修复授权或代理；不要把 token 放 URL |
| Testcontainers 跳过 | Docker daemon/Compose 是否可用 | 启动 Docker 后重新执行 Maven test |

使用响应中的 `request_id` 关联 Java/Python/outbox 日志。日志与工单中不得粘贴访问令牌或完整敏感数据。
