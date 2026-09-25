// SPDX-License-Identifier: MIT
pragma solidity ^0.8.28;

/// @notice Minimal ENSv2 registry surface used by `SubscriptionRegistrar`.
/// @dev Transcribed from the vendored ABI in `packages/core/abis/UserRegistryImpl.json`
///      (rule 1 — nothing is declared here that is not in that ABI).
interface IRegistry {
    function getSubregistry(string calldata label) external view returns (IRegistry);
    function getResolver(string calldata label) external view returns (address);
}

/// @notice The subset of `IPermissionedRegistry` the registrar needs.
interface IPermissionedRegistry is IRegistry {
    /// @notice Registers a new label.
    /// @param label The label to register.
    /// @param owner The owner of the label.
    /// @param registry The subregistry to set for the label.
    /// @param resolver The resolver to set for the label.
    /// @param roleBitmap The EAC roles granted to `owner` on the label's resource.
    /// @param expiry Absolute expiry, in unix seconds.
    /// @return tokenId The minted token ID.
    function register(
        string calldata label,
        address owner,
        IRegistry registry,
        address resolver,
        uint256 roleBitmap,
        uint64 expiry
    ) external returns (uint256 tokenId);

    /// @notice Extend a registration. `anyId` is a labelhash, token ID, or resource.
    function renew(uint256 anyId, uint64 newExpiry) external;

    /// @notice Expiry of a label. Zero when unregistered.
    function findExpiry(string calldata label) external view returns (uint64);

    /// @notice Current token ID for a label. Changes when roles change — never cache it.
    function findTokenId(string calldata label) external view returns (uint256);

    /// @notice Grant EAC roles on a resource.
    function grantRoles(uint256 resource, uint256 roleBitmap, address account)
        external
        returns (bool);

    /// @notice The EAC resource backing a label. `anyId` is a labelhash, token ID, or resource.
    function getResource(uint256 anyId) external view returns (uint256 resource);
}
