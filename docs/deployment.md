# 部署指南

## 生产原则

- 默认部署在内网；镜像与依赖制品应预先同步到企业镜像仓库/制品库。
- 生产叠加 `deploy/compose.production.yml`，使用 OIDC、外部数据库密钥和服务间令牌。
- PostgreSQL、Java、Python 和前端分别运行非 root 容器；数据库、模型和前端网络隔离。
- 模型目录是只读发布制品。checkpoint、归一化参数、阈值与预处理定义必须作为同一版本签名发布。

示例：

```powershell
$env:OIDC_ISSUER_URI='https://oidc.internal.example/realms/powergrid'
$env:CORS_ALLOWED_ORIGINS='https://powergrid.internal.example'
$env:DB_PASSWORD_SECRET_FILE='D:\secrets\db-password.txt'
$env:MODEL_SERVICE_TOKEN_SECRET_FILE='D:\secrets\model-token.txt'
docker compose -f deploy/docker-compose.yml -f deploy/compose.production.yml up -d
```

不要把 `deploy/.env.example` 的开发值用于生产。生产部署前应锁定镜像 digest，执行依赖扫描并生成 SBOM：Java 使用 `mvn cyclonedx:makeAggregateBom`；Python/Node 可在离线制品流水线使用 CycloneDX CLI 对锁定文件生成清单。

## 可观测性接入

Java 暴露 Actuator/Prometheus；Python 暴露 `/metrics`、liveness/readiness。两侧日志均写标准输出并携带 `request_id`，可由企业 Fluent Bit、Filebeat、Vector 或 OpenTelemetry Collector 收集，不依赖公网 SaaS。建议告警：readiness 失败、模型加载失败、窗口长期 warming、推理 p95、调用失败率、重复/乱序/缺失计数、outbox 重试积压。

入口网关应限制上传和接入速率，并对读取接口按用户/台区限流。推荐在网关保留 `X-Request-ID`，禁止记录 Authorization、WebSocket 子协议原值和请求体原始敏感数据。
