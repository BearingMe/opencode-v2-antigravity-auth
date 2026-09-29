import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

export const AntigravitySmoke = Rpc.define({
  id: "antigravity-smoke",
  methods: {
    ping: {
      input: z.object({}).strict(),
      output: z.string(),
    },
  },
  events: {},
})
