export const DEFAULT_UPDATE_MANIFEST_URL =
    "https://github.com/Supenman/INTX/releases/latest/download/update.json";
const CUSTOM_MANIFEST_STORAGE_KEY = "intx-update-manifest-url";

export type UpdatePlatformEntry = {
    url: string;
    mirrors?: string[];
    sha256: string;
    size?: number;
};

export type UpdateManifest = {
    version: string;
    pub_date?: string;
    notes?: string;
    platforms?: Record<string, UpdatePlatformEntry>;
};

export type AvailableAppUpdate = {
    version: string;
    url: string;
    mirrors: string[];
    sha256: string;
    size: number;
    notes: string;
    pubDate: string;
};

function parseVersionParts(version: string): [number, number, number] | null {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)/);
    if (!match) return null;
    return [Number(match[1]), Number(match[2]), Number(match[3])];
}

export function isNewerSemver(candidate: string, current: string): boolean {
    const next = parseVersionParts(candidate);
    const curr = parseVersionParts(current);
    if (!next || !curr) return false;
    for (let i = 0; i < 3; i += 1) {
        if (next[i] > curr[i]) return true;
        if (next[i] < curr[i]) return false;
    }
    return false;
}

export function isValidSha256Hex(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim());
}

export function isHttpsUrl(value: unknown): value is string {
    return typeof value === "string" && value.trim().startsWith("https://");
}

/**
 * 解析自研更新清单 `update.json`，仅当存在更高版本、合法 HTTPS 地址与 64 位 SHA-256 时返回可安装更新。
 */
export function resolveAvailableUpdate(
    raw: unknown,
    currentVersion: string,
    platform = "windows-x86_64",
): AvailableAppUpdate | null {
    if (!raw || typeof raw !== "object") return null;
    const manifest = raw as Partial<UpdateManifest>;
    if (typeof manifest.version !== "string" || !isNewerSemver(manifest.version, currentVersion)) {
        return null;
    }
    const entry = manifest.platforms?.[platform];
    if (!entry || !isHttpsUrl(entry.url) || !isValidSha256Hex(entry.sha256)) {
        return null;
    }
    const mirrors = Array.isArray(entry.mirrors)
        ? entry.mirrors.filter(isHttpsUrl).map((item) => item.trim())
        : [];
    const normalizedVersion = manifest.version.trim().replace(/^v/i, "");
    return {
        version: normalizedVersion,
        url: entry.url.trim(),
        mirrors,
        sha256: entry.sha256.trim().toLowerCase(),
        size: typeof entry.size === "number" && Number.isFinite(entry.size) && entry.size > 0 ? entry.size : 0,
        notes: typeof manifest.notes === "string" ? manifest.notes.trim() : "",
        pubDate: typeof manifest.pub_date === "string" ? manifest.pub_date.trim() : "",
    };
}

export function getUpdateManifestUrl(): string {
    try {
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(CUSTOM_MANIFEST_STORAGE_KEY) : null;
        if (isHttpsUrl(stored)) return stored.trim();
    } catch {
        // ignore storage access failure
    }
    return DEFAULT_UPDATE_MANIFEST_URL;
}
