import type { StickerProvider } from "@/lib/opencut/stickers/types";
import { DefinitionRegistry } from "@/lib/opencut/params/registry";

export class StickersRegistry extends DefinitionRegistry<string, StickerProvider> {
	constructor() {
		super("sticker provider");
	}
}

export const stickersRegistry = new StickersRegistry();
