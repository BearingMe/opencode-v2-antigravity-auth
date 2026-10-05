import assert from "node:assert/strict"
import { Message } from "@opencode/ai"

const { createSessionRecoveryPolicy } = await import("../dist/src/modules/session-recovery/index.js")
const { applyOpenCodeToolResultBatches } = await import("../dist/src/adapters/opencode/session-recovery.js")
const events = []
const ports = {
  storage: {
    readMessages: () => [],
    readParts: () => [],
    messageHasContent: () => false,
    findMessagesWithThinkingBlocks: () => [],
    findMessagesWithOrphanThinking: () => [],
    findMessageByIndexNeedingThinking: () => null,
    prependThinkingPart: () => false,
    stripThinkingParts: () => false,
  },
  session: {
    abort: async () => events.push("abort"),
    messages: async () => [
      {
        info: { id: "assistant-smoke", role: "assistant" },
        parts: [{ type: "tool_use", id: "tool-smoke" }],
      },
    ],
    resume: async () => events.push("resume"),
    showNotice: async () => events.push("notice"),
  },
  logger: { debug: () => undefined, error: () => undefined, toast: () => undefined },
}

assert.equal(createSessionRecoveryPolicy(ports, { enabled: false, autoResume: true }), null)
assert.deepEqual(events, [], "disabled recovery must not start host operations")

const recovery = createSessionRecoveryPolicy(ports, { enabled: true, autoResume: false })
assert.ok(recovery)
const contextMessages = [
  Message.assistant([{ type: "tool-call", id: "tool-smoke", name: "search", input: { query: "status" } }]),
]
const batches = recovery.findMissingToolResultBatches(contextMessages)
assert.equal(batches.length, 1, "a dangling tool call should have one recovery batch")
assert.equal(applyOpenCodeToolResultBatches(contextMessages, batches), 1)
await recovery.notifyToolResultRepair("session-smoke", batches[0].results.length)
assert.equal(contextMessages[1].role, "tool", "recovery should add a real V2 tool message")
assert.equal(contextMessages[1].content[0].type, "tool-result")
assert.equal(contextMessages[1].content[0].id, "tool-smoke")
assert.equal(contextMessages[1].content[0].name, "search")
assert.deepEqual(contextMessages[1].content[0].result, {
  type: "text",
  value: "Operation cancelled by user (ESC pressed)",
})
assert.deepEqual(events, ["notice"])

console.log("Session recovery smoke passed (interrupted tool and disabled recovery).")
