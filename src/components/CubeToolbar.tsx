import { useState } from 'react';
import { Box, Hand, Layers2, Minus, Plus, Type } from 'lucide-react';
import { Button, Tip } from './ui/primitives';

export type CubeMode = 'orbit' | 'pan' | 'slice';
const modes = [
  { id: 'orbit', label: 'Orbit', hint: 'Drag to rotate the cube', Icon: Box },
  { id: 'pan', label: 'Pan', hint: 'Drag to move the view', Icon: Hand },
  { id: 'slice', label: 'Slice', hint: 'Drag a face to slice the cube', Icon: Layers2 },
] as const;

export function CubeToolbar({
  mode,
  onMode,
  onReset,
  onZoom,
  zoom,
  showLabels,
  onLabels,
}: {
  mode: CubeMode;
  onMode: (mode: CubeMode) => void;
  onReset: () => void;
  onZoom: (step: number) => void;
  zoom: number;
  showLabels: boolean;
  onLabels: () => void;
}) {
  const [focused, setFocused] = useState(0);
  const actions = [
    ...modes.map(({ id, label, hint, Icon }) => ({
      label,
      hint,
      content: (
        <>
          <Icon size={15} aria-hidden="true" />
          {id === 'slice' && <span>Slice</span>}
        </>
      ),
      pressed: mode === id,
      onClick: () => onMode(id),
      disabled: false,
    })),
    {
      label: 'Reset cube',
      hint: 'Restore the full cube and camera',
      content: <>Reset</>,
      onClick: onReset,
      disabled: false,
    },
    {
      label: 'Zoom in',
      hint: 'Zoom in',
      content: <Plus size={16} aria-hidden="true" />,
      onClick: () => onZoom(0.2),
      disabled: zoom >= 3,
    },
    {
      label: 'Zoom out',
      hint: 'Zoom out',
      content: <Minus size={16} aria-hidden="true" />,
      onClick: () => onZoom(-0.2),
      disabled: zoom <= -2,
    },
    {
      label: 'Place labels',
      hint: showLabels ? 'Hide place names' : 'Show place names',
      content: <Type size={16} aria-hidden="true" />,
      pressed: showLabels,
      onClick: onLabels,
      disabled: false,
    },
  ];
  return (
    <div
      className="camera-tools"
      role="toolbar"
      aria-label="Cube controls"
      onKeyDown={(e) => {
        if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(e.key)) return;
        e.preventDefault();
        e.stopPropagation();
        const buttons = Array.from(
          e.currentTarget.querySelectorAll<HTMLButtonElement>('button:not(:disabled)'),
        );
        const current = buttons.indexOf(e.target as HTMLButtonElement);
        const next =
          e.key === 'Home'
            ? 0
            : e.key === 'End'
              ? buttons.length - 1
              : (current + (e.key === 'ArrowRight' ? 1 : -1) + buttons.length) % buttons.length;
        buttons[next]?.focus();
      }}
    >
      {actions.map((action, index) => (
        <span className="camera-action" key={action.label}>
          {(index === 3 || index === 6) && <span className="camera-separator" aria-hidden="true" />}
          <Tip label={action.hint}>
            <Button
              variant="ghost"
              className={`icon ${action.pressed ? 'active' : ''}`}
              aria-label={action.label}
              aria-pressed={action.pressed}
              tabIndex={index === (actions[focused]?.disabled ? 0 : focused) ? 0 : -1}
              disabled={action.disabled}
              onFocus={() => setFocused(index)}
              onClick={action.onClick}
            >
              {action.content}
            </Button>
          </Tip>
        </span>
      ))}
    </div>
  );
}
