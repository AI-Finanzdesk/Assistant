/** Vercel Cron stuurt automatisch "Authorization: Bearer $CRON_SECRET". */
export function isCronAuthorized(request: Request) {
  const secret = process.env.CRON_SECRET;
  return Boolean(secret) && request.headers.get("authorization") === `Bearer ${secret}`;
}
