import { describe, expect, it } from 'vitest'

import {
  describeEmptyTranscriptionResponse,
  filterTranscriptionByConfidence,
  normalizeGeneratedTranscriptionText,
  resolveActiveTranscriptionModel,
  resolveActiveTranscriptionProviderError,
  resolveProviderConfiguredTranscriptionModel,
  resolveProviderConfigWithTranscriptionModel,
  resolveStreamTranscriptionExecutor,
  resolveTranscriptionFileName,
  resolveTranscriptionModelOnProviderChange,
  resolveTranscriptionProviderOptions,
} from './hearing'

describe('filterTranscriptionByConfidence', () => {
  const segments = [
    { text: 'Hello ', avg_logprob: -0.3 },
    { text: 'world ', avg_logprob: -1.2 },
    { text: 'gibberish', avg_logprob: -2.5 },
  ]

  it('keeps all segments when threshold is very low', () => {
    expect(filterTranscriptionByConfidence(segments, -3)).toBe('Hello world gibberish')
  })

  it('filters out low-confidence segments', () => {
    expect(filterTranscriptionByConfidence(segments, -1)).toBe('Hello')
  })

  it('filters out all segments when threshold is 0', () => {
    expect(filterTranscriptionByConfidence(segments, 0)).toBe('')
  })

  it('returns empty string for empty segments', () => {
    expect(filterTranscriptionByConfidence([], -1)).toBe('')
  })

  it('trims whitespace from result', () => {
    expect(filterTranscriptionByConfidence([{ text: '  hello  ', avg_logprob: -0.5 }], -1)).toBe('hello')
  })
})

describe('resolveStreamTranscriptionExecutor', () => {
  /**
   * @example
   * resolveStreamTranscriptionExecutor('official-provider-transcription')
   */
  it('routes the official transcription provider through the Aliyun streaming executor', () => {
    const executor = resolveStreamTranscriptionExecutor('official-provider-transcription')

    expect(executor).toBe(resolveStreamTranscriptionExecutor('aliyun-nls-transcription'))
  })
})

describe('resolveActiveTranscriptionProviderError', () => {
  /**
   * @example
   * resolveActiveTranscriptionProviderError('')
   */
  it('returns a clear setup error when no transcription provider is selected', () => {
    expect(resolveActiveTranscriptionProviderError('')).toBe('No active transcription provider selected. Select a provider in Settings > Hearing.')
  })

  /**
   * @example
   * resolveActiveTranscriptionProviderError('openai-compatible-audio-transcription')
   */
  it('allows a selected transcription provider', () => {
    expect(resolveActiveTranscriptionProviderError('openai-compatible-audio-transcription')).toBeUndefined()
  })
})

describe('resolveActiveTranscriptionModel', () => {
  /**
   * @example
   * resolveActiveTranscriptionModel('', { model: 'FunAudioLLM/SenseVoiceSmall' })
   */
  it('uses the provider config model when the hearing model has not been synced', () => {
    expect(resolveActiveTranscriptionModel('', { model: 'FunAudioLLM/SenseVoiceSmall' })).toBe('FunAudioLLM/SenseVoiceSmall')
  })

  /**
   * @example
   * resolveActiveTranscriptionModel('whisper-1', { model: 'FunAudioLLM/SenseVoiceSmall' })
   */
  it('prefers the explicit hearing model over the provider config model', () => {
    expect(resolveActiveTranscriptionModel('whisper-1', { model: 'FunAudioLLM/SenseVoiceSmall' })).toBe('whisper-1')
  })
})

describe('resolveProviderConfiguredTranscriptionModel', () => {
  it('uses the FunASR default when provider settings are not initialized', () => {
    expect(resolveProviderConfiguredTranscriptionModel('funasr-audio-transcription')).toBe('sensevoice')
  })

  it('uses the configured FunASR model after the provider setting changes', () => {
    expect(resolveProviderConfiguredTranscriptionModel('funasr-audio-transcription', { model: 'paraformer' })).toBe('paraformer')
  })

  it('preserves an explicitly cleared FunASR model', () => {
    expect(resolveProviderConfiguredTranscriptionModel('funasr-audio-transcription', { model: '' })).toBe('')
  })

  it('keeps the existing OpenAI-compatible model default', () => {
    expect(resolveProviderConfiguredTranscriptionModel('openai-compatible-audio-transcription')).toBe('whisper-1')
  })

  it('uses the configured model for any provider that owns a model setting', () => {
    expect(resolveProviderConfiguredTranscriptionModel(
      'mimo-audio-transcription',
      { model: 'mimo-v2.5' },
    )).toBe('mimo-v2.5')
  })

  it('does not synchronize models for providers without model settings', () => {
    expect(resolveProviderConfiguredTranscriptionModel('browser-web-speech-api')).toBeUndefined()
  })
})

