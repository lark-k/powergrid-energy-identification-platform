# 数据字典

所有业务时间使用带时区时间，功率单位为 kW，比例为 0～1；缺失数值使用 `null`，不得使用 0 代替无结果。

| 表 | 用途 | 关键约束 |
|---|---|---|
| `station` | 台区主数据 | `station_id` 主键 |
| `main_switch_minute` | 总开及 A/B/C 三相分钟数据 | `station_id + event_time` 唯一，支持幂等与乱序写入 |
| `recognition_result` / `recognition_item` | 光伏、能源站、充电桩辨识 | 关联窗口、质量、模型版本和部署角色 |
| `pv_separation_result` | 光伏初始/校正分离结果 | 只保存真实模型输出；校正字段可空 |
| `pv_feedback_batch` / `pv_feedback_point` | 光伏分站反馈 | `arrival_time` 控制可见性，`event_time` 匹配业务分钟 |
| `correction_record` | 历史校正审计 | 保留前值、参考值、后值和原因 |
| `model_registry` / `model_deployment` | 模型注册、候选、active 与回滚 | 制品摘要和审批记录 |
| `inference_replay_job` | 历史真实推理回放任务 | 保存时间范围、进度、成功/跳过/失败数及错误信息；结果写入仍保持幂等 |
| `training_run` / `training_epoch` | 真实训练运行与曲线 | 无记录即返回空，不生成指标 |
| `collection_process_event` / `node_status` / `data_quality_summary` | 采集过程与质量 | 缺失、重复、乱序计数 |
| `audit_log` | 操作和数据访问审计 | request_id、主体、资源、状态 |
| `outbox_event` | 可靠实时事件 | event_id、request_id、发生时间、重试状态 |

稳定资源标识只使用 `main_switch`、`pv`、`energy_station`、`charger`。`energy_station_detected` 是当前 SGCC 模型字段到平台 `energy_station` 的内部映射。

## 历史回放状态

- `queued`：任务已持久化，等待执行。
- `running`：正在按批次调用模型服务并保存结果。
- `completed`：目标分钟已遍历完成；详细成功、跳过和失败数量以计数字段为准。
- `failed`：任务无法继续，错误摘要记录在 `error_message`，原始分钟数据不受影响。
