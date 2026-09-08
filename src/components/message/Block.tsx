import type { ContentBlock } from "../../types";
import { useT } from "../../hooks/useT";
import { CopyButton } from "../ui/CopyButton";
import { Md } from "./Markdown";
import { TextBlock } from "./systemTags";
import { ToolResultBlock } from "./ToolResultBlock";
import { TOOL_INPUTS, ToolInput, toolCopyPayload } from "./tools";

/** Renders one content block by kind. `compact` hides thinking (subagent view). */
export function Block({ b, compact }: { b: ContentBlock; compact: boolean }) {
  const t = useT();
  switch (b.kind) {
    case "text":
      return (
        <div className="block markdown">
          <TextBlock text={b.text} />
        </div>
      );
    case "thinking":
      if (compact) return null;
      return (
        <details className="block thinking collapsible">
          <summary>{t("block_thinking")}</summary>
          <Md>{b.text}</Md>
        </details>
      );
    case "tool_use": {
      const inp = typeof b.input === "object" && b.input !== null ? b.input as Record<string, unknown> : null;
      const tname = b.isMcp ? b.name.replace(/^mcp__/, "mcp:") : b.name;
      const ToolBody = inp ? TOOL_INPUTS[b.name] : undefined;
      // The button is anchored to this box — the one the reader sees. Anchoring
      // it to an inner element instead floats it mid-block, since `.json-view`
      // and `.bash-cmd` don't line up with it.
      const copy = toolCopyPayload(b.name, b.input);
      return (
        <div className="block tool_use">
          <span className={"tname" + (b.isMcp ? " mcp" : "")}>{tname}</span>
          {ToolBody && inp ? <ToolBody input={inp} peerEventId={b.peerEventId} /> : <ToolInput input={b.input} />}
          {copy && <CopyButton className="copy-float" label={copy.label} text={copy.text} />}
        </div>
      );
    }
    case "tool_result":
      return <ToolResultBlock b={b} />;
    case "image":
      return (
        <div className="block image">
          <img src={`data:${b.mediaType};base64,${b.data}`} alt={t("block_image_alt")} />
        </div>
      );
  }
}
