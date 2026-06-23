import { useTheme, type Theme } from "../../state/ThemeContext";
import { SelectWithIcon, IconPalette } from "../ui/SelectWithIcon";

const THEMES: { key: Theme; label: string }[] = [
  { key: "default",      label: "Default"      },
  { key: "maurice",      label: "Maurice"      },
  { key: "maurice-dark", label: "Maurice Nuit" },
];

export function ThemeSelect() {
  const { theme, setTheme } = useTheme();
  return (
    <SelectWithIcon icon={<IconPalette />}>
      <select
        value={theme}
        onChange={(e) => setTheme(e.target.value as Theme)}
      >
        {THEMES.map((t) => (
          <option key={t.key} value={t.key}>{t.label}</option>
        ))}
      </select>
    </SelectWithIcon>
  );
}
