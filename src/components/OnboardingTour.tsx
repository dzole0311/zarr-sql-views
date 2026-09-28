import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import * as Dialog from '@radix-ui/react-dialog';
import { X } from 'lucide-react';

const steps = [
  {
    target: '.dataset-controls',
    sidebar: true,
    title: 'Choose what to explore',
    text: 'Switch variables and search the available forecast runs here. The color scale below explains the values in the cube.',
  },
  {
    target: '.camera-tools',
    sidebar: false,
    title: 'Explore the cube',
    text: 'Drag to orbit and scroll to zoom. Use the hand tool to move the camera, or Reset to return to the starting view.',
  },
  {
    target: '[aria-label="Interactive forecast cube"]',
    sidebar: false,
    title: 'Move across the map',
    text: 'Hold Command while dragging the cube surface to explore a new region. Data loads as you move.',
  },
  {
    target: '[aria-label="Interactive forecast cube"]',
    sidebar: false,
    title: 'Compare points',
    text: 'Click the cube to add a colored point and its forecast line below. Add more points to compare them. Points stay in the same cube positions as you move the map.',
  },
  {
    target: '.transport',
    sidebar: false,
    title: 'Travel through time',
    text: 'Drag the timeline or press Play to move through forecast hours. The cube and point forecasts stay in sync.',
  },
  {
    target: '.analysis-controls',
    sidebar: true,
    title: 'Find cells with SQL',
    text: 'Query loaded_forecast using value, longitude, latitude, or forecast_hour. Include cell_id to show only matching cells, including inside the cube. Your query stays active when you move to another region.',
    sql: 'SELECT cell_id FROM loaded_forecast\nWHERE value > 20',
  },
];

const storageKey = 'zarr-sql-views-tour-v1';

export function OnboardingTour({
  ready,
  prepare,
}: {
  ready: boolean;
  prepare: (sidebar: boolean) => void;
}) {
  const [step, setStep] = useState<number | null>(null);
  const [rect, setRect] = useState<DOMRect | null>(null);
  const autoChecked = useRef(false);
  const current = step === null ? null : steps[step];

  useEffect(() => {
    if (!ready || autoChecked.current) return;
    autoChecked.current = true;
    try {
      const seen = localStorage.getItem(storageKey) ?? localStorage.getItem('strata-tour-v1');
      localStorage.setItem(storageKey, 'seen');
      if (seen) return;
    } catch {}
    setStep(0);
  }, [ready]);

  useLayoutEffect(() => {
    if (!current || !ready) return;
    prepare(current.sidebar);
    let observer: ResizeObserver | undefined;

    const measure = () => {
      const target = document.querySelector(current.target);
      setRect(target?.getBoundingClientRect() ?? null);
    };

    const frame = requestAnimationFrame(() => {
      const target = document.querySelector(current.target);
      if (target instanceof HTMLDetailsElement) target.open = true;
      target?.scrollIntoView({ block: 'nearest' });
      measure();
      observer = new ResizeObserver(measure);
      if (target) observer.observe(target);
    });

    window.addEventListener('resize', measure);
    window.addEventListener('scroll', measure, true);

    return () => {
      cancelAnimationFrame(frame);
      observer?.disconnect();
      window.removeEventListener('resize', measure);
      window.removeEventListener('scroll', measure, true);
    };
  }, [current, ready, prepare]);

  const close = () => {
    setStep(null);
    prepare(true);
  };

  const width = Math.min(336, window.innerWidth - 32);

  const left =
    rect && rect.right + width + 28 < window.innerWidth
      ? rect.right + 16
      : Math.max(16, window.innerWidth - width - 20);

  const top = rect ? Math.max(64, Math.min(rect.top, window.innerHeight - 350)) : 80;

  return (
    <Dialog.Root
      open={ready && step !== null}
      onOpenChange={(open) => {
        if (!open) close();
      }}
    >
      <Dialog.Portal>
        <Dialog.Overlay className="tour-overlay" />
        {rect && (
          <div
            aria-hidden="true"
            className="tour-spotlight"
            style={{
              left: rect.left - 5,
              top: rect.top - 5,
              width: rect.width + 10,
              height: rect.height + 10,
            }}
          />
        )}
        <Dialog.Content
          className="tour-card"
          style={{ width, left, top }}
          onPointerDownOutside={(e) => e.preventDefault()}
        >
          <div className="tour-meta">
            <span>
              {(step ?? 0) + 1} of {steps.length}
            </span>
            <Dialog.Close aria-label="Close tour">
              <X size={15} />
            </Dialog.Close>
          </div>
          <Dialog.Title>{current?.title}</Dialog.Title>
          <Dialog.Description>{current?.text}</Dialog.Description>
          {current?.sql && <pre>{current.sql}</pre>}
          <div className="tour-actions">
            <button onClick={close}>Skip tour</button>
            <div>
              {step !== null && step > 0 && <button onClick={() => setStep(step - 1)}>Back</button>}
              <button
                className="tour-next"
                onClick={() => (step === steps.length - 1 ? close() : setStep((step ?? 0) + 1))}
              >
                {step === steps.length - 1 ? 'Done' : 'Next'}
              </button>
            </div>
          </div>
        </Dialog.Content>
      </Dialog.Portal>
    </Dialog.Root>
  );
}
