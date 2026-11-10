import { useCallback, useEffect, useRef, useState } from 'react';
import { runGeneration, type RunResult } from './runGeneration';

/**
 * 生成用例的 React 适配层。
 *
 * 只做两件事：
 * 1. 给 UI 一个**稳定引用**的生成函数（踩过 "Maximum update depth" 的坑）；
 * 2. 记住 AbortController，允许用户取消。
 *
 * 真正的逻辑在 runGeneration 里，可以脱离 React 直接测。
 */
export interface UseRunGeneration {
  (nodeId: string): Promise<RunResult>;
  cancel: (nodeId: string) => void;
}

export function useRunGeneration(): UseRunGeneration {
  const aborters = useRef(new Map<string, AbortController>());
  const [, force] = useState(0);

  useEffect(() => {
    const map = aborters.current;
    return () => {
      for (const c of map.values()) c.abort();
      map.clear();
    };
  }, []);

  const generate = useCallback(async (nodeId: string): Promise<RunResult> => {
    const r = await runGeneration(nodeId, (signal) => {
      aborters.current.set(nodeId, signal);
    });
    aborters.current.delete(nodeId);
    force((n) => n + 1);
    return r;
  }, []) as UseRunGeneration;

  generate.cancel = useCallback((nodeId: string) => {
    aborters.current.get(nodeId)?.abort();
  }, []);

  return generate;
}
