/**
 * The signature visual element (see PLAN.md's design-direction note): a
 * segmented amber-on-black readout styled after the floor indicator panel
 * above an elevator's doors. Used anywhere the player needs to read a
 * number or short status at a glance — current floor, shift clock. Every
 * other panel in the app stays deliberately quiet so this one reads as the
 * "instrument" among plain service-panel controls.
 */
export interface DotMatrixDisplayProps {
  value: string;
  label?: string;
}

export function DotMatrixDisplay({ value, label }: DotMatrixDisplayProps): JSX.Element {
  return (
    <span className="dot-matrix" role="status" aria-label={label ? `${label}: ${value}` : value}>
      <span className="dot-matrix__value" aria-hidden="true">
        {value}
      </span>
    </span>
  );
}
