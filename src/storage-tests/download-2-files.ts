import { RpcEndpoints, DownloadTestScenario } from '../utils';

export default new DownloadTestScenario({
  chainRpc: RpcEndpoints.reckless,
  name: 'Download 2 media files',
  contentIds: [
    // 4 MB file on Reckless:
    '5EPeofnvh2rqswd8E8mqWaYGPvaHC13HdMZwhZexjXz5EZbb',
    // 90 MB file on Reckless:
    '5DNMsxhtiBSFmi1egRLuKkRYGFf6CVTFjvqHKhZkqEr7sk8a'
  ]
});
