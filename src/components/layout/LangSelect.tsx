import { useLang } from "../../state/LangContext";
import { SUPPORTED_LANGS, type Lang } from "../../i18n/index";
import { SelectWithIcon, IconGlobe } from "../ui/SelectWithIcon";

export function LangSelect() {
  const { langPref, setLang } = useLang();
  return (
    <SelectWithIcon icon={<IconGlobe />}>
      <select
        value={langPref ?? ""}
        onChange={(e) => setLang((e.target.value as Lang) || null)}
      >
        <option value="">Default</option>
        {SUPPORTED_LANGS.map((l) => (
          <option key={l} value={l}>{l.toUpperCase()}</option>
        ))}
      </select>
    </SelectWithIcon>
  );
}
