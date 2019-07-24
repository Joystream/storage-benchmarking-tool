import * as path from 'path';
import { ContentId } from '@joystream/types/lib/media';
import * as fs from 'fs';

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

type FilterContentIdsFn = () => ContentId[]

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
  filter?: ContentId[] | FilterContentIdsFn,
  // target: ...
  // personae: ...
  maxDownloadTimePerByte?: number
}

export type UploadTestScenarioProps = TestScenarioProps & {
  contentFileName: string
  // TODO finish...
}

export type DownloadResultType = {
  contentId: string,
  contentName: string,
  storageProviderId: string,
  assetUrl: string,
  startTime: number,
  endTime: number,
  // avgSpeed: number, can be calculated
  contentSize: number,
  downloadedSize: number,
  error?: string
}

export type UploadResultType = {
  // TODO finish...
}

abstract class TestScenario<TestProps extends TestScenarioProps> {
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

// Extract to other file:
// ---------------------------------------------------------

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

// ---------------------------------------------------------

const rootDir = process.cwd();

export const pathFromRoot = (subPath: string): string => {
  return path.join(rootDir, subPath);
}

export const ACCOUNTS_FOLDER = pathFromRoot(`benchmark/accounts`);
export const RESULTS_FOLDER = pathFromRoot(`benchmark/results`);
export const SAMPLE_FILES_FOLDER = pathFromRoot(`benchmark/sample-files`);
export const TEST_SCENARIOS_FOLDER = pathFromRoot(`build/src/storage-tests`);

// ---------------------------------------------------------

export function arrayToConsoleString(array: any[]) {
  return array.map((item, i) => 
  `  ${i+1}) ${item ? item.toString() : 'undefined'}`).join('\n')
}
