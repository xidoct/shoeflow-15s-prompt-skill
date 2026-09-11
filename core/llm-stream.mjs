import { LlmResponseError, llmTransportError, parseLlmResponse, redactLlmError } from './llm-response.mjs';

// Decode UTF-8 and SSE lines across arbitrary network boundaries, including CRLF.
async function* events(body, stats) {
  const reader = body.getReader();
  const decoder = new TextDecoder('utf-8', { fatal: true });
  let line = '';
  let skipLf = false;
  let data = [];
  let type = '';
  function* lines(text) {
    for (const char of text) {
      if (skipLf) { skipLf = false; if (char === '\n') continue; }
      if (char !== '\r' && char !== '\n') { line += char; continue; }
      skipLf = char === '\r';
      if (!line) {
        const event = data.length ? { type: type || 'message', data: data.join('\n') } : null;
        data = []; type = '';
        if (event) yield event;
      } else if (!line.startsWith(':')) {
        const separator = line.indexOf(':');
        const field = separator < 0 ? line : line.slice(0, separator);
        let value = separator < 0 ? '' : line.slice(separator + 1);
        if (value.startsWith(' ')) value = value.slice(1);
        if (field === 'data') data.push(value);
        if (field === 'event') type = value;
      }
      line = '';
    }
  }
  try {
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      stats.receivedBytes += value.byteLength;
      let text;
      try { text = decoder.decode(value, { stream: true }); }
      catch { throw new LlmResponseError('流式响应包含无效的 UTF-8 数据，未将损坏内容当作分镜。', 'LLM_STREAM_INVALID_EVENT', stats); }
      yield* lines(text);
    }
    try { yield* lines(decoder.decode()); }
    catch (error) {
      if (error instanceof LlmResponseError) throw error;
      throw new LlmResponseError('流式响应结束时字符数据不完整，未将损坏内容当作分镜。', 'LLM_STREAM_INCOMPLETE', stats);
    }
    // SSE requires a blank line to dispatch an event; do not accept a partial final event.
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
}

async function readChatStream(response, meta) {
  const started = performance.now();
  const stats = {
    httpStatus: response.status, responseFormat: 'chat-completions-stream', contentType: 'event-stream',
    receivedBytes: 0, eventCount: 0, contentChars: 0, hasReasoning: false,
    finishReason: 'unknown', streamDone: false, localDeadline: 'none', automaticRetry: false
  };
  const fail = (message, code) => { throw new LlmResponseError(message, code, stats); };
  if (!response.body) fail('接口没有返回可读取的流式正文。', 'LLM_STREAM_INCOMPLETE');
  const parts = [];
  let finishReason = null;
  try {
    for await (const event of events(response.body, stats)) {
      stats.eventCount++;
      if (event.data.trim() === '[DONE]' && event.type !== 'error') { stats.streamDone = true; break; }
      if (['ping', 'heartbeat', 'keepalive'].includes(event.type)) continue;
      let payload;
      try { payload = JSON.parse(event.data); }
      catch {
        if (event.type === 'error') fail('流式服务返回错误：' + redactLlmError(event.data, meta.key), 'LLM_STREAM_PROVIDER_ERROR');
        fail('流式响应包含无法解析的数据块，本次分镜未完成。', 'LLM_STREAM_INVALID_EVENT');
      }
      const upstreamError = payload?.error || payload?.data?.error;
      if (event.type === 'error' || upstreamError || payload?.success === false) {
        const detail = redactLlmError(typeof upstreamError === 'string' ? upstreamError : upstreamError?.message || payload?.message, meta.key);
        fail('流式服务返回错误' + (detail ? '：' + detail : '，本次分镜未完成。'), 'LLM_STREAM_PROVIDER_ERROR');
      }
      const choices = payload?.choices || payload?.data?.choices;
      if (!Array.isArray(choices)) fail('流式数据不符合 Chat Completions 格式，缺少 choices。', 'LLM_STREAM_SCHEMA');
      if (!choices.length) continue; // Optional final usage chunk.
      const choice = choices.find(item => item?.index === 0) || (choices.length === 1 && choices[0]?.index == null ? choices[0] : null);
      if (!choice) continue; // Never concatenate another candidate into the selected completion.
      const delta = choice.delta;
      if (!delta || typeof delta !== 'object' || Array.isArray(delta)) fail('流式数据缺少有效的 delta 增量内容。', 'LLM_STREAM_SCHEMA');
      if (['stop', 'length', 'content_filter', 'tool_calls', 'function_call'].includes(choice.finish_reason)) stats.finishReason = choice.finish_reason;
      stats.hasReasoning ||= Boolean(delta.reasoning_content || delta.reasoning);
      if (choice.finish_reason === 'length') fail('模型输出达到长度上限，流式分镜尚未完整生成。', 'LLM_OUTPUT_TRUNCATED');
      if (choice.finish_reason === 'content_filter' || delta.refusal) fail('模型未返回完整分镜，流式响应包含拒绝或内容过滤标记。', 'LLM_REFUSAL');
      if (delta.tool_calls?.length || delta.function_call || ['tool_calls', 'function_call'].includes(choice.finish_reason)) fail('模型返回了工具调用而非完整分镜正文。', 'LLM_STREAM_UNEXPECTED_TOOL');
      let content = delta.content;
      if (Array.isArray(content) && content.every(part => typeof part?.text === 'string')) content = content.map(part => part.text).join('');
      if (content != null && typeof content !== 'string') fail('流式正文片段不是文本，无法拼接分镜。', 'LLM_STREAM_INVALID_EVENT');
      if (content) {
        if (finishReason) fail('流式响应在完成标记之后继续输出正文，未采用不确定的结果。', 'LLM_STREAM_INVALID_EVENT');
        parts.push(content);
        stats.contentChars += content.length;
      }
      if (choice.finish_reason != null) {
        if (choice.finish_reason !== 'stop') fail('流式响应没有正常完成标记，本次分镜未完成。', 'LLM_STREAM_INCOMPLETE');
        finishReason = 'stop';
        stats.finishReason = 'stop';
      }
    }
  } catch (error) {
    if (error instanceof LlmResponseError) throw error;
    throw llmTransportError(error, { ...stats, stage: 'reading_response_stream', responseReceived: true, elapsedMs: Math.round(performance.now() - started) });
  }
  if (!stats.streamDone || finishReason !== 'stop') fail('流式连接结束，但未收到完整的结束标记，可能中途断流。本次未采用部分分镜，也未自动重试。', 'LLM_STREAM_INCOMPLETE');
  try {
    // Reuse the exact same complete-storyboard validation; never expose reasoning text.
    return parseLlmResponse(JSON.stringify({ choices: [{ finish_reason: finishReason, message: { content: parts.join(''), reasoning_content: stats.hasReasoning } }] }), meta);
  } catch (error) {
    if (error instanceof LlmResponseError) {
      delete error.diagnostics.responseChars; // Synthetic envelope length is not an upstream measurement.
      error.diagnostics = { ...error.diagnostics, ...stats };
    }
    throw error;
  }
}

export async function readLlmStoryboardResponse(response, { key } = {}) {
  const meta = { status: response.status, contentType: response.headers.get('content-type') || '', key };
  if (response.status < 400 && meta.contentType.split(';')[0].trim().toLowerCase() === 'text/event-stream') {
    return readChatStream(response, meta);
  }
  // Some compatible providers ignore stream:true. Consume their existing JSON response,
  // without sending a second request; retain HTML/HTTP error handling unchanged.
  return parseLlmResponse(await response.text(), meta);
}
