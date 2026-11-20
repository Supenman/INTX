/**
 * 时间线的时间单位。
 *
 * 为什么不用浮点秒：30fps 下 1 帧 = 33.3333…ms，用浮点秒做累加，1000 帧后能漂出 0.3 秒，
 * 导出时画面和音频就对不上了。120000 ticks/秒 能被 24 / 25 / 30 / 23.976 / 29.97 的帧率
 * 分母整除（30fps = 4000 ticks/帧，23.976fps = 5005 ticks/帧），全程整数运算不丢精度。
 */

export const TICKS_PER_SECOND = 120_000;

export function secondsToTicks(seconds: number): number {
    return Math.round(seconds * TICKS_PER_SECOND);
}

export function ticksToSeconds(ticks: number): number {
    return ticks / TICKS_PER_SECOND;
}

export function ticksPerFrame(fps: number): number {
    return TICKS_PER_SECOND / fps;
}

/** 把任意 tick 吸附到最近的帧边界，避免出现「半帧」这种编码器不接受的时间点。 */
export function snapToFrame(ticks: number, fps: number): number {
    const perFrame = ticksPerFrame(fps);
    return Math.round(ticks / perFrame) * perFrame;
}
