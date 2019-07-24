import axios from 'axios';
import * as numeral from 'numeral';
import { parse as parseUrl } from 'url';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import * as cliProgress from 'cli-progress';
import chalk from 'chalk';
import { Writable } from 'stream';
import * as moment from 'moment';
import { Keyring } from '@polkadot/keyring';
import { KeyringPair$Json } from '@polkadot/keyring/types';

import { RpcEndpoints, canUploadFile, DownloadResultType, HARDCODED_DO_TYPE, ACCOUNTS_FOLDER, arrayToConsoleString } from './utils';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Option, Vector } from '@polkadot/types/codec';
import { registerJoystreamTypes } from '@joystream/types';
import { Url } from '@joystream/types/lib/discovery';
import { DataObjectStorageRelationshipId, DataObjectStorageRelationship, ContentId, DataObject, ContentMetadata } from '@joystream/types/lib/media';
import { AccountId } from '@polkadot/types';
import { CodecResult, SubscriptionResult } from '@polkadot/api/promise/types';
import { SubmittableExtrinsic } from '@polkadot/api/SubmittableExtrinsic';
// tslint:disable-next-line:import-name
import * as IpfsHash from 'ipfs-only-hash';

// create new progress bar with custom token "speed"
const consoleBar = new cliProgress.Bar({
  format: `Progress ${chalk.green('[{bar}]')} {percentage}% | ETA: {eta}s | ${chalk.bold('{value}')}/{total} bytes | Speed: {speed} MB/sec`,
  barCompleteChar: '◼'
}, cliProgress.Presets.rect);

function formatNumber(n: number) {
  return numeral(n).format('0,0');
}
// return string Url with last `/` removed
function normalizeUrl(url: string | Url) : string {
  let st = new String(url)
  if (st.endsWith('/')) {
    return st.substring(0, st.length - 1);
  }
  return st.toString()
}

type ServiceInfoEntry = {
  version: number,
  endpoint: string
}

type ServiceInfo = {
  asset: ServiceInfoEntry,
  discover: ServiceInfoEntry,
}

type TesterProps = {
  // api: ApiPromise
}

export class Tester {

  private api: ApiPromise;
  private bootstrapNodes: Url[];
  private downloadResults: DownloadResultType[] = [];

  constructor () {
    // stub
  }

  private dataObjectQuery = () => {
    return this.api.query.dataObjectStorageRegistry;
  }

  setup = async (): Promise<Tester> => {
    await this.connectToApi();
    await this.findBootstrapNodes();
    return this;
  }

  private connectToApi = async () => {
    const rpcEndpoint = RpcEndpoints.reckless;
    const provider = new WsProvider(rpcEndpoint);

    // Register types before creating the API:
    registerJoystreamTypes();

    // Create the API and wait until ready:
    console.log(`Connecting to Substrate API: ${rpcEndpoint}`)
    this.api = await ApiPromise.create(provider);

    // Retrieve the chain & node information information via rpc calls
    const system = this.api.rpc.system;
    const [ chain, nodeName, nodeVersion ] = await Promise.all(
      [ system.chain(), system.name(), system.version() ]);

    console.log(`Connected to chain '${chain}' (${nodeName} v${nodeVersion})`)
  }

  private findBootstrapNodes = async () => {
    this.bootstrapNodes = await this.api.query.discovery.bootstrapEndpoints() as unknown as Url[];

    const bootstrapNodesAsString = arrayToConsoleString(this.bootstrapNodes)
    console.log(`Storage bootstrap nodes:\n${bootstrapNodesAsString}\n`);
  }

  getPrimaryLiaison = async (): Promise<AccountId | undefined> => {
    const primaryLiaison = await this.api.query.dataDirectory.primaryLiaisonAccountId() as unknown as Option<AccountId>;

    return primaryLiaison && primaryLiaison.isSome
      ? primaryLiaison.unwrap()
      : undefined
  }

  getStakedProviders = async (): Promise<AccountId[]> => {
    return await this.api.query.actors.actorAccountIds() as unknown as AccountId[];
  }

