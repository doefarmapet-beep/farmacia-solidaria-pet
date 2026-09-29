import { handleVercelRequest } from '../server.mjs';

export default async function handler(request, response) {
  await handleVercelRequest(request, response);
}