// Standalone edition: every request group has a fixed 15-second ceiling.
export const MAX_BATCH_SECONDS = 15;
export function generationLimits() { return { maxDuration: 15, minDuration: 4 }; }

function referenceStrategy(shots) {
  const strategies = shots.map(({ scene }) => scene.referenceStrategy || (scene.useAvatar === false ? 'product_only' : 'avatar_and_product'));
  const avatar = strategies.some(strategy => strategy !== 'product_only');
  const product = strategies.some(strategy => strategy !== 'avatar_only');
  return avatar && product ? 'avatar_and_product' : avatar ? 'avatar_only' : 'product_only';
}

export function createGenerationPlan(scenes, config = {}) {
  const { maxDuration, minDuration } = generationLimits(config);
  if (!Array.isArray(scenes)) throw new Error('分镜列表格式无效');
  const batches = [];
  let shots = [], seconds = 0;
  function finishBatch() {
    if (!shots.length) return;
    batches.push({
      index: batches.length + 1, startScene: shots[0].number, endScene: shots.at(-1).number,
      shots, contentDuration: seconds, duration: Math.max(minDuration, seconds),
      holdSeconds: Math.max(0, minDuration - seconds), referenceStrategy: referenceStrategy(shots)
    });
    shots = []; seconds = 0;
  }
  scenes.forEach((scene, index) => {
    const duration = Number(scene?.duration);
    if (!Number.isInteger(duration) || duration <= 0) throw new Error(`第 ${index + 1} 个分镜时长须为正整数秒`);
    if (duration > maxDuration) throw new Error(`第 ${index + 1} 个分镜为 ${duration} 秒，超过当前单次调用上限 ${maxDuration} 秒，请先拆分该分镜；不会截短口播`);
    if (seconds + duration > maxDuration) finishBatch();
    shots.push({ scene, number: index + 1, start: seconds, end: seconds + duration });
    seconds += duration;
  });
  finishBatch();
  return { maxDuration, minDuration, batches, totalDuration: batches.reduce((sum, batch) => sum + batch.duration, 0) };
}
