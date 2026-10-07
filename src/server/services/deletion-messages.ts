import "server-only";
import type { Blockers } from "@/server/repositories/deletion.repo";

const NOUN: Record<string, [string, string]> = {
  versions: ["version", "versions"],
  approvals: ["review decision", "review decisions"],
  postings: ["post", "posts"],
  shoots: ["shoot", "shoots"],
  files: ["attachment", "attachments"],
  content: ["content item", "content items"],
  expenses: ["expense", "expenses"],
  tasks: ["assigned task", "assigned tasks"],
  uploads: ["content routed to them for posting", "content items routed to them for posting"],
};

/** "2 versions and 1 shoot" */
export function describeBlockers(b: Blockers): string {
  const parts = Object.entries(b)
    .filter(([, n]) => n > 0)
    .map(([k, n]) => `${n} ${NOUN[k]?.[n === 1 ? 0 : 1] ?? k}`);
  return parts.length > 1 ? `${parts.slice(0, -1).join(", ")} and ${parts.at(-1)}` : (parts[0] ?? "");
}
