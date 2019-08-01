import axios from 'axios';
import * as numeral from 'numeral';
import * as _ from 'lodash';
import * as fs from 'fs';
import * as path from 'path';
import { promisify } from 'util';
import { Writable } from 'stream';

import { DownloadResultType, base64Hash, RANDOM_RANGES_FOLDER, DownloadTestScenario, RandomRange, resolveTestResultsFilePath, formatNumber, resolveRandomRangesFilePath } from './utils';
import { Option } from '@polkadot/types/codec';
import { ContentId, ContentMetadata } from '@joystream/types/lib/media';
import { AccountId } from '@polkadot/types';
import { newProgressBar } from './progress-bar';
import { AbstractTester } from './test-runner-common';

// Update a console progress bar every X MB (in bytes):
const updateEvery_X_MB = 1;
const one_MB_in_bytes = 1024 ** 2;
const updateEveryXBytes = updateEvery_X_MB * one_MB_in_bytes;

export class DownloadTester extends AbstractTester<DownloadTestScenario, DownloadResultType> {

  public getStakedProviders = async (): Promise<AccountId[]> => {
    return await this.api.query.actors.actorAccountIds() as unknown as AccountId[];
  }

  // tslint:disable-next-line:max-func-body-length
  public downloadContent = async (storageProviderId: AccountId, contentId: ContentId, randomRanges: RandomRange[] = []) => {
    
    const { generateRandomRanges } = (this.scenario as DownloadTestScenario).props;
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
    if (generateRandomRanges) {
      console.log(`Generating random ranges of ${contentFromUrlStr}`)
    } else {
      console.log(`Downloading ${contentFromUrlStr}`)
    }

    const expectedSize = dataObject.size_in_bytes.toNumber();
    const consoleBar = newProgressBar('download')

    const startTime = Date.now();

    const result: DownloadResultType = {
      contentId: contentId.encode(),
      contentName: metaJson.name,
      storageProviderId: storageProviderId.toString(),
      assetUrl,
      startTime,
      endTime: startTime, // this is a temporary until the test is finished or interrapted
      fileSize: expectedSize,
      downloadedSize: 0,
      error: undefined
    };
    this.testResults.push(result);

    const passedMillis = () => {
      const passed = Date.now() - startTime;
      return {
        asNumber: passed,
        asString: formatNumber(passed)
      };
    }

    const headers: any = {}
    // console.log({ randomRanges })


    let expectedHash: string
    let expectedRangeSize: number

    const useRandomRanges = randomRanges && randomRanges.length > 0
    if (useRandomRanges) {
      const range = randomRanges[0] // TODO get in a loop for every passed range
      expectedRangeSize = range.endIdx - range.startIdx
      expectedHash = range.base64Hash
      console.log(`Requested range:`, range)
      headers.Range = `bytes=${range.startIdx}-${range.endIdx-1}`
    }
    
    consoleBar.start(expectedSize, 0, { speed: "N/A" })
    
    const response = await axios.get(assetUrl, {
      responseType: 'stream',
      headers,
      // headers: { Range: `bytes=0-4` } // Just for debug.
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

    let consumedSinceLastUpdate = 0;
    let consumedBytes = 0;

    let randomRangesStr = ''

    let downloadedRange = Buffer.from([]) // TODO it should be Buffer

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

            // console.log(`==> Download chunk of size`, chunk.length, `bytes:`, chunk)

            const chunkSize = chunk && chunk.length ? chunk.length : 0;

            if (generateRandomRanges && chunkSize > 0) {
              const halfSize = Math.floor(chunkSize / 2)
              // tslint:disable-next-line:insecure-random
              const start = Math.floor(Math.random() * halfSize)
              const end = start + halfSize
              const randomRange = chunk.slice(start, end)
              const globalStart = consumedBytes + start
              const globalEnd = globalStart + halfSize
              const hash = base64Hash(randomRange)
              
              if (randomRangesStr.length > 0) {
                randomRangesStr += '\n'
              }
              randomRangesStr += `${globalStart};${globalEnd};${hash}`

              // console.log(`>> ${chunksProcessed + 1}) Hash b64 [${globalStart}-${globalEnd}; size: ${end - start}]: ${hash}`)
            }

            
            // TODO print received range:
            if (useRandomRanges) {
              downloadedRange = Buffer.concat([downloadedRange, chunk])
              if (downloadedRange.length >= expectedRangeSize) {
                const actualHash = base64Hash(downloadedRange)
                console.log(`Expected base64 hash: ${expectedHash}`)
                console.log(`Actual base64 hash:   ${actualHash}`)
              }
            }
            


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
        result.error = `Failed to download a full content due to an error: ${err}`;
        
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
    console.log(`✅ Content downloaded! Consumed ${formatNumber(consumedBytes)} bytes in ${passed} millis`)

    if (generateRandomRanges && randomRangesStr.length > 0) {
      const rangesFilePath = await resolveRandomRangesFilePath(contentId)
      await promisify(fs.writeFile)(rangesFilePath, randomRangesStr);
      console.log(`✅ Random ranges w/ their hashes in base64 saved to file: ${rangesFilePath}`);
    }
  }

  public saveDownloadResultsToFile = async (testName: string = `download`) => {
    const fullPath = await resolveTestResultsFilePath(testName)
    const resultsJson = JSON.stringify(this.testResults, null, 2);
    await promisify(fs.writeFile)(fullPath, resultsJson);
    console.log(`Saved download results to file: ${fullPath}`);
  }
}
