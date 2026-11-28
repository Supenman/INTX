import { describe, expect, it } from "vitest";

import {
    buildReleaseTagManifestUrl,
    buildUpdateManifestCandidates,
    DEFAULT_UPDATE_MANIFEST_URL,
    extractPrereleaseManifestUrl,
    isNewerSemver,
    isPrereleaseVersion,
    isValidSha256Hex,
    resolveAvailableUpdate,
} from "./updater";

const VALID_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("custom updater manifest parsing", () => {
    it("compares semantic versions including prerelease tags", () => {
        expect(isNewerSemver("0.2.3", "v0.2.2")).toBe(true);
        expect(isNewerSemver("v1.0.0", "0.9.9")).toBe(true);
        expect(isNewerSemver("v0.2.2", "0.2.2")).toBe(false);
        expect(isNewerSemver("0.2.1", "v0.2.2")).toBe(false);
        expect(isNewerSemver("v0.2.4-beta.2", "v0.2.4-beta.1")).toBe(true);
        expect(isNewerSemver("v0.2.4-beta.10", "v0.2.4-beta.2")).toBe(true);
        expect(isNewerSemver("v0.2.4", "v0.2.4-beta.2")).toBe(true);
        expect(isNewerSemver("v0.2.4-beta.9", "v0.2.4")).toBe(false);
        expect(isNewerSemver("v0.2.4-beta.2", "v0.2.4-beta.2")).toBe(false);
        expect(isPrereleaseVersion("v0.2.4-beta.1")).toBe(true);
        expect(isPrereleaseVersion("v0.2.4")).toBe(false);
    });

    it("builds deterministic tag manifest URLs and channel-safe candidate lists", () => {
        expect(buildReleaseTagManifestUrl("0.2.4-beta.4")).toBe(
            "https://github.com/Supenman/INTX/releases/download/v0.2.4-beta.4/update.json",
        );
        expect(buildReleaseTagManifestUrl("not-a-version")).toBeNull();

        // Pre-release build probes direct tag manifest first (bypassing api.github.com rate limits).
        expect(
            buildUpdateManifestCandidates({
                currentVersion: "v0.2.4-beta.3",
                candidateVersion: "v0.2.4-beta.4",
            }),
        ).toEqual([
            "https://github.com/Supenman/INTX/releases/download/v0.2.4-beta.4/update.json",
            DEFAULT_UPDATE_MANIFEST_URL,
        ]);

        // Stable build must never probe prerelease tags.
        expect(
            buildUpdateManifestCandidates({
                currentVersion: "v0.2.3",
                candidateVersion: "v0.2.4-beta.4",
            }),
        ).toEqual([DEFAULT_UPDATE_MANIFEST_URL]);

        // Stable build with newer stable candidate includes direct tag fallback after latest.
        expect(
            buildUpdateManifestCandidates({
                currentVersion: "v0.2.3",
                candidateVersion: "v0.2.4",
            }),
        ).toEqual([
            DEFAULT_UPDATE_MANIFEST_URL,
            "https://github.com/Supenman/INTX/releases/download/v0.2.4/update.json",
        ]);

        // Custom manifest override takes exclusive priority.
        expect(
            buildUpdateManifestCandidates({
                currentVersion: "v0.2.4-beta.3",
                candidateVersion: "v0.2.4-beta.4",
                customManifestUrl: "https://mirror.example.com/update.json",
            }),
        ).toEqual(["https://mirror.example.com/update.json"]);
    });

    it("extracts update.json download URL from GitHub releases API including prereleases", () => {
        const url = extractPrereleaseManifestUrl([
            { draft: true, prerelease: true, assets: [{ name: "update.json", browser_download_url: "https://example.com/draft.json" }] },
            { draft: false, prerelease: true, assets: [{ name: "update.json", browser_download_url: "https://github.com/Supenman/INTX/releases/download/v0.2.4-beta.2/update.json" }] },
        ]);
        expect(url).toBe("https://github.com/Supenman/INTX/releases/download/v0.2.4-beta.2/update.json");
    });

    it("resolves a valid newer Windows update and filters non-HTTPS mirrors", () => {
        const result = resolveAvailableUpdate(
            {
                version: "v0.2.3",
                pub_date: "2026-11-27T07:00:00Z",
                notes: "自研免密码更新器",
                platforms: {
                    "windows-x86_64": {
                        url: "https://github.com/Supenman/INTX/releases/download/v0.2.3/INTX_0.2.3_x64-setup.exe",
                        mirrors: [
                            "http://insecure.example.com/setup.exe",
                            "https://mirror.example.com/INTX_0.2.3_x64-setup.exe",
                        ],
                        sha256: VALID_SHA.toUpperCase(),
                        size: 52428800,
                    },
                },
            },
            "v0.2.2",
        );
        expect(result).toEqual({
            version: "0.2.3",
            url: "https://github.com/Supenman/INTX/releases/download/v0.2.3/INTX_0.2.3_x64-setup.exe",
            mirrors: ["https://mirror.example.com/INTX_0.2.3_x64-setup.exe"],
            sha256: VALID_SHA,
            size: 52428800,
            notes: "自研免密码更新器",
            pubDate: "2026-11-27T07:00:00Z",
        });
    });

    it("rejects insecure URLs, invalid sha256, or same/older versions", () => {
        expect(isValidSha256Hex("not-a-hash")).toBe(false);
        expect(
            resolveAvailableUpdate(
                {
                    version: "0.2.3",
                    platforms: { "windows-x86_64": { url: "http://example.com/a.exe", sha256: VALID_SHA } },
                },
                "0.2.2",
            ),
        ).toBeNull();
        expect(
            resolveAvailableUpdate(
                {
                    version: "0.2.3",
                    platforms: { "windows-x86_64": { url: "https://example.com/a.exe", sha256: "1234" } },
                },
                "0.2.2",
            ),
        ).toBeNull();
        expect(
            resolveAvailableUpdate(
                {
                    version: "0.2.2",
                    platforms: { "windows-x86_64": { url: "https://example.com/a.exe", sha256: VALID_SHA } },
                },
                "0.2.2",
            ),
        ).toBeNull();
    });
});
