import { RpcEndpoints, UploadTestScenario } from '../utils';

const contentFileName = 'staked.mp3';

export default new UploadTestScenario({
  chainRpc: RpcEndpoints.reckless,
  name: `Upload a big audio file: ${contentFileName}`,
  contentFileName,
  uploaderAccountId: `5H1BPjHGWicySyxM2sUaWbPjnwVnDw923z1S1phPS9o9CHbg`
});
