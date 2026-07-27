import type { SpeechProvider } from '@xsai-ext/providers/utils'

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

  it('persists a Hearing model selection into another provider with a model setting', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['mimo-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.xiaomimimo.com/v1/',
      model: 'mimo-v2-omni',
    }
    const hearingStore = useHearingStore()

    hearingStore.activeTranscriptionProvider = 'mimo-audio-transcription'
    await vi.waitFor(() => {
      expect(hearingStore.activeTranscriptionModel).toBe('mimo-v2-omni')
    })

    hearingStore.activeTranscriptionModel = 'mimo-v2.5'

    await vi.waitFor(() => {
      expect(providersStore.getProviderConfig('mimo-audio-transcription')?.model).toBe('mimo-v2.5')
    })
  })

  it('recreates a cached provider when its persisted model changes', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['mimo-audio-speech'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.xiaomimimo.com/v1/',
      model: 'mimo-v2-omni',
    }
    await new Promise(resolve => setTimeout(resolve, 0))

    const firstProvider = await providersStore.getProviderInstance<SpeechProvider>('mimo-audio-speech')
    expect(firstProvider.speech('unused').model).toBe('mimo-v2-omni')

    providersStore.providers['mimo-audio-speech'].model = 'mimo-v2.5-tts'

    await vi.waitFor(async () => {
      const currentProvider = await providersStore.getProviderInstance<SpeechProvider>('mimo-audio-speech')
      expect(currentProvider).not.toBe(firstProvider)
      expect(currentProvider.speech('unused').model).toBe('mimo-v2.5-tts')
    })
  })

  it('persists a model selected for a list-backed provider without an initial model setting', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    }

    const metadata = providersStore.providerMetadata['openai-audio-transcription']
    const originalListModels = metadata.capabilities.listModels
    let invocation = 0
    metadata.capabilities.listModels = async () => {
      invocation += 1
      return []
    }

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(invocation).toBe(1)
      })

      hearingStore.activeTranscriptionModel = 'whisper-1'

      await vi.waitFor(() => {
        expect(providersStore.getProviderConfig('openai-audio-transcription')?.model).toBe('whisper-1')
      })
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(invocation).toBe(1)
    }
    finally {
      metadata.capabilities.listModels = originalListModels
    }
  })

  it('uses and persists a list-backed provider displayed default during initial selection', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    }

    const metadata = providersStore.providerMetadata['openai-audio-transcription']
    const originalListModels = metadata.capabilities.listModels
    metadata.capabilities.listModels = async () => [
      {
        id: 'gpt-4o-transcribe',
        name: 'GPT-4o Transcribe',
        provider: 'openai-audio-transcription',
      },
      {
        id: 'whisper-1',
        name: 'Whisper-1',
        provider: 'openai-audio-transcription',
      },
    ]

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('whisper-1')
      })
      expect(providersStore.getProviderConfig('openai-audio-transcription')?.model).toBe('whisper-1')
    }
    finally {
      metadata.capabilities.listModels = originalListModels
    }
  })

  it('keeps a provider model configured while its model list is loading', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    }

    const metadata = providersStore.providerMetadata['openai-audio-transcription']
    const originalListModels = metadata.capabilities.listModels
    const pendingModels = deferred<ModelInfo[]>()
    let invocation = 0
    let completed = 0
    metadata.capabilities.listModels = async () => {
      invocation += 1
      const models = await pendingModels.promise
      completed += 1
      return models
    }

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(invocation).toBe(1)
      })

      providersStore.providers['openai-audio-transcription'] = {
        ...providersStore.providers['openai-audio-transcription'],
        model: 'comet-model',
      }

      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('comet-model')
        expect(invocation).toBe(1)
      })

      pendingModels.resolve([
        {
          id: 'gpt-4o-transcribe',
          name: 'GPT-4o Transcribe',
          provider: 'openai-audio-transcription',
        },
        {
          id: 'whisper-1',
          name: 'Whisper-1',
          provider: 'openai-audio-transcription',
        },
      ])

      await vi.waitFor(() => {
        expect(completed).toBe(1)
      })
      expect(hearingStore.activeTranscriptionModel).toBe('comet-model')
      expect(providersStore.getProviderConfig('openai-audio-transcription')?.model).toBe('comet-model')
    }
    finally {
      pendingModels.resolve([])
      metadata.capabilities.listModels = originalListModels
    }
  })

  it('does not clear a configured model while switching to its provider', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
      model: 'configured-transcription-model',
    }

    const metadata = providersStore.providerMetadata['openai-audio-transcription']
    const originalListModels = metadata.capabilities.listModels
    const pendingModels = deferred<ModelInfo[]>()
    let invocation = 0
    metadata.capabilities.listModels = async () => {
      invocation += 1
      return await pendingModels.promise
    }

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'funasr-audio-transcription'
      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('sensevoice')
      })

      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('configured-transcription-model')
      })
      expect(providersStore.getProviderConfig('openai-audio-transcription')?.model).toBe('configured-transcription-model')
      expect(invocation).toBe(0)
    }
    finally {
      pendingModels.resolve([])
      metadata.capabilities.listModels = originalListModels
    }
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

  it('waits for the current same-provider fetch before resolving a provider transition', async () => {
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

    metadata.capabilities.listModels = async () => {
      invocation += 1
      return await (invocation === 1 ? firstModels.promise : secondModels.promise)
    }

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(invocation).toBe(1)
      })

      const competingFetch = providersStore.fetchModelsForProvider('openai-audio-transcription')
      await vi.waitFor(() => {
        expect(invocation).toBe(2)
      })

      firstModels.resolve([{
        id: 'stale-transcription-model',
        name: 'Stale transcription model',
        provider: 'openai-audio-transcription',
      }])
      await new Promise(resolve => setTimeout(resolve, 0))
      expect(hearingStore.activeTranscriptionModel).toBe('')

      secondModels.resolve([{
        id: 'fresh-transcription-model',
        name: 'Fresh transcription model',
        provider: 'openai-audio-transcription',
      }])
      await competingFetch

      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('fresh-transcription-model')
      })
    }
    finally {
      metadata.capabilities.listModels = originalListModels
    }
  })

  it('does not select stale cached models when the current refresh returns no models', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    }
    const originalFetch = providersStore.fetchModelsForProvider
    const originalGetModels = providersStore.getModelsForProvider
    let completed = false

    providersStore.fetchModelsForProvider = vi.fn(async (providerId: string) => {
      if (providerId !== 'openai-audio-transcription')
        return await originalFetch(providerId)

      await Promise.resolve()
      completed = true
      return []
    })
    providersStore.getModelsForProvider = vi.fn((providerId: string) => {
      if (providerId === 'openai-audio-transcription') {
        return [{
          id: 'stale-cached-model',
          name: 'Stale cached model',
          provider: 'openai-audio-transcription',
        }]
      }
      return originalGetModels(providerId)
    })

    try {
      const hearingStore = useHearingStore()
      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'

      await vi.waitFor(() => {
        expect(completed).toBe(true)
      })
      await new Promise(resolve => setTimeout(resolve, 0))

      expect(hearingStore.activeTranscriptionModel).toBe('')
    }
    finally {
      providersStore.fetchModelsForProvider = originalFetch
      providersStore.getModelsForProvider = originalGetModels
    }
  })

  it('does not let an earlier invocation apply stale models after the same provider is reselected', async () => {
    const providersStore = useProvidersStore()
    providersStore.providers['openai-audio-transcription'] = {
      apiKey: 'test-key',
      baseUrl: 'https://api.openai.com/v1/',
    }
    const originalFetch = providersStore.fetchModelsForProvider
    const originalGetModels = providersStore.getModelsForProvider
    const firstLoad = deferred<ModelInfo[]>()
    const secondLoad = deferred<ModelInfo[]>()
    let currentModels: ModelInfo[] = []
    let invocation = 0
    let completed = 0

    providersStore.getModelsForProvider = vi.fn((providerId: string) => {
      if (providerId === 'openai-audio-transcription')
        return currentModels
      return originalGetModels(providerId)
    })
    providersStore.fetchModelsForProvider = vi.fn(async (providerId: string) => {
      if (providerId !== 'openai-audio-transcription')
        return await originalFetch(providerId)

      invocation += 1
      currentModels = await (invocation === 1 ? firstLoad.promise : secondLoad.promise)
      completed += 1
      return currentModels
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

      hearingStore.activeTranscriptionProvider = 'openai-audio-transcription'
      await vi.waitFor(() => {
        expect(invocation).toBe(2)
      })

      secondLoad.resolve([{
        id: 'fresh-transcription-model',
        name: 'Fresh transcription model',
        provider: 'openai-audio-transcription',
      }])
      await vi.waitFor(() => {
        expect(hearingStore.activeTranscriptionModel).toBe('fresh-transcription-model')
      })

      firstLoad.resolve([{
        id: 'stale-transcription-model',
        name: 'Stale transcription model',
        provider: 'openai-audio-transcription',
      }])
      await vi.waitFor(() => {
        expect(completed).toBe(2)
      })

      expect(hearingStore.activeTranscriptionModel).toBe('fresh-transcription-model')
    }
    finally {
      providersStore.getModelsForProvider = originalGetModels
      providersStore.fetchModelsForProvider = originalFetch
    }
  })
})
