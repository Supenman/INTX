import { Component, type ErrorInfo, type ReactNode } from "react";
import { Button } from "antd";
import { AlertTriangle, Copy, Download, Home, RefreshCw } from "lucide-react";
import { isRouteErrorResponse, useRouteError } from "react-router-dom";

import i18n from "@/i18n";
import { exportDiagnosticsReport, recordDiagnosticError } from "@/services/diagnostics-log";

type AppBoundaryState = { error: Error | null };

/** 应用级防白屏边界：捕获任意页面渲染异常并提供返回首页、重载与导出诊断报告。 */
export class AppErrorBoundary extends Component<{ children: ReactNode }, AppBoundaryState> {
    state: AppBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): AppBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error, info: ErrorInfo) {
        recordDiagnosticError(`AppErrorBoundary:${info.componentStack?.split("\n")[1]?.trim() || "render"}`, error);
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <ErrorFallbackView
                error={this.state.error}
                onReset={() => this.setState({ error: null })}
            />
        );
    }
}

/** 路由级异常兜底（如懒加载分包网络错误或路由 loader 异常）。 */
export function RouteErrorFallback() {
    const routeError = useRouteError();
    const error = isRouteErrorResponse(routeError)
        ? new Error(`${routeError.status} ${routeError.statusText}`)
        : routeError instanceof Error
          ? routeError
          : new Error(String(routeError ?? "Unknown route error"));
    recordDiagnosticError("RouteErrorFallback", error);
    return <ErrorFallbackView error={error} />;
}

function ErrorFallbackView({ error, onReset }: { error: Error; onReset?: () => void }) {
    const t = i18n.t.bind(i18n);
    const detail = error.stack || error.message || "Unknown error";

    return (
        <div role="alert" className="flex h-full min-h-[360px] w-full items-center justify-center bg-background p-6 text-foreground">
            <div className="w-full max-w-lg rounded-2xl border border-border bg-[var(--surface-card)] p-6 shadow-lg">
                <div className="flex items-center gap-2.5 text-base font-semibold text-destructive">
                    <AlertTriangle className="size-5 shrink-0" />
                    <span>{t("errorBoundary.title")}</span>
                </div>
                <p className="mt-2 text-sm text-muted-foreground">{t("errorBoundary.description")}</p>
                <pre className="thin-scrollbar mt-4 max-h-40 overflow-auto whitespace-pre-wrap break-all rounded-lg border border-border bg-[var(--surface-sunken)] p-3 font-mono text-xs text-muted-foreground">
                    {error.message || detail}
                </pre>
                <div className="mt-5 flex flex-wrap items-center gap-2">
                    {onReset ? (
                        <Button type="primary" icon={<RefreshCw className="size-4" />} onClick={onReset}>
                            {t("errorBoundary.retry")}
                        </Button>
                    ) : null}
                    <Button
                        icon={<Home className="size-4" />}
                        onClick={() => {
                            window.location.assign("/");
                        }}
                    >
                        {t("errorBoundary.goHome")}
                    </Button>
                    <Button
                        icon={<Copy className="size-4" />}
                        onClick={() => {
                            void navigator.clipboard?.writeText(detail);
                        }}
                    >
                        {t("errorBoundary.copyError")}
                    </Button>
                    <Button
                        icon={<Download className="size-4" />}
                        onClick={() => {
                            void exportDiagnosticsReport();
                        }}
                    >
                        {t("errorBoundary.exportDiagnostics")}
                    </Button>
                </div>
            </div>
        </div>
    );
}

type NodeBoundaryState = { error: Error | null };

/** 画布单节点/插件防崩溃边界：单个节点或插件渲染异常时只降级当前节点，不拖垮整张画布。 */
export class CanvasNodeErrorBoundary extends Component<{ nodeId: string; children: ReactNode }, NodeBoundaryState> {
    state: NodeBoundaryState = { error: null };

    static getDerivedStateFromError(error: Error): NodeBoundaryState {
        return { error };
    }

    componentDidCatch(error: Error) {
        recordDiagnosticError(`CanvasNode:${this.props.nodeId}`, error);
    }

    componentDidUpdate(prevProps: { nodeId: string }) {
        if (prevProps.nodeId !== this.props.nodeId && this.state.error) {
            this.setState({ error: null });
        }
    }

    render() {
        if (!this.state.error) return this.props.children;
        return (
            <div
                role="alert"
                className="flex h-full w-full flex-col items-center justify-center gap-2 px-4 text-center text-xs text-muted-foreground"
                onPointerDown={(event) => event.stopPropagation()}
            >
                <AlertTriangle className="size-5 text-destructive" />
                <span className="font-medium text-foreground">{i18n.t("errorBoundary.nodeTitle")}</span>
                <span className="line-clamp-2 break-words opacity-80">{this.state.error.message}</span>
                <button
                    type="button"
                    className="mt-1 inline-flex h-7 items-center gap-1 rounded-full border border-border bg-[var(--surface-card)] px-2.5 text-xs text-foreground hover:bg-[var(--surface-card-hover)]"
                    onClick={() => this.setState({ error: null })}
                >
                    <RefreshCw className="size-3" />
                    {i18n.t("errorBoundary.retry")}
                </button>
            </div>
        );
    }
}
