import axios from 'axios';
import * as numeral from 'numeral';
import * as _ from 'lodash';
import * as fs from 'fs';
import { promisify } from 'util';
import { Writable } from 'stream';

import { DownloadResultType, base64Hash, DownloadTestScenario, RandomRange, resolveTestResultsFilePath, formatNumber, resolveRandomRangesFilePath, getRandomRangesFromCsvFile } from './utils';
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

  protected findContentMetadata = async (contentId: ContentId): Promise<ContentMetadata> => {
    const metadataOpt = await this.api.query.dataDirectory
      .metadataByContentId(contentId) as Option<ContentMetadata>;
    return metadataOpt.unwrapOr(undefined);
  }

  protected getContentName = async (contentId: ContentId): Promise<string> => {
    const metadata = await this.findContentMetadata(contentId)
    return metadata ? metadata.parseJson().name : undefined;
  }

  // tslint:disable-next-line:max-func-body-length
  public downloadContent = async (storageProviderId: AccountId, contentId: ContentId) => {
    
    const { generateRandomRanges, useRandomRanges, maxRandomRanges: randomRangesCount } = this.scenario.props;

    const cid = contentId.encode();
    const assetUrl = await this.resolveAssetEndpoint(storageProviderId, contentId);

    const headers: any = {}

    let randomRanges: RandomRange[]
    let range: RandomRange
    let expectedHash: string
    let expectedRangeSize: number
    let totalRangesSize: number
    let currentRangeNumber: number

    let randomRangesStr = ''
    let matchedRanges = 0
    let downloadedRange: Buffer

    if (useRandomRanges) {
      randomRanges = await getRandomRangesFromCsvFile(cid, randomRangesCount)
      totalRangesSize = randomRanges.reduce((acc, range) => {
        return acc + range.endIdx - range.startIdx
      }, 0)
    }

    const dataObject = await this.findDataObject(contentId)
    if (!dataObject) {
      console.log(`❌ Data object was not found by content id: ${cid}`);
      return;
    }
    
    const contentName = await this.getContentName(contentId)

    const contentFromUrlStr = `content from URL ${assetUrl}`;
    if (generateRandomRanges) {
      console.log(`Generating random ranges of ${contentFromUrlStr}`)
    } else {
      console.log(`Downloading ${contentFromUrlStr}`)
    }

    const fileSize = dataObject.size_in_bytes.toNumber()
    const expectedSize = randomRanges ? totalRangesSize : fileSize

    const progressKind = useRandomRanges ? `range-download` : `full-download`
    const consoleBar = newProgressBar(progressKind)
    const startTime = Date.now();

    const result: DownloadResultType = {
      contentId: cid,
      contentName,
      storageProviderId: storageProviderId.toString(),
      assetUrl,
      startTime,
      endTime: startTime, // this is temporary until the test is finished or interrupted
      fileSize,
      downloadedSize: 0,
      randomRanges,
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

    const buildDownloadRequest = async () => {
      // console.log({ headers })
      const response = await axios.get(assetUrl, {
        responseType: 'stream',
        headers,
      }).catch(err => {
        const passed = passedMillis().asString;
        throw new Error(`Failed to request ${contentFromUrlStr} after ${passed} millis. Error: ${err.toString()}`);
      });
  
      if (!response) {
        throw new Error(`Received an empty response from assent endpoint`)
      }

      return response
    }

    let consumedSinceLastUpdate = 0;
    let consumedBytes = 0;

    const calcSpeedInMbPerSec = () => {
      const mbConsumed = consumedBytes / updateEveryXBytes;
      const secsPassed = passedMillis().asNumber / 1000;
      return mbConsumed / secsPassed;
    }

    const updateProgressBar = () => {
      const speed = numeral(calcSpeedInMbPerSec()).format('0.00');
      const progressPayload: any = { speed }
      if (useRandomRanges) {
        progressPayload.range = currentRangeNumber
      }
      consoleBar.update(consumedBytes, progressPayload);
    }

    const consumeContent = async () => new Promise((resolve, _reject) => {
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
                // console.log(`Expected base64 hash: ${expectedHash}`)
                // console.log(`Actual base64 hash:   ${actualHash}`)
                if (actualHash === expectedHash) {
                  matchedRanges++
                } else {
                  throw new Error(`Range hashes don't match: ${JSON.stringify(range)}`)
                }
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

        buildDownloadRequest().then(response =>
          response.data.pipe(stream)
        )
      } catch (err) {
        const passed = passedMillis().asString;
        result.endTime = Date.now();
        result.downloadedSize = consumedBytes;
        result.error = `Failed to download a content due to an error: ${err}`;
        
        consoleBar.stop();
        console.log(`❌ Failed to download a content. Consumed ${formatNumber(consumedBytes)} bytes. Passed ${passed} millis.`, err);
        resolve();
      }
    });
    
    const progressPayload: any = { speed: "N/A" }
    if (useRandomRanges) {
      progressPayload.range = 1
      progressPayload.rangesCount = randomRanges.length
    }
    consoleBar.start(expectedSize, 0, progressPayload)

    if (useRandomRanges) {
      for (let i = 0; i < randomRanges.length; i++) {
        range = randomRanges[i]
        currentRangeNumber = i + 1
        expectedRangeSize = range.endIdx - range.startIdx
        expectedHash = range.base64Hash
        downloadedRange = Buffer.from([])
        headers.Range = `bytes=${range.startIdx}-${range.endIdx-1}`
        // console.log(`Using a random range #${i+1}/${randomRanges.length}:`, range)
        await consumeContent()
      }
    } else {
      await consumeContent()
    }
    
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
