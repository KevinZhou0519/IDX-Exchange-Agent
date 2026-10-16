// openclaw/plugin-sdk/provider-tools ships no type declarations; this covers
// the one function the Gemini schema test uses.
declare module "openclaw/plugin-sdk/provider-tools" {
  export function normalizeGeminiToolSchemas(ctx: { tools: unknown[] }): { parameters: unknown }[];
}
