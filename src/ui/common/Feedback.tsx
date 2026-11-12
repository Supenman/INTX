/**
 * 画布级反馈的统一出口。
 *
 * 反馈分三层，各管各的，不互相抢注意力：
 * - toast：短暂的成功/信息确认（复制、粘贴、保存），2.4s 自动消失，
 *   aria-live=polite 让读屏器播报但不打断当前操作。
 * - alert：需要用户处理的错误（连线被拒、生成失败、导入无效），
 *   常驻直到关闭或 5.2s 超时，role=alert 立即播报。
 * - 节点内状态：任务进度/失败/完成，留在节点卡片上（见 CanvasNode），
 *   不升到画布级，避免「一个节点失败整屏弹红条」。
 *
 * 此前 toast 只是工具栏里一个无 aria 的 chip，错误条和它各写各的；
 * 这里把两者的渲染收敛成组件，语义与样式一致，调用方仍只管 flash/showError。
 */

export interface ToastProps {
  message: string | null;
}

/** 短暂确认。挂在工具栏末尾，不占独立浮层。 */
export function Toast({ message }: ToastProps) {
  if (!message) return null;
  return (
    <span className="chip accent toast" role="status" aria-live="polite">
      {message}
    </span>
  );
}

export interface AlertBannerProps {
  message: string | null;
  onClose: () => void;
}

/** 需要处理的错误。底部居中浮层，可手动关闭。 */
export function AlertBanner({ message, onClose }: AlertBannerProps) {
  if (!message) return null;
  return (
    <div className="conn-error" role="alert">
      <span>{message}</span>
      <button onClick={onClose} aria-label="关闭" title="关闭">
        ×
      </button>
    </div>
  );
}
