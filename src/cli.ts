import { runTestFile } from "./run-test-file";
import { arrayToConsoleString } from './utils';

const program = require('commander');

function commaSeparatedList(value: string) {
  return value.split(',');
}

const testsText = `<tests> is a comma separated list of test files.`

program
  .version('0.1.0')
  .description('Storage Benchmarking Tool for Joystream Network')
  .option('-t, --test <tests>', `Run test scenario(s). ${testsText}`, commaSeparatedList)
  .parse(process.argv);

const testFileNames = program.test as string[];
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
    await runTestFile(testFile)
  }
}

runTestFiles()
