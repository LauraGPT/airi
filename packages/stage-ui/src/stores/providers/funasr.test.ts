import type { TranscriptionProviderWithExtraOptions } from '@xsai-ext/providers/utils'

import { describe, expect, it } from 'vitest'

import { buildFunASRProvider, FUNASR_TRANSCRIPTION_MODELS, resolveFunASRProviderSetting } from './funasr'

interface TestTranscriptionOptions {
  language?: string
  prompt?: string
}

function expectTranscriptionProvider(
  provider: unknown,
): asserts provider is TranscriptionProviderWithExtraOptions<string, TestTranscriptionOptions> {
  if (typeof provider !== 'object' || provider === null || !('transcription' in provider) || typeof provider.transcription !== 'function')
    throw new TypeError('Expected a transcription provider')
}

describe('buildFunASRProvider', () => {
  // Regression coverage for https://github.com/moeru-ai/airi/issues/1906
  it('provides local FunASR defaults and supported model choices', async () => {
    const metadata = buildFunASRProvider()

    expect(metadata).toMatchObject({
      category: 'transcription',
      id: 'funasr-audio-transcription',
      requiresCredentials: false,
      tasks: ['speech-to-text', 'automatic-speech-recognition', 'asr', 'stt'],
    })
    expect(metadata.defaultOptions?.()).toEqual({
      apiKey: 'not-needed',
      baseUrl: 'http://localhost:8000/v1/',
      model: 'sensevoice',
    })
    expect(FUNASR_TRANSCRIPTION_MODELS.map(model => model.id)).toEqual([
      'sensevoice',
      'fun-asr-nano',
      'paraformer',
    ])
    await expect(metadata.capabilities.listModels?.({})).resolves.toEqual(FUNASR_TRANSCRIPTION_MODELS)

    const provider = await metadata.createProvider(metadata.defaultOptions?.() || {})
    expectTranscriptionProvider(provider)
    expect(provider.transcription('sensevoice')).toMatchObject({
      apiKey: 'not-needed',
      baseURL: 'http://localhost:8000/v1/',
      model: 'sensevoice',
    })
  })

  it('accepts a local server without user credentials and validates required fields', async () => {
    const metadata = buildFunASRProvider()

    await expect(metadata.validators.validateProviderConfig({
      apiKey: '',
      baseUrl: 'http://127.0.0.1:8000/v1/',
      model: 'sensevoice',
    })).resolves.toMatchObject({ valid: true })

    await expect(metadata.validators.validateProviderConfig({
      apiKey: '',
      baseUrl: 'localhost:8000/v1/',
      model: '',
    })).resolves.toMatchObject({
      valid: false,
      reason: expect.stringContaining('Base URL'),
    })
  })

  it('normalizes the base URL and preserves transcription options', async () => {
    const metadata = buildFunASRProvider((apiKey, baseUrl) => ({
      transcription: (model: string) => ({ apiKey, baseURL: baseUrl, model }),
    }))
    const provider = await metadata.createProvider({
      apiKey: 'gateway-secret',
      baseUrl: 'http://localhost:8000/v1',
      model: 'sensevoice',
    })

    expectTranscriptionProvider(provider)
    expect(provider.transcription('sensevoice', { language: 'zh', prompt: 'AIRI' })).toEqual({
      apiKey: 'gateway-secret',
      baseURL: 'http://localhost:8000/v1/',
      language: 'zh',
      model: 'sensevoice',
      prompt: 'AIRI',
    })
  })

  it('preserves explicitly cleared settings while defaulting absent values', () => {
    expect(resolveFunASRProviderSetting(undefined, 'baseUrl', 'http://localhost:8000/v1/'))
      .toBe('http://localhost:8000/v1/')
    expect(resolveFunASRProviderSetting({}, 'model', 'sensevoice')).toBe('sensevoice')
    expect(resolveFunASRProviderSetting({ baseUrl: '' }, 'baseUrl', 'http://localhost:8000/v1/'))
      .toBe('')
    expect(resolveFunASRProviderSetting({ model: '' }, 'model', 'sensevoice')).toBe('')
  })
})
