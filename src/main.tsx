import { createRoot } from 'react-dom/client';
import { registerNode, builtinNodes, installBuiltinTools } from '@/domain';
import { Canvas } from '@/ui/canvas/Canvas';
import './styles/app.css';

// 注册内置节点类型。任何新类型（含未来的插件）都走同一条路径。
for (const def of builtinNodes) {
  registerNode(def);
}

// 注册内置工具。必须同步：异步会让首帧渲染时注册表还是空的。
installBuiltinTools();

createRoot(document.getElementById('root')!).render(<Canvas />);
