import { referenceContent, visualContract } from './references.mjs';
import { normalizeLlmEndpoint, LlmResponseError, llmTransportError } from './llm-response.mjs';
import { unlimitedFetch } from './unlimited-fetch.mjs';
import { readLlmStoryboardResponse } from './llm-stream.mjs';
const authHeaders = key => key ? { authorization: `Bearer ${key}` } : {};
export class LlmStoryboardProvider {
  constructor(config = {}, { fetchImpl = unlimitedFetch } = {}) {
    this.config = config;
    this.fetchImpl = fetchImpl;
  }

  async createStoryboard(script, systemPrompt, refs = { products: [], avatar: '' }) {
    const endpoint = normalizeLlmEndpoint(this.config.endpoint);
    if (!script?.trim()) throw new Error('口播文案不能为空');
    const started = performance.now();
    let response;
    let stage = 'waiting_response_headers';
    try {
      response = await this.fetchImpl(endpoint, {
        method: 'POST',
        headers: { 'content-type': 'application/json', ...authHeaders(this.config.key) },
        body: JSON.stringify({
        model: this.config.model || 'gpt-4o-mini',
        messages: [
          { role: 'system', content: systemPrompt + '\n\n' + visualContract },
          { role: 'user', content: [{ type: 'text', text: `请为下面这段完整口播设计连续短视频分镜。镜头时长和数量由你决定，不要凑固定总时长。不要遗漏语义，不要新增商品信息，并让每个镜头明确承接上一镜头：\n\n${script}` }, ...referenceContent(refs)] }
        ],
        temperature: 0.7,
        response_format: { type: 'json_object' },
        stream: true
        })
      });
      stage = 'reading_response_body';
      return await readLlmStoryboardResponse(response, { key: this.config.key });
    } catch (error) {
      if (error instanceof LlmResponseError) throw error;
      throw llmTransportError(error, {
        stage, localDeadline: 'none', elapsedMs: Math.round(performance.now() - started),
        responseReceived: Boolean(response), httpStatus: response?.status ?? null
      });
    }
  }
}

