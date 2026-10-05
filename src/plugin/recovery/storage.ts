/** Compatibility exports for the filesystem-backed recovery store. */
export {
  fileRecoveryStorage,
  findMessageByIndexNeedingThinking,
  findMessagesWithOrphanThinking,
  findMessagesWithThinkingBlocks,
  getMessageDir,
  hasContent,
  messageHasContent,
  prependThinkingPart,
  readMessages,
  readParts,
  stripThinkingParts,
} from "../../adapters/filesystem/session-recovery-store.js"
