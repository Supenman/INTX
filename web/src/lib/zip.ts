import { unzipSync, zipSync } from "fflate";

type ZipFile = {
    name: string;
    data: BlobPart;
};

/** 导入包来自用户手里的外部文件，必须先设上限再解压，不能把 1KB 的压缩包放开成几个 G。 */
const MAX_ZIP_ENTRIES = 512;
const MAX_UNCOMPRESSED_BYTES = 512 * 1024 * 1024;

const EOCD_SIGNATURE = 0x06054b50;
const CENTRAL_SIGNATURE = 0x02014b50;

/**
 * 只读 ZIP 中央目录，不碰压缩数据。
 *
 * `unzipSync` 会一次性把所有条目展开到内存，所以「解压完再检查大小」没有任何意义。
 * 中央目录里每条都记了原始大小，先把它加起来，超限直接拒。ZIP64 的 32 位字段
 * 全是 0xffff，这里明确拒绝而不是猜——猜错的代价是把整个进程内存打满。
 */
export function assertZipBudget(bytes: Uint8Array) {
    const view = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
    let eocd = -1;
    // EOCD 固定 22 字节，注释最长 65535 字节，从尾部往回找即可。
    const floor = Math.max(0, bytes.length - (22 + 65535));
    for (let offset = bytes.length - 22; offset >= floor; offset -= 1) {
        if (view.getUint32(offset, true) === EOCD_SIGNATURE) {
            eocd = offset;
            break;
        }
    }
    if (eocd < 0) throw new Error("压缩包格式无效：找不到结束目录");

    const count = view.getUint16(eocd + 10, true);
    const centralSize = view.getUint32(eocd + 12, true);
    const centralOffset = view.getUint32(eocd + 16, true);
    if (count === 0xffff || centralSize === 0xffffffff || centralOffset === 0xffffffff) throw new Error("不支持 ZIP64 压缩包");
    if (count > MAX_ZIP_ENTRIES) throw new Error(`压缩包条目超过 ${MAX_ZIP_ENTRIES} 个，已拒绝导入`);
    if (centralOffset + centralSize > bytes.length) throw new Error("压缩包目录损坏");

    let total = 0;
    let cursor = centralOffset;
    for (let index = 0; index < count; index += 1) {
        if (cursor + 46 > bytes.length || view.getUint32(cursor, true) !== CENTRAL_SIGNATURE) throw new Error("压缩包目录损坏");
        total += view.getUint32(cursor + 24, true);
        if (total > MAX_UNCOMPRESSED_BYTES) throw new Error(`压缩包解压后超过 ${Math.round(MAX_UNCOMPRESSED_BYTES / 1024 / 1024)} MB，已拒绝导入`);
        const nameLength = view.getUint16(cursor + 28, true);
        const extraLength = view.getUint16(cursor + 30, true);
        const commentLength = view.getUint16(cursor + 32, true);
        cursor += 46 + nameLength + extraLength + commentLength;
        if (cursor > bytes.length) throw new Error("压缩包目录损坏");
    }
}

export async function createZip(files: ZipFile[]) {
    const entries = await Promise.all(
        files.map(async (file) => {
            const data = new Uint8Array(await new Blob([file.data]).arrayBuffer());
            return [file.name, data] as const;
        }),
    );
    return new Blob([zipSync(Object.fromEntries(entries), { level: 0 })], { type: "application/zip" });
}

export async function readZip(file: Blob) {
    const bytes = new Uint8Array(await file.arrayBuffer());
    assertZipBudget(bytes);
    const entries = unzipSync(bytes);
    // 中央目录声明与实际内容不一致时，同样按超限处理，不把可疑内容交出去。
    const values = Object.values(entries);
    if (values.length > MAX_ZIP_ENTRIES || values.reduce((sum, data) => sum + data.byteLength, 0) > MAX_UNCOMPRESSED_BYTES) throw new Error("压缩包内容超过限制，已拒绝导入");
    return new Map(Object.entries(entries).map(([name, data]) => [name, new Blob([data])]));
}
