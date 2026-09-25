// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice ENSv2 role constants, mirrored from the vendored `RegistryRolesLib`
///         and `PermissionedResolverLib` at the commit pinned in CONTRACTS.md.
/// @dev Roles are nybble-packed: slots 0-31 are regular roles, slots 32-63 are
///      admin roles at exactly `regular << 128`.
library RecallRoles {
    // --- registry ---

    /// @dev Nybble 4: authorizes extending a registration's expiry.
    uint256 internal constant ROLE_RENEW = 1 << 16;
    /// @dev Nybble 36: authorizes granting ROLE_RENEW.
    uint256 internal constant ROLE_RENEW_ADMIN = ROLE_RENEW << 128;

    /// @dev Nybble 6: authorizes changing a name's resolver.
    uint256 internal constant ROLE_SET_RESOLVER = 1 << 24;

    // --- resolver ---

    /// @dev Nybble 3: authorizes `setPubkey` on the resolver.
    uint256 internal constant ROLE_SET_PUBKEY = 1 << 12;
}
