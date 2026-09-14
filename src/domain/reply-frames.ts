/** Optional writing scaffolds. Brackets are deliberately not inferred facts. */
export const CUSTOM_REPLY_FRAMES = [
  { label: '回应眼前的问题', text: '关于你刚才问的，我能确认的是【已有事实】；【还不确定的部分】我需要再核对。' },
  { label: '说清自己的需要', text: '我现在遇到的是【具体情况】，我在意【自己的需要】。我想和你商量【一个具体请求】。' },
  { label: '提出下一步', text: '我提议先【一个能做到的小行动】，再用【检查方法】看看结果。你有哪些顾虑？' },
] as const;
