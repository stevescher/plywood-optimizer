'use client';

import { useCallback, useEffect, useRef } from 'react';
import { wrap, Remote } from 'comlink';
import { useProjectStore } from '@/store/useProjectStore';
import { useLayoutStore } from '@/store/useLayoutStore';
import { solveAll } from '@/lib/optimizer/solver';

type WorkerApi = { solveAll: typeof solveAll };

export function useOptimizer() {
  const remoteRef = useRef<Remote<WorkerApi> | null>(null);
  const workerRef = useRef<Worker | null>(null);

  useEffect(() => {
    let worker: Worker;
    try {
      worker = new Worker(
        new URL('../lib/optimizer/optimizer.worker.ts', import.meta.url)
      );
      worker.onerror = () => {
        // Worker failed to load (e.g. bundler doesn't support this pattern in dev).
        // The optimize() fallback path will use the main-thread solver instead.
        remoteRef.current = null;
        workerRef.current = null;
      };
      workerRef.current = worker;
      remoteRef.current = wrap<WorkerApi>(worker);
    } catch {
      // Worker construction not supported in this environment — fallback is used.
    }

    return () => {
      worker?.terminate();
      workerRef.current = null;
      remoteRef.current = null;
    };
  }, []);

  const optimize = useCallback(async () => {
    const { stockSheets, panels, kerf } = useProjectStore.getState();
    const { setOptimizing, setSolutions } = useLayoutStore.getState();

    setOptimizing(true);
    try {
      let solutions;
      if (remoteRef.current) {
        solutions = await remoteRef.current.solveAll({ stockSheets, panels, kerf });
      } else {
        // Worker not yet initialized — fall back to main-thread synchronous call
        solutions = solveAll({ stockSheets, panels, kerf });
      }
      setSolutions(solutions);
    } catch (e) {
      console.error('Optimization failed:', e);
      setSolutions([]);
    } finally {
      setOptimizing(false);
    }
  }, []);

  return optimize;
}
