# 模型替换、切换与回滚

1. 将 checkpoint、归一化参数、阈值、预处理定义、输入/输出 Schema 和 manifest 打成不可分割制品，计算 SHA-256。
2. 实现新的 `ModelRunner`，保持 `manifest()`、`infer(points)`、`health()`；不得修改平台业务契约。
3. 注册为 `candidate`，readiness 必须验证摘要与预处理契约。摘要不匹配时禁止加载。
4. 将 candidate runner 部署为第二个模型服务实例，设置 `MODEL_SHADOW_ENABLED=true` 和 `MODEL_CANDIDATE_SERVICE_BASE_URL`。Java 会对同一原始窗口调用 active/candidate；candidate 失败不影响 active 结果，并自动写入 `shadow_inference_comparison` 的概率与光伏功率差异。
5. 人工审批后将 candidate 切为 active。每条业务结果继续保存其真实 `model_version`、窗口和摘要。
6. 异常时调用回滚操作恢复上一 active 部署；历史结果不覆写，只对后续推理生效。

不得只替换 `.pt` 后沿用不匹配的归一化或阈值。当前 `CurrentSgccModelRunner` 的辨识窗口为 120 分钟、光伏分离窗口为 240 分钟；替换 SGCC 实现时 Java 和前端接口不变。

当前限制：只有光伏有数值分离；能源站和充电桩只有概率/状态；当前充电桩数据未完成与其他资源的真实同步混合验证；跨台区正式发布前必须完成外部测试。
