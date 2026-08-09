# 部署与历史数据迁移手册

本文面向负责交付和运维的人员。目标是在一台新的 Linux 服务器上启动平台后，直接看到与当前本地环境一致的台区、分钟采集、辨识结果、光伏分离结果、训练曲线和模型，而不是一个空数据库。

## 1. 部署物说明

平台发布分为两部分，必须同时交付：

1. **程序仓库**：前端、Java 后端、Python 模型服务、Dockerfile 和 Compose 配置。
2. **部署数据包**：当前 PostgreSQL 快照、正式模型、原始/训练数据资产、SHA256 清单和数据基线。

不要把 Docker named volume 目录直接复制到另一台服务器。数据库迁移统一使用 PostgreSQL custom dump（`pg_dump -Fc`）和 `pg_restore`。Docker named volume 只负责目标服务器部署后的持续持久化。

部署数据包结构如下：

```text
powergrid-demo-YYYYMMDD-HHMMSS/
├── manifest.json
├── SHA256SUMS
├── database/
│   ├── powergrid.dump
│   └── metadata.json
├── models/
│   ├── selected_model.pt
│   └── selected_pv_model.pt
└── assets/
    └── sgcc-project.tar.gz
```

`manifest.json` 保存源 Git commit、数据库表行数、分钟数据时间范围、Flyway 版本、模型哈希和全部文件哈希。服务器部署脚本会先校验这些值，再进行恢复。

## 2. 部署模式

### 2.1 演示模式

演示模式与本地运行行为最接近，使用 `dev-operator` 和开发认证，打开页面即可查看数据。

只允许用于：

- 可信内网；
- VPN 后方；
- 防火墙限制来源 IP 的验收服务器。

不要把演示模式直接暴露到公网。演示模式没有真实登录保护，请至少在云安全组或服务器防火墙中限制访问来源。

### 2.2 生产模式

生产模式启用 OIDC、文件型 Docker secrets 和生产 Spring profile。使用前必须准备：

- 可访问的 OIDC issuer；
- 与页面域名完全一致的 CORS origin；
- 数据库密码文件；
- Java/Python 服务间令牌文件；
- 网关或反向代理提供 HTTPS；
- OIDC 用户的 `sub` 与平台 `user_station_role.user_id` 映射。

若只是学校演示或封闭网络验收，先使用演示模式完成数据一致性验收，再接入 OIDC。

## 3. 环境要求

### 3.1 本地导出端

- 当前本地 Compose 正在健康运行；
- Docker Engine 与 Docker Compose v2；
- Python 3.11 或更高版本；
- 至少 2 GB 可用磁盘空间；
- 当前操作系统用户有权执行 Docker 命令。

### 3.2 目标服务器

推荐：

- Linux x86_64；
- 4 核 CPU；
- 8 GB 内存；
- 20 GB 以上可用磁盘；
- Docker Engine 26+ 与 Compose v2；
- Python 3.11+；
- 已开放所选前端端口；
- 系统时间与 NTP 正常同步。

默认使用 CPU 推理。如果改用 NVIDIA GPU，还需安装与宿主机驱动匹配的 NVIDIA Container Toolkit，并相应调整模型镜像和 Compose 设备配置。未完成 GPU 验证时保持 `MODEL_DEVICE=cpu`。

## 4. 在当前本地环境生成部署数据包

先确认本地系统可访问：

```powershell
docker compose --env-file deploy/.env -f deploy/docker-compose.yml ps
```

四个服务应全部为 `healthy`。然后在仓库根目录执行：

```powershell
python deploy/scripts/create_deployment_bundle.py
```

脚本执行以下操作：

1. 从当前 PostgreSQL 容器生成一致性 custom dump；
2. 读取所有关键业务表行数、Flyway 版本和分钟时间范围；
3. 复制当前正式辨识模型和光伏分离模型；
4. 将完整 `SGCC-project` 原始数据、数据集、训练输出和日志归档；
5. 生成 `manifest.json` 与 `SHA256SUMS`。

输出默认位于：

```text
deploy/releases/powergrid-demo-YYYYMMDD-HHMMSS/
```

