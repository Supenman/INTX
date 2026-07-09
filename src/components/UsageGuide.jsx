import { Fragment } from 'react';
import { colorVar, fontWeight } from '../styles/tokens';

export default function UsageGuide() {
  return (
    <div style={containerStyle}>
      <Section title="快捷键">
        <Row keys={['Ctrl', 'S']} desc="保存当前项目" />
        <Row keys={['Ctrl', 'Z']} desc="撤销" />
        <Row keys={['Ctrl', 'Y']} desc="重做" />
        <Row keys={['Delete', 'Backspace']} desc="删除选中的节点" />
        <Row keys={['F']} desc="自适应缩放适配画布" />
        <Row keys={['M']} desc="切换小地图显示" />
      </Section>

      <Section title="鼠标操作">
        <Row keys={['左键拖拽']} desc="框选多个节点" />
        <Row keys={['中键拖拽']} desc="平移画布" />
        <Row keys={['滚轮']} desc="垂直滚动画布" />
        <Row keys={['Ctrl', '滚轮']} desc="缩放画布" />
        <Row keys={['双击文本节点']} desc="进入编辑模式" />
      </Section>

      <Section title="节点操作">
        <Row keys={['拖拽连线']} desc="从节点右侧圆点拖出连线连接其他节点" />
        <Row keys={['右键节点']} desc="打开节点菜单（复制/粘贴/禁用等）" />
        <Row keys={['Ctrl+V']} desc="在画布粘贴剪贴板中的文件或文本，自动创建素材节点" />
      </Section>

      <Section title="节点类型">
        <TypeRow label="图片生成" color="var(--signal-image)" desc="根据提示词生成图片" />
        <TypeRow label="文本生成" color="var(--signal-text)" desc="根据提示词生成文本" />
        <TypeRow label="视频生成" color="var(--signal-video)" desc="根据提示词生成视频" />
        <TypeRow label="素材-图片" color="var(--signal-image)" desc="上传或粘贴的图片素材" />
        <TypeRow label="素材-文本" color="var(--signal-source-text)" desc="纯文本素材" />
        <TypeRow label="素材-视频" color="var(--signal-video)" desc="视频素材" />
        <TypeRow label="素材-音频" color="var(--signal-audio)" desc="音频素材" />
        <TypeRow label="素材-Markdown" color="var(--signal-markdown)" desc="Markdown 格式文本素材" />
      </Section>
    </div>
  );
}

function Section({ title, children }) {
  return (
    <div style={sectionStyle}>
      <div style={sectionTitleStyle}>{title}</div>
      <div style={sectionBodyStyle}>{children}</div>
    </div>
  );
}

function Row({ keys, desc }) {
  const keyArr = Array.isArray(keys) ? keys : [keys];
  return (
    <div style={rowStyle}>
      <div style={keysStyle}>
        {keyArr.map((k, i) => (
          <Fragment key={i}>
            {i > 0 && <span style={plusStyle}>+</span>}
            <span style={keyStyle}>
              <span style={keyTextStyle}>{k}</span>
            </span>
          </Fragment>
        ))}
      </div>
      <span style={descStyle}>{desc}</span>
    </div>
  );
}

function TypeRow({ label, color, desc }) {
  return (
    <div style={rowStyle}>
      <div style={typeTagStyle(color)}>{label}</div>
      <span style={descStyle}>{desc}</span>
    </div>
  );
}

const containerStyle = {
  padding: '20px 24px',
  display: 'flex', flexDirection: 'column', gap: 24,
};

const sectionStyle = {
  display: 'flex', flexDirection: 'column', gap: 8,
};

const sectionTitleStyle = {
  fontSize: 12, fontWeight: 800,
  color: colorVar.textSecondary,
  letterSpacing: '0.06em',
  textTransform: 'uppercase',
  paddingBottom: 4,
  borderBottom: `1px solid ${colorVar.border}`,
};

const sectionBodyStyle = {
  display: 'flex', flexDirection: 'column', gap: 6,
};

const rowStyle = {
  display: 'flex', alignItems: 'center', gap: 12,
  padding: '6px 0',
};

const keysStyle = {
  display: 'flex', alignItems: 'center', gap: 4, flexShrink: 0,
  minWidth: 120,
};

const keyStyle = {
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '2px 7px', borderRadius: 5,
  background: colorVar.soft, border: `1px solid ${colorVar.border}`,
  minWidth: 22, height: 22,
};

const keyTextStyle = {
  fontSize: 11, fontWeight: 700, color: colorVar.text,
  lineHeight: 1,
};

const plusStyle = {
  fontSize: 11, color: colorVar.textTertiary, margin: '0 2px',
};

const descStyle = {
  fontSize: 13, fontWeight: 500, color: colorVar.textSecondary,
  lineHeight: 1.4,
};

const typeTagStyle = (color) => ({
  display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
  padding: '2px 9px', borderRadius: 5,
  background: `color-mix(in srgb, ${color} 15%, transparent)`,
  color,
  fontSize: 11, fontWeight: 700, whiteSpace: 'nowrap',
  minWidth: 98,
});
