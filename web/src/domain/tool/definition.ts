/**
 * 声明式工具注册表 —— 类型契约（v0.2 / P1）。
 *
 * 设计来源：BeefTV 把「按钮什么时候出现、什么时候灰掉、点了干什么」全部
 * 数据化，UI 只做解析与渲染。INTX 照这个判断走，但砍掉两个包袱：
 *
 * 1. 这里不存放 ReactNode / 图标 / 回调函数。domain 必须能在 node 环境里
 *    直接单测，也不能把 UI 动作函数塞进可序列化的项目文件。
 *    工具用 `action` 字符串标识意图，由 UI 层统一 dispatch。
 * 2. 字段收敛到实际用得上的 8 个，不做 `expands` / `prominent` / 分组函数
 *    这类通用产品才需要的可配置项。
 */

export type ToolbarId = 'main' | 'selection' | 'node-hover' | 'add-node-menu' | 'node-context-menu' | 'canvas-context-menu';

export type ToolCategory = 'navigation' | 'edit' | 'layout' | 'selection' | 'node' | 'danger';

export type ToolMode = 'select' | 'hand';

/** 添加菜单的分组，直接对应节点注册表的 category。 */
export type MenuSection = 'source' | 'generate' | 'utility' | 'canvas';

export interface ToolNodeContext {
  kind: string;
  category: 'source' | 'generate' | 'utility';
  hasAsset: boolean;
  busy: boolean;
}

/**
 * 一次解析的上下文。刻意做成纯数据：所有字段都能从 store 快照直接读出来，
 * 解析函数因此是可单测的纯函数，组件不需要为了算「按钮该不该出现」而重渲染。
 */
export interface ToolContext {
  toolMode: ToolMode;
  selectedCount: number;
  nodeCount: number;
  clipboardCount: number;
  canUndo: boolean;
  canRedo: boolean;
  demoMode: boolean;
  /** 节点悬浮工具栏专用；其余工具栏传 null。 */
  node: ToolNodeContext | null;
  /** 右键菜单命中的节点 id；空白处右键为 null。多选右键时指向被点的那个。 */
  contextNodeId?: string | null;
  /** 右键命中的节点是否已锁定；决定菜单显示「锁定」还是「解锁」。 */
  nodeLocked?: boolean;
  /** 右键菜单：命中节点是视频且有画面时，才给「截帧 / 提取音频」入口。 */
  canCaptureVideoFrame?: boolean;
  canExtractAudio?: boolean;
  /** 右键菜单：当前选区能否合并成组 / 拆掉命中的组。 */
  canGroup?: boolean;
  canUngroup?: boolean;
}

export interface ToolSwitchOption {
  id: string;
  label: string;
  value: string;
}

export interface ToolDefinition {
  id: string;
  toolbar: ToolbarId;
  /** 相邻工具 category 不同时，解析管线自动插一条分隔线。 */
  category: ToolCategory;
  label: string;
  /** i18n key；有值时 UI 优先用它翻译，label 只作兜底。 */
  labelKey?: string;
  /** 完整提示语，进 title 属性；label 保持短，能塞进悬浮栏。 */
  hint: string;
  defaultVisible: boolean;
  defaultOrder: number;
  danger?: boolean;
  /** 意图标识，UI 层把它映射成实际动作。 */
  action: string;
  payload?: Readonly<Record<string, string>>;
  /** 添加菜单专用分组。 */
  section?: MenuSection;
  /** 同一个工具在两种模式间切换（如区域选择 / 抓手），UI 渲染成一组按钮。 */
  switchOptions?: readonly ToolSwitchOption[];
  switchValue?: (ctx: ToolContext) => string;
  applicable?: (ctx: ToolContext) => boolean;
  disabled?: (ctx: ToolContext) => boolean;
  active?: (ctx: ToolContext) => boolean;
  /** 菜单类工具：label 里的 {n} 替换成选中数量（「删除 3 个节点」）。 */
  countLabel?: boolean;
}

export interface ToolbarPrefs {
  version: 1;
  /** 用户拖出来的顺序；未列出的新工具按 defaultOrder 补进去。 */
  order: readonly string[];
  hidden: readonly string[];
}

export type ToolEntry =
  | { kind: 'tool'; tool: ToolDefinition; disabled: boolean; active: boolean }
  | { kind: 'separator'; id: string };

/** 添加菜单条目：文案与顺序统一取自节点注册表，未完成的动作显式给禁用理由。 */
export interface AddNodeCommand {
  id: string;
  label: string;
  /** i18n key；有值时 UI 优先用它翻译，label 兜底。 */
  labelKey?: string;
  section: MenuSection;
  defaultOrder: number;
  action: string;
  payload?: Readonly<Record<string, string>>;
  disabledReason: string | null;
  /**
   * 单键快捷键（大写字母）。只在画布获得焦点、且没有输入框聚焦时生效。
   * 由节点注册表声明，添加菜单和快捷键处理读同一份来源，避免菜单里加了节点、
   * 快捷键却没跟上。
   */
  shortcut?: string;
}

/** 空白处右键菜单条目。与节点右键菜单同构，但不依赖命中节点。 */
export interface CanvasContextCommand {
  id: string;
  label: string;
  labelKey?: string;
  action: string;
  danger: boolean;
  disabled: boolean;
  category: ToolCategory;
}
