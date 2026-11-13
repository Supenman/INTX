import { describe, expect, it } from 'vitest';
import { assetSnapshotCodec, encodeSnapshot, projectSnapshotCodec } from './snapshot-storage';
import { sampleAssets, sampleProjects, valueOf } from './snapshot-repositories.contract';

const corrupt = { ok: false, error: { code: 'corrupt_data', message: expect.any(String) } };
describe('lossless snapshot validation', () => {
  it('normal typed optional undefined is absence, open metadata stays complete', () => {
    const projects = sampleProjects();
    projects.projects[0].nodes[0].metadata!.errorDetails = undefined;
    projects.projects[0].nodes[0].metadata!.groupId = undefined;
    projects.projects[0].chatSessions[0].messages[0].detail = undefined;
    const assets = sampleAssets(); assets.assets[0].source = undefined; assets.assets[0].metadata!.prompt = undefined;
    for (const [codec, fixture] of [[projectSnapshotCodec, projects], [assetSnapshotCodec, assets]] as const) {
      const normalized = JSON.parse(JSON.stringify(fixture));
      // Union-specific generic calls are checked independently below.
      expect(codec.copy(fixture as never)).toEqual({ ok: true, value: normalized });
      expect(codec.decode(encodeSnapshot({ value: normalized, revision: 10 }))).toEqual({ ok: true, value: { value: normalized, revision: 10 } });
    }
  });
  it.each([
    ['required undefined', (p: any) => { p.projects[0].title = undefined; }],
    ['wrong viewport field', (p: any) => { p.projects[0].viewport.k = '1'; }],
    ['required node position missing', (p: any) => { delete p.projects[0].nodes[0].position; }],
    ['bad known metadata type', (p: any) => { p.projects[0].nodes[0].metadata.images[0].naturalWidth = '640'; }],
    ['bad connection', (p: any) => { p.projects[0].connections[0].toNodeId = null; }],
    ['bad tombstone', (p: any) => { p.deletedProjects[0].deletedAt = 3; }],
    ['function in detail', (p: any) => { p.projects[0].chatSessions[0].messages[0].detail = { fn: () => 3 }; }],
    ['function metadata', (p: any) => { p.projects[0].nodes[0].metadata.custom = () => 3; }],
    ['undefined array item', (p: any) => { p.projects[0].chatSessions[0].messages[0].detail = [undefined]; }],
    ['undefined unknown detail field', (p: any) => { p.projects[0].chatSessions[0].messages[0].detail = { essential: undefined }; }],
    ['undefined nested plugin field', (p: any) => { p.projects[0].nodes[0].metadata.customData = { essential: undefined }; }],
    ['sparse array', (p: any) => { p.projects[0].nodes = new Array(1); }],
    ['NaN', (p: any) => { p.projects[0].viewport.x = NaN; }],
    ['Infinity', (p: any) => { p.projects[0].nodes[0].metadata.bytes = Infinity; }],
    ['bigint', (p: any) => { p.projects[0].nodes[0].metadata.custom = (globalThis as any).BigInt(1); }],
    ['symbol', (p: any) => { p.projects[0].nodes[0].metadata.custom = Symbol('synthetic'); }],
    ['symbol property', (p: any) => { p.projects[0][Symbol('synthetic')] = 3; }],
    ['Date', (p: any) => { p.projects[0].chatSessions[0].messages[0].detail = new Date(); }],
    ['Map', (p: any) => { p.projects[0].chatSessions[0].messages[0].detail = new Map(); }],
    ['cycle', (p: any) => { p.projects[0].nodes[0].metadata.custom = p; }],
    ['non-enumerable', (p: any) => { Object.defineProperty(p, 'secret', { value: 1 }); }],
    ['toJSON', (p: any) => { p.projects[0].nodes[0].metadata.toJSON = () => ({ content: 'lost' }); }],
    ['extra array field', (p: any) => { p.projects.custom = 'lost'; }],
    ['duplicate projects', (p: any) => { p.projects.push(p.projects[0]); }],
    ['duplicate tombstones', (p: any) => { p.deletedProjects.push(p.deletedProjects[0]); }],
  ])('%s rejects before stringify', (_, mutate) => {
    const p = sampleProjects(); mutate(p); expect(projectSnapshotCodec.copy(p)).toEqual(corrupt);
  });
  it('accessor is rejected without invoking user getter', () => {
    const p = sampleProjects(); let reads = 0;
    Object.defineProperty(p.projects[0], 'title', { enumerable: true, get() { reads++; return 'lost'; } });
    expect(projectSnapshotCodec.copy(p)).toEqual(corrupt); expect(reads).toBe(0);
  });
  it('shared references are cloned without treating them as cycles', () => {
    const p = sampleProjects(); p.projects[1].viewport = p.projects[0].viewport;
    expect(valueOf(projectSnapshotCodec.copy(p))).toEqual(p);
  });
  it.each([
    ['required media undefined', (a: any) => { a.assets[0].data.url = undefined; }],
    ['wrong media width', (a: any) => { a.assets[1].data.width = '640'; }],
    ['undefined tag', (a: any) => { a.assets[0].tags.push(undefined); }],
    ['wrong kind', (a: any) => { a.assets[0].kind = 'audio'; }],
    ['duplicate assets', (a: any) => { a.assets.push(a.assets[0]); }],
    ['non-JSON metadata', (a: any) => { a.assets[0].metadata.fn = () => 3; }],
  ])('%s rejects assets', (_, mutate) => { const a = sampleAssets(); mutate(a); expect(assetSnapshotCodec.copy(a)).toEqual(corrupt); });
  it('envelope only accepts current legacy or format one, never interprets malformed as empty', () => {
    const p = sampleProjects(); const raw = JSON.stringify({ state: p, version: 0 });
    expect(projectSnapshotCodec.decode(raw)).toEqual({ ok: true, value: { value: p, revision: 0 } });
    for (const invalid of [null, {}, '{bad', JSON.stringify({ state: p, version: 0, metadata: null }), JSON.stringify({ state: p, version: 0, extra: true }), JSON.stringify({ state: p, version: 0, metadata: { formatVersion: 1 } })]) expect(projectSnapshotCodec.decode(invalid)).toEqual(corrupt);
    for (const version of [1, null, '0']) expect(projectSnapshotCodec.decode(JSON.stringify({ state: p, version }))).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.any(String) } });
    for (const formatVersion of [2, null, '1']) expect(projectSnapshotCodec.decode(JSON.stringify({ state: p, version: 0, metadata: { formatVersion, revision: 0 } }))).toEqual({ ok: false, error: { code: 'unsupported_format', message: expect.any(String) } });
    for (const revision of [-1, 0.5, '1', null, Number.MAX_SAFE_INTEGER + 1]) expect(projectSnapshotCodec.decode(JSON.stringify({ state: p, version: 0, metadata: { formatVersion: 1, revision } }))).toEqual(corrupt);
  });
});
