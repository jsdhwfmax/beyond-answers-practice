import type { Metadata, Viewport } from 'next';
import BackgroundMusic from '@/components/background-music';
import './globals.css';

export const metadata: Metadata = {
  title: '答案之外 · 经验练习场',
  description: '在重要的第一次之前，先练一次。走进校园工作室，用有出处的经验，做出自己的安排。',
  icons: { icon: '/art/project-icon-v6.png', apple: '/art/project-icon-v6.png' },
  robots: { index: false, follow: false },
};
export const viewport: Viewport = { width: 'device-width', initialScale: 1, themeColor: '#183B56' };

export default function RootLayout({ children }: Readonly<{ children: React.ReactNode }>) {
  return <html lang="zh-CN"><body><BackgroundMusic />{children}</body></html>;
}
