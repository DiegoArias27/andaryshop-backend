import rateLimit from 'express-rate-limit'

// Applied to login/register endpoints to slow down credential-stuffing and
// brute-force attempts. Keyed by IP; generous enough not to lock out a
// legitimate user retrying a typo, tight enough to blunt automated abuse.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados intentos. Intenta de nuevo en unos minutos.' },
})
