import { RpcEndpoints, UploadTestScenario } from '../utils';

const contentFileName = 'audio.mp3';

export default new UploadTestScenario({
  chainRpc: RpcEndpoints.reckless,
  name: `Upload a small audio file: ${contentFileName}`,
  contentFileName
});
