import { pool } from '../config/db.js'

const PAGES = ['home', 'packages']

const SINGLETON_TYPES = new Set(['category_showcase', 'all_products'])

function keyOf(entry) {
  return SINGLETON_TYPES.has(entry.type) ? entry.type : `${entry.type}:${entry.id}`
}

async function fetchEligible(page) {
  const bannerPlacement = page === 'home' ? 'home_promo' : 'packages'
  const [[banners], [collections]] = await Promise.all([
    pool.query(
      `SELECT id, title FROM banners WHERE kind = 'promo' AND placement = ? AND is_active = 1 ORDER BY sort_order ASC, created_at ASC`,
      [bannerPlacement]
    ),
    pool.query(`SELECT id, name FROM collections WHERE is_active = 1 ORDER BY sort_order ASC`),
  ])
  return { banners, collections }
}

/** Mirrors frontend/src/utils/collections.ts's isPackageCollection() — used
 * ONLY to decide the Paquetes page's very first seed (so migrating to this
 * curated-list system doesn't change what a customer already sees that
 * page showing). Every collection is eligible for ongoing curation
 * afterward regardless of pricing mode — the admin decides from then on. */
async function fetchPackageCollectionIds(collectionIds) {
  if (collectionIds.length === 0) return new Set()
  const [rows] = await pool.query(
    `SELECT c.id, c.pricing_mode, c.unit_price, c.unit_min_qty, c.bundle_qty, c.bundle_price,
            (SELECT COUNT(*) FROM collection_bundle_parts p WHERE p.collection_id = c.id) AS parts_count,
            (SELECT COUNT(*) FROM collection_bundle_parts p WHERE p.collection_id = c.id AND p.price IS NOT NULL) AS priced_parts_count,
            (SELECT COUNT(*) FROM collection_combo_tiers t WHERE t.collection_id = c.id) AS combo_tiers_count
     FROM collections c WHERE c.id IN (?)`,
    [collectionIds]
  )
  const ids = new Set()
  for (const c of rows) {
    let isPackage = false
    if (c.pricing_mode === 'bundle') {
      isPackage = (!!c.bundle_qty && !!c.bundle_price) || c.priced_parts_count > 0
    } else if (c.pricing_mode === 'unit') {
      isPackage = !!c.unit_price && ((!!c.unit_min_qty && c.unit_min_qty > 1) || c.parts_count > 0)
    } else if (c.pricing_mode === 'wholesale') {
      isPackage = true
    } else if (c.pricing_mode === 'combo') {
      isPackage = c.combo_tiers_count > 0
    }
    if (isPackage) ids.add(c.id)
  }
  return ids
}

/** Turns whatever this page's admin has explicitly curated (plus whatever
 * banners/collections actually exist right now) into the final,
 * safe-to-render list — the single source of truth both the admin's
 * ordering screen and the storefront read from. A brand new banner or
 * collection is appended automatically (nothing silently vanishes just for
 * being created after the last save) UNLESS it was explicitly removed from
 * this page before — that removal is remembered so it doesn't just
 * reappear on the next read. Stale references (since deleted/deactivated)
 * are dropped silently either way. */
