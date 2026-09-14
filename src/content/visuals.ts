/** Original generated art. Selection changes appearance only, never story facts. */
export const VISUAL_VERSION = 'warm-brick-campus-2026-09-13-v3';
export const PORTRAITS = [
  { id: 'portrait-neutral', name: '短发同伴', description: '靛蓝外套，抬手倾听', src: '/art/companion-indigo-v2.png', alt: '身穿靛蓝外套的原创成年同伴，正抬手倾听', position: '50% 18%' },
  { id: 'portrait-curly', name: '卷发同伴', description: '赭黄衬衫，轻松交谈', src: '/art/companion-ochre-v2.png', alt: '身穿赭黄衬衫的原创成年卷发同伴，正专心听你说话', position: '50% 18%' },
  { id: 'portrait-longhair', name: '长发同伴', description: '浅绿开衫，邀请你继续', src: '/art/companion-sage-v2.png', alt: '身穿浅绿开衫的原创成年长发同伴，伸出手示意继续交流', position: '50% 18%' },
  { id: 'portrait-glasses', name: '眼镜同伴', description: '白衬衫，带着一本笔记', src: '/art/companion-ink-v2.png', alt: '戴眼镜的原创成年同伴，穿白衬衫和深蓝针织背心，拿着合上的笔记本', position: '50% 18%' },
  { id: 'portrait-terracotta', name: '暖衫同伴', description: '砖红开衫，静静听你说', src: '/art/companion-terracotta-v3.png', alt: '身穿砖红开衫和燕麦色上衣的原创成年短卷发同伴，正抬手倾听', position: '50% 18%' },
] as const;
export const SCENES = [
  { id: 'scene-courtyard', name: '校园庭院', description: '树荫下，慢慢聊', src: '/art/place-courtyard-v2.png', alt: '傍晚阳光中的校园庭院，石桌和树荫等待同伴坐下交流', position: '50% 55%' },
  { id: 'scene-dorm', name: '宿舍公共区', description: '灯亮起来，再说几句', src: '/art/place-milk-tea-lounge-v3.png', alt: '奶茶色的原创宿舍公共休息区，暖灯照着燕麦色沙发与木桌，窗外是红砖拱廊', position: '50% 48%' },
  { id: 'scene-discussion', name: '社团讨论室', description: '把想法摆到桌上', src: '/art/place-brick-studio-v3.png', alt: '琥珀灯光照亮的原创红砖社团工作室，木桌和空白纸张等待同伴一起讨论', position: '50% 52%' },
  { id: 'scene-panorama', name: '重返校园', description: '沿着熟悉的路走一走', src: '/art/campus-arcade-v3.png', alt: '金色傍晚的原创红砖校园拱廊，右侧三位成年同伴正在自然交谈', position: '50% 50%' },
  { id: 'scene-library-cafe', name: '图书馆窗边', description: '拉把椅子，聊聊想法', src: '/art/place-library-cafe-v3.png', alt: '原创校园图书馆窗边的咖啡学习角，金色阳光落在木桌、书架和素色杯子上', position: '50% 52%' },
] as const;
export type PortraitId = typeof PORTRAITS[number]['id'];
export type SceneId = typeof SCENES[number]['id'];
export const DEFAULT_PORTRAIT_ID: PortraitId = 'portrait-neutral';
export const DEFAULT_SCENE_ID: SceneId = 'scene-discussion';
export function portraitFor(id?: string) { return PORTRAITS.find(portrait => portrait.id === id) ?? PORTRAITS[0]; }
export function sceneFor(id?: string) { return SCENES.find(scene => scene.id === id) ?? SCENES.find(scene => scene.id === DEFAULT_SCENE_ID)!; }
export function isPortraitId(value: unknown): value is PortraitId { return typeof value === 'string' && PORTRAITS.some(portrait => portrait.id === value); }
export function isSceneId(value: unknown): value is SceneId { return typeof value === 'string' && SCENES.some(scene => scene.id === value); }
