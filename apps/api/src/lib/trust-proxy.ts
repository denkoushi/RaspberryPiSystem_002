// Caddy overwrites X-Forwarded-For with its socket peer; trust only that last hop.
// Fastify 5.12.5 disables numeric hop counts, so express one hop as a predicate.
export const trustImmediateProxy = (_address: string, hop: number): boolean => hop === 0;
