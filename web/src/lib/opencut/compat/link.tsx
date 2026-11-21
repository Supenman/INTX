import type { AnchorHTMLAttributes } from "react";
import { Link as RouterLink } from "react-router-dom";

type LinkProps = Omit<AnchorHTMLAttributes<HTMLAnchorElement>, "href"> & {
    href: string;
    prefetch?: boolean;
    replace?: boolean;
    scroll?: boolean;
};

export default function Link({ href, prefetch: _prefetch, scroll: _scroll, replace, ...props }: LinkProps) {
    if (/^https?:\/\//i.test(href)) return <a href={href} {...props} />;
    return <RouterLink to={href} replace={replace} {...props} />;
}
