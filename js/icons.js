// ============= Lucide 图标局部初始化 =============
export function initIcons(root = document) {
  if (!window.lucide || !window.lucide.createIcons) return;
  const nodes = root.querySelectorAll ? root.querySelectorAll('[data-lucide]') : [];
  if (nodes.length) window.lucide.createIcons({ nodes: [...nodes] });
}
