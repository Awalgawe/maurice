import React, { createContext, useContext, useState } from "react";
import type { I18nKey } from "../i18n/index";
import type { TFunc } from "../hooks/useT";

export interface EditorDef {
  id: string;
  label: string;
  /** i18n key overriding `label` when the name is translatable (not a brand). */
  labelKey?: I18nKey;
  /** null = use server-side /api/open (OS default) */
  url: ((path: string) => string) | null;
}

/** Display name for an editor: the translated label when it's translatable
 *  (the OS default), the brand name otherwise. Shared by every consumer so no
 *  one renders the raw `label` or hardcodes an "Open in …" title. */
export function editorLabel(editor: EditorDef, t: TFunc): string {
  return editor.labelKey ? t(editor.labelKey) : editor.label;
}

export const EDITORS: EditorDef[] = [
  { id: "os",      label: "OS",      labelKey: "editor_os_default", url: null },
  { id: "vscode",  label: "VS Code", url: (p) => `vscode://file/${p}` },
  { id: "cursor",  label: "Cursor",  url: (p) => `cursor://file/${p}` },
  { id: "zed",     label: "Zed",     url: (p) => `zed://file/${p}` },
];

const STORAGE_KEY = "claude-sessions:editor";

const EditorContext = createContext<{
  editor: EditorDef;
  setEditorId: (id: string) => void;
}>({ editor: EDITORS[0], setEditorId: () => {} });

export function EditorProvider({ children }: { children: React.ReactNode }) {
  const [editorId, setEditorIdState] = useState(
    () => localStorage.getItem(STORAGE_KEY) ?? EDITORS[0].id
  );

  const editor = EDITORS.find((e) => e.id === editorId) ?? EDITORS[0];

  function setEditorId(id: string) {
    localStorage.setItem(STORAGE_KEY, id);
    setEditorIdState(id);
  }

  return (
    <EditorContext.Provider value={{ editor, setEditorId }}>
      {children}
    </EditorContext.Provider>
  );
}

export function useEditor() {
  return useContext(EditorContext);
}
