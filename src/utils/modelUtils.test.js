import { describe, it, expect } from 'vitest';
import { getAvailableModels } from './modelUtils';

describe('getAvailableModels', () => {
  it('returns image models from enabled providers', () => {
    const providers = [
      { id: 'a', enabled: true, image_models: ['SeeDream 4.5', 'DALL-E 3'] },
      { id: 'b', enabled: false, image_models: ['Hidden'] },
    ];
    expect(getAvailableModels('image', providers)).toEqual(['SeeDream 4.5', 'DALL-E 3']);
  });

  it('uses chat_models key for text type', () => {
    const providers = [
      { id: 'a', enabled: true, chat_models: ['GPT-4o', 'Claude 3.5'] },
    ];
    expect(getAvailableModels('text', providers)).toEqual(['GPT-4o', 'Claude 3.5']);
  });

  it('uses video_models key for video type', () => {
    const providers = [
      { id: 'a', enabled: true, video_models: ['Sora'] },
    ];
    expect(getAvailableModels('video', providers)).toEqual(['Sora']);
  });

  it('deduplicates models across providers', () => {
    const providers = [
      { id: 'a', enabled: true, image_models: ['DALL-E 3', 'Flux'] },
      { id: 'b', enabled: true, image_models: ['DALL-E 3', 'Imagen'] },
    ];
    expect(getAvailableModels('image', providers)).toEqual(['DALL-E 3', 'Flux', 'Imagen']);
  });

  it('falls back to defaults when no enabled provider has models', () => {
    expect(getAvailableModels('image', [{ id: 'a', enabled: true, image_models: [] }]))
      .toEqual(['SeeDream 4.5', 'SeeDream 3.0', 'Stable Diffusion XL', 'DALL-E 3']);
    expect(getAvailableModels('text', [])).toEqual(['GPT-4o', 'Claude 3.5', 'Gemini Pro', 'Qwen 2.5']);
    expect(getAvailableModels('video', [])).toEqual(['SeeVideo 2.0', 'Runway Gen-3', 'Pika 1.0', 'Sora']);
  });

  it('returns empty array for unknown type with no providers', () => {
    expect(getAvailableModels('unknown', [])).toEqual([]);
  });

  it('handles missing providers argument', () => {
    expect(getAvailableModels('image')).toEqual(['SeeDream 4.5', 'SeeDream 3.0', 'Stable Diffusion XL', 'DALL-E 3']);
  });
});