import { useCallback, useEffect, useRef, useState } from "react";
import { Moon, Sun } from "lucide-react";
import { flushSync } from "react-dom";
import { useTranslation } from "react-i18next";

import { cn } from "@/lib/utils";

export type TransitionVariant = "circle" | "square" | "triangle" | "diamond" | "hexagon" | "rectangle" | "star";

interface AnimatedThemeTogglerProps extends React.ComponentPropsWithoutRef<"button"> {
    duration?: number;
    variant?: TransitionVariant;
    /** When true, the transition expands from the viewport center instead of the button center. */
    fromCenter?: boolean;
    theme?: "light" | "dark";
    targetTheme?: "light" | "dark";
    onThemeChange?: (theme: "light" | "dark") => void;
}

// 模块级锁：连续快速点击时，前一个 ViewTransition 还没结束就再起一个，会出现两套剪裁动画叠加、
// 主题停在中间态。BeefTV 上游用同样的锁挡住并发，这里对齐。动画引用也留着，cleanup 时取消，
// 避免 finished 和 ready 两条路径各驱动一次动画。
let themeTransitionInFlight = false;
let themeClipAnimation: Animation | null = null;

function polygonCollapsed(cx: number, cy: number, vertexCount: number): string {
    const pairs = Array.from({ length: vertexCount }, () => `${cx}px ${cy}px`).join(", ");
    return `polygon(${pairs})`;
}

function getThemeTransitionClipPaths(variant: TransitionVariant, cx: number, cy: number, maxRadius: number, viewportWidth: number, viewportHeight: number): [string, string] {
    switch (variant) {
        case "circle":
            return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
        case "square": {
            const halfW = Math.max(cx, viewportWidth - cx);
            const halfH = Math.max(cy, viewportHeight - cy);
            const halfSide = Math.max(halfW, halfH) * 1.05;
            const end = [`${cx - halfSide}px ${cy - halfSide}px`, `${cx + halfSide}px ${cy - halfSide}px`, `${cx + halfSide}px ${cy + halfSide}px`, `${cx - halfSide}px ${cy + halfSide}px`].join(", ");
            return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
        }
        case "triangle": {
            const scale = maxRadius * 2.2;
            const dx = (Math.sqrt(3) / 2) * scale;
            const verts = [`${cx}px ${cy - scale}px`, `${cx + dx}px ${cy + 0.5 * scale}px`, `${cx - dx}px ${cy + 0.5 * scale}px`].join(", ");
            return [polygonCollapsed(cx, cy, 3), `polygon(${verts})`];
        }
        case "diamond": {
            // Slightly larger than the view-transition circle radius so axis-aligned coverage matches the circle reveal.
            const R = maxRadius * Math.SQRT2;
            const end = [`${cx}px ${cy - R}px`, `${cx + R}px ${cy}px`, `${cx}px ${cy + R}px`, `${cx - R}px ${cy}px`].join(", ");
            return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
        }
        case "hexagon": {
            const R = maxRadius * Math.SQRT2;
            const verts: string[] = [];
            for (let i = 0; i < 6; i++) {
                const a = -Math.PI / 2 + (i * Math.PI) / 3;
                verts.push(`${cx + R * Math.cos(a)}px ${cy + R * Math.sin(a)}px`);
            }
            return [polygonCollapsed(cx, cy, 6), `polygon(${verts.join(", ")})`];
        }
        case "rectangle": {
            const halfW = Math.max(cx, viewportWidth - cx);
            const halfH = Math.max(cy, viewportHeight - cy);
            const end = [`${cx - halfW}px ${cy - halfH}px`, `${cx + halfW}px ${cy - halfH}px`, `${cx + halfW}px ${cy + halfH}px`, `${cx - halfW}px ${cy + halfH}px`].join(", ");
            return [polygonCollapsed(cx, cy, 4), `polygon(${end})`];
        }
        case "star": {
            // Small overscan so the last frames never leave a 1px seam before the transition group ends.
            const R = maxRadius * Math.SQRT2 * 1.03;
            const innerRatio = 0.42;
            const starPolygon = (radius: number) => {
                const verts: string[] = [];
                for (let i = 0; i < 5; i++) {
                    const outerA = -Math.PI / 2 + (i * 2 * Math.PI) / 5;
                    verts.push(`${cx + radius * Math.cos(outerA)}px ${cy + radius * Math.sin(outerA)}px`);
                    const innerA = outerA + Math.PI / 5;
                    verts.push(`${cx + radius * innerRatio * Math.cos(innerA)}px ${cy + radius * innerRatio * Math.sin(innerA)}px`);
                }
                return `polygon(${verts.join(", ")})`;
            };
            const startR = Math.max(2, R * 0.025);
            return [starPolygon(startR), starPolygon(R)];
        }
        default:
            return [`circle(0px at ${cx}px ${cy}px)`, `circle(${maxRadius}px at ${cx}px ${cy}px)`];
    }
}

