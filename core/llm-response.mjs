const object = value => value && typeof value === 'object' && !Array.isArray(value);

export function normalizeLlmEndpoint(endpoint) {
  if (!String(endpoint || '').trim()) throw new Error('请在设置中填写大语言模型 API 地址');
  let url;
  try { url = new URL(String(endpoint).trim()); }
  catch { throw new Error('大语言模型 API 地址格式无效'); }
  if (!['http:', 'https:'].includes(url.protocol)) throw new Error('大语言模型 API 地址必须使用 http 或 https');
  const route = url.pathname.replace(/\/+$/, '');
  if (!route || route === '/v1') url.pathname = '/v1/chat/completions';
  return url.toString();
}

export function redactLlmError(value, key = '') {
  let text = String(value || '');
  if (key) text = text.split(key).join('[已隐藏 Key]');
  return text.replace(/Bearer\s+[^\s"'<>]+/gi, 'Bearer [已隐藏]')
    .replace(/\bsk-[\w-]+/g, '[已隐藏 Key]').slice(0, 400);
}

export class LlmResponseError extends Error {
  constructor(message, code, diagnostics) {
    super(message);
    this.name = 'LlmResponseError';
    this.code = code;
    this.diagnostics = { code, ...diagnostics };
  }
}

export function llmTransportError(error, diagnostics) {
  const timeoutCodes = ['UND_ERR_CONNECT_TIMEOUT', 'UND_ERR_HEADERS_TIMEOUT', 'UND_ERR_BODY_TIMEOUT', 'ETIMEDOUT'];
  const networkCodes = ['ECONNRESET', 'ECONNREFUSED', 'ENOTFOUND', 'EAI_AGAIN', 'UND_ERR_SOCKET'];
  const causeCode = error?.cause?.code || error?.code;
  const transportCode = [...timeoutCodes, ...networkCodes].includes(causeCode) ? causeCode : 'unknown';
  const detail = { ...diagnostics, transportCode, requestOutcome: 'unknown', automaticRetry: false };
  if (timeoutCodes.includes(causeCode) || error?.name === 'TimeoutError') {
    return new LlmResponseError('连接或读取大语言模型接口时超时，尚未收到完整结果。未自动重试；请检查网络及服务商请求记录。', 'LLM_TRANSPORT_TIMEOUT', detail);
  }
  return new LlmResponseError('连接大语言模型接口失败或连接中断，未取得完整结果。未自动重试；请检查网络和服务商请求记录后再决定是否重试。', 'LLM_NETWORK_ERROR', detail);
}

function textContent(content) {
  if (typeof content === 'string') return content;
  if (Array.isArray(content)) return content.map(part => typeof part?.text === 'string' ? part.text : '').join('');
  return content;
}

function storyboardCandidate(value, diagnostics) {
  // Only known, unambiguous wrappers/aliases. Never turn arbitrary response objects into shots.
  if (Array.isArray(value)) return { scenes: value };
  if (!object(value)) return value;
  const names = ['scenes', 'shots', 'storyboard', 'data'];
  if (Object.hasOwn(value, 'scenes')) return value;
  const candidates = names.slice(1).filter(name => Array.isArray(value[name]) || object(value[name]) && Object.hasOwn(value[name], 'scenes'));
  if (candidates.length > 1) throw new LlmResponseError('模型返回了多个可能的分镜列表，无法确定使用哪一份；请要求只返回一个 scenes 数组。', 'LLM_AMBIGUOUS_SCENES', diagnostics);
  if (candidates.length === 1) {
    const nested = value[candidates[0]];
    return Array.isArray(nested) ? { ...value, scenes: nested } : { ...value, ...nested };
  }
  return value;
}

export function parseLlmResponse(raw, meta = {}) {
  const diagnostics = {
    httpStatus: meta.status || 200,
    responseFormat: 'unknown',
    // Fixed categories only: do not copy response text, request bodies, keys or URLs into diagnostics.
    contentType: String(meta.contentType || '').includes('json') ? 'json' : String(meta.contentType || '').includes('html') ? 'html' : 'other',
    responseChars: raw.length
  };
  const fail = (message, code) => { throw new LlmResponseError(message, code, diagnostics); };
  if ([408, 504].includes(diagnostics.httpStatus)) fail(`大语言模型服务或网关返回 HTTP ${diagnostics.httpStatus} 超时。本地未设置等待时限，无法取消上游的超时策略；请先查看服务商请求记录，不要立即重复提交。`, 'LLM_UPSTREAM_TIMEOUT');
  let payload;
  try { payload = JSON.parse(raw); }
  catch {
    if (diagnostics.httpStatus >= 400) fail(`大语言模型接口 HTTP ${diagnostics.httpStatus}，且未返回 JSON 错误信息。请核对聊天接口地址及服务商状态。`, 'LLM_HTTP_ERROR');
    fail('大语言模型接口返回的不是 JSON，而是网页或普通文本；请检查是否填写了完整聊天接口 /v1/chat/completions。', 'LLM_NON_JSON_RESPONSE');
  }
  const errorPayload = payload?.error || payload?.data?.error;
  if (diagnostics.httpStatus >= 400 || errorPayload || payload?.success === false) {
    const detail = redactLlmError(typeof errorPayload === 'string' ? errorPayload : errorPayload?.message || payload?.message, meta.key);
    fail(`大语言模型服务返回错误（HTTP ${diagnostics.httpStatus}）${detail ? '：' + detail : '，请检查 Key、模型权限和服务商状态'}`, 'LLM_PROVIDER_ERROR');
  }
  const envelope = Array.isArray(payload?.choices) ? payload : Array.isArray(payload?.data?.choices) ? payload.data : null;
  let content;
  if (envelope) {
    diagnostics.responseFormat = 'chat-completions';
    const choice = envelope.choices[0];
    const reason = choice?.finish_reason;
    diagnostics.finishReason = ['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(reason) ? reason : 'unknown';
    diagnostics.hasReasoning = Boolean(choice?.message?.reasoning_content);
    if (reason === 'length') fail('模型输出达到长度上限，分镜可能尚未写完；本次不会把不完整结果当作成功。请检查服务商的输出长度设置。', 'LLM_OUTPUT_TRUNCATED');
    if (reason === 'content_filter' || choice?.message?.refusal) fail('模型未返回分镜正文，服务返回了拒绝或内容过滤标记。', 'LLM_REFUSAL');
    content = textContent(choice?.message?.content);
  } else if (Array.isArray(payload) || (object(payload) && (Object.hasOwn(payload, 'scenes') || Object.hasOwn(payload, 'shots') || Object.hasOwn(payload, 'storyboard') || (object(payload.data) && Object.hasOwn(payload.data, 'scenes'))))) {
    diagnostics.responseFormat = 'direct-storyboard';
    content = payload;
  } else {
    fail('接口返回 JSON，但没有找到 choices[0].message.content 或分镜对象；当前响应结构与聊天接口不兼容。', 'LLM_RESPONSE_SCHEMA');
  }
  if (content == null || typeof content === 'string' && !content.trim()) {
    fail(diagnostics.hasReasoning ? '模型只返回了推理内容，没有最终分镜正文；推理内容不会被当作分镜。' : '模型返回的正文为空，没有生成分镜。', 'LLM_EMPTY_CONTENT');
  }
  let result = content;
  if (typeof content === 'string') {
    diagnostics.contentChars = content.length;
    const text = content.trim();
    try { result = JSON.parse(text); }
    catch {
      const fences = [...text.matchAll(/```(?:json)?\s*\n?([\s\S]*?)```/gi)];
      if (fences.length !== 1) fail('模型返回了正文，但不是有效的分镜 JSON（可能带解释文字、格式损坏或多个代码块）。', 'LLM_INVALID_JSON');
      try { result = JSON.parse(fences[0][1].trim()); }
      catch { fail('模型返回的 JSON 代码块无法解析，可能未完整输出。', 'LLM_INVALID_JSON'); }
    }
  }
  result = storyboardCandidate(result, diagnostics);
  if (!object(result) || !Object.hasOwn(result, 'scenes')) fail('模型正文已解析，但缺少 scenes 分镜列表；请让模型按分镜格式输出。', 'LLM_SCENES_MISSING');
  if (!Array.isArray(result.scenes)) fail('模型返回的 scenes 不是数组，分镜结构不符合要求。', 'LLM_SCENES_TYPE');
  diagnostics.sceneCount = result.scenes.length;
  if (!result.scenes.length) fail('模型返回了空分镜列表 scenes: []，本次没有生成任何镜头。', 'LLM_SCENES_EMPTY');
  if (result.scenes.some(scene => !object(scene) || !['title', 'voiceText', 'text', 'visualPrompt'].some(field => typeof scene[field] === 'string' && scene[field].trim()))) {
    fail('分镜列表包含空对象或非镜头内容，缺少标题、口播或画面描述。', 'LLM_SCENE_INVALID');
  }
  return result;
}
