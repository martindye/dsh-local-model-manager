/** Portable llama.cpp lifecycle and loopback proxy for a DSH profile. */
import { createModelProxy } from './proxy.mjs'

export { Config } from './config.mjs'
export const name = 'local-model-manager'

/** Mount the proxy; live launch settings do not remount it or restart a model. */
export function apply(ctx, config = {}) {
  const proxy = createModelProxy(config)
  ctx?.inject?.(['settings'], child => {
    child.effect(() => child.settings.configure({ auto: false }, ctx.fiber))
  })
  const start = () => {
    proxy.listen().catch(error => proxy.log(`FATAL proxy server error: ${error.message}`))
    return () => proxy.close()
  }
  if (ctx?.effect) ctx.effect(start, 'local-model-manager: proxy')
  else start()
}
