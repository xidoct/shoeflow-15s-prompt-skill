import { normalizeStoryboardPayload } from './scene-schema.mjs';
import { createGenerationPlan } from './generation-plan.mjs';
import { batchScene, buildBatchPrompt } from './generation-prompt.mjs';
import { arkReferences, buildArkPayload } from './ark-seedance.mjs';

export function compile(board, options = {}) {
  const normalized = normalizeStoryboardPayload(board);
  const count = Number(options.productCount ?? 1);
  if (!Number.isInteger(count) || count < 0 || count > 8) throw new Error('商品参考图数量须为 0–8');
  const refs = { avatarImage: options.avatar === false ? '' : 'avatar-placeholder', productImages: Array.from({ length: count }, (_, i) => `product-${i}`) };
  const config = { continuityMode: options.mode === 'first_frame' ? 'first_frame' : 'reference' };
  const plan = createGenerationPlan(normalized.scenes);
  const batches = plan.batches.map((batch, i) => {
    const continuity = { ...normalized, previousLastFrame: i ? 'tail-placeholder' : '' };
    const scene = batchScene(batch);
    const references = arkReferences(scene, refs, config, continuity.previousLastFrame);
    if (references.length > 9) throw new Error(`第 ${i + 1} 组参考图超过 9 张（含尾帧），请减少商品图数量`);
    const payload = buildArkPayload(scene, refs, config, continuity, buildBatchPrompt(batch, continuity));
    return { index: i + 1, duration: batch.duration, startScene: batch.startScene, endScene: batch.endScene,
      references: references.map((ref, n) => ({ number: n + 1, label: ref.label, role: ref.role })),
      prompt: payload.content.filter(item => item.type === 'text').map(item => item.text).join('\n') };
  });
  return { ...normalized, batches };
}
