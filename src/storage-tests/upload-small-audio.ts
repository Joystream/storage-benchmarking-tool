import { RpcEndpoints, UploadTestScenario } from '../utils';

// const contentFileName = 'audio.mp3';
const contentFileName = 'art_of_war_01-02_sun_tzu.mp3';

export default new UploadTestScenario({
  chainRpc: RpcEndpoints.reckless,
  name: `Upload a small audio file: ${contentFileName}`,
  contentFileName,
  uploaderAccountId: `5H1BPjHGWicySyxM2sUaWbPjnwVnDw923z1S1phPS9o9CHbg`
});
