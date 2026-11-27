// 画布色板。基线对齐 BeefTV 上游（中性灰），不再用暖灰（stone）——
// 应用外壳走 shadcn 的中性色，画布用暖米会让「列表页 → 画布」出现色调断层。
// 唯一有意偏离上游的是 placeholder：上游 #737373 在深色卡上只有 3.2:1，
// 而占位文字是用户判断「这个节点是什么」的唯一线索，这里提到 ≥4.5:1。

export type CanvasColorTheme = "light" | "dark";
export type CanvasBackgroundMode = "dots" | "lines" | "blank";

export const canvasThemes = {
    light: {
        canvas: {
            background: "#f0f0f0",
            dot: "rgba(0,0,0,.28)",
            line: "rgba(0,0,0,.10)",
            selectionStroke: "#111827",
            selectionFill: "rgba(17,17,17,.10)",
        },
        node: {
            label: "#4b5563",
            fill: "#ffffff",
            panel: "#ffffff",
            stroke: "#e2e4e8",
            activeStroke: "#111827",
            placeholder: "#6b7280",
            text: "#111827",
            muted: "#4b5563",
            faint: "#9ca3af",
            // 节点静止/悬停阴影：静态卡片只用一层浅影，选中时才加深，
            // 否则整屏节点都带重阴影，画布看起来发灰。
            shadow: "0 6px 18px rgba(15,23,42,.08)",
            hoverShadow: "0 10px 24px rgba(15,23,42,.12)",
        },
        toolbar: {
            panel: "rgba(255,255,255,.94)",
            border: "rgba(17,24,39,.10)",
            item: "#4b5563",
            itemHover: "rgba(17,24,39,.06)",
            activeBg: "rgba(17,24,39,.10)",
            activeText: "#111827",
        },
    },
    dark: {
        canvas: {
            // 上游采样基线为 #141414，不是纯黑；点阵保持低对比度。
            background: "#141414",
            dot: "rgba(175,175,175,.24)",
            line: "rgba(210,210,210,.30)",
            selectionStroke: "#f1f1f1",
            selectionFill: "rgba(255,255,255,.12)",
        },
        node: {
            label: "#a3a3a3",
            fill: "#262626",
            panel: "#222222",
            stroke: "rgba(255,255,255,.18)",
            activeStroke: "#f1f1f1",
            placeholder: "#8f8f8f",
            text: "#ededed",
            muted: "#a3a3a3",
            faint: "#666666",
            // 暗色下阴影几乎不可见，改用更深的投影叠加提亮，保证卡片边缘可辨。
            shadow: "0 6px 18px rgba(0,0,0,.36)",
            hoverShadow: "0 10px 26px rgba(0,0,0,.46)",
        },
        toolbar: {
            panel: "rgba(20,20,20,.97)",
            border: "rgba(255,255,255,.10)",
            item: "#d4d4d4",
            itemHover: "rgba(255,255,255,.07)",
            activeBg: "rgba(255,255,255,.10)",
            activeText: "#f5f6f8",
        },
    },
} as const;

export type CanvasTheme = (typeof canvasThemes)[CanvasColorTheme];
