import * as DialogPrimitive from '@radix-ui/react-dialog';
import * as TooltipPrimitive from '@radix-ui/react-tooltip';
import * as SliderPrimitive from '@radix-ui/react-slider';
import * as PopoverPrimitive from '@radix-ui/react-popover';
import { X } from 'lucide-react';
import { clsx } from 'clsx';
import { twMerge } from 'tailwind-merge';
import type { ButtonHTMLAttributes, ReactNode } from 'react';

export const cn = (...inputs: Parameters<typeof clsx>) => twMerge(clsx(inputs));

export function Button({
  className,
  variant = 'default',
  ...props
}: ButtonHTMLAttributes<HTMLButtonElement> & { variant?: 'default' | 'ghost' | 'primary' }) {
  return <button className={cn('button', variant, className)} {...props} />;
}

export function Tip({ label, children }: { label: string; children: ReactNode }) {
  return (
    <TooltipPrimitive.Root>
      <TooltipPrimitive.Trigger asChild>{children}</TooltipPrimitive.Trigger>
      <TooltipPrimitive.Portal>
        <TooltipPrimitive.Content className="tooltip" sideOffset={8}>
          {label}
        </TooltipPrimitive.Content>
      </TooltipPrimitive.Portal>
    </TooltipPrimitive.Root>
  );
}

export const TooltipProvider = TooltipPrimitive.Provider;

export function Dialog({
  open,
  onOpenChange,
  title,
  description,
  children,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  title: string;
  description?: string;
  children: ReactNode;
}) {
  return (
    <DialogPrimitive.Root open={open} onOpenChange={onOpenChange}>
      <DialogPrimitive.Portal>
        <DialogPrimitive.Overlay className="dialog-overlay" />
        <DialogPrimitive.Content
          className="dialog-content"
          {...(!description ? { 'aria-describedby': undefined } : {})}
        >
          <DialogPrimitive.Title>{title}</DialogPrimitive.Title>
          {description && <DialogPrimitive.Description>{description}</DialogPrimitive.Description>}
          <DialogPrimitive.Close asChild>
            <Button className="dialog-close icon" variant="ghost" aria-label="Close dialog">
              <X size={18} />
            </Button>
          </DialogPrimitive.Close>
          {children}
        </DialogPrimitive.Content>
      </DialogPrimitive.Portal>
    </DialogPrimitive.Root>
  );
}

export function Slider({
  label,
  value,
  max,
  step = 1,
  onStep,
  onChange,
}: {
  label: string;
  value: number;
  max: number;
  step?: number;
  onStep?: (direction: number) => void;
  onChange: (v: number) => void;
}) {
  return (
    <SliderPrimitive.Root
      aria-label={label}
      className="slider"
      value={[value]}
      min={0}
      max={Math.max(1, max)}
      step={step}
      onKeyDown={(e) => {
        if (onStep && ['ArrowLeft', 'ArrowDown', 'ArrowRight', 'ArrowUp'].includes(e.key)) {
          e.preventDefault();
          onStep(e.key === 'ArrowLeft' || e.key === 'ArrowDown' ? -1 : 1);
        }
      }}
      onValueChange={([v]) => onChange(v)}
    >
      <SliderPrimitive.Track className="slider-track">
        <SliderPrimitive.Range className="slider-range" />
      </SliderPrimitive.Track>
      <SliderPrimitive.Thumb className="slider-thumb" aria-label={label} />
    </SliderPrimitive.Root>
  );
}

export function Popover({ trigger, children }: { trigger: ReactNode; children: ReactNode }) {
  return (
    <PopoverPrimitive.Root>
      <PopoverPrimitive.Trigger asChild>{trigger}</PopoverPrimitive.Trigger>
      <PopoverPrimitive.Portal>
        <PopoverPrimitive.Content className="popover" sideOffset={8}>
          {children}
        </PopoverPrimitive.Content>
      </PopoverPrimitive.Portal>
    </PopoverPrimitive.Root>
  );
}
