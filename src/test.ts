import { ReferencesService } from './references/references.ts';
import { Services } from './utils/utils.services.ts';

const services = new Services();
const refService = services.get(ReferencesService);
console.log(
  await refService.search({
    query: 'How do I add a new bunker type?',
    limit: 5,
  }),
);
await services.destroy();
