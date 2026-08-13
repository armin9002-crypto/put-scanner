interface Segment<T extends string> {
  value: T;
  label: string;
}

export default function MobileSegmentedControl<T extends string>({
  value,
  options,
  onChange,
  label,
}: {
  value: T;
  options: readonly Segment<T>[];
  onChange: (value: T) => void;
  label: string;
}) {
  return (
    <div className="mobile-segmented" role="tablist" aria-label={label}>
      {options.map(option => {
        const selected = option.value === value;
        return (
          <button
            key={option.value}
            type="button"
            role="tab"
            aria-selected={selected}
            onClick={() => onChange(option.value)}
            className="pressable mobile-segmented__item"
            data-selected={selected ? 'true' : 'false'}
          >
            {option.label}
          </button>
        );
      })}
    </div>
  );
}
