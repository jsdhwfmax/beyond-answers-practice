import { PracticeApp } from '@/components/practice-app';
import { CAMPUS_CORPUS } from '@/content/campus-corpus';

export default async function Home({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const params = await searchParams;
  const initialMode = params.mode === 'custom' ? 'custom' : typeof params.session === 'string' ? 'session' : params.view === 'demo' ? 'demo' : params.view === 'home' ? 'home' : 'launch';
  const categories = [...new Set(CAMPUS_CORPUS.map(question => question.category))];
  const launchQuestions = categories.flatMap(category => {
    const matching = CAMPUS_CORPUS.filter(question => question.category === category && question.title.length <= 65);
    const campusSpecific = matching.filter(question => /大学|校园|同学|导师|室友|宿舍|社团|实习|选课|迷茫/.test(question.title));
    return (campusSpecific.length >= 2 ? campusSpecific : matching).slice(0, 2);
  })
    .map(question => ({ id: question.id, title: question.title, url: question.questionUrl, category: question.category }));
  return <PracticeApp initialMode={initialMode} launchQuestions={launchQuestions} />;
}
