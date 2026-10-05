import { describe, expect, it, vi } from "vitest"
import { Message } from "@opencode/ai"
import { applyOpenCodeToolResultBatches, createOpenCodeRecoverySessionPort } from "./session-recovery.js"
import type { PluginClient } from "../../plugin/types.js"

/** Builds a typed client double for the session APIs used by recovery. */
function createClient(messages: unknown = { data: [] }) {
  const prompt = vi.fn(async (_input: unknown) => ({ data: undefined }))
  const abort = vi.fn(async (_input: unknown) => ({ data: undefined }))
  const readMessages = vi.fn(async (_input: unknown) => messages)
  const showToast = vi.fn(async (_input: unknown) => ({ data: undefined }))
  const client: PluginClient = {
    app: { log: async () => undefined },
    auth: { set: async () => undefined },
    session: { prompt, abort, messages: readMessages },
    tui: { showToast },
  }
  return { client, prompt, abort, readMessages, showToast }
}

describe("OpenCode session-recovery adapter", () => {
  it("inserts real tool-result messages after each assistant call batch", () => {
    const messages = [
      Message.assistant([{ type: "tool-call", id: "call-1", name: "search", input: {} }]),
      Message.user("next turn"),
      Message.assistant([{ type: "tool-call", id: "call-2", name: "edit", namespace: "workspace", input: {} }]),
    ]

    const resultCount = applyOpenCodeToolResultBatches(messages, [
      {
        afterMessageIndex: 0,
        results: [{ toolUseId: "call-1", toolName: "search", content: "cancelled" }],
      },
      {
        afterMessageIndex: 2,
        results: [{ toolUseId: "call-2", toolName: "edit", namespace: "workspace", content: "cancelled" }],
      },
    ])

    expect(resultCount).toBe(2)
    expect(messages.map((message) => message.role)).toEqual(["assistant", "tool", "user", "assistant", "tool"])
    expect(messages[1]?.content[0]).toMatchObject({
      type: "tool-result",
      id: "call-1",
      name: "search",
      result: { type: "text", value: "cancelled" },
    })
    expect(messages[4]?.content[0]).toMatchObject({
      type: "tool-result",
      id: "call-2",
      name: "edit",
      namespace: "workspace",
      result: { type: "text", value: "cancelled" },
    })
  })

  it("normalizes V2 context messages for session-error recovery", async () => {
    const { client, readMessages } = createClient({
      data: [
        { id: "user-1", type: "user", text: "continue" },
        {
          id: "assistant-1",
          type: "assistant",
          agent: "writer",
          model: { providerID: "custom", id: "model-1" },
          content: [{ type: "text", text: "done" }],
        },
      ],
    })
    const session = createOpenCodeRecoverySessionPort(client, "C:/workspace")

    await expect(session.messages("session-1")).resolves.toEqual([
      { info: { id: "user-1", role: "user", agent: undefined, model: undefined }, parts: undefined },
      {
        info: {
          id: "assistant-1",
          role: "assistant",
          agent: "writer",
          model: { providerID: "custom", modelID: "model-1" },
        },
        parts: undefined,
      },
    ])

    expect(readMessages).toHaveBeenCalledWith({ path: { id: "session-1" }, query: { directory: "C:/workspace" } })
  })

  it("loads messages and resumes in the selected project directory", async () => {
    const message = { info: { id: "assistant-1", role: "assistant" } }
    const { client, readMessages, prompt, abort, showToast } = createClient({ data: [message] })
    const session = createOpenCodeRecoverySessionPort(client, "C:/workspace")

    await expect(session.messages("session-1")).resolves.toEqual([
      { info: { id: "assistant-1", role: "assistant", agent: undefined, model: undefined }, parts: undefined },
    ])
    await session.abort("session-1")
    await session.resume({ sessionID: "session-1", text: "continue", agent: "writer" })
    await session.showNotice({ title: "Recovery", message: "Working", variant: "warning" })

    expect(readMessages).toHaveBeenCalledWith({ path: { id: "session-1" }, query: { directory: "C:/workspace" } })
    expect(abort).toHaveBeenCalledWith({ path: { id: "session-1" } })
    expect(prompt).toHaveBeenCalledWith({
      path: { id: "session-1" },
      body: { parts: [{ type: "text", text: "continue" }], agent: "writer", model: undefined },
      query: { directory: "C:/workspace" },
    })
    expect(showToast).toHaveBeenCalledWith({ body: { title: "Recovery", message: "Working", variant: "warning" } })
  })
})
