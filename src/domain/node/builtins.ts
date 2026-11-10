import type { NodeDefinition } from '../node/definition';

/**
 * v0.1 内置节点定义。
 *
 * 刻意只做四种，把地基验证扎实：
 * - text-input   文字输入（产 text）
 * - asset        素材（产 image/video/audio/text，由导入的资产决定）
 * - generate     生成（吃 prompt + 参考素材，产 image/video/text）
 * - storyboard   分镜宫格（一段分镜文本 → 多张分格图，一篇 N 格）
 *
 * 注意 generate 的输入口 `reference` 是 multiple 的，
 * 因为多参考图是这类工具的刚需；而 `prompt` 只接一路。
 */

export const textInputNode: NodeDefinition = {
  kind: 'text-input',
  title: '文字输入',
  category: 'source',
  inputPorts: [],
  outputPorts: [
    { id: 'text', label: '文本', accepts: ['text'], multiple: true, required: false },
  ],
  params: [
    {
      kind: 'text',
      id: 'content',
      label: '内容',
      placeholder: '写点什么，或从别的节点接入文本…',
      multiline: true,
      defaultValue: '',
    },
  ],
};

export const assetNode: NodeDefinition = {
  kind: 'asset',
  title: '素材',
  category: 'source',
  inputPorts: [],
  outputPorts: [
    {
      id: 'out',
      label: '素材',
      accepts: ['image', 'video', 'audio', 'text'],
      multiple: true,
      required: false,
    },
  ],
  params: [
    {
      kind: 'text',
      id: 'caption',
      label: '备注',
      placeholder: '可选，给自己看的说明',
      defaultValue: '',
    },
  ],
};

export const generateNode: NodeDefinition = {
  kind: 'generate',
  title: '生成',
  category: 'generate',
  inputPorts: [
    { id: 'prompt', label: '提示词', accepts: ['text'], multiple: false, required: true },
    {
      id: 'reference',
      label: '参考素材',
      accepts: ['image', 'video'],
      multiple: true,
      required: false,
    },
  ],
  outputPorts: [
    {
      id: 'out',
      label: '结果',
      accepts: ['image', 'video', 'text'],
      multiple: false,
      required: false,
    },
  ],
  params: [
    { kind: 'text', id: 'prompt', label: '直接输入提示词', placeholder: '描述你想要的画面', multiline: true, defaultValue: '' },
    {
      kind: 'select',
      id: 'outputKind',
      label: '产出类型',
      options: [
        { value: 'image', label: '图片' },
        { value: 'video', label: '视频' },
        { value: 'text', label: '文字' },
      ],
      defaultValue: 'image',
    },
    {
      kind: 'select',
      id: 'aspectRatio',
      label: '宽高比',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '16:9', label: '16:9' },
        { value: '9:16', label: '9:16' },
        { value: '4:3', label: '4:3' },
        { value: '3:4', label: '3:4' },
      ],
      defaultValue: '1:1',
    },
  ],
};

export const storyboardNode: NodeDefinition = {
  kind: 'storyboard',
  title: '分镜宫格',
  category: 'generate',
  inputPorts: [
    { id: 'script', label: '分镜文本', accepts: ['text'], multiple: false, required: true },
    {
      id: 'reference',
      label: '角色参考',
      accepts: ['image'],
      multiple: true,
      required: false,
    },
  ],
  outputPorts: [
    {
      id: 'out',
      label: '分格',
      accepts: ['image'],
      multiple: true,
      required: false,
    },
  ],
  params: [
    {
      kind: 'select',
      id: 'grid',
      label: '宫格',
      options: [
        { value: '2x2', label: '4 宫格' },
        { value: '3x3', label: '9 宫格' },
        { value: '4x4', label: '16 宫格' },
        { value: '1x4', label: '条漫 4 格' },
      ],
      defaultValue: '2x2',
    },
    {
      kind: 'select',
      id: 'aspectRatio',
      label: '单格比例',
      options: [
        { value: '1:1', label: '1:1' },
        { value: '3:4', label: '3:4' },
        { value: '9:16', label: '9:16' },
        { value: '16:9', label: '16:9' },
      ],
      defaultValue: '1:1',
    },
    {
      kind: 'text',
      id: 'style',
      label: '画风',
      placeholder: '可选，例如「赛璐璐动画，浅色背景」',
      defaultValue: '',
    },
  ],
};

export const builtinNodes: readonly NodeDefinition[] = [
  textInputNode,
  assetNode,
  generateNode,
  storyboardNode,
];