  findReadyContentProviders = async (contentId: ContentId): Promise<AccountId[]> => {
    const relIds = await this.dataObjectQuery().relationshipsByContentId(contentId) as unknown as 
      DataObjectStorageRelationshipId[];

    const allRelationships = await Promise.all(relIds.map(id =>
      this.dataObjectQuery().relationships(id))
    ) as unknown as Option<DataObjectStorageRelationship>[];

    const readyProviders = allRelationships
      .map(r => r.isSome ? r.unwrap().storage_provider : undefined)
      .filter(r => r !== undefined);

    // Filter out providers no longer in actors list
    const stakedActors = await this.getStakedProviders();

    const stillActiveProviders = _.intersectionBy(stakedActors, readyProviders, provider => provider.toString());
    const providersAsString = arrayToConsoleString(stillActiveProviders);
    console.log(`Found ${stillActiveProviders.length} providers ready to serve content with id ${contentId.encode()}:\n${providersAsString}`);

    return stillActiveProviders;
  }

  getKnownContentIds = async () => {
    return await this.api.query.dataDirectory.knownContentIds() as unknown as Vector<ContentId>;
  }

  private discoverServiceInfo = async (bootstrapNode: Url, storageProvider: AccountId): Promise<ServiceInfo | undefined> => {

    const discoveryBaseUrl = normalizeUrl(bootstrapNode);
  
    // Check if discovery URL is valid:
    try {
      parseUrl(discoveryBaseUrl);
    } catch (err) {
      console.log(`Invalid URL of discovery node: ${discoveryBaseUrl}`);
      return undefined;
    }

    const serviceInfoUrl = `${discoveryBaseUrl}/discover/v0/${storageProvider.toString()}`;

    console.log(`Resolving a storage provider ${storageProvider.toString()} using ${discoveryBaseUrl} ...`);

    const serviceInfoJson = await axios.get(serviceInfoUrl) as any;

    if (!serviceInfoJson) {
      console.log(`Could not get a service info from this discovery node: ${discoveryBaseUrl}`);
      return undefined;
    }

    // TODO cast to type: 
    const serviceInfo = JSON.parse(serviceInfoJson.data.serialized)

    console.log({ serviceInfo });
    
    return serviceInfo;
  }

  resolveAssetEndpoint = async (storageProvider: AccountId, contentId: ContentId): Promise<string | undefined> => {
    for (let i = 0; i < this.bootstrapNodes.length; i++) {
      const discoverNode = this.bootstrapNodes[i];
      const serviceInfo = await this.discoverServiceInfo(discoverNode, storageProvider);
      if (!serviceInfo) continue;

      const assetBaseUrl = normalizeUrl(serviceInfo.asset.endpoint);
      const assetName = contentId.encode();
      return `${assetBaseUrl}/asset/v0/${assetName}`;
    }
    return undefined;
  }

  findDataObject = async (contentId: ContentId) => {
    const dataObjectOpt = await this.api.query.dataDirectory.dataObjectByContentId(contentId) as Option<DataObject>;
    return dataObjectOpt.unwrapOr<DataObject>(undefined);
  }

