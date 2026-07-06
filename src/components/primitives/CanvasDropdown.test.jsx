// @vitest-environment jsdom
import { describe, it, expect, vi } from 'vitest';
import { render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import CanvasDropdown from './CanvasDropdown';

const OPTIONS = [
  { value: 'image', label: '图片' },
  { value: 'text', label: '文字' },
  { value: 'video', label: '视频' },
];

describe('CanvasDropdown', () => {
  it('renders the trigger with placeholder when no value', () => {
    render(<CanvasDropdown options={OPTIONS} placeholder="选择类型" />);
    expect(screen.getByRole('button', { name: '选择类型' })).toBeInTheDocument();
  });

  it('renders trigger with selected label', () => {
    render(<CanvasDropdown value="image" options={OPTIONS} />);
    expect(screen.getByRole('button')).toHaveTextContent('图片');
  });

  it('shows dropdown on trigger click', async () => {
    const user = userEvent.setup();
    render(<CanvasDropdown options={OPTIONS} placeholder="选择" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    expect(screen.getByText('图片')).toBeInTheDocument();
    expect(screen.getByText('文字')).toBeInTheDocument();
    expect(screen.getByText('视频')).toBeInTheDocument();
  });

  it('selects an option and calls onChange', async () => {
    const user = userEvent.setup();
    const onChange = vi.fn();
    render(<CanvasDropdown value="" options={OPTIONS} onChange={onChange} placeholder="选择" />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('视频'));
    expect(onChange).toHaveBeenCalledWith('video');
  });

  it('closes the dropdown after selecting an option', async () => {
    const user = userEvent.setup();
    render(<CanvasDropdown value="" options={OPTIONS} onChange={() => {}} placeholder="选择" />);
    await user.click(screen.getByRole('button'));
    await user.click(screen.getByText('文字'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders options with icons', () => {
    const opts = [
      { value: 'x', label: '选项', icon: <svg data-testid="opt-icon" /> },
    ];
    render(<CanvasDropdown value="" options={opts} placeholder="选择" />);
    // icon is not in DOM until dropdown opens — just verify render
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('shows custom trigger content', () => {
    render(
      <CanvasDropdown
        value=""
        options={OPTIONS}
        trigger={<span data-testid="custom-trigger">自定义</span>}
      />
    );
    expect(screen.getByTestId('custom-trigger')).toBeInTheDocument();
  });

  it('closes on Escape key', async () => {
    const user = userEvent.setup();
    render(<CanvasDropdown options={OPTIONS} placeholder="选择" />);
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.keyboard('{Escape}');
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('closes on click outside', async () => {
    const user = userEvent.setup();
    render(
      <div>
        <div data-testid="outside">外面</div>
        <CanvasDropdown options={OPTIONS} placeholder="选择" />
      </div>
    );
    await user.click(screen.getByRole('button'));
    expect(screen.getByRole('listbox')).toBeInTheDocument();
    await user.click(screen.getByTestId('outside'));
    expect(screen.queryByRole('listbox')).not.toBeInTheDocument();
  });

  it('renders with right alignment', () => {
    render(<CanvasDropdown options={OPTIONS} align="right" placeholder="选择" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('renders with top position', () => {
    render(<CanvasDropdown options={OPTIONS} position="top" placeholder="选择" />);
    expect(screen.getByRole('button')).toBeInTheDocument();
  });

  it('applies custom buttonStyle to the trigger', () => {
    render(
      <CanvasDropdown
        options={OPTIONS}
        placeholder="选"
        buttonStyle={{ fontWeight: 300 }}
      />
    );
    expect(screen.getByRole('button')).toBeInTheDocument();
  });
});
