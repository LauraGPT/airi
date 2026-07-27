import type { ModelInfo } from '../providers'

import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProvidersStore } from '../providers'
import { useHearingStore } from './hearing'

function deferred<T>() {
  let resolve!: (value: T) => void
  const promise = new Promise<T>((resolvePromise) => {
    resolve = resolvePromise
  })

  return { promise, resolve }
}

vi.mock('vue-i18n', () => ({
  useI18n: () => ({
    locale: { value: 'en' },
    t: (key: string) => key,
  }),
}))

vi.mock('../../composables/use-analytics', () => ({
  useAnalytics: () => new Proxy({}, { get: () => () => {} }),
}))

describe('hearing provider model synchronization', () => {
  beforeEach(() => {
    globalThis.localStorage?.clear()
    setActivePinia(createPinia())
  })

  it('selects the destination provider model instead of retaining the previous provider model', async () => {
    const hearingStore = useHearingStore()

    hearingStore.activeTranscriptionProvider = 'funasr-audio-transcription'
    hearingStore.activeTranscriptionModel = 'paraformer'
    hearingStore.activeTranscriptionProvider = 'official-provider-transcription'

    await vi.waitFor(() => {
      expect(hearingStore.activeTranscriptionModel).toBe('auto')
    })
  })

  it('persists a Hearing model selection into the active FunASR provider config', async () => {
    const providersStore = useProvidersStore()
    const hearingStore = useHearingStore()

    hearingStore.activeTranscriptionProvider = 'funasr-audio-transcription'
    await vi.waitFor(() => {
      expect(hearingStore.activeTranscriptionModel).toBe('sensevoice')
    })

    hearingStore.activeTranscriptionModel = 'fun-asr-nano'

    await vi.waitFor(() => {
      expect(providersStore.getProviderConfig('funasr-audio-transcription')?.model).toBe('fun-asr-nano')
    })
  })

  it('does not let an earlier asynchronous provider load overwrite a later provider selection', async () => {
    const providersStore = useProvidersStore()
    const hearingStore = useHearingStore()
    const originalFetch = providersStore.fetchModelsForProvider

    providersStore.fetchModelsForProvider = vi.fn(async (providerId: string) => {
      if (providerId === 'official-provider-transcription')
        await new Promise(resolve => setTimeout(resolve, 20))
      return await originalFetch(providerId)
    })

    hearingStore.activeTranscriptionProvider = 'official-provider-transcription'
    hearingStore.activeTranscriptionProvider = 'funasr-audio-transcription'

    await vi.waitFor(() => {
      expect(hearingStore.activeTranscriptionModel).toBe('sensevoice')
    })
    await new Promise(resolve => setTimeout(resolve, 30))

    expect(hearingStore.activeTranscriptionProvider).toBe('funasr-audio-transcription')
    expect(hearingStore.activeTranscriptionModel).toBe('sensevoice')
  })

  it('does not let an earlier invocation overwrite a repeated provider selection', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    }

    const metadata = providersStore.providerMetadata['openai-audio-transcription']
    const originalListModels = metadata.capabilities.listModels
    const firstModels = deferred<ModelInfo[]>()
    const secondModels = deferred<ModelInfo[]>()
    let invocation = 0
    let completed = 0

    metadata.capabilities.listModels = async () => {
      invocation += 1
      const models = await (invocation === 1 ? firstModels.promise : secondModels.promise)
      completed += 1
      return models
    }

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(invocation).toBe(1)
      })

      hearingStore.activeTranscriptionProvider = 'funasr-audio-transcription'
      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('sensevoice')
      })

      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'
      await vi.waitFor(() => {
        expect(invocation).toBe(2)
      })

      secondModels.resolve([{
        id: 'fresh-transcription-model',
        name: 'Fresh transcription model',
        provider: 'openai-audio-transcription',
      }])
      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('fresh-transcription-model')
      })

      firstModels.resolve([{
        id: 'stale-transcription-model',
        name: 'Stale transcription model',
        provider: 'openai-audio-transcription',
      }])
      await vi.waitFor(() => {
        expect(completed).toBe(2)
      })

      expect(hearingStore.activeTranscriptionModel).toBe('fresh-transcription-model')
      expect(providersStore.getModelsForProvider('openai-audio-transcription')).toEqual([{
        id: 'fresh-transcription-model',
        name: 'Fresh transcription model',
        provider: 'openai-audio-transcription',
      }])
    }
    finally {
      metadata.capabilities.listModels = originalListModels
    }
  })

  it('does not let an earlier invocation apply stale config after the same provider is reselected', async () => {
    const providersStore = useProvidersStore()
    const originalFetch = providersStore.fetchModelsForProvider
    const originalGetConfig = providersStore.getProviderConfig
    const firstLoad = deferred<void>()
    const secondLoad = deferred<void>()
    let currentConfig: Record<string, unknown> = { model: 'stale-configured-model' }
    let invocation = 0
    let completed = 0

    providersStore.getProviderConfig = vi.fn((providerId: string) => {
      if (providerId === 'openai-audio-transcription')
        return currentConfig
      return originalGetConfig(providerId)
    })
    providersStore.fetchModelsForProvider = vi.fn(async (providerId: string) => {
      if (providerId !== 'openai-audio-transcription')
        return await originalFetch(providerId)

      invocation += 1
      await (invocation === 1 ? firstLoad.promise : secondLoad.promise)
      completed += 1
      return []
    })

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(invocation).toBe(1)
      })

      hearingStore.activeTranscriptionProvider = 'funasr-audio-transcription'
      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('sensevoice')
      })

      currentConfig = { model: 'fresh-configured-model' }
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'
      await vi.waitFor(() => {
        expect(invocation).toBe(2)
      })

      secondLoad.resolve()
      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('fresh-configured-model')
      })

      firstLoad.resolve()
      await vi.waitFor(() => {
        expect(completed).toBe(2)
      })

      expect(hearingStore.activeTranscriptionModel).toBe('fresh-configured-model')
    }
    finally {
      providersStore.getProviderConfig = originalGetConfig
      providersStore.fetchModelsForProvider = originalFetch
    }
  })
})