  // tslint:disable-next-line:max-func-body-length
  downloadContent = async (storageProviderId: AccountId, contentId: ContentId) => {
    
    const cid = contentId.encode();
    const assetUrl = await this.resolveAssetEndpoint(storageProviderId, contentId);
    const metadataOpt = await this.api.query.dataDirectory.metadataByContentId(contentId) as Option<ContentMetadata>;

    const dataObject = await this.findDataObject(contentId)
    if (!dataObject) {
      console.log(`❌ Data object was not found by content id: ${cid}`);
      return;
    }

    const metadata: ContentMetadata = metadataOpt.unwrapOr(undefined);
    if (!metadata) {
      console.log(`❌ Content metadata was not found by content id: ${cid}`);
      return;
    }
    const metaJson = metadata.parseJson();

    const contentFromUrlStr = `content from URL ${assetUrl}`;
    console.log(`Downloading ${contentFromUrlStr}`);

    const expectedSize = dataObject.size_in_bytes.toNumber();
    consoleBar.start(expectedSize, 0, { speed: "N/A" });

    const startTime = Date.now();

    const result: DownloadResultType = {
      contentId: contentId.encode(),
      contentName: metaJson.name,
      storageProviderId: storageProviderId.toString(),
      assetUrl,
      startTime,
      endTime: startTime, // this is a temporary until the test is finished or interrapted
      contentSize: expectedSize,
      downloadedSize: 0,
      error: undefined
    };
    this.downloadResults.push(result);

    const passedMillis = () => {
      const passed = Date.now() - startTime;
      return {
        asNumber: passed,
        asString: formatNumber(passed)
      };
    }

    const response = await axios.get(assetUrl, {
      // responseType: 'blob', // important
      responseType: "stream"
    }).catch(err => {
      const passed = passedMillis().asString;
      console.log(`❌ Failed to request ${contentFromUrlStr} after ${passed} millis`, err);
    });

    if (!response) {
      const error = `Received an empty response from assent endpoint`;
      result.endTime = Date.now();
      result.error = error;
      console.log(`❌ ${error}`);
      return;
    }

    // Update a console progress bar every X MB (in bytes):
    const updateEvery_X_MB = 1;
    const one_MB_in_bytes = 1024 ** 2;
    const updateEveryXBytes = updateEvery_X_MB * one_MB_in_bytes;

    let consumedSinceLastUpdate = 0;
    let consumedBytes = 0;

    const calcSpeedInMbPerSec = () => {
      const mbConsumed = consumedBytes / updateEveryXBytes;
      const secsPassed = passedMillis().asNumber / 1000;
      return mbConsumed / secsPassed;
    }

    const updateProgressBar = () => {
      const speed = numeral(calcSpeedInMbPerSec()).format('0.00');
      consoleBar.update(consumedBytes, { speed });
    }

    const consumeContent = new Promise((resolve, _reject) => {
      try {
        const stream = new Writable({
          write (chunk: any, _encoding: string, callback: (error?: Error | null) => void) {
            const chunkSize = chunk && chunk.length ? chunk.length : 0;
            consumedBytes += chunkSize;
            consumedSinceLastUpdate += chunkSize;
            if (consumedSinceLastUpdate >= updateEveryXBytes) {
              consumedSinceLastUpdate = 0;
              updateProgressBar();
            }
            callback();
          }
        });
        stream.on('finish', () => {
          updateProgressBar();
          resolve();
        })
        response.data.pipe(stream);
      } catch (err) {
        const passed = passedMillis().asString;
        result.endTime = Date.now();
        result.downloadedSize = consumedBytes;
        result.error = `Failed to consume a full content due to an error: ${err}`;
        
        consoleBar.stop();
        console.log(`❌ Failed to consume a full content. Consumed ${formatNumber(consumedBytes)} bytes. Passed ${passed} millis.`, err);
        resolve();
      }
    });
    
    await consumeContent;
    
    const passed = passedMillis().asString;
    result.endTime = Date.now();
    result.downloadedSize = consumedBytes;

    consoleBar.stop();
    console.log(`✅ Content downloaded! Consumed ${formatNumber(consumedBytes)} bytes in ${passed} millis`);
  }

  saveDownloadResultsToFile = async (folderPath: string, testName: string) => {
    // tslint:disable-next-line:non-literal-fs-path
    const exists = fs.existsSync(folderPath);
    if (!exists) {
      await promisify(fs.mkdir)(folderPath, { recursive: true });
    }
    const currDateTime = moment().format(`YYYY-MM-DD_HH:mm`);
    const fullPath = path.join(folderPath, `${testName}_${currDateTime}.js`);
    const { downloadResults } = this;
    const resultsJson = JSON.stringify(downloadResults, null, 2);
    const fileContent = `window.JOY_BENCHMARK_DOWNLOAD_RESULTS = ${resultsJson};`
    await promisify(fs.writeFile)(fullPath, fileContent);
    console.log(`Saved download results to file: ${fullPath}`);
  }

  createDataObject = async (contentId: ContentId, filePath: fs.PathLike) => {
    // tslint:disable-next-line:non-literal-fs-path
    const fileStats = fs.statSync(filePath)
    const fileSize = fileStats.size
    
    // tslint:disable-next-line:non-literal-fs-path
    const fileStream = fs.createReadStream(filePath);
    const ipfsCid = await IpfsHash.of(fileStream);
    console.log('Computed IPFS hash:', ipfsCid)

    const addContentTx = this.api.tx.dataDirectory.addContent(contentId, HARDCODED_DO_TYPE, fileSize, ipfsCid);

    // TODO get from a Upload Scenario prop:
    const uploaderAccount = `5H1BPjHGWicySyxM2sUaWbPjnwVnDw923z1S1phPS9o9CHbg`

    await this.signTxAndSend(uploaderAccount, addContentTx)

    const dataObject = await this.findDataObject(contentId)
    if (!dataObject) {
      console.log(`❌ Data object was not found by content id: ${contentId.encode()}`);
      return;
    }
    console.log(`Data object created:`, dataObject.toJSON())
  }

