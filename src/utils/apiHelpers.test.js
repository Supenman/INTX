import { describe, it, expect } from 'vitest';
import { classifyModel, normalizeId, deriveIdFromName, newProviderTemplate } from './apiHelpers';

describe('classifyModel', () => {
  it('classifies video models by keyword', () => {
    expect(classifyModel('Sora-1.0')).toBe('video');
    expect(classifyModel('kling-v1')).toBe('video');
    expect(classifyModel('doubao-seedance-001')).toBe('video');
    expect(classifyModel('wan2.1-t2v')).toBe('video');
  });

  it('classifies image models by keyword', () => {
    expect(classifyModel('DALL-E 3')).toBe('image');
    expect(classifyModel('flux-pro')).toBe('image');
    expect(classifyModel('qwen-image-edit')).toBe('image');
    expect(classifyModel('z-image-turbo')).toBe('image');
  });

  it('defaults to chat for unrecognized models', () => {
    expect(classifyModel('gpt-4o')).toBe('chat');
    expect(classifyModel('claude-3.5-sonnet')).toBe('chat');
  });

  it('handles undefined / empty / non-string safely', () => {
    expect(classifyModel()).toBe('chat');
    expect(classifyModel('')).toBe('chat');
    expect(classifyModel(null)).toBe('chat');
  });

  it('is case-insensitive', () => {
    expect(classifyModel('SORA')).toBe('video');
    expect(classifyModel('Flux')).toBe('image');
  });
});

describe('normalizeId', () => {
  it('lowercases and replaces non-allowed chars', () => {
    expect(normalizeId('  My Provider!!  ')).toBe('my-provider');
  });
  it('keeps non-dash non-letter characters as-is after replacement', () => {
    expect(normalizeId('a---b___c')).toBe('a-b___c');
  });
  it('strips leading and trailing dashes', () => {
    expect(normalizeId('---hello---')).toBe('hello');
  });
  it('truncates to 40 chars', () => {
    const long = 'a'.repeat(60);
    expect(normalizeId(long).length).toBe(40);
  });
  it('handles empty / undefined / non-string', () => {
    expect(normalizeId('')).toBe('');
    expect(normalizeId()).toBe('');
    expect(normalizeId(null)).toBe('');
  });
});

describe('deriveIdFromName', () => {
  it('returns existingId when it is comfly or modelscope', () => {
    expect(deriveIdFromName('Anything', 'comfly', [])).toBe('comfly');
    expect(deriveIdFromName('Anything', 'modelscope', [])).toBe('modelscope');
  });

  it('derives a normalised id from a name', () => {
    expect(deriveIdFromName('My Provider!!', 'new-1', [])).toBe('my-provider');
  });

  it('avoids collision with other providers', () => {
    const all = [
      { id: 'my-provider' },
      { id: 'my-provider-2' },
    ];
    expect(deriveIdFromName('My Provider', 'new-1', all)).toBe('my-provider-3');
  });

  it('skips its own existing id when checking collisions', () => {
    const all = [{ id: 'foo' }];
    expect(deriveIdFromName('Foo', 'foo', all)).toBe('foo');
  });

  it('generates a random id when name normalises to empty', () => {
    const id = deriveIdFromName('!!!', 'new-1', []);
    expect(id).toMatch(/^api-[a-z0-9]{6}$/);
  });
});

describe('newProviderTemplate', () => {
  it('returns the expected default shape', () => {
    const t = newProviderTemplate();
    expect(t).toMatchObject({
      name: '新平台',
      base_url: '',
      protocol: 'openai',
      enabled: true,
      primary: false,
    });
    expect(t.id).toMatch(/^new-\d+$/);
    expect(t.image_models).toEqual([]);
    expect(t.chat_models).toEqual([]);
    expect(t.video_models).toEqual([]);
  });

  it('produces an id with the expected prefix', () => {
    const t = newProviderTemplate();
    expect(t.id.startsWith('new-')).toBe(true);
  });
});
