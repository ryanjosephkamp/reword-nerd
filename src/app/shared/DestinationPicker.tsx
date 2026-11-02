import type { Destination } from "../../engine/handoff/destinations";

interface DestinationPickerProps {
  name: string;
  value: Destination;
  options: readonly Destination[];
  groups: readonly { kind: Destination["kind"]; label: string }[];
  onChange: (next: Destination) => void;
}

export function DestinationPicker({
  name,
  value,
  options,
  groups,
  onChange,
}: DestinationPickerProps) {
  return (
    <fieldset className="destination-picker">
      <legend className="field-label">Where will you run it?</legend>
      {groups.map((group) => (
        <div key={group.kind} className="destination-group">
          <span className="destination-group-label">{group.label}</span>
          <div className="chips">
            {options
              .filter((candidate) => candidate.kind === group.kind)
              .map((candidate) => (
                <label key={candidate.id} className="chip">
                  <input
                    type="radio"
                    name={name}
                    checked={candidate.id === value.id}
                    onChange={() => onChange(candidate)}
                  />
                  <span>{candidate.label}</span>
                </label>
              ))}
          </div>
        </div>
      ))}
    </fieldset>
  );
}
