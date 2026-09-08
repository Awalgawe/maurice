import { BashInput, EditInput, ReadInput, WriteInput } from "./fileTools";
import { ExitPlanModeInput, AgentInput, AskUserQuestionInput, SkillInput } from "./planTools";
import {
  ToolSearchInput, GrepInput, WebFetchInput, WebSearchInput, TodoWriteInput,
  TaskCreateInput, TaskUpdateInput, ScheduleWakeupInput, PushNotificationInput,
  toolInputJson,
} from "./miscTools";
import { SendMessageInput } from "../PeerMeta";
import type { I18nKey } from "../../../hooks/useT";

export { ToolInput } from "./miscTools";

/** `peerEventId` is set only on SendMessage blocks; every other renderer simply
 *  ignores the optional prop. */
type ToolInputComponent = (props: {
  input: Record<string, unknown>;
  peerEventId?: string;
}) => React.ReactNode;

/** Tool name → dedicated input renderer. Module-level const (built once). */
export const TOOL_INPUTS: Record<string, ToolInputComponent> = {
  Bash: BashInput,
  Edit: EditInput,
  Read: ReadInput,
  Write: WriteInput,
  ToolSearch: ToolSearchInput,
  Grep: GrepInput,
  Glob: GrepInput,
  ExitPlanMode: ExitPlanModeInput,
  Agent: AgentInput,
  AskUserQuestion: AskUserQuestionInput,
  Skill: SkillInput,
  WebFetch: WebFetchInput,
  WebSearch: WebSearchInput,
  TodoWrite: TodoWriteInput,
  TaskCreate: TaskCreateInput,
  TaskUpdate: TaskUpdateInput,
  ScheduleWakeup: ScheduleWakeupInput,
  PushNotification: PushNotificationInput,
  SendMessage: SendMessageInput,
};

/**
 * What a tool_use block's copy button hands over, or null when the block holds
 * nothing worth copying (a Grep pattern, a todo list, a plan already rendered as
 * markdown with its own per-code-block buttons).
 * Always the full value — Write content and Edit's new string are never rendered
 * in full, and the JSON view is a 3000-char preview.
 */
export function toolCopyPayload(
  name: string,
  input: unknown,
): { text: string; label: I18nKey } | null {
  const inp = typeof input === "object" && input !== null ? input as Record<string, unknown> : null;
  if (inp) {
    if (name === "Bash" && typeof inp.command === "string")
      return { text: inp.command, label: "code_copy_command" };
    if (name === "Edit" && typeof inp.new_string === "string")
      return { text: inp.new_string, label: "code_copy_new" };
    if (name === "Write" && typeof inp.content === "string")
      return { text: inp.content, label: "code_copy_content" };
  }
  // Everything else only gets a button when it falls back to the raw JSON view.
  if (TOOL_INPUTS[name]) return null;
  const json = toolInputJson(input);
  return json === null ? null : { text: json, label: "code_copy_json" };
}
