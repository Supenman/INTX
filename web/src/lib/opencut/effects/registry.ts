import { DefinitionRegistry } from "@/lib/opencut/params/registry";
import type { EffectDefinition } from "@/lib/opencut/effects/types";

export class EffectsRegistry extends DefinitionRegistry<string, EffectDefinition> {
	constructor() {
		super("effect");
	}
}

export const effectsRegistry = new EffectsRegistry();
