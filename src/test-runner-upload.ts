import axios from 'axios';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { Keyring } from '@polkadot/keyring';
import { KeyringPair$Json } from '@polkadot/keyring/types';

import { canUploadFile, HARDCODED_DO_TYPE, ACCOUNTS_FOLDER, UploadResultType, UploadTestScenario, resolveTestResultsFilePath } from './utils';
import { Option } from '@polkadot/types/codec';
import { ContentId } from '@joystream/types/lib/media';
import { AccountId } from '@polkadot/types';
import { CodecResult, SubscriptionResult } from '@polkadot/api/promise/types';
import { SubmittableExtrinsic } from '@polkadot/api/SubmittableExtrinsic';
// tslint:disable-next-line:import-name
import * as IpfsHash from 'ipfs-only-hash';
import { newProgressBar } from './progress-bar';
import { AbstractTester } from './test-runner-common';

// Update a console progress bar every X MB (in bytes):
const updateEvery_X_MB = 1;
const one_MB_in_bytes = 1024 ** 2;
const updateEveryXBytes = updateEvery_X_MB * one_MB_in_bytes;

export class UploadTester extends AbstractTester<UploadTestScenario, UploadResultType> {

  private getPrimaryLiaison = async (): Promise<AccountId | undefined> => {
    const primaryLiaison = await this.api.query.dataDirectory.primaryLiaisonAccountId() as unknown as Option<AccountId>;

    return primaryLiaison && primaryLiaison.isSome
      ? primaryLiaison.unwrap()
      : undefined
  }

  public isPrimaryLiaison = async (storageProviderId: AccountId) => {
    const primaryLiaison = await this.getPrimaryLiaison()
    return storageProviderId.eq(primaryLiaison)
  }

  public saveUploadResultsToFile = async (testName: string = `upload`) => {
    const fullPath = await resolveTestResultsFilePath(testName)
    const resultsJson = JSON.stringify(this.testResults, null, 2);
    await promisify(fs.writeFile)(fullPath, resultsJson);
    console.log(`Saved upload results to file: ${fullPath}`);
  }

  private createDataObject = async (contentId: ContentId, filePath: fs.PathLike) => {
    // tslint:disable-next-line:non-literal-fs-path
    const fileStats = fs.statSync(filePath)
    const fileSize = fileStats.size
    
    // tslint:disable-next-line:non-literal-fs-path
    const fileStream = fs.createReadStream(filePath);
    const ipfsCid = await IpfsHash.of(fileStream);
    console.log('Computed IPFS hash:', ipfsCid)

    const addContentTx: any = this.api.tx.dataDirectory.addContent(contentId, HARDCODED_DO_TYPE, fileSize, ipfsCid)

    const { uploaderAccountId } = (this.scenario as UploadTestScenario).props

    await this.signTxAndSend(uploaderAccountId, addContentTx)

    const dataObject = await this.findDataObject(contentId)
    if (!dataObject) {
      console.log(`❌ Data object was not found by content id: ${contentId.encode()}`);
      return;
    }
    console.log(`Data object created:`, dataObject.toJSON())
  }

  private signTxAndSend = async (accountAddress: string, tx: SubmittableExtrinsic<CodecResult, SubscriptionResult>) => {
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

  // tslint:disable-next-line:max-func-body-length
  public uploadContent = async (storageProviderId: AccountId, filePath: fs.PathLike) => {

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

    const consoleBar = newProgressBar('upload')
    let consumedSinceLastUpdate = 0;
    let consumedBytes = 0;
    
    fileStream.on('data', (chunk) => {
      const chunkSize = chunk.length
      consumedBytes += chunkSize;
      consumedSinceLastUpdate += chunkSize;
      if (consumedSinceLastUpdate >= updateEveryXBytes) {
        consoleBar.update(consumedBytes)
        if (consumedBytes >= fileSize) {
          consoleBar.stop()
          console.log(`Wait until content is marked as ready by the storage provider...`)
        }
      }
    });

    // tslint:disable-next-line:non-literal-fs-path
    const fileStats = fs.statSync(filePath)
    const fileSize = fileStats.size

    const newContentId = ContentId.generate();
    await this.createDataObject(newContentId, filePath)
    
    const config = {
      maxContentLength: fileSize, // <-- this is required
      headers: {
        'Content-Length': fileSize,
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
    consoleBar.start(fileSize, 0, { speed: "N/A" });

    const startTime = Date.now();

    const result: UploadResultType = {
      filePath: filePath.toString(),
      contentId: newContentId.encode(),
      storageProviderId: storageProviderId.toString(),
      assetUrl,
      startTime,
      endTime: startTime, // this is a temporary until the test is finished or interrapted
      fileSize,
      uploadedSize: 0,
      error: undefined
    };
    this.testResults.push(result);

    function onUploadFinished () {
      result.endTime = Date.now()
      result.uploadedSize = consumedBytes
      consoleBar.stop()
    }

    try {
      await axios.put<{ message: string }>(assetUrl, fileStream, config).catch(err => {
        console.log(`Error from axios.put:`, err)
      });

      // TODO create content metadata with title and cover?

      onUploadFinished()
      console.log(`✅ File uploaded at URL: ${assetUrl}`);
    } catch (err) {
      result.error = `Failed to upload a ful file due to an error: ${err}`
      onUploadFinished()
      console.log(`❌ Failed to upload a file at URL: ${assetUrl}`, err);
      
      const isUploadFailed = !err.response || (err.response.status >= 500 && err.response.status <= 504);
      if (isUploadFailed) {
        // network connection error
        console.log(`Unreachable a storage provider: ${storageProviderId}`)
      }
    }
  }
}
