import { createWorker, type Env } from './worker.ts';

export { createWorker } from './worker.ts';
export type { Env } from './worker.ts';

export default createWorker() satisfies ExportedHandler<Env>;
