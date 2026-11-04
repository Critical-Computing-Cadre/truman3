import { type ReactNode, useEffect, useState } from "react";

/** A checkbox that saves. It shows the change right away, rather than waiting for the save. */
export function SavedCheckbox({
  checked,
  disabled,
  onChange,
  className,
  children,
}: {
  checked: boolean;
  disabled: boolean;
  onChange: (checked: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  const [shown, setShown] = useState(checked);
  useEffect(() => setShown(checked), [checked]);
  return (
    <label className={className}>
      <input
        type="checkbox"
        disabled={disabled}
        checked={shown}
        onChange={(event) => {
          setShown(event.target.checked);
          onChange(event.target.checked);
        }}
      />
      {children}
    </label>
  );
}
