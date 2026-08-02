# 本地开发与联调

## Compose

```powershell
Copy-Item deploy/.env.example deploy/.env
docker compose --env-file deploy/.env -f deploy/docker-compose.yml up --build
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

前端地址为 `http://localhost:5173`。前端容器只代理 `/api` 到 Java；Python 与 PostgreSQL 位于独立内部网络，浏览器不可直接访问。

发送总开分钟数据：

```powershell
$body = @{
  points = @(@{
    station_id = 'A01'; event_time = '2026-08-01T08:00:00+08:00'
    active_power_kw = 5200; phase_a_power_kw = 1730; phase_b_power_kw = 1740; phase_c_power_kw = 1730
    coverage_ratio = 1; quality_flag = 'good'; source_id = 'local-smoke'
  })
} | ConvertTo-Json -Depth 5
Invoke-RestMethod -Method Post -Uri http://localhost:5173/api/v1/ingestion/main-switch/minutes -ContentType application/json -Body $body
```

未达到 120/240 分钟窗口时，辨识/分离保持空值并显示预热状态。测试真实推理应连续发送至少 240 个分钟点。

SGCC 原始分钟 CSV 使用受控脚本导入。脚本将原始北京时间转换为带时区时间，并把三相 W 转换为 kW；默认只校验，增加 `--apply` 才写入：

```powershell
python deploy/scripts/import_sgcc_main_switch.py `
  --source "sgcc-main-a=SGCC-project/202511050004 总开" `
  --source "sgcc-main-b=SGCC-project/台区数据总开0"
```

正式写入时增加 `--apply`。批量导入不会为每分钟立即推理，完成后再创建一次历史回放任务。不得把光伏、能源站或充电桩分表误导入 `main_switch_minute`。

如果数据已经直接存在 PostgreSQL 中，需要显式发起历史推理回放：

```powershell
$replay = @{
  from = '2026-07-01T00:00:00+08:00'
  to = '2026-07-02T00:00:00+08:00'
  dry_run = $false
} | ConvertTo-Json
$job = Invoke-RestMethod -Method Post `
  -Uri http://localhost:5173/api/v1/stations/A01/inference-replays `
  -ContentType application/json -Body $replay
Invoke-RestMethod "http://localhost:5173/api/v1/stations/A01/inference-replays/$($job.job_id)"
```

单次范围最多 31 天。回放只读取总开历史并执行真实模型，不修改原始分钟数据；相同模型版本重复回放不会产生重复业务结果。页面“历史时刻”控件使用 `/data-range` 返回的最早/最晚分钟约束选择范围。

## 脱离 Docker

- Python：在 `model-service/` 执行 `python -m uvicorn app.main:app --host 127.0.0.1 --port 8000`。
- Java：配置 PostgreSQL 和模型服务环境变量后，在 `backend/` 执行 `.\mvnw.cmd spring-boot:run -Dspring-boot.run.profiles=dev`。
- 前端：在 `frontend/` 设置 `VITE_DATA_SOURCE=api`，执行 `npm.cmd run dev`。

切换 `VITE_DATA_SOURCE=mock` 才会使用演示生成器；`api` 模式没有 Mock 回退。
