import { ArrowRight } from "lucide-react";
import { useEffect, useState } from "react";
import { App, Button, Image, Tag } from "antd";
import { useNavigate } from "react-router-dom";
import { Trans, useTranslation } from "react-i18next";

import { fetchPrompts, type Prompt } from "@/services/api/prompts";
import { navigationTools } from "@/constant/navigation-tools";
import i18n from "@/i18n";
import { cn } from "@/lib/utils";

export default function IndexPage() {
    const { message } = App.useApp();
    const { t } = useTranslation();
    const navigate = useNavigate();
    const [primaryTool] = navigationTools;
    const [promptShowcase, setPromptShowcase] = useState<Prompt[]>([]);
    const [previewIndex, setPreviewIndex] = useState(0);
    const [previewOpen, setPreviewOpen] = useState(false);

    useEffect(() => {
        void fetchPrompts({ pageSize: 12 })
            .then((data) => setPromptShowcase(data.items))
            .catch((error) => message.error(error instanceof Error ? error.message : i18n.t("home.promptError")));
    }, [message]);

    return (
        <main className="relative h-full overflow-y-auto bg-background bg-[radial-gradient(var(--border)_1px,transparent_1px)] [background-size:22px_22px] text-foreground">
            <section className="relative mx-auto max-w-6xl px-6">
                {/* Hero：收紧垂直节奏，标题不再用 48→96px 的断崖，改用 display 令牌 + 窄容器 */}
                <div className="relative flex flex-col items-center pb-16 pt-24 text-center sm:pb-20 sm:pt-28">
                    <div className="pointer-events-none absolute inset-0 overflow-hidden">
                        <div className="absolute left-[18%] top-16 size-16 rounded-full border border-dashed border-border/70" />
                        <div className="absolute right-[20%] top-[46%] size-16 rounded-full border border-dashed border-border/70" />
                    </div>

                    <span className="typ-label relative mb-6 inline-flex items-center gap-2 rounded-full border border-border bg-card px-3 py-1 text-muted-foreground">
                        <span className="size-1.5 rounded-full bg-emerald-500" />
                        {t("home.heroBadge")}
                    </span>

                    <h1 className="typ-display relative max-w-3xl text-balance text-foreground sm:text-[40px] sm:leading-[1.08]">
                        {t("home.heroTitle")}
                    </h1>

                    <p className="typ-body relative mt-5 max-w-xl text-balance text-muted-foreground">
                        <Trans
                            i18nKey="home.description"
                            components={{
                                canvas: <span className="border-b border-foreground/40 pb-px font-medium text-foreground" />,
                                content: <span className="rounded-[3px] bg-foreground/8 px-1 py-px font-medium text-foreground" />,
                            }}
                        />
                    </p>

                    <div className="relative mt-8 flex flex-wrap items-center justify-center gap-2.5">
                        <Button type="primary" size="large" onClick={() => navigate(`/${primaryTool.slug}`)} icon={<ArrowRight className="size-4" />} iconPlacement="end">
                            {t("home.start")}
                        </Button>
                        <Button size="large" onClick={() => navigate("/canvas")}>
                            {t("home.openCanvas")}
                        </Button>
                    </div>
                </div>

                <section className="relative pb-20">
                    {/* 标题栏：窄屏把入口按钮挪到下一行，避免描述被挤成孤字行 */}
                    <div className="mb-5 flex flex-col gap-3 sm:mb-6 sm:flex-row sm:items-end sm:justify-between sm:gap-4">
                        <div className="min-w-0">
                            <h2 className="typ-heading-lg text-foreground">{t("home.showcaseTitle")}</h2>
                            <p className="typ-caption mt-1.5 text-pretty text-muted-foreground sm:max-w-lg">{t("home.showcaseDescription")}</p>
                        </div>
                        <Button type="text" size="small" onClick={() => navigate("/prompts")} icon={<ArrowRight className="size-3.5" />} iconPlacement="end" className="shrink-0 self-start text-muted-foreground sm:self-auto">
                            {t("home.viewPrompts")}
                        </Button>
                    </div>

                    {/* 作品墙：统一圆角与表面层级，去掉逐卡描边 */}
                    {promptShowcase.length === 0 ? (
                        /* 空态不占满整块，避免整屏最重的区域却没有信息 */
                        <div className="surface-card flex flex-col items-center gap-1.5 px-6 py-9 text-center">
                            <p className="typ-body-compact font-medium text-foreground">{t("home.showcaseEmpty")}</p>
                            <p className="typ-caption text-muted-foreground">{t("home.showcaseEmptyHint")}</p>
                        </div>
                    ) : (
                    <div className="grid auto-rows-[180px] gap-3 sm:grid-cols-2 md:auto-rows-[200px] md:grid-cols-4">
                        {promptShowcase.map((item, index) => (
                            <button
                                key={item.id}
                                type="button"
                                onClick={() => {
                                    setPreviewIndex(index);
                                    setPreviewOpen(true);
                                }}
                                className={cn(
                                    "surface-card-interactive group relative cursor-pointer overflow-hidden text-left focus-ring",
                                    index === 0 && "sm:col-span-2 md:row-span-2",
                                    index === 3 && "md:col-span-2",
                                )}
                            >
                                <img
                                    src={item.coverUrl}
                                    alt={item.title}
                                    loading="lazy"
                                    className="size-full object-cover transition duration-500 group-hover:scale-[1.02]"
                                />
                                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 via-black/40 to-transparent px-3.5 pb-3 pt-10 text-white">
                                    <div className="mb-1.5 flex flex-wrap gap-1">
                                        {item.tags.slice(0, 2).map((tag) => (
                                            <span key={tag} className="typ-label rounded-full bg-white/18 px-2 py-0.5 text-white/95 backdrop-blur-sm">
                                                {tag}
                                            </span>
                                        ))}
                                    </div>
                                    <h3 className="typ-body-compact line-clamp-1 font-medium">{item.title}</h3>
                                    {/* 描述默认收起，悬停 / 键盘聚焦时展开：让作品图本身占主导 */}
                                    <p className="typ-caption mt-1 line-clamp-2 max-h-0 overflow-hidden text-white/75 opacity-0 transition-all duration-300 group-hover:max-h-12 group-hover:opacity-100 group-focus-visible:max-h-12 group-focus-visible:opacity-100">
                                        {item.prompt}
                                    </p>
                                </div>
                            </button>
                        ))}
                    </div>
                    )}
                </section>
            </section>
            <Image.PreviewGroup
                preview={{
                    open: previewOpen,
                    current: previewIndex,
                    onOpenChange: setPreviewOpen,
                    onChange: setPreviewIndex,
                }}
            >
                <div className="hidden">
                    {promptShowcase.map((item) => (
                        <Image key={item.id} src={item.coverUrl} alt={item.title} />
                    ))}
                </div>
            </Image.PreviewGroup>
        </main>
    );
}
