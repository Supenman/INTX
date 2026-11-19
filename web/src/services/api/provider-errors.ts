/**
 * 厂商错误体 → 可读文案的唯一实现。
 *
 * body 可能是对象、序列化过的 JSON 字符串、纯文本，或网关返回的 HTML 错误页。
 * 图片 / 视频 / 音频 / 脚本插件共用这一份，不要再各自复制。
 */
import i18n from "@/i18n";

const apiText = (key: string, options?: Record<string, unknown>) => i18n.t(`apiErrors.${key}`, options);

export function readApiErrorMessage(value: unknown): string {
    if (!value) return "";
    if (typeof value === "string") {
        // 可能是一层序列化过的 JSON（如 error.message），也可能是纯文本。
        try {
            const parsed = JSON.parse(value);
            const inner = readApiErrorMessage(parsed) || value;
            // "{}" 这种空对象等于没有可用信息。
            if (inner === value && typeof parsed === "object" && Object.keys(parsed).length === 0) return "";
            return inner;
        } catch {
            if (/<[a-z][\s\S]*>/i.test(value)) return apiText("htmlError", { preview: `${value.slice(0, 80)}...` });
            return value;
        }
    }
    if (typeof value !== "object") return "";
    const payload = value as { msg?: unknown; message?: unknown; errorMessage?: unknown; error?: unknown; detail?: unknown };
    const errorMsg = typeof payload.error === "string" ? payload.error : (payload.error as { message?: unknown })?.message;
    return readApiErrorMessage(payload.msg) || readApiErrorMessage(payload.message) || readApiErrorMessage(payload.errorMessage) || readApiErrorMessage(errorMsg) || readApiErrorMessage(payload.detail) || "";
}
