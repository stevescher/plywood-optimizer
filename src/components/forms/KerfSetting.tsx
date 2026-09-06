'use client';

import { useProjectStore } from '@/store/useProjectStore';
import { NumberInput } from './NumberInput';

export function KerfSetting() {
  const { kerf, setKerf, units } = useProjectStore();

  const hint = units === 'metric'
    ? 'Typical table saw: 3 mm'
    : 'Fractions (1/8) or decimals (0.125)';

  return (
    <div className="flex items-center gap-3">
      <div className="w-24 shrink-0">
        <NumberInput
          value={kerf}
          onChange={setKerf}
          placeholder={units === 'metric' ? '3' : '1/8'}
          units={units}
          aria-label="Blade kerf"
        />
      </div>
      <div>
        <p className="text-xs font-medium text-muted-foreground">Blade kerf</p>
        <p className="text-[11px] text-muted-foreground">{hint}</p>
      </div>
    </div>
  );
}
