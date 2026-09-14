import { ProfileDiscovery } from '@/components/profile-discovery';

export const metadata = {
  title: '找到相近处境｜答案之外',
  description: '按学历、院校类型和当前阶段，查找有原文依据的知乎校园经验。',
};

export default function DiscoverPage() {
  return <ProfileDiscovery />;
}
