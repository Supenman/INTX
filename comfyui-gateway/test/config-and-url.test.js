import { test } from "node:test";
import assert from "node:assert/strict";
import path from "node:path";

import { loadConfig } from "../src/config.js";
import { absoluteTaskUrl, requestBaseUrl } from "../src/public-url.js";

test("loadConfig 默认仅绑定回环地址 127.0.0.1:8190，且 outputDir 跟随 dataDir/outputs", () => {
  const customDataDir = path.resolve("/tmp/intx-test-data");
  const config = loadConfig({ dataDir: customDataDir });
  assert.equal(config.host, "127.0.0.1");
  assert.equal(config.port, 8190);
  assert.equal(config.outputDir, path.join(customDataDir, "outputs"));
  assert.equal(config.publicBaseUrl, "http://127.0.0.1:8190");
});

test("loadConfig 拒绝在未开启 ALLOW_REMOTE 时监听非回环地址（0.0.0.0）", () => {
  assert.throws(
    () => loadConfig({ host: "0.0.0.0", allowRemote: false }),
    /回环地址/,
  );
  const allowed = loadConfig({ host: "0.0.0.0", allowRemote: true });
  assert.equal(allowed.host, "0.0.0.0");
});

test("requestBaseUrl 与 absoluteTaskUrl 正确重定基 /files 路径且不误改外部链接", () => {
  const config = { host: "127.0.0.1", port: 8190, publicBaseUrl: "http://127.0.0.1:8190", publicBaseUrlExplicit: false };
  const localReq = { protocol: "http", headers: { host: "127.0.0.1:8190" } };
  assert.equal(requestBaseUrl(config, localReq), "http://127.0.0.1:8190");
  assert.equal(absoluteTaskUrl(config, localReq, "/files/out.mp4"), "http://127.0.0.1:8190/files/out.mp4");
  assert.equal(absoluteTaskUrl(config, localReq, "https://cdn.example.com/v.mp4"), "https://cdn.example.com/v.mp4");

  const proxiedReq = { protocol: "http", headers: { "x-forwarded-proto": "https", "x-forwarded-host": "studio.example.com" } };
  assert.equal(requestBaseUrl(config, proxiedReq), "https://studio.example.com");
  assert.equal(
    absoluteTaskUrl(config, proxiedReq, "http://127.0.0.1:8190/files/clip.mp4?t=1"),
    "https://studio.example.com/files/clip.mp4?t=1",
  );
  assert.equal(absoluteTaskUrl(config, localReq, ""), null);
});
