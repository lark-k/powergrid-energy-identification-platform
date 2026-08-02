# 安全配置

- 权限角色：`ADMIN`、`OPERATOR`、`VIEWER`；台区访问同时校验 `user_station_role`，WebSocket 握手也执行同一校验。
- 生产必须设置 `SECURITY_MODE=oidc` 和可信 `OIDC_ISSUER_URI`。开发认证只在 `dev` profile 显式启用。
- 浏览器 REST/SSE 使用 Bearer 头；WebSocket 使用 `bearer` 子协议和 base64url 编码短期令牌，令牌不进入 URL。反向代理不得记录子协议头。
- Java 到 Python 使用独立服务令牌；生产通过密钥挂载注入。令牌不得复用用户令牌。
- 上传只接受 JSON/CSV、限制大小、校验文件名/内容前缀和必需字段，拒绝路径分隔符及可执行文件头。
- SQL 全部参数化；台区资源使用方法级授权；CORS 使用显式白名单；响应启用 nosniff、DENY frame 和 no-referrer。
- 审计记录主体、动作、台区、状态、时间和 request_id，不记录凭据、令牌或完整上传内容。
- 生产 Swagger 仅管理员可访问且默认关闭；生产无 Mock 数据和默认凭据。

OIDC 令牌至少应包含稳定 subject 与角色映射。若企业 IdP 的角色 claim 不是 Spring 默认映射，需在部署模块提供经过审计的 `JwtAuthenticationConverter`，不得在前端自行提升角色。
