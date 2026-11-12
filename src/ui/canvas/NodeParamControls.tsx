import type { SelectOption } from '@/domain';

/**
 * 节点卡片上的参数编辑控件。
 *
 * select 参数以前在卡片上只是只读展示，改参数只能删节点重建。
 * 这里用原生 select/input 而不是分段控件：aspectRatio 有 5 个选项，
 * 280px 的卡片里做分段必挤；原生控件暗色可样式化，键盘与 e2e 也最稳。
 *
 * 所有控件必须带 nodrag 并阻止事件冒泡：不然点击会拖动节点、
 * Delete 会删掉节点而不是编辑文本。
 */

export interface ParamSelectProps {
  label: string;
  value: string;
  options: readonly SelectOption[];
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function ParamSelect({ label, value, options, disabled, onChange }: ParamSelectProps) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <select
        className="node-param-select nodrag"
        value={value}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      >
        {options.map((o) => (
          <option key={o.value} value={o.value}>
            {o.label}
          </option>
        ))}
      </select>
    </label>
  );
}

export interface ParamTextInputProps {
  label: string;
  value: string;
  placeholder?: string;
  disabled?: boolean;
  onChange: (value: string) => void;
}

export function ParamTextInput({ label, value, placeholder, disabled, onChange }: ParamTextInputProps) {
  return (
    <label className="node-field">
      <span>{label}</span>
      <input
        className="node-param-input nodrag"
        value={value}
        placeholder={placeholder}
        disabled={disabled}
        aria-label={label}
        onChange={(e) => onChange(e.target.value)}
        onClick={(e) => e.stopPropagation()}
        onKeyDown={(e) => e.stopPropagation()}
      />
    </label>
  );
}
