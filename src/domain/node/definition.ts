import type { PortSpec, PortType } from './port';

/**
 * NodeDefinition —— 节点类型定义。
 *
 * 这是对旧项目 `docs/CONTEXT.md` 里「类型集合冻结为 image / text / video，
 * 不预留插件接口」那条约定的正式推翻。现在不做插件市场，
 * 但机制上不能把扩展性焊死：新增节点类型 = 新增一个 definition 并注册。
 */

/** 参数值只允许可序列化的基本类型，避免塞函数进项目文件。 */
export type ParamValue = string | number | boolean | null;

export interface SelectOption {
  value: string;
  label: string;
}

/**
 * 参数描述。故意做得保守——只覆盖抽屉表单真正需要的控件，
 * 而不是引入一套 JSON Schema 实现。后续需要更复杂控件时再加 discriminant。
 */
export type ParamSpec =
  | {
      kind: 'text';
      id: string;
      label: string;
      placeholder?: string;
      multiline?: boolean;
      defaultValue: string;
    }
  | {
      kind: 'number';
      id: string;
      label: string;
      min?: number;
      max?: number;
      step?: number;
      defaultValue: number;
    }
  | {
      kind: 'boolean';
      id: string;
      label: string;
      defaultValue: boolean;
    }
  | {
      kind: 'select';
      id: string;
      label: string;
      options: readonly SelectOption[];
      defaultValue: string;
    };

export interface NodeDefinition {
  /** 稳定标识，写进项目文件，不允许随意改名 */
  kind: string;
  title: string;
  /** 侧栏/右键菜单的分组，用于组织节点列表 */
  category: 'source' | 'generate' | 'utility';
  inputPorts: readonly PortSpec[];
  outputPorts: readonly PortSpec[];
  params: readonly ParamSpec[];
}

/** 参数默认值表，创建节点时用于填充初始 params。 */
export function defaultParams(def: NodeDefinition): Record<string, ParamValue> {
  const out: Record<string, ParamValue> = {};
  for (const p of def.params) {
    out[p.id] = p.defaultValue;
  }
  return out;
}

export function getParamSpec(def: NodeDefinition, id: string): ParamSpec | undefined {
  return def.params.find((p) => p.id === id);
}

/** 节点产出的数据类型：取第一个输出口的第一个接受类型，忽略 'any'。 */
export function outputType(def: NodeDefinition): PortType {
  const port = def.outputPorts[0];
  if (!port) return 'any';
  const t = port.accepts.find((x) => x !== 'any');
  return t ?? 'any';
}

export function findPort(ports: readonly PortSpec[], id: string): PortSpec | undefined {
  return ports.find((p) => p.id === id);
}
