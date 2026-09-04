# Java 业务后台

Java 21 / Spring Boot 3.5 模块化单体。后台不加载 PyTorch checkpoint、不复制模型特征工程，也不启动 Python 命令行；所有模型推理通过 `integration/modelservice` 的稳定 HTTP 契约完成。

## 模块

`security`、`station`、`measurement`、`recognition/model`、`separation`、`feedback`、`correction`、`training`、`process/realtime`、`audit`、`integration/mqtt` 和 `integration/modelservice` 分别承担权限、总开幂等接入、MQTT 协议适配、推理持久化、历史反馈校正、模型注册发布、实时事件与审计。

## MQTT 实时接入

设置 `MQTT_ENABLED=true` 后，后台匿名连接 `MQTT_BROKER_URI`，订阅 `MQTT_TOPIC_FILTER`。测录终端消息中的 `TotW_MA`、`PhW_phsA_MA`、`PhW_phsB_MA` 和 `PhW_phsC_MA` 会转换为现有分钟点并触发两套模型。测点时间统一截断到分钟，协议中的 `quality=0` 映射为 `good`，其他值映射为 `warning`。

设备与台区通过逗号分隔的 `MQTT_DEVICE_STATION_MAPPINGS` 配置，例如 `202606050023=A01,另一个设备=另一个台区`。目标台区必须已存在。当前 Broker 不使用用户名和密码；如果部署多个后台实例，每个实例必须配置不同的 `MQTT_CLIENT_ID`。

Flyway V1 可从空 PostgreSQL 创建核心业务表，V2 增加可审计的历史推理回放任务。开发演示数据仅位于 `db/devdata`，只有 `dev`/`test` profile 会加载；生产不会自动写入 Mock 数据。

## 历史数据补算

直接写入数据库的既有总开分钟不会产生 Spring 分钟到达事件。管理员或操作员可通过 `POST /api/v1/stations/{stationId}/inference-replays` 发起最长 31 天的历史补算。后台按 300 个目标分钟分片，读取每片之前最多 239 分钟原始历史，批量调用 Python `/internal/v1/inference/replay`，再按模型版本幂等保存辨识和光伏分离结果。

任务状态通过 `GET /api/v1/stations/{stationId}/inference-replays/{jobId}` 查询。窗口不足、长缺口或模型不可用不会产生伪造输出，分别计入 `skipped_targets` 或 `failed_targets`。`dry_run=true` 只统计范围内目标分钟，不调用模型、不写模型结果。

## 独立启动

1. 启动 PostgreSQL 与 Python 模型服务。
2. 复制 `.env.example` 的键到本地环境并修改值。
3. 启动：

```powershell
.\mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=dev
```

生产使用 `SPRING_PROFILES_ACTIVE=prod`、`SECURITY_MODE=oidc`、`OIDC_ISSUER_URI`、数据库密钥和服务间令牌。生产配置没有默认账号、密码或签名密钥。

## 验证

```powershell
.\mvnw.cmd test
.\mvnw.cmd package
.\mvnw.cmd cyclonedx:makeAggregateBom
```

测试包括领域规则、MockMvc、Flyway 空库迁移、幂等/乱序/越权以及模型契约。PostgreSQL Testcontainers 用例在 Docker 可用时自动运行。

健康端点：`/actuator/health/liveness`、`/actuator/health/readiness`；指标：`/actuator/prometheus`。平台接口以 `../contracts/platform-api.openapi.yaml` 为准，生产不匿名开放 Swagger。
