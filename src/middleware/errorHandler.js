export function notFoundHandler(req, res) {
  res.status(404).json({ error: 'Route not found' })
}

export function errorHandler(err, req, res, next) {
  console.error(err)

  if (err.code === 'ER_DUP_ENTRY') {
    return res.status(409).json({ error: 'Duplicate entry' })
  }

  const status = err.status || 500
  res.status(status).json({ error: err.message || 'Internal server error' })
}
