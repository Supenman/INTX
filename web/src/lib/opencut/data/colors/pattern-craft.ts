// 剪辑台背景预设：Pattern craft 分区，装饰性渐变。
// 供 BackgroundContent 渲染为 background（CSS 渐变字符串）。
export const patternCraftGradients: readonly string[] = [
	"linear-gradient(135deg, #fde68a 0%, #fca5a5 100%)",
	"linear-gradient(135deg, #fca5a5 0%, #c084fc 100%)",
	"linear-gradient(135deg, #c084fc 0%, #818cf8 100%)",
	"linear-gradient(135deg, #818cf8 0%, #22d3ee 100%)",
	"linear-gradient(135deg, #22d3ee 0%, #4ade80 100%)",
	"linear-gradient(135deg, #4ade80 0%, #facc15 100%)",
	"linear-gradient(135deg, #fb923c 0%, #f87171 100%)",
	"linear-gradient(135deg, #f87171 0%, #fbbf24 100%)",
	"linear-gradient(45deg, #fbbf24 25%, #f472b6 25%, #f472b6 50%, #818cf8 50%, #818cf8 75%, #22d3ee 75%)",
	"radial-gradient(circle at 30% 30%, #fde68a 0%, #fca5a5 45%, #c084fc 100%)",
	"radial-gradient(circle at 50% 50%, #818cf8 0%, #312e81 100%)",
	"conic-gradient(from 180deg at 50% 50%, #fca5a5, #fbbf24, #4ade80, #22d3ee, #818cf8, #c084fc, #fca5a5)",
] as const;
