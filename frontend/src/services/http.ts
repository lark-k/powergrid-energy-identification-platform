export interface ApiErrorBody {
  code?: string;
  message?: string;
  request_id?: string;
  details?: Record<string, unknown>;
}

const STATUS_MESSAGES: Record<number, string> = {
  401: "登录状态已失效，请重新认证",
  403: "当前账号无权访问该台区",
  404: "请求的台区或数据不存在",
  422: "提交的数据不符合接口要求",
  500: "业务后台处理失败",
  503: "模型服务暂不可用，系统已进入降级状态",
};

export class PlatformApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly requestId: string | null = null,
    public readonly details: Record<string, unknown> = {},
  ) {
    super(message);
    this.name = "PlatformApiError";
  }
}

export const accessToken = () => {
  const configured = String(import.meta.env.VITE_ACCESS_TOKEN ?? "").trim();
  if (configured) return configured;
  try { return window.localStorage.getItem("powergrid_access_token") ?? ""; } catch { return ""; }
};

export const authHeaders = (): Record<string, string> => {
  const token = accessToken();
  if (token) return { Authorization: `Bearer ${token}` };
  const devUser = String(import.meta.env.VITE_DEV_USER ?? "").trim();
  return devUser ? {
    "X-Dev-User": devUser,
    "X-Dev-Roles": String(import.meta.env.VITE_DEV_ROLES ?? "OPERATOR"),
  } : {};
};

export async function apiRequest<T>(baseUrl: string, path: string, init: RequestInit = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${baseUrl}${path}`, {
      ...init,
      credentials: "same-origin",
      headers: { Accept: "application/json", ...authHeaders(), ...init.headers },
    });
  } catch {
    throw new PlatformApiError(0, "BACKEND_OFFLINE", "无法连接 Java 业务后台");
  }
  if (!response.ok) {
    let body: ApiErrorBody = {};
    try { body = await response.json() as ApiErrorBody; } catch { /* non-JSON gateway response */ }
    throw new PlatformApiError(
      response.status,
      body.code ?? `HTTP_${response.status}`,
      body.message ?? STATUS_MESSAGES[response.status] ?? `后台请求失败（${response.status}）`,
      body.request_id ?? response.headers.get("X-Request-ID"),
      body.details ?? {},
    );
  }
  if (response.status === 204) return undefined as T;
  const contentType = response.headers.get("content-type") ?? "";
  return (contentType.includes("application/json") ? response.json() : response.blob()) as Promise<T>;
}
