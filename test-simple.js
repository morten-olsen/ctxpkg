const Services = require('./src/utils/utils.services.ts');
const ReferencesService = require('./src/references/references.ts');

async function test() {
  try {
    const services = new Services();
    const refService = services.get(ReferencesService);
    console.log('Testing with correct collection path...');
    await refService.updateDocument({
      collection: '/Users/alice/Projects/zeronorth/shorts/tmp-recalculate-vessel-reports',
      id: 'test.md',
      content: '# Test\n\nThis is a test document.'
    });
    console.log('Test completed successfully');
    await services.destroy();
  } catch (error) {
    console.error('Error details:', error.message);
    await services.destroy();
  }
  }
}

test();