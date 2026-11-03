// Offizielles Anthropic-SDK für den Browser (eigenes Bündel, erst beim ersten Gespräch geladen).
// Beim Bau bündelt esbuild es mit; der Entwicklungsserver (scripts/serve.js) bündelt diese Datei bei Bedarf.
export { default as Anthropic } from '@anthropic-ai/sdk'
export { betaTool } from '@anthropic-ai/sdk/helpers/beta/json-schema'
