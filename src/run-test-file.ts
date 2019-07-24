import * as path from 'path';
import { TEST_SCENARIOS_FOLDER, DownloadTestScenario, UploadTestScenario } from './utils';
import { runDownloadTest } from './run-download-test';
import { runUploadTest } from './run-upload-test';

function resolveFullPathOfTestFile(filePath: string): string {
  if (!filePath.endsWith('.js')) {
    filePath += '.js';
  }
  if (filePath.indexOf('/') < 0) {
    filePath = path.join(TEST_SCENARIOS_FOLDER, filePath);
  }
  return filePath;
}

export async function runTestFile(testFilePath: string, scenarioNames?: string[]) {
  testFilePath = resolveFullPathOfTestFile(testFilePath)
  try {
    // tslint:disable-next-line:non-literal-require
    const testScenarios = require(testFilePath);

    if (!scenarioNames || scenarioNames.length === 0) {
      // Get all test scenarios in a test file:
      scenarioNames = Object.keys(testScenarios);
    }

    console.log(`Test scenarios found in ${testFilePath}:`)
    console.log({ scenarioNames })

    for (let i = 0; i < scenarioNames.length; i++) {
      let scenario = testScenarios[scenarioNames[i]];

      if (typeof scenario === 'function') {
        // console.log(`\nCalling a test scenario as a function: ${scenarioName}`);
        scenario = scenario();
      }
      
      if (scenario instanceof DownloadTestScenario) {
        console.log(`\nCalling a download test scenario:`, scenario.props);
        await runDownloadTest(scenario)
      }
      else if (scenario instanceof UploadTestScenario) {
        console.log(`\nCalling an upload test scenario:`, scenario.props);
        await runUploadTest(scenario)
      }
      else {
        console.log(`Unknown type of a test scenario:`, scenario);
      }
    }
  } catch (err) {
    console.log(`Failed to load a test scenario: ${testFilePath}`);
    console.log(err);
  }
}
