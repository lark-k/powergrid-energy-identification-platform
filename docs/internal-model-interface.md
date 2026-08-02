# Java / Python 内部模型接口

契约源为 `contracts/model-service.openapi.yaml`。Java 只发送稳定分钟字段：台区、带时区事件时间、总开及三相有功 kW、覆盖率、质量标记和来源；不会发送 checkpoint 路径或模型结构。

Python `CurrentSgccModelRunner` 在进程 lifespan 中加载模型一次，提供：

```text
manifest() -> ModelManifest
infer(points: list[MinutePoint]) -> InferenceResult
health() -> ModelHealth
```

响应保存目标时间、120/240 分钟窗口、插值分钟数、质量、两套真实模型版本、三个辨识结果、光伏数值分离、耗时和 warnings。所有比例为 0～1，功率为 kW，缺失值为 `null`。

Java 调用具有连接/读取超时、有限重试和熔断。active 调用失败不会丢失原始总开分钟；candidate 调用失败也不会影响 active 结果。`request_id` 同时进入 HTTP、数据库、outbox 和日志。服务间 Bearer 令牌由环境变量或密钥挂载注入，日志不得输出令牌。
