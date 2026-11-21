import type { ComponentProps } from "react";

type ImageProps = Omit<ComponentProps<"img">, "width" | "height"> & {
    width?: number | `${number}`;
    height?: number | `${number}`;
    fill?: boolean;
    priority?: boolean;
    unoptimized?: boolean;
    quality?: number;
};

export default function Image({ fill, priority: _priority, unoptimized: _unoptimized, quality: _quality, ...props }: ImageProps) {
    return <img {...props} className={`${fill ? "absolute inset-0 size-full object-cover " : ""}${props.className || ""}`} />;
}
