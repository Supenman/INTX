// 剪辑台背景预设：Syntax UI 分区，编辑器风格的渐变。
// 供 BackgroundContent 渲染为 background（CSS 渐变字符串）。
export const syntaxUIGradients: readonly string[] = [
	"linear-gradient(135deg, #0f172a 0%, #1e293b 100%)",
	"linear-gradient(135deg, #0f172a 0%, #312e81 100%)",
	"linear-gradient(135deg, #1e1b4b 0%, #0f172a 100%)",
	"linear-gradient(135deg, #0c4a6e 0%, #0f172a 100%)",
	"linear-gradient(135deg, #134e4a 0%, #0f172a 100%)",
	"linear-gradient(135deg, #3b0764 0%, #0f172a 100%)",
	"linear-gradient(135deg, #1e293b 0%, #475569 100%)",
	"linear-gradient(135deg, #312e81 0%, #6d28d9 100%)",
	"linear-gradient(135deg, #0c4a6e 0%, #0891b2 100%)",
	"linear-gradient(135deg, #134e4a 0%, #0d9488 100%)",
	"radial-gradient(circle at 30% 20%, #1e293b 0%, #0f172a 70%)",
	"radial-gradient(circle at 70% 30%, #312e81 0%, #0f172a 70%)",
] as const;
