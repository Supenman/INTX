export const DEFAULT_UPDATE_MANIFEST_URL =
    "https://github.com/Supenman/INTX/releases/latest/download/update.json";
export const DEFAULT_RELEASES_API_URL =
    "https://api.github.com/repos/Supenman/INTX/releases?per_page=10";
const RELEASE_TAG_DOWNLOAD_BASE =
    "https://github.com/Supenman/INTX/releases/download";
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

type ParsedSemver = {
    core: [number, number, number];
    prerelease: string[];
};

function parseSemver(version: string): ParsedSemver | null {
    const match = version.trim().match(/^v?(\d+)\.(\d+)\.(\d+)(?:-([0-9A-Za-z.-]+))?(?:\+.*)?$/);
    if (!match) return null;
    return {
        core: [Number(match[1]), Number(match[2]), Number(match[3])],
        prerelease: match[4] ? match[4].split(".").filter(Boolean) : [],
    };
}

function comparePrereleaseIdentifiers(a: string, b: string): number {
    const aNum = /^\d+$/.test(a);
    const bNum = /^\d+$/.test(b);
    if (aNum && bNum) return Number(a) - Number(b);
    if (aNum !== bNum) return aNum ? -1 : 1;
    return a.localeCompare(b);
}

/** 按 SemVer 2.0.0 规则判断 candidate 是否严格高于 current（支持 -beta.N 等预发布后缀）。 */
export function isNewerSemver(candidate: string, current: string): boolean {
    const next = parseSemver(candidate);
    const curr = parseSemver(current);
    if (!next || !curr) return false;
    for (let i = 0; i < 3; i += 1) {
        if (next.core[i] > curr.core[i]) return true;
        if (next.core[i] < curr.core[i]) return false;
    }
    const nextPre = next.prerelease;
    const currPre = curr.prerelease;
    if (nextPre.length === 0 && currPre.length === 0) return false;
    // 同主次修订号下，正式版高于预发布版（如 0.2.4 > 0.2.4-beta.2）。
    if (nextPre.length === 0) return true;
    if (currPre.length === 0) return false;
    const len = Math.max(nextPre.length, currPre.length);
    for (let i = 0; i < len; i += 1) {
        if (i >= nextPre.length) return false;
        if (i >= currPre.length) return true;
        const diff = comparePrereleaseIdentifiers(nextPre[i], currPre[i]);
        if (diff !== 0) return diff > 0;
    }
    return false;
}

export function isPrereleaseVersion(version: string): boolean {
    const parsed = parseSemver(version);
    return Boolean(parsed && parsed.prerelease.length > 0);
}

/** 根据合法 SemVer 版本号拼接对应 GitHub Release Tag 的 update.json 直连地址（绕开 api.github.com 限流）。 */
export function buildReleaseTagManifestUrl(version: string): string | null {
    const parsed = parseSemver(version);
    if (!parsed) return null;
    const suffix = parsed.prerelease.length ? `-${parsed.prerelease.join(".")}` : "";
    const tag = `v${parsed.core[0]}.${parsed.core[1]}.${parsed.core[2]}${suffix}`;
    return `${RELEASE_TAG_DOWNLOAD_BASE}/${tag}/update.json`;
}

/**
 * 按渠道规则生成待探测的 update.json 候选地址列表：
 * - 自定义地址始终独占最高优先级；
 * - 预发布版优先按远端最新 VERSION 直连对应 tag 清单，避免被 api.github.com 60 次/小时限流卡住；
 * - 正式版仅探测正式发布通道，绝不向正式版用户推送 beta 预发布包。
 */
export function buildUpdateManifestCandidates(options: {
    currentVersion: string;
    candidateVersion?: string;
    customManifestUrl?: string | null;
}): string[] {
    if (options.customManifestUrl && isHttpsUrl(options.customManifestUrl)) {
        return [options.customManifestUrl.trim()];
    }
    const urls: string[] = [];
    const currentIsPre = isPrereleaseVersion(options.currentVersion);
    const candidate = options.candidateVersion?.trim();
    const candidateIsNewer = Boolean(candidate && isNewerSemver(candidate, options.currentVersion));

    if (currentIsPre) {
        if (candidate && candidateIsNewer) {
            const tagUrl = buildReleaseTagManifestUrl(candidate);
            if (tagUrl) urls.push(tagUrl);
        }
        urls.push(DEFAULT_UPDATE_MANIFEST_URL);
    } else {
        urls.push(DEFAULT_UPDATE_MANIFEST_URL);
        if (candidate && candidateIsNewer && !isPrereleaseVersion(candidate)) {
            const tagUrl = buildReleaseTagManifestUrl(candidate);
            if (tagUrl) urls.push(tagUrl);
        }
    }

    return [...new Set(urls)];
}

export function isValidSha256Hex(value: unknown): value is string {
    return typeof value === "string" && /^[0-9a-fA-F]{64}$/.test(value.trim());
}

export function isHttpsUrl(value: unknown): value is string {
    return typeof value === "string" && value.trim().startsWith("https://");
}

/** 从 GitHub Releases API 列表中取最新非草稿且包含 update.json 资产的清单地址（含 pre-release）。 */
export function extractPrereleaseManifestUrl(releasesRaw: unknown): string | null {
    if (!Array.isArray(releasesRaw)) return null;
    for (const item of releasesRaw) {
        if (!item || typeof item !== "object") continue;
        const release = item as { draft?: boolean; assets?: Array<{ name?: string; browser_download_url?: string }> };
        if (release.draft || !Array.isArray(release.assets)) continue;
        const asset = release.assets.find((entry) => entry?.name === "update.json" && isHttpsUrl(entry.browser_download_url));
        if (asset?.browser_download_url) return asset.browser_download_url.trim();
    }
    return null;
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

export function getCustomUpdateManifestUrl(): string | null {
    try {
        const stored = typeof window !== "undefined" ? window.localStorage.getItem(CUSTOM_MANIFEST_STORAGE_KEY) : null;
        if (isHttpsUrl(stored)) return stored.trim();
    } catch {
        // ignore storage access failure
    }
    return null;
}

export function getUpdateManifestUrl(): string {
    return getCustomUpdateManifestUrl() ?? DEFAULT_UPDATE_MANIFEST_URL;
}
