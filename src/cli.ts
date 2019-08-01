import { runTestFile } from "./run-test-file";
import { arrayToConsoleString, TEST_SCENARIOS_FOLDER } from './utils';
import * as fs from 'fs';
import * as path from 'path';

const program = require('commander');

function commaSeparatedList(value: string) {
  return value.split(',');
}

const opt_list = `list`
const opt_test = `test`
const opt_ranges = `ranges`

const testsText = `<tests> is a comma separated list of test files.`

program
  .version('0.1.0')
  .description('Storage Benchmarking Tool for Joystream Network')
  .option(`-l, --${opt_list}`, `Lookup available test scenario(s).`)
  .option(`-t, --${opt_test} <tests>`, `Run test scenario(s). ${testsText}`, commaSeparatedList)
  .option(`-r, --${opt_ranges}`, `Prepare random ranges with hashes that can be used in download tests.`)
  .parse(process.argv);

if (program[opt_list]) {
  // tslint:disable-next-line:non-literal-fs-path
  const testFileNames = fs.readdirSync(TEST_SCENARIOS_FOLDER).filter(file => {
    const filePath = path.join(TEST_SCENARIOS_FOLDER, file)
    const isJsOrJsonFile = file.endsWith(`.js`) || file.endsWith(`.json`)
    // tslint:disable-next-line:non-literal-fs-path
    return isJsOrJsonFile && fs.statSync(filePath).isFile();
  });
  console.log(`Found ${testFileNames.length} test scenario(s):`)
  console.log(arrayToConsoleString(testFileNames))
  process.exit(0)
}

const testFileNames = program[opt_test] as string[];
if (!testFileNames || testFileNames.length === 0) {
  console.log(`You need to specify at least one test file. See usage with -h or --help option.`);
  process.exit(0);
}

console.log(`Going to run ${testFileNames.length} test file(s):`)
console.log(arrayToConsoleString(testFileNames), '\n')

async function runTestFiles() {
  const filesCount = testFileNames.length
  for (let i = 0; i < filesCount; i++) {
    const testFile = testFileNames[i];
    console.log(`Run a test file #${i+1}/${filesCount}: ${testFile} ...`)
    await runTestFile(testFile, {
      generateRandomRanges: program[opt_ranges]
    })
  }
}

runTestFiles()
