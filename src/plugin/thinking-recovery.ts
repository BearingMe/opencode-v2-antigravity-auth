/** Compatibility exports for the request-time turn-repair policies. */
export {
  analyzeConversationState,
  closeToolLoopForThinking,
  hasPossibleCompactedThinking,
  looksLikeCompactedThinkingTurn,
  needsThinkingRecovery,
} from "../modules/session-recovery/index.js"
export type { ConversationState } from "../modules/session-recovery/index.js"
