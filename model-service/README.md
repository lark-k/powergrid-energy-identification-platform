# Python 模型服务

该服务将 `SGCC-project` 作为可替换模型实现，通过稳定的内部 API 向 Java 后台提供因果分钟推理。服务启动时只加载一次两套 checkpoint；请求不会启动 Python 子进程，也不会重新加载模型。

当前能力：

- 最近 120 分钟总开数据用于光伏、能源站、充电桩当前分钟辨识；
- 最近 240 分钟总开数据用于当前分钟光伏功率分离；
- 总开有功和 A/B/C 三相有功均以 kW 接口输入；
- 最多 3 分钟、两端有真实锚点的短缺口线性插值；
- 当前分钟必须是真实数据，不读取未来分钟；
- 能源站和充电桩不返回分离功率；
- 历史不足或窗口不连续时返回 `null` 结果和明确质量状态，不用 0 伪装缺失结果。

## 独立运行

```powershell
cd model-service
python -m uvicorn app.main:app --host 0.0.0.0 --port 8000
```

配置见 `.env.example`。生产必须启用 `MODEL_SERVICE_AUTH_REQUIRED=true` 并通过密钥挂载注入 `MODEL_SERVICE_TOKEN`。`MODEL_SERVICE_ENV=production` 时不开放 Swagger UI。

## 接口

- `GET /health/live`
- `GET /health/ready`
- `GET /metrics`
- `GET /internal/v1/models`
- `GET /internal/v1/models/{task}/manifest`
- `POST /internal/v1/inference/minute`
- `POST /internal/v1/inference/batch`
- `POST /internal/v1/inference/replay`

完整字段见 `../contracts/model-service.openapi.yaml`。

## 测试

```powershell
python -m pytest
```

测试会真实加载仓库现有两套 checkpoint，并使用当前总开样例完成推理。当前充电桩数据没有与总开、光伏、能源站完成真实同步混合验证；跨台区正式应用前必须执行外部测试。系统只做监测分析，不提供设备控制。
# 01/04 光伏第三版适配

内置 `artifacts/pv-v3/` 的 Small Causal S4D，116通道、240分钟，按到达分钟推理。与资源辨识可独立切换。`pv_v3_manifest.json` 连同原交付清单、归一化及权重参与完整制品摘要。

在线/回放的可选 `separation_points` 提供精确 `measurement_time`、`arrival_time`，不会改变原辨识 `points`。适配器每个请求重建因果保持状态，空到达输入或长缺测返回空分离结果。`separation_input_power_kw` 是同一到达窗口的有效总开功率，供业务保存和功率账务使用。详细接入边界见 `docs/model-replacement.md`。
