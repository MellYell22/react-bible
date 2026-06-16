import { handleMobileBuilderHttp } from '../lib/mobile-builder/http';

export default async function handler(req: any, res: any) {
  const result = await handleMobileBuilderHttp({
    method: req.method,
    url: req.url,
    body: req.body,
  });

  res.status(result.status).json(result.body);
}
