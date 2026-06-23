import { BashInput, EditInput, ReadInput, WriteInput } from "./fileTools";
import { ExitPlanModeInput, AgentInput, AskUserQuestionInput, SkillInput } from "./planTools";
import {
  ToolSearchInput, GrepInput, WebFetchInput, WebSearchInput, TodoWriteInput,
  TaskCreateInput, TaskUpdateInput, ScheduleWakeupInput, PushNotificationInput,
} from "./miscTools";

export { ToolInput } from "./miscTools";

type ToolInputComponent = (props: { input: Record<string, unknown> }) => React.ReactNode;

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
};
