import { describe, expect, it } from "vitest";

import { isNewerSemver, isValidSha256Hex, resolveAvailableUpdate } from "./updater";

const VALID_SHA = "ba7816bf8f01cfea414140de5dae2223b00361a396177a9cb410ff61f20015ad";

describe("custom updater manifest parsing", () => {
    it("compares semantic versions with or without v prefix", () => {
        expect(isNewerSemver("0.2.3", "v0.2.2")).toBe(true);
        expect(isNewerSemver("v1.0.0", "0.9.9")).toBe(true);
        expect(isNewerSemver("v0.2.2", "0.2.2")).toBe(false);
        expect(isNewerSemver("0.2.1", "v0.2.2")).toBe(false);
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
