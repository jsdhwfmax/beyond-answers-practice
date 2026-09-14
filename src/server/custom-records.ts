import type { CustomPracticeView } from '@/domain/custom-practice';

export interface CustomRecord {
  owner: string; view: CustomPracticeView; creationHash: string;
  actions: Record<string, { hash: string; status: 'processing' | 'done' | 'failed'; attempt: string; until: number }>;
}
export interface CustomStore {
  create(record: CustomRecord): Promise<void>;
  read(owner: string, id: string): Promise<CustomRecord>;
  list(owner: string): Promise<CustomRecord[]>;
  update<T>(owner: string, id: string, mutation: (record: CustomRecord) => T): Promise<T>;
  remove(owner: string, id: string): Promise<void>;
  cleanup(now: number): Promise<number>;
}
