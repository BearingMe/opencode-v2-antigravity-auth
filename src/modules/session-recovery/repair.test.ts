import { describe, expect, it, vi } from "vitest"
import { createSessionRecoveryPolicy, type RecoveryConversationMessage, type SessionRecoveryPorts } from "./index.js"

/** Builds host-neutral ports around one failed conversation for policy tests. */
function createPorts(messages: RecoveryConversationMessage[]): SessionRecoveryPorts {
  return {
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
      abort: vi.fn(async () => undefined),
      messages: vi.fn(async () => messages),
      resume: vi.fn(async () => undefined),
      showNotice: vi.fn(async () => undefined),
    },
    logger: {
      debug: vi.fn(),
      error: vi.fn(),
      toast: vi.fn(),
    },
  }
}

describe("session-error recovery policy", () => {
  it("does not expose repair behavior when recovery is disabled", () => {
    const ports = createPorts([])

    const recovery = createSessionRecoveryPolicy(ports, { enabled: false, autoResume: true })

    expect(recovery).toBeNull()
    expect(ports.session.abort).not.toHaveBeenCalled()
    expect(ports.session.messages).not.toHaveBeenCalled()
  })

  it("plans cancelled results after dangling calls and leaves completed calls alone", () => {
    const ports = createPorts([])
    const recovery = createSessionRecoveryPolicy(ports, { enabled: true, autoResume: false })
    if (!recovery) throw new Error("enabled recovery should be available")

    expect(
      recovery.findMissingToolResultBatches([
        {
          role: "assistant",
          content: [
            { type: "tool-call", id: "call-complete", name: "search" },
            { type: "tool-call", id: "call-provider", name: "remote", providerExecuted: true },
            { type: "tool-call", id: "call-pending", name: "edit", namespace: "workspace" },
          ],
        },
        { role: "tool", content: [{ type: "tool-result", id: "call-complete" }] },
      ]),
    ).toEqual([
      {
        afterMessageIndex: 0,
        results: [
          {
            toolUseId: "call-pending",
            toolName: "edit",
            namespace: "workspace",
            content: "Operation cancelled by user (ESC pressed)",
          },
        ],
      },
    ])
  })

  it("deduplicates overlapping thinking repairs for the same assistant message", async () => {
    const ports = createPorts([
      {
        info: { id: "assistant-1", role: "assistant" },
      },
    ])
    let finishNotice!: () => void
    ports.session.showNotice = vi.fn(() => new Promise<void>((resolve) => (finishNotice = resolve)))
    ports.storage.findMessageByIndexNeedingThinking = vi.fn(() => "assistant-1")
    ports.storage.prependThinkingPart = vi.fn(() => true)
    const recovery = createSessionRecoveryPolicy(ports, { enabled: true, autoResume: false })
    if (!recovery) throw new Error("enabled recovery should be available")
    const request = {
      id: "assistant-1",
      role: "assistant",
      sessionID: "session-1",
      error: "thinking must be the first block in messages.1",
    }

    const firstRepair = recovery.handleSessionRecovery(request)
    await vi.waitFor(() => expect(ports.session.showNotice).toHaveBeenCalledOnce())
    await expect(recovery.handleSessionRecovery(request)).resolves.toBe(false)

    finishNotice()
    await expect(firstRepair).resolves.toBe(true)
    expect(ports.storage.prependThinkingPart).toHaveBeenCalledOnce()
  })

  it("resumes successful thinking repair with the prior user-turn agent and model", async () => {
    const ports = createPorts([
      { info: { id: "user-1", role: "user", agent: "writer", model: { providerID: "custom", modelID: "m1" } } },
      { info: { id: "assistant-1", role: "assistant" } },
    ])
    ports.storage.findMessageByIndexNeedingThinking = vi.fn(() => "assistant-1")
    ports.storage.prependThinkingPart = vi.fn(() => true)
    const recovery = createSessionRecoveryPolicy(ports, {
      enabled: true,
      autoResume: true,
      resumeText: "configured continuation",
    })
    if (!recovery) throw new Error("enabled recovery should be available")

    await expect(
      recovery.handleSessionRecovery({
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        error: "thinking must be the first block in messages.1",
      }),
    ).resolves.toBe(true)

    expect(ports.session.resume).toHaveBeenCalledWith({
      sessionID: "session-1",
      text: "configured continuation",
      agent: "writer",
      model: { providerID: "custom", modelID: "m1" },
    })
  })

  it("uses the latest V2 assistant settings when persisted user messages lack them", async () => {
    const ports = createPorts([
      { info: { id: "user-1", role: "user" } },
      {
        info: {
          id: "assistant-1",
          role: "assistant",
          agent: "writer",
          model: { providerID: "custom", modelID: "m1" },
        },
      },
    ])
    ports.storage.findMessageByIndexNeedingThinking = vi.fn(() => "assistant-1")
    ports.storage.prependThinkingPart = vi.fn(() => true)
    const recovery = createSessionRecoveryPolicy(ports, { enabled: true, autoResume: true })
    if (!recovery) throw new Error("enabled recovery should be available")

    await recovery.handleSessionRecovery({
      id: "assistant-1",
      role: "assistant",
      sessionID: "session-1",
      error: "thinking must be the first block in messages.1",
    })

    expect(ports.session.resume).toHaveBeenCalledWith({
      sessionID: "session-1",
      text: "[session recovered - continuing previous task]",
      agent: "writer",
      model: { providerID: "custom", modelID: "m1" },
    })
  })

  it("leaves tool-result failures to the V2 context repair path", async () => {
    const ports = createPorts([{ info: { id: "assistant-1", role: "assistant" } }])
    const recovery = createSessionRecoveryPolicy(ports, { enabled: true, autoResume: false })
    if (!recovery) throw new Error("enabled recovery should be available")

    await expect(
      recovery.handleSessionRecovery({
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        error: "tool_use without matching tool_result",
      }),
    ).resolves.toBe(false)
    expect(ports.session.abort).not.toHaveBeenCalled()
    expect(ports.session.messages).not.toHaveBeenCalled()
  })

  it("keeps thinking repair successful when abort and warning-notice requests fail", async () => {
    const ports = createPorts([
      { info: { id: "assistant-1", role: "assistant" }, parts: [{ type: "tool_use", id: "call-1" }] },
    ])
    ports.session.abort = vi.fn(async () => {
      throw new Error("already stopped")
    })
    ports.session.showNotice = vi.fn(async () => {
      throw new Error("toast unavailable")
    })
    ports.storage.findMessageByIndexNeedingThinking = vi.fn(() => "assistant-1")
    ports.storage.prependThinkingPart = vi.fn(() => true)
    const recovery = createSessionRecoveryPolicy(ports, { enabled: true, autoResume: false })
    if (!recovery) throw new Error("enabled recovery should be available")

    await expect(
      recovery.handleSessionRecovery({
        id: "assistant-1",
        role: "assistant",
        sessionID: "session-1",
        error: "thinking must be the first block in messages.1",
      }),
    ).resolves.toBe(true)
    expect(ports.storage.prependThinkingPart).toHaveBeenCalledOnce()
  })
})