describe('resolveTranscriptionModelOnProviderChange', () => {
  it('preserves a valid persisted model during initial provider hydration', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'openai-audio-transcription',
      undefined,
      [{ id: 'gpt-4o-transcribe' }, { id: 'whisper-1' }],
      undefined,
      'whisper-1',
    )).toBe('whisper-1')
  })

  it('does not restore an unverified persisted model when initial model loading fails', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'openai-audio-transcription',
      undefined,
      [],
      undefined,
      'persisted-stale-model',
      true,
    )).toBe('')
  })

  it('uses the destination provider configured model before its first listed model', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'mimo-audio-transcription',
      { model: 'mimo-v2.5' },
      [{ id: 'mimo-v2-omni' }, { id: 'mimo-v2.5' }],
      'funasr-audio-transcription',
      'sensevoice',
    )).toBe('mimo-v2.5')
  })

  it('uses a list-backed provider displayed default before its first listed model', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'openai-audio-transcription',
      { baseUrl: 'https://api.openai.com/v1/' },
      [{ id: 'gpt-4o-transcribe' }, { id: 'whisper-1' }],
      'funasr-audio-transcription',
      'sensevoice',
      true,
    )).toBe('whisper-1')
  })

  it('selects the official provider model instead of retaining a FunASR model', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'official-provider-transcription',
      undefined,
      [{ id: 'auto' }],
      'funasr-audio-transcription',
      'paraformer',
    )).toBe('auto')
  })

  it('clears a stale model when the destination provider has no selectable model', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'provider-without-models',
      undefined,
      [],
      'funasr-audio-transcription',
      'paraformer',
    )).toBe('')
  })

  it('preserves an initial manual model when the provider has no model list', () => {
    expect(resolveTranscriptionModelOnProviderChange(
      'provider-without-models',
      undefined,
      [],
      undefined,
      'custom-model',
    )).toBe('custom-model')
  })
})

describe('resolveProviderConfigWithTranscriptionModel', () => {
  it('persists a Hearing model selection into the FunASR provider config', () => {
    expect(resolveProviderConfigWithTranscriptionModel(
      'funasr-audio-transcription',
      'fun-asr-nano',
      { baseUrl: 'http://localhost:8000/v1/', model: 'sensevoice' },
    )).toEqual({ baseUrl: 'http://localhost:8000/v1/', model: 'fun-asr-nano' })
  })

  it('does not rewrite the provider config when the model is already synchronized', () => {
    expect(resolveProviderConfigWithTranscriptionModel(
      'funasr-audio-transcription',
      'paraformer',
      { model: 'paraformer' },
    )).toBeUndefined()
  })

  it('persists a Hearing model selection for any provider with a model setting', () => {
    expect(resolveProviderConfigWithTranscriptionModel(
      'mimo-audio-transcription',
      'mimo-v2.5',
      { baseUrl: 'https://api.xiaomimimo.com/v1/', model: 'mimo-v2-omni' },
    )).toEqual({ baseUrl: 'https://api.xiaomimimo.com/v1/', model: 'mimo-v2.5' })
  })

  it('persists a model selection for a list-backed provider before its config owns a model', () => {
    expect(resolveProviderConfigWithTranscriptionModel(
      'openai-audio-transcription',
      'whisper-1',
      { baseUrl: 'https://api.openai.com/v1/' },
      true,
    )).toEqual({ baseUrl: 'https://api.openai.com/v1/', model: 'whisper-1' })
  })

  it('does not persist a global model into providers without scoped model settings', () => {
    expect(resolveProviderConfigWithTranscriptionModel(
      'official-provider-transcription',
      'auto',
      {},
    )).toBeUndefined()
  })
})

describe('resolveTranscriptionProviderOptions', () => {
  /**
   * @example
   * resolveTranscriptionProviderOptions({}, 'zh-Hans')
   */
  it('derives a two-letter transcription language from the active UI locale', () => {
    expect(resolveTranscriptionProviderOptions({}, 'zh-Hans')).toEqual({ language: 'zh' })
  })

  /**
   * @example
   * resolveTranscriptionProviderOptions({ language: 'ja' }, 'zh-Hans')
   */
  it('prefers the provider language when one is configured explicitly', () => {
    expect(resolveTranscriptionProviderOptions({ language: 'ja' }, 'zh-Hans')).toEqual({ language: 'ja' })
  })
})

describe('normalizeGeneratedTranscriptionText', () => {
  /**
   * @example
   * normalizeGeneratedTranscriptionText({ result: { text: '你好' } })
   */
  it('reads nested text from OpenAI-compatible provider variants', () => {
    expect(normalizeGeneratedTranscriptionText({ result: { text: '你好' } })).toBe('你好')
  })

  /**
   * @example
   * normalizeGeneratedTranscriptionText({ segments: [{ text: '你' }, { text: '好' }] })
   */
  it('joins segment text when no top-level text is returned', () => {
    expect(normalizeGeneratedTranscriptionText({ segments: [{ text: '你' }, { text: '好' }] })).toBe('你好')
  })

  /**
   * @example
   * normalizeGeneratedTranscriptionText({ segments: [{ text: ' Hello' }, { text: ' world' }] })
   */
  it('preserves segment whitespace before trimming the final fallback text', () => {
    expect(normalizeGeneratedTranscriptionText({ segments: [{ text: ' Hello' }, { text: ' world' }] })).toBe('Hello world')
  })

  /**
   * @example
   * normalizeGeneratedTranscriptionText({ data: { text: '你好' } })
   */
  it('reads data text from provider envelope responses', () => {
    expect(normalizeGeneratedTranscriptionText({ data: { text: '你好' } })).toBe('你好')
  })
})

describe('describeEmptyTranscriptionResponse', () => {
  /**
   * @example
   * describeEmptyTranscriptionResponse({ result: { duration: 1 } })
   */
  it('describes response keys when no usable text was returned', () => {
    expect(describeEmptyTranscriptionResponse({ result: { duration: 1 } })).toContain('keys=result')
  })
})

describe('resolveTranscriptionFileName', () => {
  /**
   * @example
   * resolveTranscriptionFileName(new File([], 'recording.wav'))
   */
  it('uses the File name so OpenAI-compatible providers can infer the audio format', () => {
    expect(resolveTranscriptionFileName(new File([], 'recording.wav'))).toBe('recording.wav')
  })
})
