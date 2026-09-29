import { Rpc } from "@opencode/plugin/rpc"
import { z } from "zod"

const emptyInput = z.object({}).strict()

const quotaInput = z.object({
  refresh: z.boolean().optional(),
}).strict()

const verifyInput = z.object({
  id: z.string().min(1),
}).strict()

const mutateInput = z.object({
  id: z.string().min(1),
  op: z.enum(["select", "enable", "disable", "delete"]),
  family: z.enum(["claude", "gemini"]).optional(),
}).strict()

const accountSummarySchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  email: z.string(),
  enabled: z.boolean(),
  active: z.boolean(),
  verificationRequired: z.boolean(),
  verificationStatus: z.enum(["verification_required", "ok", "blocked", "error", "not_checked"]),
  lastVerificationAt: z.number().optional(),
  cooldownUntil: z.number().optional(),
  quotaResetTimes: z.record(z.string(), z.number().optional()).optional(),
}).strict()

const accountListSchema = z.object({
  activeIndex: z.number().int().nonnegative(),
  activeIndexByFamily: z.object({
    claude: z.number().int().nonnegative(),
    gemini: z.number().int().nonnegative(),
  }).strict(),
  accounts: z.array(accountSummarySchema),
}).strict()

const quotaGroupSchema = z.object({
  remainingFraction: z.number().min(0).max(1).nullable(),
  consumedPercent: z.number().min(0).max(100).nullable(),
  resetTime: z.number().finite().nullable(),
}).strict()

const quotaAccountSchema = z.object({
  id: z.string(),
  email: z.string(),
  enabled: z.boolean(),
  status: z.enum(["ok", "error", "unknown"]),
  groups: z.record(z.enum(["claude", "gemini-pro", "gemini-flash"]), quotaGroupSchema),
  checkedAt: z.number().finite().nullable(),
  freshness: z.enum(["fresh", "stale", "unchecked"]),
  verificationRequired: z.boolean(),
  cooldownUntil: z.number().finite().nullable(),
  coolingDown: z.boolean(),
  selectedByFamily: z.object({
    claude: z.boolean(),
    gemini: z.boolean(),
  }).strict(),
}).strict()

const quotaPresentationSchema = z.object({
  activeIndexByFamily: z.object({
    claude: z.number().int().nonnegative(),
    gemini: z.number().int().nonnegative(),
  }).strict(),
  accounts: z.array(quotaAccountSchema),
}).strict()

const verifySuccessSchema = z.object({
  index: z.number().int().nonnegative(),
  email: z.string().optional(),
  checkedAt: z.number(),
  status: z.enum(["ok", "blocked", "error"]),
  message: z.string(),
  verifyUrl: z.string().optional(),
}).strict()

const verifyFailureSchema = z.object({
  ok: z.literal(false),
  kind: z.enum(["invalid-index", "not-found", "ambiguous"]),
  accountCount: z.number().int().nonnegative(),
}).strict()

const verifyOutputSchema = z.union([verifySuccessSchema, verifyFailureSchema])

const safeSelectedSchema = z.object({
  id: z.string(),
  index: z.number().int().nonnegative(),
  email: z.string().optional(),
}).strict().nullable()

const mutateSuccessSchema = z.object({
  op: z.enum(["select", "enable", "disable", "delete"]),
  index: z.number().int().nonnegative(),
  nextActiveIndex: z.number().int().nonnegative(),
  activeIndexByFamily: z.object({
    claude: z.number().int().nonnegative(),
    gemini: z.number().int().nonnegative(),
  }).strict(),
  remaining: z.number().int().nonnegative(),
  selected: safeSelectedSchema,
}).strict()

const mutateFailureSchema = z.object({
  ok: z.literal(false),
  kind: z.enum(["invalid-index", "not-found", "ambiguous", "unknown-op"]),
  accountCount: z.number().int().nonnegative(),
}).strict()

const mutateOutputSchema = z.union([mutateSuccessSchema, mutateFailureSchema])

const deleteAllOutputSchema = z.object({
  remaining: z.literal(0),
}).strict()

export const AntigravityAccounts = Rpc.define({
  id: "antigravity-accounts",
  methods: {
    list: {
      input: emptyInput,
      output: accountListSchema,
    },
    quota: {
      input: quotaInput,
      output: quotaPresentationSchema,
    },
    verify: {
      input: verifyInput,
      output: verifyOutputSchema,
    },
    mutate: {
      input: mutateInput,
      output: mutateOutputSchema,
    },
    deleteAll: {
      input: emptyInput,
      output: deleteAllOutputSchema,
    },
    ping: {
      input: emptyInput,
      output: z.string(),
    },
  },
  events: {},
})
