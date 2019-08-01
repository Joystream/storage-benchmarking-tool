import { ContentId } from "@joystream/types/lib/media";
import { DownloadTestScenario, getRandomRangesFromCsvFile } from "./utils";
import { DownloadTester } from './test-runner-download';

export async function runDownloadTest (test: DownloadTestScenario) {
  const tester = new DownloadTester(test);
  try {
    await tester.setup();

    let contentIds: ContentId[]
    const contentIdStrs = test.props.contentIds

    if (contentIdStrs && contentIdStrs.length) {
      contentIds = contentIdStrs.map(ContentId.decode)
      console.log(`Going to download ${contentIds.length} file(s)`)
    } else {
      console.log(`No content ids provided in a test scenario. Downloading all known files`)
      contentIds = await tester.getKnownContentIds()
    }

    for (let i = 0; i < contentIds.length; i++) {
      const cid = contentIds[i];
      const contentProviders = await tester.findReadyContentProviders(cid);
      
      // TODO Generate random ranges only on single provider that has requested content.

      // TODO pick up provider dynamically or via filterProviders or try all providers:
      for (let j = 0; j < contentProviders.length; j++) {
        const provider = contentProviders[j];
        
        console.log(`\nDownloading content #${i+1}/${contentIds.length} from provider #${j+1}/${contentProviders.length}`)

        await tester.downloadContent(provider, cid);
      }
    }

    await tester.saveDownloadResultsToFile();

  } catch (err) {
    console.log(`❌ Unexpected error while running a tester:`, err);
  }
  tester.destroy();
}
