import { describe, expect, it } from 'vitest';

import { resolveImageCapabilities, unsupportedImageFields } from './imageCapabilities';

const openai = (baseUrl = 'https://api.openai.com/v1', hasScript = false) => ({ apiFormat: 'openai' as const, baseUrl, hasScript });
const gemini = (hasScript = false) => ({ apiFormat: 'gemini' as const, baseUrl: 'https://generativelanguage.googleapis.com/v1beta', hasScript });

describe('图片能力合同', () => {
  it('ModelScope 官方端点：质量 / 尺寸 / 背景 / 参考图都不发', () => {
    for (const baseUrl of ['https://api-inference.modelscope.cn/v1', 'https://api-inference.modelscope.ai', ' https://API-INFERENCE.modelscope.cn/v1/ ']) {
      const profile = resolveImageCapabilities(openai(baseUrl));
      expect(profile.kind).toBe('modelscope-async');
      expect(profile.quality).toBe('unimplemented');
      expect(profile.size).toBe('unimplemented');
      expect(profile.background).toBe('unimplemented');
      expect(profile.referenceImages).toBe('unimplemented');
      expect(profile.perRequestMax).toBe(1);
      expect(profile.separateRequestsForCount).toBe(true);
      expect(profile.asyncTask).toBe(true);
      expect(profile.upstreamCancel).toBe(false);
    }
  });

  it('端点优先于协议下拉框：Gemini 协议填 ModelScope 地址也走异步单图', () => {
    const profile = resolveImageCapabilities({ ...gemini(), baseUrl: 'https://api-inference.modelscope.cn/v1' });
    expect(profile.kind).toBe('modelscope-async');
    expect(profile.size).toBe('unimplemented');
  });

  it('脚本优先于端点：有脚本就按脚本自己的参数能力算', () => {
    const profile = resolveImageCapabilities(openai('https://api-inference.modelscope.cn/v1', true));
    expect(profile.kind).toBe('script');
    expect(profile.quality).toBe('supported');
    expect(profile.size).toBe('supported');
    expect(profile.background).toBe('supported');
    expect(profile.perRequestMax).toBe(15);
    expect(profile.separateRequestsForCount).toBe(false);
    expect(profile.asyncTask).toBe(false);
  });

  it('Gemini 原生：只发尺寸（分辨率 + 宽高比），质量与透明背景不发', () => {
    const profile = resolveImageCapabilities(gemini());
    expect(profile.kind).toBe('gemini-generate');
    expect(profile.size).toBe('supported');
    expect(profile.quality).toBe('unimplemented');
    expect(profile.background).toBe('unimplemented');
    expect(profile.referenceImages).toBe('supported');
    expect(profile.perRequestMax).toBe(1);
    expect(profile.separateRequestsForCount).toBe(true);
    expect(profile.asyncTask).toBe(false);
  });

  it('OpenAI 兼容渠道：四项都发，多张一次请求', () => {
    const profile = resolveImageCapabilities(openai());
    expect(profile.kind).toBe('openai-images');
    expect(profile.quality).toBe('supported');
    expect(profile.size).toBe('supported');
    expect(profile.background).toBe('supported');
    expect(profile.referenceImages).toBe('supported');
    expect(profile.perRequestMax).toBe(15);
    expect(profile.separateRequestsForCount).toBe(false);
  });

  it('非官方域名（含社区网页、仿冒域名、非法地址）按 OpenAI 兼容处理', () => {
    for (const baseUrl of ['https://www.modelscope.cn/v1', 'https://api-inference.modelscope.cn.evil.com/v1', 'not a url']) {
      expect(resolveImageCapabilities(openai(baseUrl)).kind).toBe('openai-images');
    }
  });

  it('未支持的项按 质量 → 尺寸 → 背景 排序，全支持时为空', () => {
    expect(unsupportedImageFields(resolveImageCapabilities(openai('https://api-inference.modelscope.cn/v1')))).toEqual(['quality', 'size', 'background']);
    expect(unsupportedImageFields(resolveImageCapabilities(gemini()))).toEqual(['quality', 'background']);
    expect(unsupportedImageFields(resolveImageCapabilities(openai()))).toEqual([]);
  });
});
