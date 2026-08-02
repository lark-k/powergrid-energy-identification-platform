# 台区能源辨识与光伏功率分离平台

面向企业内网部署的台区监测分析平台。稳定业务资源为：总开（`main_switch`）、光伏（`pv`）、能源站（`energy_station`）和充电桩（`charger`）。当前仅对光伏进行数值功率分离；能源站与充电桩只输出辨识概率和状态。系统不提供设备控制、调度指令或自动闭环。

## 架构

```text
React 前端 -> Java 模块化业务后台 -> Python 模型服务 -> CurrentSgccModelRunner -> SGCC-project
```

- `frontend/`：React 19 + TypeScript + Vite；`api` 模式只访问 Java，`mock` 模式用于显式演示。
- `backend/`：Java 21 + Spring Boot 3.5 模块化单体，负责权限、幂等接入、持久化、反馈校正、实时事件、审计和模型发布。
- `model-service/`：FastAPI 服务，启动时一次性加载两套 checkpoint，封装窗口、插值、归一化、阈值和字段映射。
- `contracts/`：前端业务 API、Java/Python 内部 API 及事件 JSON Schema 的唯一稳定契约。
- `deploy/`：本地 Compose、生产覆盖配置、非 root 镜像和反向代理。
- `SGCC-project/`：可替换的现有模型实现及用户模型资产；平台构建不会重写数据集和 checkpoint。

## 一键本地启动

前提：Docker Engine 与 Compose v2，建议至少 8 GB 可用内存。

```powershell
Copy-Item deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build
```

打开 `http://localhost:5173`。本地 Compose 显式使用开发认证和开发密钥；这些值不是生产默认值。生产必须叠加 `deploy/compose.production.yml`，通过 OIDC 与密钥挂载注入配置。

## 独立验证

```powershell
cd model-service
python -m pytest

cd ../backend
.\mvnw.cmd test
.\mvnw.cmd package

cd ../frontend
npm.cmd test
npm.cmd run build
npm.cmd run test:sites
```

详见 [本地开发](docs/local-development.md)、[部署](docs/deployment.md)、[安全配置](docs/security.md)、[模型替换与回滚](docs/model-replacement.md)、[当前模型边界](docs/current-model-boundaries.md)、[内部模型接口](docs/internal-model-interface.md)、[数据字典](docs/data-dictionary.md)、[故障排查](docs/troubleshooting.md)和[验收报告](docs/acceptance-report.md)。

## 当前模型边界

- 辨识使用截至目标分钟的最近 120 分钟连续总开窗口。
- 光伏分离使用截至目标分钟的最近 240 分钟连续总开窗口。
- 最多插值 3 分钟且必须有两端真实锚点；目标分钟必须是真实点；不会读取未来分钟。
- 无结果返回 `null`，不使用 0 代替缺失结果。
- 当前充电桩数据没有与其他资源完成真实同步混合验证。
- 当前模型用于其他台区正式应用前必须完成外部测试、回放评估和人工审批。

接口入口：[平台 OpenAPI](contracts/platform-api.openapi.yaml)、[模型服务 OpenAPI](contracts/model-service.openapi.yaml)、[事件 Schema](contracts/events.schema.json)。
