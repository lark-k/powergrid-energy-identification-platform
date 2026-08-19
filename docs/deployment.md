# 外部服务器简明部署手册

本文供运维人员使用。目标是在一台新的 Linux 服务器上启动平台，并自动恢复本地现有数据库、模型及历史数据。部署完成后，浏览器打开服务器地址即可看到与本地一致的演示数据，不会出现空数据库。

本手册使用 `demo` 模式，适合学校演示、验收环境、测试服务器或可信内网。该模式不提供正式用户登录保护，不要直接向不受信任的公网开放；云服务器建议在安全组中只允许指定来源 IP 访问 5173 端口。

## 1. 部署结果

部署完成后会启动四个容器：

| 服务 | 用途 | 是否暴露到服务器外部 |
|---|---|---|
| `frontend` | 页面入口 | 是，默认端口 5173 |
| `backend` | Java 业务后台 | 否 |
| `model-service` | Python 模型推理 | 否 |
| `postgres` | PostgreSQL 数据库 | 否 |

首次部署会自动恢复以下内容：

- 台区信息；
- 历史分钟采集数据；
- 设备辨识结果；
- 光伏功率分离结果；
- 数据采集过程记录；
- 模型训练运行及 epoch 曲线；
- 当前正式模型；
- 原始数据、训练数据集、checkpoint 和训练输出。

## 2. 需要准备的文件

服务器部署必须同时拿到以下两项：

1. 项目代码目录 `powergrid-energy-identification-platform`；
2. 数据包目录，例如 `powergrid-demo-current` 或 `powergrid-demo-final`。

数据包包含：

```text
powergrid-demo-current/
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

`deploy/releases/` 被 Git 忽略，因此只克隆 Git 仓库不会得到数据库数据包。数据包必须单独复制到服务器。

## 3. 开发人员：生成最新数据包

如果运维已经拿到数据包，可以跳过本节。

在当前本地项目的 Windows PowerShell 中执行：

```powershell
cd D:\code\school\powergrid-energy-identification-platform

docker compose `
  --env-file deploy/.env `
  -f deploy/docker-compose.yml `
  ps
```

确认 `postgres`、`model-service`、`backend` 和 `frontend` 都是 `healthy`，然后生成数据包：

```powershell
python deploy/scripts/create_deployment_bundle.py `
  --output deploy/releases/powergrid-demo-final
```

如果本地数据没有发生变化，也可以使用已经生成的：

```text
deploy/releases/powergrid-demo-current
```

正式迁移前，如果还有采集程序不断向本地写入数据，应先暂停采集，再生成最终数据包，避免漏掉导出完成后新产生的数据。

## 4. 运维人员：服务器环境要求

推荐服务器环境：

- Ubuntu Server 22.04 或 24.04；
- 4 核 CPU；
- 8 GB 内存；
- 至少 20 GB 可用磁盘；
- Docker Engine；
- Docker Compose v2；
- Python 3.11 或更高版本。

登录服务器：

```bash
ssh 用户名@服务器IP
```

检查环境：

```bash
docker version
docker compose version
python3 --version
```

如果服务器已经安装以上工具，直接进入第 5 节。

Ubuntu 可以尝试安装：

```bash
sudo apt update
sudo apt install -y docker.io docker-compose-v2 python3 git
sudo systemctl enable --now docker
sudo usermod -aG docker "$USER"
```

用户加入 Docker 组后退出并重新登录：

```bash
exit
ssh 用户名@服务器IP
```

再次检查：

```bash
docker version
docker compose version
```

如果系统软件源没有 `docker-compose-v2`，请由服务器管理员按照 Docker 官方 Ubuntu 安装方式安装 Docker Engine 和 Compose plugin。

## 5. 将代码传到服务器

### 方式一：从 Git 克隆

```bash
cd /opt
sudo git clone 仓库地址 powergrid-energy-identification-platform
sudo chown -R "$USER":"$USER" /opt/powergrid-energy-identification-platform
```

例如使用 GitHub：

```bash
sudo git clone \
  https://github.com/lark-k/powergrid-energy-identification-platform.git \
  /opt/powergrid-energy-identification-platform

