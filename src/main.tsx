import { createRoot } from 'react-dom/client';
import { registerNode, builtinNodes } from '@/domain';
import { Canvas } from '@/ui/canvas/Canvas';
import './styles/app.css';

// 注册内置节点类型。任何新类型（含未来的插件）都走同一条路径。
for (const def of builtinNodes) {
  registerNode(def);
}

createRoot(document.getElementById('root')!).render(<Canvas />);
