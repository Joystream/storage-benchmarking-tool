import { RpcEndpoints, DownloadTestScenario } from '../utils';

export function downloadAllContent () {
  console.log(`> You are in downloadAllContent`);
}

export default new DownloadTestScenario({
  chainRpc: RpcEndpoints.reckless,
  name: 'Download all content'
});
