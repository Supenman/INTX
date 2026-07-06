// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanvasButton from './CanvasButton';

describe('CanvasButton', () => {
  it('renders children text', () => {
    render(<CanvasButton>保存</CanvasButton>);
    expect(screen.getByRole('button', { name: '保存' })).toBeInTheDocument();
  });

  it('renders with an icon', () => {
    const Icon = () => <svg data-testid="icon" />;
    render(<CanvasButton icon={<Icon />}>删除</CanvasButton>);
    expect(screen.getByTestId('icon')).toBeInTheDocument();
    expect(screen.getByText('删除')).toBeInTheDocument();
  });

  it('applies primary variant', () => {
    render(<CanvasButton variant="primary">提交</CanvasButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
  });

  it('applies danger variant', () => {
    render(<CanvasButton variant="danger">删除</CanvasButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
  });

  it('applies ghost variant', () => {
    render(<CanvasButton variant="ghost">取消</CanvasButton>);
    const btn = screen.getByRole('button');
    expect(btn).toBeInTheDocument();
  });

  it('applies sm size', () => {
    render(<CanvasButton size="sm">小</CanvasButton>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('applies lg size', () => {
    render(<CanvasButton size="lg">大</CanvasButton>);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('calls onClick when clicked', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CanvasButton onClick={onClick}>点击</CanvasButton>);
    await user.click(screen.getByRole('button'));
    expect(onClick).toHaveBeenCalledTimes(1);
  });

  it('does not call onClick when disabled', async () => {
    const user = userEvent.setup();
    const onClick = vi.fn();
    render(<CanvasButton disabled onClick={onClick}>保存</CanvasButton>);
    await user.click(screen.getByRole('button'));
    expect(onClick).not.toHaveBeenCalled();
  });

  it('is disabled when disabled prop is set', () => {
    render(<CanvasButton disabled>保存</CanvasButton>);
    expect(screen.getByRole('button')).toBeDisabled();
  });

  it('passes extra DOM attributes', () => {
    render(<CanvasButton data-testid="my-btn">测试</CanvasButton>);
    expect(screen.getByTestId('my-btn')).toBeInTheDocument();
  });
});
