// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanvasInput from './CanvasInput';

describe('CanvasInput', () => {
  it('renders a text input by default', () => {
    render(<CanvasInput placeholder="输入名称" />);
    const input = screen.getByPlaceholderText('输入名称');
    expect(input.tagName).toBe('INPUT');
    expect(input).toHaveAttribute('type', 'text');
  });

  it('renders a password input', () => {
    render(<CanvasInput type="password" placeholder="API Key" />);
    expect(screen.getByPlaceholderText('API Key')).toHaveAttribute('type', 'password');
  });

  it('displays the current value', () => {
    render(<CanvasInput value="hello" onChange={() => {}} />);
    expect(screen.getByDisplayValue('hello')).toBeInTheDocument();
  });

  it('calls onChange with the new value', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CanvasInput value="" onChange={onChange} placeholder="输入" />);
    const input = screen.getByPlaceholderText('输入');
    await user.type(input, 'a');
    expect(onChange).toHaveBeenCalled();
  });

  it('renders a select element when options are provided', () => {
    const opts = [
      { value: 'a', label: '选项 A' },
      { value: 'b', label: '选项 B' },
    ];
    render(<CanvasInput type="select" value="a" onChange={() => {}} options={opts} />);
    const select = screen.getByRole('combobox');
    expect(select).toBeInTheDocument();
    expect(screen.getByText('选项 A')).toBeInTheDocument();
    expect(screen.getByText('选项 B')).toBeInTheDocument();
  });

  it('renders a textarea when multiline is true', () => {
    render(<CanvasInput multiline placeholder="多行" />);
    const el = screen.getByPlaceholderText('多行');
    expect(el.tagName).toBe('TEXTAREA');
  });

  it('can be disabled', () => {
    render(<CanvasInput disabled placeholder="禁用" />);
    expect(screen.getByPlaceholderText('禁用')).toBeDisabled();
  });

  it('passes extra DOM attributes', () => {
    render(<CanvasInput data-testid="my-input" placeholder="test" />);
    expect(screen.getByTestId('my-input')).toBeInTheDocument();
  });
});
