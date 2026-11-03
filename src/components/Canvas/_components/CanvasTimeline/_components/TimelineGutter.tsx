import { IconEye, IconEyeOff } from 'src/lib/icons';
import { Button, Tooltip, TooltipContent, TooltipTrigger } from '../../../../../lib/ui';
import { GUTTER_W, RULER_H, LANE_H } from '../constants';
import type { Layer } from '../constants';

interface Props {
  layers: Layer[];
  scrollTop: number;
  onToggleHidden: (id: string) => void;
  onWheelScroll: (deltaY: number) => void;
}

export const TimelineGutter = ({ layers, scrollTop, onToggleHidden, onWheelScroll }: Props) => {
  // Numbered badges skip the indicators row so Video stays L1, Audio L2, etc.
  const regularLayers = layers.filter((l) => l.id !== 'indicators');

  return (
    <div
      className="shrink-0 flex flex-col border-r border-sf-border bg-sf-panel"
      style={{ width: GUTTER_W }}
    >
      <div
        className="shrink-0 border-b border-sf-border"
        style={{ height: RULER_H, background: '#0d0d0f' }}
      />

      <div
        className="relative flex-1 overflow-hidden"
        onWheel={(e) => {
          if (e.deltaY === 0) {
            return;
          }
          e.preventDefault();
          onWheelScroll(e.deltaY);
        }}
      >
        <div style={{ transform: `translateY(-${scrollTop}px)` }}>
          {layers.map((row) => {
            const isIndicators = row.id === 'indicators';
            const layerIndex = regularLayers.indexOf(row);

            return (
              <div
                key={row.id}
                className={`group flex shrink-0 items-center gap-1.5 border-b border-sf-border transition-colors ${
                  row.hidden ? 'bg-[#101014]' : ''
                }`}
                style={{ height: LANE_H, padding: '0 8px 0 10px' }}
              >
                {isIndicators ? (
                  <span
                    className="shrink-0 text-xs font-bold"
                    style={{
                      padding: '2px 6px',
                      letterSpacing: '0.5px',
                      borderRadius: 4,
                      background: 'rgba(255,255,255,0.05)',
                      color: 'rgba(255,255,255,0.8)',
                    }}
                  >
                    ◇
                  </span>
                ) : (
                  <span
                    className={`shrink-0 rounded text-xs font-bold ${
                      row.hidden ? 'bg-sf-border text-sf-secondary' : 'bg-secondary text-sf-primary'
                    }`}
                    style={{ padding: '2px 5px', letterSpacing: '0.5px' }}
                  >
                    {`L${layerIndex + 1}`}
                  </span>
                )}

                <span
                  className={`min-w-0 flex-1 truncate text-sm font-medium cursor-text ${
                    row.hidden ? 'text-sf-secondary' : 'text-sf-primary/90'
                  }`}
                >
                  {row.label}
                </span>

                <div className="flex shrink-0 gap-0.5 opacity-70 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100">
                  <Tooltip>
                    <TooltipTrigger asChild>
                      <Button
                        variant="ghost"
                        size="icon-xs"
                        aria-label={
                          row.hidden ? `Show ${row.label} layer` : `Hide ${row.label} layer`
                        }
                        className="text-sf-secondary hover:text-sf-primary"
                        active={row.hidden}
                        onClick={() => onToggleHidden(row.id)}
                      >
                        {row.hidden ? <IconEyeOff size={12} /> : <IconEye size={12} />}
                      </Button>
                    </TooltipTrigger>
                    <TooltipContent side="right">
                      {row.hidden ? 'Show layer' : 'Hide layer'}
                    </TooltipContent>
                  </Tooltip>
                </div>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
