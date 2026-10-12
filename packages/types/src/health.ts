/** Public `GET /health` body; `version` is the deployed API's SemVer. */
export interface ApiHealth {
  status: 'ok';
  version: string;
}
