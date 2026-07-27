import { createPinia, setActivePinia } from 'pinia'
import { beforeEach, describe, expect, it, vi } from 'vitest'

import { useProvidersStore } from '../providers'
import { useHearingStore } from './hearing'

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
})
