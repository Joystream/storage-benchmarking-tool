import * as path from 'path';
import { TEST_SCENARIOS_FOLDER, DownloadTestScenario, UploadTestScenario } from './utils';

export function runTestFile(testFilePath: string, testFunctions?: string[]) {
  if (!testFilePath.endsWith('.js')) {
    testFilePath += '.js';
  }
  if (testFilePath.indexOf('/') < 0) {
    testFilePath = path.join(TEST_SCENARIOS_FOLDER, testFilePath);
  }
  try {
    // tslint:disable-next-line:non-literal-require
    const testGroup = require(testFilePath);

    if (!testFunctions || testFunctions.length === 0) {
      // Get all test functions in a scenarion:
      testFunctions = Object.keys(testGroup);
    }

    console.log(`Test scenarios found in ${testFilePath}:`)
    console.log({ testFunctions })

    testFunctions.forEach(funcName => {
      const test = testGroup[funcName];
      if (typeof test === 'function') {
        console.log(`\nCalling a test function: ${funcName}`);
        test();
      } else if (test instanceof DownloadTestScenario) {
        console.log(`\nCalling a download test scenario:`, test.props);

        // TODO run download test scenarion here!

      } else if (test instanceof UploadTestScenario) {
        console.log(`\nCalling a upload test scenario:`, test.props);

        // TODO run upload test scenarion here!

      } else {
        console.log(`Unknown test type:`, test);
      }
    });
  } catch (err) {
    console.log(`Failed to load a test scenario: ${testFilePath}`);
    console.log(err);
  }
}
