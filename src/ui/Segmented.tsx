import { useId } from "react";

interface SegmentedProps<T extends string> {
  label: string;
  value: T;
  options: readonly { value: T; label: string }[];
  onChange: (value: T) => void;
  /** Hide the visible label when the context already names the control. */
  hideLabel?: boolean;
}

/** A row of mutually exclusive choices, built on native radio buttons for keyboard support. */
export function Segmented<T extends string>({
  label,
  value,
  options,
  onChange,
  hideLabel,
}: SegmentedProps<T>) {
  const name = useId();
  return (
    <fieldset className="segmented">
      <legend className={hideLabel ? "visually-hidden" : "field-label"}>{label}</legend>
      <div className="segmented-options">
        {options.map((option) => (
          <label key={option.value} className="segmented-option">
            <input
              type="radio"
              name={name}
              value={option.value}
              checked={option.value === value}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </fieldset>
  );
}
