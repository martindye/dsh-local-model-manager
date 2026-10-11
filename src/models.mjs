import { readFileSync } from 'node:fs'
import { parse } from 'yaml'

/** Read model context entries in YAML/JSON, including quoted ids and aliases. */
export function contextFromSettings(settingsPath, modelId) {
  if (!settingsPath || !modelId) return null
  let document
  try {
    document = parse(readFileSync(settingsPath, 'utf8'), {
      maxAliasCount: 100, logLevel: 'silent',
      // DSH expression tags remain opaque data; never execute profile code.
      customTags: [{ tag: 'tag:yaml.org,2002:js', resolve: value => ({ __jsExpr: value }) }],
    })
  } catch (error) { return null }
  const seen = new Set()
  const visit = (node) => {
    if (!node || typeof node !== 'object' || seen.has(node)) return null
    seen.add(node)
    if (node.id === modelId && Number.isSafeInteger(node.contextWindow) && node.contextWindow > 0) return node.contextWindow
    for (const value of Object.values(node)) {
      const context = visit(value)
      if (context !== null) return context
    }
    return null
  }
  return visit(document)
}

/** Resolve one dropdown entry without changing the legacy Windows/Qwen defaults. */
export function modelRequest(config, modelId) {
  modelId ||= config.defaultModel || ''
  const profile = modelId && Object.hasOwn(config.modelProfiles ?? {}, modelId) ? config.modelProfiles[modelId] : null
  const effective = profile ? { ...config, ...Object.fromEntries(Object.entries(profile).filter(([, value]) => value !== undefined)) } : config
  const configuredContext = modelId && Object.hasOwn(config.modelContexts ?? {}, modelId) ? config.modelContexts[modelId] : null
  const contextSize = profile?.contextSize ?? configuredContext ?? contextFromSettings(config.settingsPath, modelId) ?? config.defaultContextSize
  if (!Number.isSafeInteger(contextSize) || contextSize <= 0) throw new Error('Requested context must be a positive safe integer')
  const servedModel = profile?.servedModel || (profile?.modelPath ? modelId : effective.servedModel || '')
  if (profile?.modelPath && !effective.startCommand) throw new Error('modelProfiles with modelPath require startCommand/startArgs')
  return { config: { ...effective, servedModel }, contextSize, modelId: modelId || '', servedModel }
}
