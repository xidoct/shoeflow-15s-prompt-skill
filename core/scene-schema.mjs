const VISUAL_TYPES = new Set([
  'avatar_talk',
  'avatar_holding_product',
  'avatar_wearing_product',
  'product_closeup',
  'feature_demo',
  'lifestyle',
  'cta'
]);

const REFERENCE_STRATEGIES = new Set(['avatar_only', 'product_only', 'avatar_and_product']);
const MAX_SCENES = 60;
const MAX_TEXT = 2_000;

function text(value, fallback = '', maxLength = MAX_TEXT) {
  return String(value ?? fallback).trim().slice(0, maxLength);
}

function optionalText(value, maxLength = MAX_TEXT) {
  return value == null ? '' : text(value, '', maxLength);
}

function duration(value, fallback = 4) {
  const parsed = Number(value);
  return Number.isFinite(parsed) ? Math.min(60, Math.max(2, Math.round(parsed))) : fallback;
}

function list(value, maxLength = 12) {
  return Array.isArray(value) ? value.map(item => text(item, '', 120)).filter(Boolean).slice(0, maxLength) : [];
}

export function normalizeScenes(input) {
  if (!Array.isArray(input) || input.length === 0) throw new Error('没有可用的分镜');
  if (input.length > MAX_SCENES) throw new Error(`分镜数量不能超过 ${MAX_SCENES} 个`);

  const raw = input.map((scene, index) => {
    if (!scene || typeof scene !== 'object') throw new Error(`第 ${index + 1} 个镜头格式无效`);
    const useAvatar = scene.useAvatar !== false;
    const fallbackStrategy = useAvatar ? 'avatar_and_product' : 'product_only';
    const strategy = REFERENCE_STRATEGIES.has(scene.referenceStrategy) ? scene.referenceStrategy : fallbackStrategy;
    const visualType = VISUAL_TYPES.has(scene.visualType) ? scene.visualType : 'product_closeup';
    return {
      title: text(scene.title, `镜头 ${index + 1}`, 120),
      voiceText: text(scene.voiceText ?? scene.text, '', MAX_TEXT),
      duration: duration(scene.duration ?? scene.dur, 4),
      visualType,
      visualPrompt: text(scene.visualPrompt, '', MAX_TEXT),
      background: optionalText(scene.background ?? scene.backgroundPrompt ?? scene.background_prompt, 800),
      backgroundContinuity: optionalText(scene.backgroundContinuity ?? scene.background_continuity, 500),
      subtitle: text(scene.subtitle ?? scene.voiceText ?? scene.text, '', 300),
      camera: text(scene.camera, '', 300),
      transition: text(scene.transition, '', 120),
      transitionIn: optionalText(scene.transitionIn ?? scene.transition_in, 180),
      transitionOut: optionalText(scene.transitionOut ?? scene.transition_out, 180),
      startState: optionalText(scene.startState ?? scene.start_state, 500),
      endState: optionalText(scene.endState ?? scene.end_state, 500),
      continuityFromPrevious: optionalText(scene.continuityFromPrevious ?? scene.continuity_from_previous, 500),
      audioPrompt: optionalText(scene.audioPrompt ?? scene.audio_prompt ?? scene.sound, 500),
      deliveryPrompt: optionalText(scene.deliveryPrompt ?? scene.delivery_prompt ?? scene.speechPrompt, 800),
      referenceStrategy: strategy,
      useAvatar,
      productViews: list(scene.productViews, 8),
      lipSyncRequired: Boolean(scene.lipSyncRequired),
      mustKeep: list(scene.mustKeep, 12)
    };
  });

  let previousBackground = '';
  raw.forEach(scene => {
    const explicitBackground = Boolean(scene.background);
    scene.background = scene.background || previousBackground || '普通有人居住的客厅，身后是沙发和窗帘，旁边有小茶几和少量生活用品，窗外自然光照进室内，像手机随手拍摄的居家带货视频';
    scene.backgroundContinuity = scene.backgroundContinuity || (previousBackground
      ? (explicitBackground && scene.background !== previousBackground
        ? '按口播需要自然换景，通过动作、遮挡或声音完成过渡，同时保持人物、产品和光线衔接'
        : '沿用上一镜头的同一空间、时间和灯光，只改变景别或机位，不主动换景')
      : '建立全片主场景，后续镜头默认沿用此空间、时间和灯光');
    previousBackground = scene.background;
  });

  return raw;
}

export function normalizeStoryboardPayload(payload) {
  return {
    globalStyle: optionalText(payload?.globalStyle ?? payload?.global_style ?? payload?.style, 2_000),
    continuityBible: optionalText(payload?.continuityBible ?? payload?.continuity_bible, 2_000),
    scenes: normalizeScenes(payload?.scenes)
  };
}
