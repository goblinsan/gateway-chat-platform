import { buildRegistry, type ProviderRegistry } from '../providers/registry'
import { getEnv } from './env'

let _registry: ProviderRegistry | undefined

/**
 * Returns the application-wide ProviderRegistry, building it once from the
 * current environment on first call.
 */
export function getProviderRegistry(): ProviderRegistry {
  if (!_registry) {
    _registry = buildRegistry(getEnv())
  }
  return _registry
}
