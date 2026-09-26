/**
 * The knowledge network: claims, provenance, review and versioned namespaces.
 *
 * This layer only ever learns. Everything it can do is about knowledge — state
 * a claim, cite a source, merge corroborating evidence, review a proposal,
 * commit a version, publish a pointer. There is no operation here that books,
 * sends, replies or spends, and that is a property of the design rather than a
 * feature not yet written: a knowledge network that could also act on your
 * behalf would need a trust model it does not have.
 *
 * Products built on top may act. When they do, the boundary they cross is their
 * own to declare and consent to — it does not move this one.
 */
export * from './contracts.js'
export * from './resolve.js'
export * from './roles.js'
export * from './crypto.js'
export * from './knowledge/index.js'
export * from './onchain.js'
export * from './publishers.js'
