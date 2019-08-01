import { SAMPLE_FILES_FOLDER, UploadTestScenario } from './utils';
import * as path from 'path';
import { UploadTester } from './test-runner-upload';

export async function runUploadTest (test: UploadTestScenario) {
  const tester = new UploadTester(test);
  try {
    await tester.setup();

    const contentProviders = await tester.getStakedProviders();

    const testFilePath = path.join(SAMPLE_FILES_FOLDER, test.props.contentFileName);

    // TODO pick up provider dynamically or via filterProviders or try all providers:
    for (let j = 0; j < contentProviders.length; j++) {
      const provider = contentProviders[j];
      const isPrimaryLiaison = await tester.isPrimaryLiaison(provider)
      
      if (!isPrimaryLiaison) {
        console.log(`Skip uploading to this storage provider because it's not the primary liaison: ${provider.toString()}`)
        continue
      }

      console.log(`\nUploading a file to provider #${j+1}/${contentProviders.length}`)
      
      console.log({ testFilePath })
      await tester.uploadContent(provider, testFilePath);
    }

    await tester.saveUploadResultsToFile();

  } catch (err) {
    console.log(`❌ Unexpected error while running a tester:`, err);
  }
  tester.destroy();
}
