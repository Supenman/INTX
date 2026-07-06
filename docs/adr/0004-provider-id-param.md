# ADR 0004 — 前端指定 provider_id 调用生成

## 状态

已接受 — 2026-07-03

## 背景

之前 `/api/generate` 没有 `provider_id` 参数，后端自动查找 primary provider。但用户在一个节点里选择了"某个平台的某个模型"后，生成时必须用该平台的 base_url 和 api_key，不能走其他平台。

## 决策

- 在 `POST /api/tasks` 的请求参数中加入 `provider_id` 字段
- 后端根据 `provider_id` 查找对应的平台配置（base_url、协议、api_key）
- 前端从节点当前选中的模型中推导出 `provider_id`（需维护 model → provider 的映射）
- 不再依赖"primary provider"自动查找逻辑

## 影响

- GeneratePayload 模型新增 `provider_id: str = ""`
- 后端 `api_key_from_payload` 需要根据 provider_id 查 env，而不是 fallback 链
- 前端需要在每个节点上记录当前使用的 provider_id（可以和模型选择联动）
