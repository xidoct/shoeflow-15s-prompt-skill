export const ARK_ENDPOINT = 'https://ark.cn-beijing.volces.com/api/v3/contents/generations/tasks';
export const ARK_MODEL = 'doubao-seedance-2-0-260128';

const arkLimits = () => ({ maxDuration: 15, maxImages: 9 });


export function arkEndpoint(endpoint = ARK_ENDPOINT) {
  const url = new URL(endpoint || ARK_ENDPOINT);
  const pathname = url.pathname.replace(/\/+$/, '');
  if (!pathname || pathname === '/api/v3') url.pathname = '/api/v3/contents/generations/tasks';
  else url.pathname = pathname;
  return url.toString();
}

export function arkReferences(scene, refs, config, previousLastFrame = '') {
  if (previousLastFrame && config.continuityMode === 'first_frame') {
    return [{ url: previousLastFrame, label: '上一次调用视频的真实尾帧（本批首帧）', role: 'first_frame' }];
  }
  const strategy = scene.referenceStrategy || (scene.useAvatar ? 'avatar_and_product' : 'product_only');
  return [
    previousLastFrame && { url: previousLastFrame, label: '上一次调用视频的真实尾帧，仅引导本批开场姿态、构图、空间和光线' },
    strategy !== 'product_only' && refs.avatarImage && { url: refs.avatarImage, label: '原始人物参考，约束身份、发型和服装' },
    ...(strategy === 'avatar_only' ? [] : (refs.productImages || []).map(url => ({ url, label: '原始商品参考，约束鞋型、配色、材质和 Logo' })))
  ].filter(Boolean).map(item => ({ ...item, role: 'reference_image' }));
}

// Validate the whole sequence before the first paid request, including the reserved tail slot.
export function validateArkBatches(batches, refs, config) {
  const { maxDuration, maxImages } = arkLimits(config);
  for (const [index, batch] of batches.entries()) {
    if (!Number.isInteger(batch.duration) || batch.duration < 4 || batch.duration > maxDuration) {
      throw new Error(`方舟第 ${index + 1} 批时长须为 4–${maxDuration} 秒；不会自动截短对白`);
    }
    const images = arkReferences(batch, refs, config, index ? 'reserved-last-frame' : '');
    if (images.length > maxImages) {
      throw new Error(`方舟第 ${index + 1} 批共 ${images.length} 张参考图（含尾帧），上限 ${maxImages} 张；请减少商品图片，或切换严格首帧衔接`);
    }
  }
}

export function buildArkPayload(scene, refs, config, continuity, prompt) {
  const references = arkReferences(scene, refs, config, continuity.previousLastFrame);
  const strict = references[0]?.role === 'first_frame';
  const referencePrompt = references.map((item, index) => `图片${index + 1}：${item.label}。`).join('\n');
  const opening = continuity.previousLastFrame
    ? (strict
      ? '从所提供的首帧进入本批第一个分镜，随后按本批时间线切换镜头；保持可见人物与商品外观。本次不附加其他参考图片。'
      : '图片1是上次调用实际生成视频的尾帧，只引导本批第一个分镜的开场，后续按时间线切换镜头；其余参考图约束人物或商品外观，不把尾帧外观误差当成新的设计。')
    : '按下列参考图的各自用途建立人物与商品外观。';
  return {
    model: config.model || ARK_MODEL,
    content: [
      { type: 'text', text: [references.length && referencePrompt, references.length && opening, prompt, scene.camera && `运镜：${scene.camera}`, scene.audioPrompt || '自然中文口播、清晰近距离人声，环境声压低。'].filter(Boolean).join('\n') },
      ...references.map(item => ({ type: 'image_url', image_url: { url: item.url }, role: item.role }))
    ],
    ratio: strict ? 'adaptive' : (config.ratio || '9:16'),
    duration: scene.duration,
    generate_audio: true,
    return_last_frame: true
  };
}