async function resolvePageLayout(page) {
  const [storedRows] = await pool.query('SELECT order_json FROM page_layouts WHERE page = ?', [page])
  const stored = storedRows[0]?.order_json ?? null
  const { banners, collections } = await fetchEligible(page)
  const bannerById = new Map(banners.map((b) => [b.id, b]))
  const collectionById = new Map(collections.map((c) => [c.id, c]))

  function labelOf(entry) {
    if (SINGLETON_TYPES.has(entry.type)) return undefined
    if (entry.type === 'banner') return bannerById.get(entry.id)?.title ?? '(sin título)'
    return collectionById.get(entry.id)?.name
  }

  // First-ever load for this page — seed the exact order/membership it
  // already rendered in before this feature existed, so migrating to this
  // curated-list system doesn't visibly change either page. Every eligible
  // collection is accounted for one way or the other (included now, or
  // explicitly `removed`) so nothing that was previously hidden reappears
  // just because it's newly "eligible" under the unified system.
  if (stored === null) {
    let includedCollections = collections
    let excludedCollections = []
    if (page === 'home') {
      const [rows] = await pool.query('SELECT id, show_on_home FROM collections WHERE is_active = 1')
      const shown = new Set(rows.filter((r) => r.show_on_home).map((r) => r.id))
      includedCollections = collections.filter((c) => shown.has(c.id))
      excludedCollections = collections.filter((c) => !shown.has(c.id))
    } else {
      const packageIds = await fetchPackageCollectionIds(collections.map((c) => c.id))
      includedCollections = collections.filter((c) => packageIds.has(c.id))
      excludedCollections = collections.filter((c) => !packageIds.has(c.id))
    }

    const seeded = [
      ...banners.map((b) => ({ type: 'banner', id: b.id })),
      ...(page === 'home' ? [{ type: 'category_showcase' }] : []),
      ...includedCollections.map((c) => ({ type: 'collection', id: c.id })),
      // "Todos los productos" already rendered unconditionally, always last,
      // before this curated-list system existed — seeding it in that same
      // spot keeps a migrating site's home page looking identical.
      ...(page === 'home' ? [{ type: 'all_products' }] : []),
    ]
    const removed = excludedCollections.map((c) => ({ type: 'collection', id: c.id }))
    await pool.query('INSERT INTO page_layouts (page, order_json) VALUES (?, ?)', [
      page,
      JSON.stringify({ order: seeded, removed }),
    ])
    return seeded.map((e) => ({ ...e, label: labelOf(e) }))
  }

  const storedOrder = Array.isArray(stored.order) ? stored.order : []
  const removedKeys = new Set((Array.isArray(stored.removed) ? stored.removed : []).map(keyOf))

  const resolved = []
  const seen = new Set()
  for (const entry of storedOrder) {
    if (!entry) continue
    const key = keyOf(entry)
    if (seen.has(key)) continue
    if (SINGLETON_TYPES.has(entry.type) && page === 'home') {
      resolved.push({ type: entry.type })
      seen.add(key)
    } else if (entry.type === 'banner' && bannerById.has(entry.id)) {
      resolved.push({ type: 'banner', id: entry.id, label: labelOf(entry) })
      seen.add(key)
    } else if (entry.type === 'collection' && collectionById.has(entry.id)) {
      resolved.push({ type: 'collection', id: entry.id, label: labelOf(entry) })
      seen.add(key)
    }
  }

  // Auto-append anything live that's neither already placed nor explicitly
  // removed before.
  for (const b of banners) {
    const key = `banner:${b.id}`
    if (!seen.has(key) && !removedKeys.has(key)) resolved.push({ type: 'banner', id: b.id, label: b.title ?? '(sin título)' })
  }
  for (const c of collections) {
    const key = `collection:${c.id}`
    if (!seen.has(key) && !removedKeys.has(key)) resolved.push({ type: 'collection', id: c.id, label: c.name })
  }
  if (page === 'home') {
    for (const t of SINGLETON_TYPES) {
      if (!seen.has(t) && !removedKeys.has(t)) resolved.push({ type: t })
    }
  }

  return resolved
}

export async function getPageLayout(req, res, next) {
  try {
    const { page } = req.params
    if (!PAGES.includes(page)) return res.status(400).json({ error: `page must be one of: ${PAGES.join(', ')}` })
    res.json(await resolvePageLayout(page))
  } catch (err) {
    next(err)
  }
}

export async function updatePageLayout(req, res, next) {
  try {
    const { page } = req.params
    if (!PAGES.includes(page)) return res.status(400).json({ error: `page must be one of: ${PAGES.join(', ')}` })
    const { order } = req.body
    if (!Array.isArray(order)) return res.status(400).json({ error: 'order array is required' })

    const validType = (t) => t === 'banner' || t === 'collection' || (SINGLETON_TYPES.has(t) && page === 'home')
    const bare = order
      .filter((e) => e && validType(e.type))
      .map(({ type, id }) => (id !== undefined ? { type, id } : { type }))
    const includedKeys = new Set(bare.map(keyOf))

    const [storedRows] = await pool.query('SELECT order_json FROM page_layouts WHERE page = ?', [page])
    const prevRemoved = Array.isArray(storedRows[0]?.order_json?.removed) ? storedRows[0].order_json.removed : []

    const { banners, collections } = await fetchEligible(page)
    const eligibleEntries = [
      ...(page === 'home' ? [...SINGLETON_TYPES].map((type) => ({ type })) : []),
      ...banners.map((b) => ({ type: 'banner', id: b.id })),
      ...collections.map((c) => ({ type: 'collection', id: c.id })),
    ]

    // Whatever's eligible but not in the submitted order just got removed —
    // union with anything already remembered as removed, minus whatever the
    // client just explicitly re-included (that clears its removed status).
    const removedMap = new Map(prevRemoved.filter((e) => e && !includedKeys.has(keyOf(e))).map((e) => [keyOf(e), e]))
    for (const e of eligibleEntries) {
      if (!includedKeys.has(keyOf(e))) removedMap.set(keyOf(e), e)
    }

    await pool.query(
      'INSERT INTO page_layouts (page, order_json) VALUES (?, ?) ON DUPLICATE KEY UPDATE order_json = VALUES(order_json)',
      [page, JSON.stringify({ order: bare, removed: [...removedMap.values()] })]
    )

    res.json(await resolvePageLayout(page))
  } catch (err) {
    next(err)
  }
}
