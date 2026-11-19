import type { CanvasBackgroundMode } from '../../lib/canvas-theme';
import type { CanvasAssistantSession, CanvasConnection, CanvasNodeData, ViewportTransform } from '../../types/canvas';

// Business data only. Stores re-export these types; persistence never imports a store.
export type CanvasProject = {
  id: string;
  title: string;
  folder?: string;
  createdAt: string;
  updatedAt: string;
  nodes: CanvasNodeData[];
  connections: CanvasConnection[];
  chatSessions: CanvasAssistantSession[];
  activeChatId: string | null;
  backgroundMode: CanvasBackgroundMode;
  showImageInfo: boolean;
  viewport: ViewportTransform;
};
export type CanvasDeletedProject = { id: string; deletedAt: string; project?: CanvasProject; purged?: boolean };

export type AssetKind = 'text' | 'image' | 'video';
export type TextAsset = AssetBase<'text'> & { data: { content: string } };
export type ImageAsset = AssetBase<'image'> & { data: { dataUrl: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type VideoAsset = AssetBase<'video'> & { data: { url: string; storageKey?: string; width: number; height: number; bytes: number; mimeType: string } };
export type Asset = TextAsset | ImageAsset | VideoAsset;
type AssetBase<T extends AssetKind> = {
  id: string;
  kind: T;
  title: string;
  coverUrl: string;
  tags: string[];
  source?: string;
  note?: string;
  createdAt: string;
  updatedAt: string;
  metadata?: Record<string, unknown>;
};
