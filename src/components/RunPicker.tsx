import { useMemo, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { Command } from 'cmdk';
import { Search, Check } from 'lucide-react';

export function RunPicker({
  options,
  value,
  disabled,
  onChange,
}: {
  options: { value: number; label: string }[];
  value: number;
  disabled: boolean;
  onChange: (value: number) => void;
}) {
  const [open, setOpen] = useState(false),
    [search, setSearch] = useState(''),
    [limit, setLimit] = useState(60);

  const matches = useMemo(
    () => options.filter((o) => o.label.toLowerCase().includes(search.trim().toLowerCase())),
    [options, search],
  );

  return (
    <Popover.Root
      open={open}
      onOpenChange={(v) => {
        setOpen(v);
        if (v) {
          setSearch('');
          setLimit(60);
        }
      }}
    >
      <Popover.Trigger asChild>
        <button
          id="initialization"
          className="run-picker-trigger"
          disabled={disabled}
          aria-label="Forecast run"
        >
          {options.find((o) => o.value === value)?.label || 'Choose a dataset'}
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content className="run-picker-popover" align="start" sideOffset={6}>
          <Command shouldFilter={false} label="Forecast runs">
            <div className="run-picker-search">
              <Search size={14} />
              <Command.Input
                autoFocus
                placeholder="Search date…"
                value={search}
                onValueChange={(v) => {
                  setSearch(v);
                  setLimit(60);
                }}
                aria-label="Search forecast runs"
              />
            </div>
            <Command.List className="run-picker-list">
              <Command.Empty>No matching runs</Command.Empty>
              {matches.slice(0, limit).map((o) => (
                <Command.Item
                  key={o.value}
                  value={String(o.value)}
                  onSelect={() => {
                    onChange(o.value);
                    setOpen(false);
                  }}
                >
                  <span>{o.label}</span>
                  {o.value === value && <Check size={13} />}
                </Command.Item>
              ))}
              {matches.length > limit && (
                <Command.Item value="more" onSelect={() => setLimit((n) => n + 60)}>
                  Show more
                </Command.Item>
              )}
            </Command.List>
          </Command>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
  );
}
