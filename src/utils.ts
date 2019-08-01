import * as path from 'path';
import * as fs from 'fs';
import * as numeral from 'numeral';
import { ContentId } from '@joystream/types/lib/media';

export type RpcEndpoint = string;

export const RpcEndpoints = {
  testnet:  `wss://testnet.joystream.org/acropolis/rpc/`,
  reckless: `wss://staging-reckless.joystream.org/reckless/rpc/`,
  lts:      `wss://staging-lts.joystream.org/staging/rpc/`
}

/**
 * @param name: Name of the test.
 * @param description Human readable description of test.
 * @param dependencies Vector of scenario IDs which this scenario depend upon. May be empty.
 * @param sentryNodes Whether to use a specific sentry node, identified with a sentry node ID, or any random node.
 * @param requestPipelineWidth How many simultaneous outstanding requests to target per active sentry node.
 * @param maxResolutionTime The maximum number of seconds it can take to resolve a host from a key before it is considered down.
 * @param pauseTime Minimum pause time (in seconds) between download requests, both failure and success.
 */
export type TestScenarioProps = {
  chainRpc: RpcEndpoint,
  name: string,
  description?: string,
  dependencies?: TestScenarioProps[]
  // sentryNodes: ...,
  requestPipelineWidth?: number,
  maxResolutionTime?: number,
  pauseTime?: number
}

/**
 * filter: A regular expression which will be used to filter the set of objects, 
 *   by data object ID, to download.
 * 
 * target: Is one among the following, with the corresponding semantics
 *   - Nothing: Download all (filtered) data objects from all groups.
 *   - A storage/distributor group ID: Download all (filtered) data objects 
 *       from all members in the given groups.
 *   - A storage/distributor group membership ID: Download all (filtered) data objects 
 *       can either be nothing, a specific storage group ID, or a specific storage membership ID.
 *   - Nothing is interpreted as downloading from every group.
 * 
 * personae: The personae type and personae ID to use when connecting. 
 *   Obviously, when connecting to a storage provider, a consumer personae is not valid.
 * 
 * maxDownloadTimePerByte: This value, times the byte size of the data object, 
 *   is the maximum number of seconds a download can remain in progress 
 *   before it is deemed a failure.
 */
export type DownloadTestScenarioProps = TestScenarioProps & {
  contentIds?: string[],
  generateRandomRanges?: boolean,
  useRandomRanges?: boolean, // Should this test use random ranges?
  maxRandomRanges?: number, // How many random ranges to use for downoload?
  // target: ...
  // personae: ...
  maxDownloadTimePerByte?: number
}

export type UploadTestScenarioProps = TestScenarioProps & {
  contentFileName: string,
  uploaderAccountId: string
  // TODO finish...
}

export type TestResultType = {
  storageProviderId: string,
  contentId: string,
  assetUrl: string,
  startTime: number,
  endTime: number,
  fileSize: number,
  error?: string
}

export type DownloadResultType = TestResultType & {
  contentName: string,
  downloadedSize: number,
  randomRanges?: RandomRange[]
}

export type UploadResultType = TestResultType & {
  filePath: string,
  uploadedSize: number,
}

export abstract class TestScenario<TestProps extends TestScenarioProps> {
  props: TestProps;
  constructor (props: TestProps) {
    this.props = props;
  }
}

export class DownloadTestScenario extends TestScenario<DownloadTestScenarioProps> {
  constructor (props: DownloadTestScenarioProps) {
    super(props);
  }
}

export class UploadTestScenario extends TestScenario<UploadTestScenarioProps> {
  constructor (props: UploadTestScenarioProps) {
    super(props);
  }
}

// ---------------------------------------------------
// File System Utils

import * as moment from 'moment'
import { Url } from '@joystream/types/lib/discovery'

/**
 * Currently there is only one data object type that we use in Joystream network.
 */
export const HARDCODED_DO_TYPE = 1;

/**
 * The maximum size of a file that can be uploaded to any Joystream storage provider.
 */
export const MAX_FILE_SIZE_IN_BYTES = 100 * 1024 ** 2; // 100 MB

/**
 * Returns a void if a file can be uploaded.
 * Returns a string with an error if a file cannot be uploaded.
 * 
 * @param filePath Path to a file that should be uploaded
 */
