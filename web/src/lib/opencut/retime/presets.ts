import type { RetimeConfig } from "@/lib/opencut/timeline";
import { clampRetimeRate } from "@/lib/opencut/retime/rate";

export function buildConstantRetime({
	rate,
	maintainPitch = false,
}: {
	rate: number;
	maintainPitch?: boolean;
}): RetimeConfig {
	return { rate: clampRetimeRate({ rate }), maintainPitch };
}
