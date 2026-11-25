/**
 * 第三方库与较新浏览器 API 的类型补充。
 *
 * 这几项在上游没有随包发布 .d.ts（或 TS 内置 lib 还没收录），
 * 缺声明会让 `tsc --noEmit` 在整份代码上报 TS7016 / TS2304，
 * 把真正的问题淹掉。这里只补用到的成员，保持 narrow：宁可少声明，
 * 也不要用 any 把类型检查放过去。
 */

declare module "culori" {
    /** 各色彩空间的公共形状；具体通道按 mode 取舍，用可选字段表达。 */
    export type ColorObject = {
        mode: string;
        r?: number;
        g?: number;
        b?: number;
        h?: number;
        s?: number;
        l?: number;
        v?: number;
        alpha?: number;
    };

    export type Rgb = ColorObject & { mode: "rgb"; r: number; g: number; b: number };

    /** converter("rgb") 精确到通道；其它 mode 只保证返回对象可再喂给 formatHex。 */
    export function converter(mode: "rgb"): (color: string | ColorObject) => Rgb | undefined;
    export function converter(mode: string): (color: string | ColorObject) => ColorObject | undefined;

    export function parse(color: string): ColorObject | undefined;
    export function formatHex(color: string | ColorObject): string;
    export function formatHex8(color: string | ColorObject): string;
}

declare module "soundtouchjs" {
    /** 变速不变调处理器：挂到 AudioContext 上，通过 connect 接下游节点。 */
    export class PitchShifter {
        constructor(context: BaseAudioContext, buffer: AudioBuffer, bufferSize?: number);
        tempo: number;
        pitch: number;
        percentagePlayed: number;
        connect(node: AudioNode): void;
        disconnect(): void;
    }
}

/** EyeDropper API 在部分 WebView 里存在但未进 TypeScript 内置 lib.dom。 */
declare class EyeDropper {
    open(): Promise<{ sRGBHex: string }>;
}

interface Window {
    EyeDropper?: typeof EyeDropper;
}