export function canUploadFile (filePath: fs.PathLike): string | void {

  // tslint:disable-next-line:non-literal-fs-path
  const fileStats = fs.statSync(filePath)

  if (!fileStats.isFile) {
    return `This is not a file`
  }

  if (fileStats.size === 0) {
    return `File is empty`
  }

  if (fileStats.size > MAX_FILE_SIZE_IN_BYTES) {
    return `File exceeds the max upload size (${fileStats.size} > ${MAX_FILE_SIZE_IN_BYTES} bytes)`
  }
}

const rootDir = process.cwd();

const pathFromRoot = (subPath: string): string => {
  return path.join(rootDir, subPath);
}

const pathFromDataDir = (...subPaths: string[]): string => {
  return path.join(pathFromRoot(`data`), ...subPaths);
}

export const TEST_SCENARIOS_FOLDER = pathFromRoot(`build/src/storage-tests`);
export const ACCOUNTS_FOLDER = pathFromDataDir(`accounts`);
export const RANDOM_RANGES_FOLDER = pathFromDataDir(`random-ranges`);
export const TEST_RESULTS_FOLDER = pathFromDataDir(`test-results`);
export const SAMPLE_FILES_FOLDER = pathFromDataDir(`sample-files`);

/**
 * This function creates all non existent directories on file system recursively.
 */
export async function resolveFilePath(folderPath: string, fileName: string): Promise<string> {
  // tslint:disable-next-line:non-literal-fs-path
  const exists = fs.existsSync(folderPath);
  if (!exists) {
    await promisify(fs.mkdir)(folderPath, { recursive: true });
  }
  return path.join(folderPath, fileName);
}

export async function resolveTestResultsFilePath(testName: string): Promise<string> {
  const currDateTime = moment().format(`YYYY-MM-DD_HH:mm`)
  const fileName = `${testName}_${currDateTime}.js`
  return await resolveFilePath(TEST_RESULTS_FOLDER, fileName)
}

export async function resolveRandomRangesFilePath(contentId: ContentId): Promise<string> {
  const assetName = contentId.encode()
  const fileName = `${assetName}.csv`
  return await resolveFilePath(RANDOM_RANGES_FOLDER, fileName)
}

// ---------------------------------------------------
// Uncategorized utils

export function arrayToConsoleString(array: any[]) {
  return array.map((item, i) => 
  `  ${i+1}) ${item ? item.toString() : 'undefined'}`).join('\n')
}

export function formatNumber(n: number) {
  return numeral(n).format('0,0');
}

/**
 * Returns a string Url with last `/` removed.
 */
export function normalizeUrl(url: string | Url) : string {
  let st = new String(url)
  if (st.endsWith('/')) {
    return st.substring(0, st.length - 1);
  }
  return st.toString()
}

// ---------------------------------------------------
// Random ranges

const crypto = require('crypto')
import { promisify } from 'util';

export function base64Hash (data: any): string {
  return crypto.createHash('md5').update(data).digest('base64')
}

export type RandomRange = {
  startIdx: number
  endIdx: number
  base64Hash: string
}

const parseRangeString = (str: string): RandomRange => {
  const [ startStr, endStr, base64Hash] = str.split(';')
  return {
    startIdx: parseInt(startStr),
    endIdx: parseInt(endStr),
    base64Hash
  }
}

export async function getRandomRangesFromCsvFile (contentId: ContentId | string, maxRangesCount: number): Promise<RandomRange[]> {

  const assetName = typeof contentId === 'string' ? contentId : contentId.encode()

  const rangesFilePath = path.join(RANDOM_RANGES_FOLDER, assetName + '.csv')
  const rangesStrs = (await promisify(fs.readFile)(rangesFilePath, 'utf8')).split('\n')

  if (maxRangesCount >= rangesStrs.length) {
    return rangesStrs.map(parseRangeString)
  }

  const randomRanges: RandomRange[] = []
  const uniqRandomIdxs = new Set<number>()

  while (uniqRandomIdxs.size < maxRangesCount) {
    // tslint:disable-next-line:insecure-random
    const randomIdx = Math.floor(Math.random() * rangesStrs.length)
    if (!uniqRandomIdxs.has(randomIdx)) {
      uniqRandomIdxs.add(randomIdx)
      const randomRangeStr = rangesStrs[randomIdx]
      randomRanges.push(parseRangeString(randomRangeStr))
    }
  }

  return randomRanges
}