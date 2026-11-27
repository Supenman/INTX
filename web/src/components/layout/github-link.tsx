import { GithubOutlined } from "@ant-design/icons";

import { REPO_URL } from "@/constant/env";
import { cn } from "@/lib/utils";

type GitHubLinkProps = {
    className?: string;
    style?: React.CSSProperties;
};

export function GitHubLink({ className, style }: GitHubLinkProps) {
    return (
        <a
            className={cn("inline-flex size-9 shrink-0 items-center justify-center rounded-full text-muted-foreground transition hover:bg-[var(--surface-card-hover)] hover:text-foreground", className)}
            style={style}
            href={REPO_URL}
            target="_blank"
            rel="noreferrer"
            aria-label="GitHub"
            title="GitHub"
        >
            <GithubOutlined className="text-base" />
        </a>
    );
}
