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

// Order creation is the one other public, unauthenticated write endpoint
// (a guest checking out never logs in) — without this, nothing stops a
// script from flooding it with fake orders. Loose enough that a real
// shopper placing several orders in a session never hits it.
export const orderRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 30,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Demasiados pedidos seguidos. Intenta de nuevo en unos minutos.' },
})
