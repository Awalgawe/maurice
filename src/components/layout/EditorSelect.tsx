import { EDITORS, editorLabel, useEditor } from "../../state/EditorContext";
import { useT } from "../../hooks/useT";
import { SelectWithIcon, IconCode } from "../ui/SelectWithIcon";

/** Topbar selector choosing which editor "open file" links target. */
export function EditorSelect() {
  const { editor, setEditorId } = useEditor();
  const t = useT();
  return (
    <SelectWithIcon icon={<IconCode />}>
      <select
        value={editor.id}
        onChange={(e) => setEditorId(e.target.value)}
        title={t("editor_select_title")}
      >
        {EDITORS.map((e) => (
          <option key={e.id} value={e.id}>{editorLabel(e, t)}</option>
        ))}
      </select>
    </SelectWithIcon>
  );
}
