import { createRemoteJWKSet, jwtVerify } from 'jose';
import data from './catalog.json' with { type: 'json' };
import { createPodarkusLocal } from './catalog-engine.js';
import { createHandler } from './service.js';

const keys = createRemoteJWKSet(new URL('https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com'));
export async function verifyFirebaseToken(token, projectId, keySet = keys) {
  const { payload } = await jwtVerify(token, keySet, {
    algorithms: ['RS256'], audience: projectId, issuer: 'https://securetoken.google.com/' + projectId,
    requiredClaims: ['exp', 'iat', 'sub', 'auth_time'], clockTolerance: 30
  });
  if (typeof payload.sub !== 'string' || !payload.sub || payload.sub.length > 128 ||
      typeof payload.iat !== 'number' || payload.iat > Date.now() / 1000 + 30 ||
      typeof payload.auth_time !== 'number' || payload.auth_time < 0 || payload.auth_time > Date.now() / 1000 + 30) throw Error('Invalid identity');
  return { sub: payload.sub };
}
const handler = createHandler({ catalogue: createPodarkusLocal(data, true), verifyToken: verifyFirebaseToken });
export default { fetch: handler };
