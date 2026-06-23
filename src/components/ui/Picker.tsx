import { useT } from "../../hooks/useT";

/** Labelled <select> filter ("Label : tous/all" + options). */
export function Picker({
  label,
  value,
  set,
  opts,
}: {
  label: string;
  value: string;
  set: (v: string) => void;
  opts?: { v: string; l: string }[];
}) {
  const t = useT();
  return (
    <select value={value} onChange={(e) => set(e.target.value)}>
      <option value="">{label}{t("picker_all_suffix")}</option>
      {opts?.map((o) => (
        <option key={o.v} value={o.v}>
          {o.l}
        </option>
      ))}
    </select>
  );
}
