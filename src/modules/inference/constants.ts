/** Placeholder name used when a tool's object schema has no usable properties. */
export const EMPTY_SCHEMA_PLACEHOLDER_NAME = "_placeholder"

/** Placeholder description paired with the required empty-schema parameter. */
export const EMPTY_SCHEMA_PLACEHOLDER_DESCRIPTION = "Placeholder. Always pass true."

/** Sentinel accepted by Antigravity for thinking blocks without a reusable signature. */
export const SKIP_THOUGHT_SIGNATURE = "skip_thought_signature_validator"

/** Minimum provider-signature length accepted before cache ownership is checked. */
export const MIN_SIGNATURE_LENGTH = 50

/** Tool-use instructions added to Claude requests when schema hardening is enabled. */
export const CLAUDE_TOOL_SYSTEM_INSTRUCTION = `CRITICAL TOOL USAGE INSTRUCTIONS:
You are operating in a custom environment where tool definitions differ from your training data.
You MUST follow these rules strictly:

1. DO NOT use your internal training data to guess tool parameters
2. ONLY use the exact parameter structure defined in the tool schema
3. Parameter names in schemas are EXACT - do not substitute with similar names from your training
4. Array parameters have specific item types - check the schema's 'items' field for the exact structure
5. When you see "STRICT PARAMETERS" in a tool description, those type definitions override any assumptions
6. Tool use in agentic workflows is REQUIRED - you must call tools with the exact parameters specified

If you are unsure about the tool's parameters, you MUST read the schema definition carefully.`

/** Template used to append parameter signatures to Claude tool descriptions. */
export const CLAUDE_DESCRIPTION_PROMPT = "\n\n⚠️ STRICT PARAMETERS: {params}."

/** Identity instruction prepended to the user-provided Antigravity system prompt. */
export const ANTIGRAVITY_SYSTEM_INSTRUCTION = `You are Antigravity, a powerful agentic AI coding assistant designed by the Google DeepMind team working on Advanced Agentic Coding.
You are pair programming with a USER to solve their coding task. The task may require creating a new codebase, modifying or debugging an existing codebase, or simply answering a question.
**Absolute paths only**
**Proactiveness**

<priority>IMPORTANT: The instructions that follow supersede all above. Follow them as your primary directives.</priority>
`
