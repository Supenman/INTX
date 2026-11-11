import { err, ok, type Result } from '../shared/result';
import type { GenerationParams } from '../task/model';

/**
 * 一键复现包。
 *
 * 一次成功出图的全部「可重跑信息」：冻结的参数快照 + 参考图资产 + 结果资产，
 * 全打进一个自包含的 JSON（图片字节以 base64 内联），别人拿到文件点一下就能原样重跑。
 *
 * 为什么是 JSON 而不是 zip：公司内部点对点传文件最稳的是单文件，且不引入压缩库依赖。
 * 图是内联 base64——小图可接受；超大批量另说（那属于 P3 的「共享工程」范畴）。
 *
 * 这里只定义结构与校验，不动任何 IO：把字节编成 base64 是调用方的职责，
 * 因为 domain 层不碰浏览器/Node 的全局 API。
 */

export const REPRO_VERSION = 1;

/** 资产的内联表示：哈希用于去重与一致性校验，bytesB64 可选（纯参数复现时可不带字节）。 */
export interface ReproAsset {
  hash: string;
  mime: string;
  /** base64 编码的字节；导出时填，导入端据此落盘。 */
  bytesB64?: string;
}

export interface ReproPackage {
  version: number;
  exportedAt: number;
  taskId: string;
  /** 冻结的生成参数；复现时原样喂给执行链路。 */
  params: GenerationParams;
  /** 输入参考图，顺序与 params.inputAssetIds 对应 */
  references: ReproAsset[];
  /** 输出产物 */
  results: ReproAsset[];
}

export type ReproErrorCode =
  | 'bad_json'
  | 'unsupported_version'
  | 'missing_params'
  | 'missing_asset_field';

export interface ReproError {
  code: ReproErrorCode;
  message: string;
}

export interface BuildReproInput {
  taskId: string;
  params: GenerationParams;
  references?: ReproAsset[];
  results?: ReproAsset[];
  now?: number;
}

/** 组装复现包。字节的 base64 由调用方在传入 ReproAsset 前编好。 */
export function buildReproPackage(input: BuildReproInput): ReproPackage {
  return {
    version: REPRO_VERSION,
    exportedAt: input.now ?? Date.now(),
    taskId: input.taskId,
    params: input.params,
    references: input.references ?? [],
    results: input.results ?? [],
  };
}

export function serializeRepro(pkg: ReproPackage): string {
  return JSON.stringify(pkg, null, 2);
}

function validateAsset(a: unknown, where: string): ReproError | null {
  if (typeof a !== 'object' || a === null) return { code: 'missing_asset_field', message: `${where} 不是对象` };
  const asset = a as Record<string, unknown>;
  if (typeof asset.hash !== 'string' || asset.hash.length === 0) {
    return { code: 'missing_asset_field', message: `${where} 缺少 hash` };
  }
  if (typeof asset.mime !== 'string' || asset.mime.length === 0) {
    return { code: 'missing_asset_field', message: `${where} 缺少 mime` };
  }
  return null;
}

/** 校验复现包结构完整性。返回空数组表示通过。 */
export function validateRepro(pkg: ReproPackage): ReproError[] {
  const errors: ReproError[] = [];
  if (pkg.version !== REPRO_VERSION) {
    errors.push({ code: 'unsupported_version', message: `不支持的复现包版本 v${pkg.version}` });
  }
  const p = pkg.params;
  if (
    !p ||
    typeof p.prompt !== 'string' ||
    typeof p.model !== 'string' ||
    typeof p.providerId !== 'string' ||
    typeof p.kind !== 'string' ||
    p.prompt.trim() === '' ||
    p.model.trim() === '' ||
    p.providerId.trim() === ''
  ) {
    errors.push({ code: 'missing_params', message: '复现包缺少生成参数（prompt/model/providerId/kind）' });
  }
  pkg.references.forEach((r, i) => {
    const e = validateAsset(r, `references[${i}]`);
    if (e) errors.push(e);
  });
  pkg.results.forEach((r, i) => {
    const e = validateAsset(r, `results[${i}]`);
    if (e) errors.push(e);
  });
  return errors;
}

/** 解析并校验复现包。任何一步失败都收敛成 Result，调用方不用 try/catch。 */
export function parseRepro(text: string): Result<ReproPackage, ReproError> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(text);
  } catch (e) {
    return err({ code: 'bad_json', message: `复现包不是合法 JSON：${e instanceof Error ? e.message : String(e)}` });
  }
  if (typeof parsed !== 'object' || parsed === null) {
    return err({ code: 'bad_json', message: '复现包根节点不是对象' });
  }
  const pkg = parsed as ReproPackage;
  const errors = validateRepro(pkg);
  if (errors.length > 0) return err(errors[0]!);
  return ok(pkg);
}
