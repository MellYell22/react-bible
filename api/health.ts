export default async function handler(req: any, res: any) {
  res.status(200).json({ 
    status: "ok", 
    env: process.env.NODE_ENV,
    appUrl: process.env.APP_URL || "not set"
  });
}