sudo chown -R "$USER":"$USER" /opt/powergrid-energy-identification-platform
```

### 方式二：开发人员直接复制代码目录

在本地 PowerShell 中执行：

```powershell
scp -r `
  D:\code\school\powergrid-energy-identification-platform `
  用户名@服务器IP:/opt/
```

## 6. 将数据包传到服务器

在本地 Windows PowerShell 中执行：

```powershell
scp -r `
  D:\code\school\powergrid-energy-identification-platform\deploy\releases\powergrid-demo-final `
  用户名@服务器IP:/opt/powergrid-releases/
```

如果使用现有的 `powergrid-demo-current`：

```powershell
scp -r `
  D:\code\school\powergrid-energy-identification-platform\deploy\releases\powergrid-demo-current `
  用户名@服务器IP:/opt/powergrid-releases/
```

如果服务器目录不存在，先在服务器创建：

```bash
sudo mkdir -p /opt/powergrid-releases
sudo chown -R "$USER":"$USER" /opt/powergrid-releases
```

传输完成后检查：

```bash
ls -lah /opt/powergrid-releases/powergrid-demo-final
```

或者：

```bash
ls -lah /opt/powergrid-releases/powergrid-demo-current
```

## 7. 创建服务器数据目录

```bash
sudo mkdir -p /srv/powergrid
sudo chown -R "$USER":"$USER" /srv/powergrid
```

数据库使用 Docker named volume 持久化；模型、原始数据和训练数据会保存到 `/srv/powergrid`。

## 8. 配置服务器参数

进入项目：

```bash
cd /opt/powergrid-energy-identification-platform
```

复制环境模板：

```bash
cp deploy/.env.server.example deploy/.env.server
```

生成两段随机值：

```bash
openssl rand -hex 24
openssl rand -hex 32
```

第一段作为数据库密码，第二段作为模型服务令牌。

编辑配置：

```bash
nano deploy/.env.server
```

修改成下面的形式，把 `服务器IP` 和密码替换成真实值：

```dotenv
POWERGRID_DATA_DIR=/srv/powergrid

POSTGRES_DB=powergrid
POSTGRES_USER=powergrid_dev
POSTGRES_PASSWORD=替换成第一段随机密码
MODEL_SERVICE_TOKEN=替换成第二段随机令牌

MODEL_DEVICE=cpu
MODEL_BATCH_SIZE=256
MODEL_INFERENCE_TIMEOUT_SECONDS=30

FRONTEND_PORT=5173
SPRING_PROFILES_ACTIVE=dev
SECURITY_MODE=dev
CORS_ALLOWED_ORIGINS=http://服务器IP:5173
```

例如服务器 IP 是 `192.168.1.100`：

```dotenv
CORS_ALLOWED_ORIGINS=http://192.168.1.100:5173
```

模板中 `OIDC_ISSUER_URI` 和 secret 文件配置在 `demo` 模式下不会使用，可以保留原值。

保存后限制配置文件权限：

```bash
chmod 600 deploy/.env.server
```

## 9. 一键部署并恢复历史数据

如果数据包是 `powergrid-demo-final`：

```bash
cd /opt/powergrid-energy-identification-platform

python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-final \
  --env-file deploy/.env.server \
  --mode demo
```

如果数据包是 `powergrid-demo-current`：

```bash
cd /opt/powergrid-energy-identification-platform

python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-current \
  --env-file deploy/.env.server \
  --mode demo
```

脚本会自动：

1. 校验数据包；
2. 创建并启动 PostgreSQL；
3. 检测目标数据库是否为空；
4. 空库时恢复本地历史数据库；
5. 安装当前正式模型；
6. 解压原始数据和训练资产；
7. 构建并启动全部容器；
8. 等待四个服务健康；
9. 核对恢复后的数据库行数和时间范围。

首次构建需要下载 Docker 镜像及项目依赖，根据服务器网络速度可能需要几分钟。

部署成功时会看到类似输出：

```text
Empty PostgreSQL database detected; restoring bundled historical data ...
Healthy: postgres
Healthy: model-service
Healthy: backend
Healthy: frontend
Database baseline verified.
Deployment completed successfully.
```

## 10. 开放页面端口

如果服务器启用了 UFW：

```bash
sudo ufw allow 5173/tcp
```

如果是云服务器，还需要在云控制台安全组中放行：

```text
TCP 5173
```

建议只允许运维或演示人员的来源 IP。

不需要开放以下端口：

```text
5432
8080
8000
```

## 11. 浏览器访问

打开：

```text
http://服务器IP:5173
```

正常情况下应该直接看到：

- 浏览器标签页名称“新型能源智能辨识与分离平台”；
- A01 台区；
- 历史功率曲线；
- 历史辨识结果；
- 光伏分离结果；
- 01 数据采集、02 模型训练、03 模型验证、04 模型应用管理四个过程页；
- 数据采集拓扑、处理成样、训练和验证流程动画；
- 两类模型的归档版本选择与当前模型健康状态；
- 曲线滑窗和分钟详情的手动解锁功能。

服务器只更新代码且需要保留现有数据库时，可在项目目录执行原 Compose 命令的 `up -d --build`；不要使用 `down -v`。

## 12. 检查服务状态

```bash
cd /opt/powergrid-energy-identification-platform

docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  ps
```

`postgres`、`model-service`、`backend` 和 `frontend` 都应显示为 `healthy`。

再次执行自动验收：

```bash
python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-current \
  --env-file deploy/.env.server \
  --mode demo \
  --verify-only
```

如果部署的是 `powergrid-demo-final`，把命令中的数据包路径替换为对应目录。

## 13. 查看日志

查看全部日志：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  logs --tail=200
```

只看某个服务：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  logs --tail=200 backend
```

服务名可以替换为 `frontend`、`model-service` 或 `postgres`。

## 14. 常用启停命令

停止服务但保留数据：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  stop
```

重新启动：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  start
```

重启全部服务：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  restart
```

删除容器但保留数据库 volume：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  down
```

不要执行：

```bash
docker compose down -v
```

`-v` 会删除 PostgreSQL 数据卷，可能造成历史数据和服务器运行后新增数据丢失。

## 15. 简单备份

在服务器生成数据库备份：

```bash
cd /opt/powergrid-energy-identification-platform

mkdir -p /srv/powergrid/backups

python3 deploy/scripts/create_deployment_bundle.py \
  --env-file deploy/.env.server \
  --skip-assets \
  --output /srv/powergrid/backups/powergrid-$(date +%Y%m%d-%H%M%S)
```

同时应定期备份：

```text
/srv/powergrid/SGCC-project
/srv/powergrid/models
/srv/powergrid/backups
```

## 16. 常见问题

### 16.1 页面无法访问

检查容器：

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  ps
```

检查服务器本机端口：

```bash
curl -I http://127.0.0.1:5173
```

如果服务器本机能访问、外部不能访问，检查云安全组和防火墙是否开放 5173。

### 16.2 页面打开但没有历史数据

执行验收：

```bash
python3 deploy/scripts/deploy_server.py \
  --bundle /opt/powergrid-releases/powergrid-demo-current \
  --env-file deploy/.env.server \
  --mode demo \
  --verify-only
```

同时确认传到服务器的是完整数据包，而不只是 Git 代码。

### 16.3 提示数据库已经非空

脚本检测到数据库已有表时会跳过恢复，避免覆盖服务器已有数据。这是正常的数据保护行为。

如果这是第一次正式部署，却提前启动过一个空演示库，请先联系数据库管理员确认并备份，不要随意删除 Docker volume。

### 16.4 模型服务不健康

```bash
docker compose \
  --env-file deploy/.env.server \
  -f deploy/docker-compose.yml \
  -f deploy/compose.server.yml \
  logs --tail=200 model-service
```

并检查模型文件：

```bash
ls -lah /srv/powergrid/models
```

### 16.5 服务器无法构建镜像

检查磁盘和网络：

```bash
df -h
docker system df
```

首次构建需要访问 Docker Hub、Maven、PyPI 和 npm。服务器不能访问互联网时，需要改为离线传输构建好的 Docker 镜像。

## 17. 最简流程总结

运维人员实际执行的核心步骤只有：

```text
1. 安装 Docker、Compose、Python
2. 获取项目代码
3. 获取 powergrid-demo-* 数据包
4. 创建 /srv/powergrid
5. 复制并修改 deploy/.env.server
6. 执行 deploy_server.py --mode demo
7. 开放 5173 端口
8. 浏览器访问 http://服务器IP:5173
```