该目录被 Git 忽略，必须作为交付文件单独复制。不要只执行 `git clone` 后就启动服务器，否则目标数据库会是空库。

如果只做日常数据库备份、不需要重复打包原始训练资产，可执行：

```powershell
python deploy/scripts/create_deployment_bundle.py --skip-assets
```

需要指定输出目录时：

```powershell
python deploy/scripts/create_deployment_bundle.py `
  --output D:\delivery\powergrid-demo-20260809
```

导出过程中不停止本地服务。正式割接时应暂停采集写入后再生成最后一个数据包，确保导出后没有遗漏的新数据。

## 5. 将程序和数据传到服务器

可以使用企业制品库、移动硬盘、SFTP 或 `scp`。需要传输：

- 完整程序仓库；
- 第 4 节生成的完整部署数据包。

Linux 示例：

```bash
scp -r powergrid-energy-identification-platform ops@SERVER:/opt/
scp -r powergrid-demo-20260809-120000 ops@SERVER:/opt/powergrid-releases/
```

进入服务器后确认：

```bash
cd /opt/powergrid-energy-identification-platform
docker version
docker compose version
python3 --version
```

## 6. 首次快速部署：演示模式

### 6.1 创建配置

```bash
cd /opt/powergrid-energy-identification-platform
cp deploy/.env.server.example deploy/.env.server
sudo mkdir -p /srv/powergrid
sudo chown -R "$(id -u):$(id -g)" /srv/powergrid
```

编辑 `deploy/.env.server`，至少修改：

```dotenv
POWERGRID_DATA_DIR=/srv/powergrid
POSTGRES_DB=powergrid
POSTGRES_USER=powergrid_dev
POSTGRES_PASSWORD=使用强随机密码
MODEL_SERVICE_TOKEN=使用另一个强随机令牌
FRONTEND_PORT=5173
SPRING_PROFILES_ACTIVE=dev
SECURITY_MODE=dev
CORS_ALLOWED_ORIGINS=http://服务器IP:5173
MODEL_DEVICE=cpu
```

配置文件不得提交到 Git。建议权限：

```bash
chmod 600 deploy/.env.server
```

### 6.2 一键恢复并启动

```bash
python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-20260809-120000 \
  --env-file deploy/.env.server \
  --mode demo
```

脚本会依次：

1. 校验数据包全部 SHA256；
2. 将正式模型安装到 `/srv/powergrid/models`；
3. 将完整数据资产展开到 `/srv/powergrid/SGCC-project`；
4. 只启动 PostgreSQL；
5. 检测数据库是否为空；
6. 空库时恢复历史数据，非空时保留已有数据，绝不覆盖；
7. 构建并启动模型、后端和前端；
8. 等待四个服务健康；
9. 核对每张关键表不少于导出时的行数；
10. 输出历史数据时间范围和访问地址。

成功后打开：

```text
http://服务器IP:5173
```

如果服务器防火墙未放行端口，需要只对指定来源地址开放 `FRONTEND_PORT`。PostgreSQL、Java 后端和模型服务没有映射到宿主机，不应对公网开放。

## 7. 生产模式部署

### 7.1 准备 secret 文件

```bash
sudo mkdir -p /srv/powergrid/secrets
sudo sh -c 'umask 077; printf "%s" "数据库强密码" > /srv/powergrid/secrets/db-password.txt'
sudo sh -c 'umask 077; printf "%s" "服务间随机令牌" > /srv/powergrid/secrets/model-service-token.txt'
```

不要在命令历史中直接输入真实密码。正式环境应通过企业密码管理系统、安全输入或配置管理工具生成上述文件。这里的命令仅说明文件格式：文件中只放值本身，不带变量名，不添加多余空行。

编辑 `deploy/.env.server`：

```dotenv
POWERGRID_DATA_DIR=/srv/powergrid
POSTGRES_DB=powergrid
POSTGRES_USER=powergrid
FRONTEND_PORT=5173
MODEL_DEVICE=cpu
CORS_ALLOWED_ORIGINS=https://powergrid.example.com
OIDC_ISSUER_URI=https://oidc.example.com/realms/powergrid
DB_PASSWORD_SECRET_FILE=/srv/powergrid/secrets/db-password.txt
MODEL_SERVICE_TOKEN_SECRET_FILE=/srv/powergrid/secrets/model-service-token.txt
```

生产模式会覆盖 `SPRING_PROFILES_ACTIVE=prod`、`SECURITY_MODE=oidc`，并忽略环境文件中的明文数据库密码和模型令牌。

### 7.2 启动

```bash
python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-20260809-120000 \
  --env-file deploy/.env.server \
  --mode production
