export function batchScene(batch) {
  const first = batch.shots[0].scene, last = batch.shots.at(-1).scene;
  return {
    ...first, duration: batch.duration, referenceStrategy: batch.referenceStrategy,
    voiceText: batch.shots.map(({ scene }) => scene.voiceText || '').join(''),
    startState: first.startState, endState: last.endState, transitionOut: last.transitionOut,
    camera: '', audioPrompt: '',
    lipSyncRequired: batch.shots.some(({ scene }) => scene.lipSyncRequired),
    productViews: [...new Set(batch.shots.flatMap(({ scene }) => scene.productViews || []))]
  };
}

export function buildBatchPrompt(batch, continuity = {}) {
  const last = batch.shots.at(-1).scene;
  return [
    `一次生成 ${batch.duration} 秒视频，按下面的时间顺序完成 ${batch.shots.length} 个分镜。时间码从本次视频 0 秒起算，是镜头节奏指导；在同一视频内部完成镜头切换，不把每个分镜当作单独视频。`,
    continuity.globalStyle && `统一风格：${continuity.globalStyle}`,
    continuity.continuityBible && `连续性规则：${continuity.continuityBible}`,
    continuity.previousLastFrame && '本次开场以上一次调用生成视频的真实尾帧为准，再按首个分镜的进入衔接过渡到目标画面。不要重演上一批已完成的动作或对白。尾帧仅提供静态画面，不代表已观察到运动速度或声音。',
    '只生成本批列出的分镜和对白，不提前生成后续批次。各段对白按对应时间段逐字说出一次，不增删、不重复，不为赶时间强行加速；保持同一说话人的声音特征。',
    '真人口播按日常带货处理：眼神、轻微面部变化和手中商品动作随当前话意自然发生；每镜只保留一条有目的、能完成的简短动作链，不机械重复动作，不强制三连动作，不表演与文案无关的夸张情绪。口型同步时保持稳定中近景，避免大幅转头、遮嘴和快速运镜。',
    ...batch.shots.map(({ scene, number, start, end }, index) => [
      `【${start}–${end} 秒｜分镜 ${number}｜${scene.title || '镜头'}】`,
      scene.visualPrompt,
      scene.background && `环境：${scene.background}`,
      scene.backgroundContinuity && `环境衔接：${scene.backgroundContinuity}`,
      (index > 0 || !continuity.previousLastFrame) && scene.startState && `计划开场：${scene.startState}`,
      scene.continuityFromPrevious && `承接：${scene.continuityFromPrevious}`,
      scene.transitionIn && `进入：${scene.transitionIn}`,
      scene.camera && `运镜：${scene.camera}`,
      scene.endState && `动作结束在：${scene.endState}`,
      scene.transitionOut && `离开：${scene.transitionOut}`,
      scene.mustKeep?.length && `保持：${scene.mustKeep.join('、')}`,
      `参考用途：${scene.referenceStrategy === 'avatar_only' ? '人物为主' : scene.referenceStrategy === 'product_only' ? '商品为主，不新增出镜说话人' : '人物与商品'}。`,
      scene.voiceText && `对白："${scene.voiceText}"。${scene.lipSyncRequired ? '可见说话人口型同步' : '作为画外口播，不新增出镜说话人'}。`,
      scene.deliveryPrompt && `口播表演：${scene.deliveryPrompt}`,
      scene.audioPrompt && `声音：${scene.audioPrompt}`
    ].filter(Boolean).join('\n')),
    batch.holdSeconds && `最后 ${batch.holdSeconds} 秒保持最后一个分镜结束画面，不增加动作、卖点或对白（满足接口最短时长）。`,
    last.endState && `本批结束目标：${last.endState}`,
    '批内按所列分镜自然剪辑，不在每个分镜结尾停顿等候。整批末尾保留清晰的人物、商品与空间供下一次调用衔接，不黑场、不淡出。'
  ].filter(Boolean).join('\n\n');
}
