import { describe, expect, it } from 'vitest';
import { projectSnapshotCodec, encodeSnapshot } from './snapshot-storage';
import { sampleProjects } from './snapshot-repositories.contract';
import type { Timeline } from '../../domain/timeline/model';
import { moveClip } from '../../domain/timeline/model';
import { secondsToTicks, ticksToSeconds } from '../../domain/timeline/time';

const validTimeline: Timeline = {
  fps: 24,
  tracks: [
    { id: 'video', kind: 'video', clips: [
      { id: 'clip-a', nodeId: 'image', startTick: 0, durationTick: 96_000, sourceStartTick: 0 },
      { id: 'clip-b', nodeId: 'image', startTick: 240_000, durationTick: 48_000, sourceStartTick: 12_000, volume: 0.8 },
    ] },
    { id: 'audio', kind: 'audio', clips: [] },
  ],
};

describe('timeline snapshot round-trip', () => {
  it('preserves a valid timeline across copy and decode', () => {
    const projects = sampleProjects();
    projects.projects[0].timeline = validTimeline;
    const copied = projectSnapshotCodec.copy(projects);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    expect(copied.value.projects[0].timeline).toEqual(validTimeline);
    const decoded = projectSnapshotCodec.decode(encodeSnapshot({ value: copied.value, revision: 1 }));
    expect(decoded.ok).toBe(true);
    if (!decoded.ok) return;
    expect(decoded.value.value.projects[0].timeline).toEqual(validTimeline);
  });

  it('still accepts projects without a timeline (legacy)', () => {
    const projects = sampleProjects();
    expect(projectSnapshotCodec.copy(projects).ok).toBe(true);
  });

  it('keeps a dragged clip position and its gap across save/refresh/load', () => {
    const projects = sampleProjects();
    // 单片段空轨拖到 2 秒处（无碰撞），与后续 8 秒片段之间形成空档。
    const single: Timeline = { fps: 24, tracks: [{ id: 'video', kind: 'video', clips: [
      { id: 'clip-a', nodeId: 'image', startTick: 0, durationTick: secondsToTicks(3), sourceStartTick: 0 },
      { id: 'clip-b', nodeId: 'image', startTick: secondsToTicks(8), durationTick: secondsToTicks(2), sourceStartTick: 0 },
    ] }] };
    const track = single.tracks[0]!;
    const moved = moveClip(track, 'clip-a', secondsToTicks(2));
    projects.projects[0].timeline = { ...single, tracks: [moved] };

    const copied = projectSnapshotCodec.copy(projects);
    expect(copied.ok).toBe(true);
    if (!copied.ok) return;
    const reloaded = projectSnapshotCodec.decode(encodeSnapshot({ value: copied.value, revision: 1 }));
    expect(reloaded.ok).toBe(true);
    if (!reloaded.ok) return;
    const clips = reloaded.value.value.projects[0].timeline!.tracks[0]!.clips;
    expect(ticksToSeconds(clips.find((c) => c.id === 'clip-a')!.startTick)).toBe(2);
    expect(ticksToSeconds(clips.find((c) => c.id === 'clip-b')!.startTick)).toBe(8); // 8 秒片段原样
  });

  it.each([
    ['missing nodeId', (t: any) => { delete t.tracks[0].clips[0].nodeId; }],
    ['negative startTick', (t: any) => { t.tracks[0].clips[0].startTick = -1; }],
    ['bad kind', (t: any) => { t.tracks[0].kind = 'subtitle'; }],
    ['undefined clip field', (t: any) => { t.tracks[0].clips[0].durationTick = undefined; }],
    ['bad volume', (t: any) => { t.tracks[0].clips[0].volume = 'loud'; }],
  ])('rejects malformed timeline: %s', (_, mutate) => {
    const projects = sampleProjects();
    const t = JSON.parse(JSON.stringify(validTimeline));
    mutate(t);
    projects.projects[0].timeline = t;
    expect(projectSnapshotCodec.copy(projects).ok).toBe(false);
  });
});