```

生产环境应由 Nginx、HAProxy 或企业网关终止 TLS，然后代理到前端端口。只开放 HTTPS 入口，不开放 PostgreSQL 5432、Java 8080 或 Python 8000。

### 7.3 OIDC 用户与台区权限

JWT 的 principal 通常是 OIDC `sub`。非管理员用户要看到 A01 台区，数据库中必须存在对应关系：

```sql
insert into app_user (user_id, display_name, enabled, created_at)
values ('OIDC_SUB', '运维用户', true, current_timestamp)
on conflict (user_id) do update set display_name = excluded.display_name, enabled = true;

insert into user_station_role (user_id, station_id, role_name, created_at)
values ('OIDC_SUB', 'A01', 'OPERATOR', current_timestamp)
on conflict do nothing;
```

请通过受控数据库管理通道执行，不要把实际用户标识写入仓库。OIDC 中的角色声明与 Spring Security authority 映射也必须在身份系统集成测试中确认。

## 8. 重复执行、更新与数据保护

`deploy_server.py` 是幂等且数据优先的：

- 目标数据库为空：恢复数据包；
- 目标数据库非空：跳过恢复，不覆盖线上数据；
- 容器重建：PostgreSQL named volume 保留；
- 模型文件：每次按数据包重新校验并安装；
- `SGCC-project` 已存在：保留服务器现有训练/原始资产，不用旧数据包覆盖；
- 数据基线：线上表行数不得低于数据包基线。

只重新部署程序时，仍可使用同一个数据包执行脚本。已有数据库会被保留，Flyway 在 backend 启动时执行新的向前迁移。

不要执行以下命令，除非已经确认要永久删除服务器数据库：

```text
docker compose down -v
docker volume rm ...
```

普通停止使用 `docker compose stop`，普通重建使用部署脚本或 `docker compose up -d --build`，均不会删除 named volume。

## 9. 部署后复验

部署脚本已经自动验收一次。需要人工再次复验时：

```bash
python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-20260809-120000 \
  --env-file deploy/.env.server \
  --mode demo \
  --verify-only
```

生产环境把 `--mode demo` 改为 `--mode production`。

人工验收清单：

- 首页能够显示 A01 台区；
- 历史功率曲线不为空；
- 辨识结果和光伏分离结果不为空；
- 训练过程显示两次历史训练及 epoch 曲线；
- 模型健康状态正常；
- 数据采集过程显示历史接收数量；
- 重启四个容器后数据仍存在；
- 新增一批数据后能够入库和推理；
- 日志中没有 Flyway、模型 SHA 或数据库连接错误。

查看状态与日志：

```bash
docker compose --env-file deploy/.env.server \
  -f deploy/docker-compose.yml -f deploy/compose.server.yml ps

docker compose --env-file deploy/.env.server \
  -f deploy/docker-compose.yml -f deploy/compose.server.yml logs --tail=200
```

生产环境排查时在命令中再叠加：

```text
-f deploy/compose.production.yml
```

## 10. 日常备份

### 10.1 生成数据库备份包

在能够访问运行中 Compose 的服务器仓库目录执行：

```bash
python3 deploy/scripts/create_deployment_bundle.py \
  --env-file deploy/.env.server \
  --skip-assets \
  --output /srv/powergrid/backups/powergrid-$(date +%Y%m%d-%H%M%S)