  signTxAndSend = async (accountAddress: string, tx: SubmittableExtrinsic<CodecResult, SubscriptionResult>) => {
    const accountFilePath = path.join(ACCOUNTS_FOLDER, accountAddress + '.json')
    // tslint:disable-next-line:non-literal-fs-path
    const accountStats = fs.statSync(accountFilePath)
    if (!accountStats.isFile) {
      console.log(`❌ Not found an account file: ${accountFilePath}`)
      return
    }

    // tslint:disable-next-line:non-literal-require
    const accountJson: KeyringPair$Json = require(accountFilePath)

    console.log(`Using this account to upload content:`, accountJson)

    // TODO save keyring as a field of this class
    const keyring = new Keyring()
    const keypair = keyring.addFromJson(accountJson)
    if (keypair.isLocked()) {
      const accountPwd = '' // TODO (improvement) ask in terminal
      keypair.decodePkcs8(accountPwd);
    }

    // TODO check that an uploader account is a member!

    // get the nonce for the admin key
    const nonce = await this.api.query.system.accountNonce(keypair.address()) as unknown as Uint8Array;

    await new Promise((resolve, reject) => {
      tx
        .sign(keypair, { nonce })
        .send(({ events = [], status }) => {
          console.log('Transaction status:', status.type);

          if (status.isFinalized) {
            console.log('Completed at block hash', status.asFinalized.toHex());
            console.log('Events:');

            events.forEach(({ phase, event: { data, method, section } }) => {
              console.log('\t', phase.toString(), `: ${section}.${method}`, data.toString());
            });

            // process.exit(0);
            resolve()
          }
        }).catch(reject);
      })
  }

  isPrimaryLiaison = async (storageProviderId: AccountId) => {
    const primaryLiaison = await this.getPrimaryLiaison()
    return storageProviderId.eq(primaryLiaison)
  }

  uploadContent = async (storageProviderId: AccountId, filePath: fs.PathLike) => {

    // Check that storage provider is a primary liaison
    const primaryLiaison = await this.getPrimaryLiaison()
    if (!storageProviderId.eq(primaryLiaison)) {
      console.log(`❌ Can upload only to the primary liaison: ${primaryLiaison.toString()}. You specified a storage provider: ${storageProviderId.toString()}`)
      return
    }

    const fileError = canUploadFile(filePath)
    if (fileError) {
      console.log(`❌ Cannot upload: ${fileError}. File: ${filePath}`)
      return
    }

    // tslint:disable-next-line:non-literal-fs-path
    const fileStream = fs.createReadStream(filePath)
    
    // We need to pause file stream, otherwise stream will be read
    // before content is sent to a storage provider. 
    fileStream.pause()
    
    let chunksCount = 0;
    fileStream.on('data', (chunk) => {
      chunksCount++;
      console.log(`Uploader read a chunk #${chunksCount} = ${chunk.length} bytes`);
    });

    // tslint:disable-next-line:non-literal-fs-path
    const fileStats = fs.statSync(filePath)

    const newContentId = ContentId.generate();
    await this.createDataObject(newContentId, filePath)
    
    const config = {
      maxContentLength: fileStats.size, // <-- this is required
      headers: {
        'Content-Length': fileStats.size,
        // TODO uncomment this once the issue fixed:
        // https://github.com/Joystream/storage-node-joystream/issues/16
        // 'Content-Type': file.type
        'Content-Type': '' // <-- this is a required hack
      }

      // For some reson 'onUploadProgress' doesn't work when we send a file from Node.js.
      // That's why we don't use it here, but we track upload progress via stream.on('data',)
      // , onUploadProgress
    };

    var assetUrl = await this.resolveAssetEndpoint(storageProviderId, newContentId);

    console.log(`Starting to upload a file at URL: ${assetUrl}`);

    try {
      await axios.put<{ message: string }>(assetUrl, fileStream, config).catch(err => {
        console.log(`Error from axios.put:`, err)
      });

      // TODO create content metadata with title and cover?

      console.log(`✅ File uploaded at URL: ${assetUrl}`);
    } catch (err) {
      console.log(`❌ Failed to upload a file at URL: ${assetUrl}`, err);
      const isUploadFailed = !err.response || (err.response.status >= 500 && err.response.status <= 504);
      if (isUploadFailed) {
        // network connection error
        console.log(`Unreachable storage provider: ${storageProviderId}`)
      }
    }
  }
  
  destroy = () => {
    const { api } = this;
    if (api && api.isReady) {
      api.disconnect();
      console.log(`Disconnect from Substrate API.`);
    }
  }
}
