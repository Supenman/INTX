import { forwardRef } from 'react';
import { space, radius, fontSize, colorVar, motion } from '../../styles/tokens';

const wrapperBase = {
  display: 'flex',
  alignItems: 'center',
  padding: space.xs,
  border: `1px solid ${colorVar.border}`,
  borderRadius: radius.md + 3,
  background: colorVar.panel,
  transition: motion.fast,
};

const controlBase = {
  width: '100%',
  padding: `0 ${space.md + 2}px`,
  border: 'none',
  background: 'transparent',
  color: colorVar.text,
  outline: 'none',
  fontSize: fontSize.lg,
  fontWeight: 650,
  fontFamily: 'inherit',
};

const TEXTAREA_BASE = {
  ...controlBase,
  minHeight: 100,
  maxHeight: 140,
  resize: 'vertical',
  lineHeight: 1.55,
  padding: `${space.md}px ${space.md + 2}px`,
  fontSize: fontSize.md,
};

const SELECT_BASE = {
  ...controlBase,
  appearance: 'none',
  cursor: 'pointer',
};

const TextInput = forwardRef(function TextInput({ type = 'text', style, ...rest }, ref) {
  return (
    <input
      ref={ref}
      type={type}
      style={{ ...controlBase, height: 34, ...style }}
      {...rest}
    />
  );
});

const TextareaInput = forwardRef(function TextareaInput({ style, ...rest }, ref) {
  return (
    <textarea
      ref={ref}
      style={{ ...TEXTAREA_BASE, ...style }}
      {...rest}
    />
  );
});

const SelectInput = forwardRef(function SelectInput({ children, style, ...rest }, ref) {
  return (
    <select
      ref={ref}
      style={{ ...SELECT_BASE, height: 34, ...style }}
      {...rest}
    >
      {children}
    </select>
  );
});

function Frame({ children, onFocusCapture, onBlurCapture, style, multiline }) {
  return (
    <div
      style={{ ...wrapperBase, ...(multiline ? { alignItems: 'stretch' } : {}), ...style }}
      onFocus={onFocusCapture}
      onBlur={onBlurCapture}
    >
      {children}
    </div>
  );
}

export default function CanvasInput(props) {
  const { multiline, options, type, ...rest } = props;

  if (options) {
    return (
      <Frame>
        <SelectInput {...rest}>
          {options.map((opt) => (
            <option key={String(opt.value)} value={opt.value}>
              {opt.label}
            </option>
          ))}
        </SelectInput>
      </Frame>
    );
  }

  if (multiline) {
    return (
      <Frame multiline onFocusCapture={(e) => (e.currentTarget.style.borderColor = colorVar.textSecondary)} onBlurCapture={(e) => (e.currentTarget.style.borderColor = colorVar.border)}>
        <TextareaInput {...rest} />
      </Frame>
    );
  }

  return (
    <Frame onFocusCapture={(e) => (e.currentTarget.style.borderColor = colorVar.textSecondary)} onBlurCapture={(e) => (e.currentTarget.style.borderColor = colorVar.border)}>
      <TextInput type={type} {...rest} />
    </Frame>
  );
}