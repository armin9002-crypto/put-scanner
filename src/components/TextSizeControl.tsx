import { useUiTextSize } from '../lib/uiTextSize';

export default function TextSizeControl() {
  const { textSize, cycleTextSize } = useUiTextSize();
  const label = textSize.charAt(0).toUpperCase() + textSize.slice(1);
  return (
    <button
      type="button"
      onClick={cycleTextSize}
      className="app-utility-button text-size-control button-ghost flex shrink-0 items-center justify-center gap-1 px-2 py-2 rounded-lg text-xs font-medium min-h-[40px] min-w-[40px] whitespace-nowrap"
      aria-label={`Text size: ${label}`}
      title={`Text size: ${label}`}
    >
      <span aria-hidden="true">Aa</span>
      <span aria-hidden="true" className="hidden xl:inline">{label}</span>
    </button>
  );
}