```

建议策略：

- 每日一次；
- 保留最近 7 个日备份；
- 保留最近 4 个周备份；
- 至少复制一份到另一台机器或企业备份存储；
- 备份目录加密并限制读取权限；
- 每月至少在隔离 PostgreSQL 中恢复一次。

注意：`create_deployment_bundle.py` 默认从基础 Compose 项目寻找 PostgreSQL，生产服务器同样适用，因为项目名和数据库 service 名保持不变。

### 10.2 备份一致性范围

数据库备份包含：

- 采集分钟数据；
- 辨识和分离结果；
- 反馈与校正记录；
- 训练运行和 epoch；
- 用户与台区权限；
- 审计和 outbox；
- Flyway schema history。

数据库不包含大型 `.npz` 数据集、完整 checkpoint、CSV/XLSX 和训练日志。这些文件位于 `POWERGRID_DATA_DIR/SGCC-project`，必须由文件备份策略同步保存。

## 11. 正式割接流程

为了避免本地导出后仍有新数据写入造成缺口，正式割接使用：

1. 提前生成测试数据包，在目标服务器完成一次全流程演练；
2. 记录本地 `main_switch_minute` 最大 `event_time`；
3. 暂停采集端写入；
4. 等待当前推理请求完成；
5. 生成最终部署数据包；
6. 将最终包传到服务器；
7. 在全新的空 PostgreSQL volume 上部署；
8. 核对脚本输出的行数和最大时间；
9. 把采集端地址切换到服务器；
10. 恢复采集并检查重复、缺失、乱序；
11. 本地旧系统保留只读至少一个回滚周期。

如果服务器已经因测试启动产生了非空数据库，部署脚本会保护它而不自动覆盖。正式割接应使用新的空 volume 或由数据库管理员在确认备份后清空测试库，不能通过脚本强制覆盖。

## 12. 升级与回滚

升级前：

1. 生成最新数据库备份；
2. 记录当前 Git commit、镜像 digest 和数据包 release ID；
3. 运行自动测试；
4. 检查 Flyway migration 是否只向前兼容；
5. 使用部署脚本更新；
6. 执行 `--verify-only`。

应用回滚优先切回原 Git commit/镜像。数据库 migration 默认不自动降级；如果新 migration 与旧应用不兼容，应恢复升级前备份到新的 PostgreSQL volume，再切换整套服务，不能直接在原库上试错。

模型回滚必须同时回滚 checkpoint、模型 manifest、归一化参数、阈值与预处理实现。不得只替换一个 `.pt` 文件。

## 13. 可观测性与安全

- Java 暴露 Actuator/Prometheus；Python 暴露 `/metrics`、liveness 和 readiness；
- 日志写标准输出并携带 `request_id`；
- 建议告警：readiness 失败、模型加载失败、推理 p95、数据库磁盘、重复/乱序/缺失计数、outbox 积压；
- 入口网关限制上传大小、采集速率和读取接口频率；
- 禁止记录 Authorization、WebSocket 子协议原值和原始敏感请求体；
- `.env.server`、secret、dump 和数据资产都按敏感文件处理；
- 生产镜像锁定 digest，执行依赖扫描并生成 SBOM；
- 数据库 volume、`POWERGRID_DATA_DIR` 和备份目录都要纳入磁盘容量监控。

## 14. 常见故障

| 现象 | 原因与处理 |
|---|---|
| 页面打开但无历史曲线 | 很可能只部署了代码，没有传部署数据包；检查脚本是否输出了数据库恢复和 baseline verified |
| 提示数据库已有表并跳过恢复 | 目标 volume 不是空库；脚本为防止数据丢失不会覆盖，确认后改用新的空 volume |
| `Checksum mismatch` | 数据包传输不完整或被修改，重新复制，禁止跳过校验 |
| 模型 readiness 失败 | 检查 `/srv/powergrid/models` 两个文件、SHA256、挂载权限和容器日志 |
| PostgreSQL 启动失败 | 检查密码文件、volume 权限、磁盘空间和 PostgreSQL 版本 |
| 生产模式返回 401 | 检查 OIDC issuer、JWT audience/issuer、时间同步和网关是否传递 Authorization |
| 登录后看不到台区 | JWT principal 没有对应 `user_station_role`，或角色映射不正确 |
| 原始训练数据不存在 | 部署包使用了 `--skip-assets`；重新传完整资产包或恢复文件备份 |
| 重启后数据丢失 | 检查是否错误执行了 `down -v`，以及 Compose 项目名/volume 是否被人为修改 |
