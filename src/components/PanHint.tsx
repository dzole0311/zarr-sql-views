import { useEffect, useState } from 'react';

export function PanHint({ active, commandHeld }: { active: boolean; commandHeld: boolean }) {
  const [visible, setVisible] = useState(false);

  useEffect(() => {
    if (!active) {
      setVisible(false);

      return;
    }

    const timer = setTimeout(() => setVisible(true), 700);

    return () => clearTimeout(timer);
  }, [active]);

  const shown = active && visible;

  return (
    <div className="pan-hint" data-visible={shown} aria-hidden={!shown}>
      <kbd aria-label="Command" data-pressed={commandHeld}>
        ⌘
      </kbd>
      <span>Drag to pan</span>
    </div>
  );
}
