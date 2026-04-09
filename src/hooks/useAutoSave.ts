'use client';

import { useEffect } from 'react';
import { useProjectStore } from '@/store/useProjectStore';
import { saveToLocalStorage, loadFromLocalStorage } from '@/lib/project-io';

export function useAutoSave() {
  // Single effect guarantees load executes before subscribe is registered,
  // eliminating the race where an immediate Zustand state change could fire
  // the subscriber before the saved data has been loaded.
  useEffect(() => {
    const saved = loadFromLocalStorage();
    if (saved) {
      useProjectStore.getState().loadProjectData(saved);
    }

    const unsub = useProjectStore.subscribe(() => {
      const data = useProjectStore.getState().getProjectData();
      saveToLocalStorage(data);
    });
    return unsub;
  }, []);
}
