import { Tester } from "./test-runner";
import { SAMPLE_FILES_FOLDER } from './utils';
import * as path from 'path';

const SMALL_FILE_NAME = 'audio.mp3'
const BIG_FILE_NAME = 'staked.mp3'

const UPLOAD_FILE_NAME = SMALL_FILE_NAME

async function runUploadTestScenario () {
  const tester = new Tester({});
  try {
    await tester.setup();

    const contentProviders = await tester.getStakedProviders();

    // This file is taken from: https://testnet.joystream.org/acropolis/pioneer/#/media/play/5FRqaXTmXJsZRKxmvcRSrCGvYgua5rtirc9dybWC6ijxieF9
    const testFilePath = path.join(SAMPLE_FILES_FOLDER, UPLOAD_FILE_NAME);

    // TODO pick up provider dynamically or via filterProviders or try all providers:
    for (let j = 0; j < contentProviders.length; j++) {
      const provider = contentProviders[j];
      
      console.log(`\nUploading a file to provider #${j+1}/${contentProviders.length}`)
      
      console.log({ testFilePath })
      await tester.uploadContent(provider, testFilePath);
    }

    // const resultsFolder = path.join(process.cwd(), `benchmark/results`);
    // await tester.saveResultsToFile(resultsFolder, `upload`);

  } catch (err) {
    console.log(`❌ Unexpected error while running a tester:`, err);
  }
  tester.destroy();
}

runUploadTestScenario();