export const AnimatedThemeToggler = ({ children, className, duration = 400, variant, fromCenter = false, theme, targetTheme, onThemeChange, ...props }: AnimatedThemeTogglerProps) => {
    const { t } = useTranslation();
    const shape = variant ?? "circle";
    const [isDark, setIsDark] = useState(false);
    const buttonRef = useRef<HTMLButtonElement>(null);

    useEffect(() => {
        if (theme) {
            setIsDark(theme === "dark");
            return;
        }

        const updateTheme = () => {
            setIsDark(document.documentElement.classList.contains("dark"));
        };

        updateTheme();

        const observer = new MutationObserver(updateTheme);
        observer.observe(document.documentElement, {
            attributes: true,
            attributeFilter: ["class"],
        });

        return () => observer.disconnect();
    }, [theme]);

    const toggleTheme = useCallback(() => {
        const button = buttonRef.current;
        if (!button) return;

        // 以 DOM 实际状态为准，不用闭包里的 isDark——连点/外部改主题时 state 可能滞后一帧。
        const currentTheme = document.documentElement.classList.contains("dark") ? "dark" : "light";
        const nextTheme = targetTheme ?? (currentTheme === "dark" ? "light" : "dark");
        if (nextTheme === currentTheme) return;

        const viewportWidth = window.visualViewport?.width ?? window.innerWidth;
        const viewportHeight = window.visualViewport?.height ?? window.innerHeight;

        let x: number;
        let y: number;
        if (fromCenter) {
            x = viewportWidth / 2;
            y = viewportHeight / 2;
        } else {
            const { top, left, width, height } = button.getBoundingClientRect();
            x = left + width / 2;
            y = top + height / 2;
        }

        const maxRadius = Math.hypot(Math.max(x, viewportWidth - x), Math.max(y, viewportHeight - y));

        const applyTheme = () => {
            setIsDark(nextTheme === "dark");
            document.documentElement.classList.toggle("dark", nextTheme === "dark");
            document.documentElement.style.colorScheme = nextTheme;
            onThemeChange?.(nextTheme);
        };

        const root = document.documentElement;
        // 减弱动效偏好 / 不支持 ViewTransition：直接切，不跑剪裁动画，避免 ca11y 问题与中间态。
        const reducedMotion = window.matchMedia("(prefers-reduced-motion: reduce)").matches;
        if (reducedMotion || typeof document.startViewTransition !== "function") {
            flushSync(applyTheme);
            return;
        }
        if (themeTransitionInFlight) return;
        themeTransitionInFlight = true;

        const clipPath = getThemeTransitionClipPaths(shape, x, y, maxRadius, viewportWidth, viewportHeight);

        root.dataset.magicuiThemeVt = "active";
        root.style.setProperty("--magicui-theme-toggle-vt-duration", `${duration}ms`);
        // Pin the collapsed clip-path via CSS so Firefox does not paint the new
        // theme unclipped between snapshot and the ready.then() JS animation.
        root.style.setProperty("--magicui-theme-vt-clip-from", clipPath[0]);
        let cleaned = false;
        const cleanup = () => {
            if (cleaned) return;
            cleaned = true;
            themeClipAnimation?.cancel();
            themeClipAnimation = null;
            themeTransitionInFlight = false;
            delete root.dataset.magicuiThemeVt;
            root.style.removeProperty("--magicui-theme-toggle-vt-duration");
            root.style.removeProperty("--magicui-theme-vt-clip-from");
        };

        let transition: ReturnType<NonNullable<typeof document.startViewTransition>>;
        try {
            transition = document.startViewTransition(() => {
                flushSync(applyTheme);
            });
        } catch {
            // 有些 WebView 实现了 startViewTransition 但在特定时机抛错；兜底直接切主题并放锁。
            cleanup();
            flushSync(applyTheme);
            return;
        }
        if (typeof transition?.finished?.finally === "function") {
            void transition.finished.then(cleanup, cleanup);
        } else {
            cleanup();
        }

        const ready = transition?.ready;
        if (ready && typeof ready.then === "function") {
            void ready
                .then(() => {
                    if (cleaned) return;
                    themeClipAnimation?.cancel();
                    themeClipAnimation = document.documentElement.animate(
                        {
                            clipPath,
                        },
                        {
                            duration,
                            // Star: linear avoids easing overshoot that fights polygon interpolation at t→1; VT group duration is synced above.
                            easing: shape === "star" ? "linear" : "ease-in-out",
                            fill: "forwards",
                            pseudoElement: "::view-transition-new(root)",
                        },
                    );
                })
                .catch(() => undefined);
        }
    }, [shape, fromCenter, duration, targetTheme, onThemeChange]);

    return (
        <button type="button" ref={buttonRef} onClick={toggleTheme} className={cn(className)} {...props}>
            {children ?? (isDark ? <Sun /> : <Moon />)}
            <span className="sr-only">{props["aria-label"] || t("theme.toggle")}</span>
        </button>
    );
};
