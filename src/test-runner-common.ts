import axios from 'axios';
import { parse as parseUrl } from 'url';
import * as _ from 'lodash';

import { RpcEndpoints, arrayToConsoleString, TestScenario, TestResultType, normalizeUrl } from './utils';
import { ApiPromise, WsProvider } from '@polkadot/api';
import { Option, Vector } from '@polkadot/types/codec';
import { registerJoystreamTypes } from '@joystream/types';
import { DataObjectStorageRelationshipId, DataObjectStorageRelationship, ContentId, DataObject } from '@joystream/types/lib/media';
import { AccountId } from '@polkadot/types';
import { Url } from '@joystream/types/lib/discovery';

type ServiceInfoEntry = {
  version: number,
  endpoint: string
}

type ServiceInfo = {
  asset: ServiceInfoEntry,
  discover: ServiceInfoEntry,
}

export abstract class AbstractTester<T extends TestScenario<any>, R extends TestResultType> {

  protected scenario: T
  protected testResults: R[] = []
  protected bootstrapNodes: Url[]
  protected api: ApiPromise

  constructor (scenario: T) {
    this.scenario = scenario
  }

  public setup = async () => {
    await this.connectToApi();
    await this.findBootstrapNodes();
    return this;
  }

  public destroy = () => {
    const { api } = this;
    if (api && api.isReady) {
      api.disconnect();
      console.log(`Disconnect from Substrate API.`);
    }
  }

  private dataObjectQuery = () => {
    return this.api.query.dataObjectStorageRegistry;
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

  public getStakedProviders = async (): Promise<AccountId[]> => {
    return await this.api.query.actors.actorAccountIds() as unknown as AccountId[];
  }

  public findReadyContentProviders = async (contentId: ContentId): Promise<AccountId[]> => {
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

  public getKnownContentIds = async () => {
    return await this.api.query.dataDirectory.knownContentIds() as unknown as Vector<ContentId>;
  }

  protected findDataObject = async (contentId: ContentId) => {
    const dataObjectOpt = await this.api.query.dataDirectory.dataObjectByContentId(contentId) as Option<DataObject>;
    return dataObjectOpt.unwrapOr<DataObject>(undefined);
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

  protected resolveAssetEndpoint = async (storageProvider: AccountId, contentId: ContentId): Promise<string | undefined> => {
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
}
